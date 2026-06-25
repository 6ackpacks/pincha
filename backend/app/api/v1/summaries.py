import json
import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import SUMMARY_AVAILABLE_TTL, SUMMARY_TTL, cache_delete, cache_get, cache_set, summary_available_key, summary_key
from app.core.auth import get_current_user
from app.core.database import async_session, get_session
from app.core.deps import require_user_video
from app.core.rate_limit import limiter
from app.core.sse_limiter import SSEConnectionGuard, sse_concurrency_guard
from app.models.summary import Summary
from app.models.user import User
from app.schemas.summary import SummaryLevel, SummaryResponse
from app.services.summary_stream import get_buffered_events

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/videos/{video_id}/summary", tags=["summaries"])


def _check_transcript_ready(video) -> None:
    """Raise 409 if the video is still processing and transcript is not ready yet.

    This check was previously inside summary_service._fetch_transcript_text but
    belongs in the route layer since it depends on the Video model's status field.
    """
    status = video.status
    if not status:
        return
    state = status.get("state", "pending") if isinstance(status, dict) else "pending"
    if state in ("pending", "downloading", "transcribing", "summarizing"):
        raise HTTPException(
            status_code=409,
            detail=f"Video is still processing (state: {state}). Transcript not ready yet.",
        )


@router.get("/available", response_model=list[str])
async def get_available_summary_levels(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return which summary levels have already been generated (no generation triggered)."""
    await require_user_video(db, current_user, video_id)

    key = summary_available_key(str(video_id))
    cached = await cache_get(key)
    if cached is not None:
        return cached

    result = await db.execute(
        select(Summary.level).where(Summary.video_id == video_id)
    )
    levels = list(result.scalars().all())
    await cache_set(key, levels, SUMMARY_AVAILABLE_TTL)
    return levels


@router.post("/full/generate")
async def trigger_full_generation(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Trigger background generation of full (90%) summary on user request."""
    await require_user_video(db, current_user, video_id)

    result = await db.execute(
        select(Summary.id).where(Summary.video_id == video_id, Summary.level == "full")
    )
    if result.scalar_one_or_none():
        return {"status": "already_exists"}

    from app.tasks.video_tasks import generate_full_summary
    task = generate_full_summary.delay(str(video_id))
    await cache_delete(summary_available_key(str(video_id)))
    return {"status": "generating", "task_id": task.id}


@router.get("/stream")
async def stream_summary_generation(
    video_id: uuid.UUID,
    last_seq: int = 0,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    sse_guard: SSEConnectionGuard = Depends(sse_concurrency_guard),
):
    """SSE endpoint streaming real-time summary generation tokens.

    Two-phase approach:
      Phase 1 — Replay buffered events from Redis List (seq > last_seq)
      Phase 2 — Subscribe to Pub/Sub for real-time new events (dedup by seq)

    Query params:
      last_seq: resume from this sequence number on reconnect (default 0)

    Events:
      - {"type": "delta", "level": "detailed", "delta": "...", "seq": N}
      - {"type": "level_ready", "level": "highlight", "seq": N}
      - {"type": "done", "levels": [...], "seq": N}

    Rate limit: max 5 concurrent SSE connections per user.
    """
    await require_user_video(db, current_user, video_id)

    from app.core.redis import get_redis

    async def _stream():
        redis = await get_redis()
        channel = f"video:{str(video_id)}:summary_stream"
        max_seq_sent = last_seq
        terminal_reached = False

        try:
            # Phase 1: Replay buffered events
            buffered = await get_buffered_events(str(video_id), after_seq=last_seq, redis=redis)
            for ev in buffered:
                seq = ev.get("seq", 0)
                if seq > max_seq_sent:
                    max_seq_sent = seq
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                    if ev.get("_terminal"):
                        terminal_reached = True

            if terminal_reached:
                return

            # Phase 2: Real-time subscription with dedup
            pubsub = redis.pubsub()
            await pubsub.subscribe(channel)

            try:
                deadline = time.monotonic() + 300  # 5 min max
                while time.monotonic() < deadline:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=5.0
                    )
                    if message is None:
                        yield ": keepalive\n\n"
                        continue

                    if message["type"] == "message":
                        try:
                            data = json.loads(message["data"])
                        except (json.JSONDecodeError, TypeError):
                            continue

                        seq = data.get("seq", 0)
                        if seq <= max_seq_sent:
                            continue  # Dedup

                        max_seq_sent = seq
                        yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

                        if data.get("_terminal") or data.get("type") == "done":
                            break
            finally:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
        finally:
            await sse_guard.release()

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "Content-Encoding": "identity",
        },
    )


@router.get("/{level}", response_model=SummaryResponse)
@limiter.limit("10/minute")
async def get_summary(
    request: Request,
    video_id: uuid.UUID,
    level: SummaryLevel,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get or generate summary for a video at the specified level.

    Rate limit: 10/minute (LLM generation).
    """
    video = await require_user_video(db, current_user, video_id)
    _check_transcript_ready(video)

    t0 = time.perf_counter()
    key = summary_key(str(video_id), level)
    cached = await cache_get(key)
    if cached is not None:
        logger.info("summary/%s cache hit for %s (%.0fms)", level, video_id, (time.perf_counter() - t0) * 1000)
        return cached

    # For full level, check DB first and return 202 if not yet generated
    if level == "full":
        result = await db.execute(
            select(Summary).where(Summary.video_id == video_id, Summary.level == level)
        )
        existing = result.scalar_one_or_none()
        if existing:
            response = SummaryResponse.model_validate(existing)
            response.cached = False
            await cache_set(key, response.model_dump(mode="json"), SUMMARY_TTL)
            return response
        # Not generated yet — trigger background task and return 202
        from app.tasks.video_tasks import generate_full_summary
        generate_full_summary.delay(str(video_id))
        await cache_delete(summary_available_key(str(video_id)))
        logger.info("summary/full not ready for %s, triggered background generation", video_id)
        return JSONResponse(
            status_code=202,
            content={"status": "generating", "message": "完整总结正在生成中，请稍后重试"},
        )

    # Other levels (express/highlight/detailed): generate synchronously
    from app.services.summary_service import get_or_create_summary
    logger.info("summary/%s cache miss for %s, generating...", level, video_id)
    summary, cached_flag = await get_or_create_summary(db, video_id, level)
    elapsed = (time.perf_counter() - t0) * 1000
    logger.info("summary/%s generated for %s (%.0fms)", level, video_id, elapsed)
    response = SummaryResponse.model_validate(summary)
    response.cached = cached_flag
    await cache_set(key, response.model_dump(mode="json"), SUMMARY_TTL)
    return response


@router.post("/{level}/regenerate", response_model=SummaryResponse)
@limiter.limit("10/minute")
async def regenerate(
    request: Request,
    video_id: uuid.UUID,
    level: SummaryLevel,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Force regenerate summary, overwriting cache.

    Rate limit: 10/minute (LLM generation).
    """
    video = await require_user_video(db, current_user, video_id)
    _check_transcript_ready(video)

    from app.services.summary_service import regenerate_summary
    summary = await regenerate_summary(db, video_id, level)
    # Bust the cache for this level and the available-levels list
    await cache_delete(summary_key(str(video_id), level), summary_available_key(str(video_id)))
    return SummaryResponse.model_validate(summary)


@router.post("/{level}/regenerate/stream")
@limiter.limit("10/minute")
async def regenerate_stream(
    request: Request,
    video_id: uuid.UUID,
    level: SummaryLevel,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    sse_guard: SSEConnectionGuard = Depends(sse_concurrency_guard),
):
    """Stream regenerate summary via SSE, yielding content deltas.

    Rate limit: 10/minute + max 5 concurrent SSE connections per user.

    NOTE: The injected `db` session is used only for pre-stream validation
    (permission check + transcript fetch). The generator acquires its own
    short-lived session for the final DB write, avoiding holding a connection
    for the entire streaming duration (3-10 min).
    """
    video = await require_user_video(db, current_user, video_id)
    _check_transcript_ready(video)

    from app.services.summary_service import (
        _fetch_transcript_text,
        save_regenerated_summary,
        stream_generate_summary,
    )

    # Read transcript while the request-scoped session is still alive
    transcript_text = await _fetch_transcript_text(db, video_id)

    async def _stream():
        try:
            full_content = ""
            async for delta in stream_generate_summary(transcript_text, level):
                full_content += delta
                yield f"data: {json.dumps({'delta': delta})}\n\n"

            # Acquire a fresh short-lived session only for the final save
            async with async_session() as save_db:
                summary = await save_regenerated_summary(save_db, video_id, level, full_content)
            await cache_delete(summary_key(str(video_id), level), summary_available_key(str(video_id)))
            yield f"data: {json.dumps({'done': True, 'summary_id': str(summary.id)})}\n\n"
        finally:
            await sse_guard.release()

    return StreamingResponse(_stream(), media_type="text/event-stream")
