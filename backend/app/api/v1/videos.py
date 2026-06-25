import asyncio
import json
import logging
import os
import uuid
from typing import List

import secrets as _secrets

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rate_limit import limiter
from app.core.url_validator import validate_url_async, SSRFError
from app.core.sse_limiter import SSEConnectionGuard, sse_concurrency_guard
from app.core.cache import (
    MINDMAP_TTL,
    TRANSCRIPT_TTL,
    VIDEO_DETAIL_TTL,
    VIDEOS_LIST_TTL,
    cache_delete,
    cache_get,
    cache_set,
    mindmap_key,
    transcript_key,
    video_detail_key,
    videos_list_key,
)
from app.core.database import get_session
from app.core.deps import require_user_video
from app.core.redis import get_redis
from app.config import settings
from app.models.summary import Summary
from app.models.transcript import Transcript
from app.models.user import User
from app.models.video import Video
from app.schemas.video import VideoCreate, VideoProgress, VideoResponse
from app.schemas.transcript import TranscriptResponse
from app.schemas.summary import SummaryResponse
from app.schemas.mindmap import MindmapResponse
from app.services import video_service
from app.services.video_service import dispatch_video_processing
from app.core.progress import heartbeat_key, sse_progress_stream

router = APIRouter(prefix="/videos", tags=["videos"])

# 保持后台 task 的强引用，防止 GC 在 task 完成前回收
_background_tasks: set = set()


def _log_task_exception(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        logger.warning("Background task failed: %s", exc)


async def _increment_view(video_id: uuid.UUID) -> None:
    """Fire-and-forget helper to increment view count with its own DB session."""
    from app.core.database import async_session as session_factory
    async with session_factory() as db:
        await video_service.increment_view_count(db, video_id)


@router.get("/trending", response_model=List[VideoResponse])
async def trending_videos(
    db: AsyncSession = Depends(get_session),
    limit: int = Query(20, ge=1, le=100),
):
    """List popular videos using mixed ranking (organic score + admin overrides)."""
    from app.services import video_service
    videos = await video_service.list_popular_videos(db, limit=limit)
    return videos


@router.get("", response_model=List[VideoResponse])
async def list_videos(
    request: Request,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    q: str | None = Query(None, description="搜索视频标题或总结内容"),
):
    """List videos for the current user, newest first.

    Pass ?q=<keyword> to search across title and summary content.
    """
    # Only use cache when there's no search query
    if not q:
        key = videos_list_key(str(current_user.id))
        cached = await cache_get(key)
        if cached is not None:
            return cached

    videos = await video_service.list_videos(db, current_user.id, q=q)

    if not q:
        terminal_states = {"done", "failed"}
        all_settled = all((v.status or {}).get("state") in terminal_states for v in videos)
        if all_settled:
            serialized = [VideoResponse.model_validate(v).model_dump(mode="json") for v in videos]
            await cache_set(key, serialized, VIDEOS_LIST_TTL)
    return videos


@router.post("", response_model=VideoResponse, status_code=201)
@limiter.limit("30/minute")
async def submit_video(
    request: Request,
    payload: VideoCreate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Submit a video URL for processing.

    - If the URL was already analysed globally, links it to the current user and returns 200.
    - If new, creates the video record, links it to the user, dispatches the pipeline, returns 201.
    """
    url_str = str(payload.url)

    # SSRF 防护：校验用户提交的 URL 不指向内网
    try:
        await validate_url_async(url_str)
    except SSRFError as e:
        return JSONResponse(
            status_code=400,
            content={"detail": f"URL 不合法：{e}"},
        )

    existing = (await db.execute(
        select(Video).where(Video.url == url_str)
    )).scalar_one_or_none()

    if existing is not None:
        # Link to this user (idempotent)
        await video_service.add_user_video(db, current_user.id, existing.id, source="manual")
        await cache_delete(videos_list_key(str(current_user.id)))
        return JSONResponse(
            status_code=200,
            content=VideoResponse.model_validate(existing).model_dump(mode="json"),
        )

    # 播客：跳过 yt-dlp 验证，改用 RSS 解析
    if payload.platform == "podcast":
        from app.services.rss_service import parse_rss_feed

        rss_meta = await parse_rss_feed(url_str)
        info = {
            "title": rss_meta.get("title"),
            "thumbnail_url": rss_meta.get("thumbnail_url"),
            "duration": rss_meta.get("duration"),
        }
        # 播客额外字段
        podcast_extra = {
            "show_name": rss_meta.get("show_name"),
            "host": rss_meta.get("host"),
            "description": rss_meta.get("description"),
        }

        video = await video_service.create_video(db, url_str, payload.platform, info)
        # 写入播客专属字段
        for field, value in podcast_extra.items():
            if value:
                setattr(video, field, value)
        await db.commit()
        await db.refresh(video)

        await video_service.add_user_video(db, current_user.id, video.id, source="manual")
        dispatch_video_processing(str(video.id))
        await cache_delete(videos_list_key(str(current_user.id)))
        return video

    # Validate URL with yt-dlp (run in thread to avoid blocking event loop)
    try:
        info = await asyncio.wait_for(
            asyncio.to_thread(video_service.validate_url, url_str),
            timeout=3.0,  # 改为 3s，超时直接用空 info
        )
    except (ValueError, asyncio.TimeoutError, Exception):
        info = {"title": None, "thumbnail_url": None, "duration": None}

    video = await video_service.create_video(db, url_str, payload.platform, info)
    await video_service.add_user_video(db, current_user.id, video.id, source="manual")

    dispatch_video_processing(str(video.id))
    await cache_delete(videos_list_key(str(current_user.id)))

    return video


@router.get("/popular", response_model=List[VideoResponse])
async def popular_videos(
    db: AsyncSession = Depends(get_session),
    limit: int = Query(20, ge=1, le=50),
):
    """Return popular videos across all users, ranked by engagement score.

    Public endpoint — no auth required so new/anonymous users see recommendations.
    """
    videos = await video_service.list_popular_videos(db, limit=limit)
    return videos


@router.get("/health/pipeline")
async def pipeline_health(x_admin_token: str | None = Header(None, alias="X-Admin-Token")):
    """Check if pipeline dependencies are accessible. Requires admin token."""
    admin_token = settings.ADMIN_TOKEN or os.environ.get("ADMIN_TOKEN", "")
    if not admin_token:
        if settings.ENVIRONMENT != "development":
            raise HTTPException(status_code=503, detail="Admin token not configured")
    elif not x_admin_token or not _secrets.compare_digest(x_admin_token, admin_token):
        raise HTTPException(status_code=403, detail="Invalid admin token")
    checks = {}

    # Check Redis
    try:
        redis = await get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    # Check cookies file
    cookies_path = os.environ.get("YOUTUBE_COOKIES_PATH", "/app/cookies/cookies.txt")
    checks["cookies_file"] = "exists" if os.path.exists(cookies_path) else "missing"

    # Check proxy
    proxy = os.environ.get("HTTP_PROXY", "")
    checks["proxy"] = "set" if proxy else "not set"

    # Check API keys
    checks["dashscope_key"] = "set" if settings.DASHSCOPE_API_KEY else "missing"
    checks["openai_key"] = "set" if settings.OPENAI_API_KEY else "missing"

    return checks


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get video metadata and current status."""
    video = await require_user_video(db, current_user, video_id)

    key = video_detail_key(str(video_id))
    cached = await cache_get(key)
    if cached is not None:
        # Fire-and-forget view count increment
        task = asyncio.create_task(_increment_view(video_id))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        task.add_done_callback(_log_task_exception)
        return cached

    # Increment view count (non-blocking)
    await video_service.increment_view_count(db, video_id)

    # Only cache terminal states — processing videos change frequently
    state = (video.status or {}).get("state")
    if state in ("done", "failed"):
        serialized = VideoResponse.model_validate(video).model_dump(mode="json")
        await cache_set(key, serialized, VIDEO_DETAIL_TTL)

    return video


@router.get("/{video_id}/full")
async def get_video_full(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Aggregated detail endpoint: returns video, transcript, summaries, and mindmap
    in a single response using concurrent queries.

    Each sub-query failing independently won't block the others — failed parts
    are returned as None so the frontend can degrade gracefully.
    """
    # Validate ownership first (shared check, fast)
    video = await require_user_video(db, current_user, video_id)

    vid_str = str(video_id)

    async def _fetch_transcript() -> dict | None:
        key = transcript_key(vid_str)
        cached = await cache_get(key)
        if cached is not None:
            return cached
        result = await db.execute(
            select(Transcript).where(Transcript.video_id == video_id)
        )
        transcript = result.scalar_one_or_none()
        if transcript is None:
            return None
        serialized = TranscriptResponse.model_validate(transcript).model_dump(mode="json")
        await cache_set(key, serialized, TRANSCRIPT_TTL)
        return serialized

    async def _fetch_summaries() -> list[dict]:
        result = await db.execute(
            select(Summary).where(Summary.video_id == video_id)
        )
        summaries = result.scalars().all()
        return [
            SummaryResponse.model_validate(s).model_dump(mode="json")
            for s in summaries
        ]

    async def _fetch_mindmap() -> dict | None:
        key = mindmap_key(vid_str)
        cached = await cache_get(key)
        if cached is not None:
            return cached
        from app.services.mindmap_service import get_or_create_mindmap
        try:
            mindmap, _ = await get_or_create_mindmap(db, video_id)
            serialized = MindmapResponse.model_validate(mindmap).model_dump(mode="json")
            await cache_set(key, serialized, MINDMAP_TTL)
            return serialized
        except Exception:
            return None

    # Concurrent fetch of all related data
    transcript_result, summaries_result, mindmap_result = await asyncio.gather(
        _fetch_transcript(),
        _fetch_summaries(),
        _fetch_mindmap(),
        return_exceptions=True,
    )

    # Increment view count (non-blocking, fire-and-forget)
    task = asyncio.create_task(_increment_view(video_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    task.add_done_callback(_log_task_exception)

    return {
        "video": VideoResponse.model_validate(video).model_dump(mode="json"),
        "transcript": transcript_result if not isinstance(transcript_result, BaseException) else None,
        "summaries": summaries_result if not isinstance(summaries_result, BaseException) else [],
        "mindmap": mindmap_result if not isinstance(mindmap_result, BaseException) else None,
    }


@router.get("/{video_id}/progress", response_model=VideoProgress)
async def get_video_progress(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
):
    """Get video processing progress from Redis heartbeat, fallback to DB."""
    video = await require_user_video(db, current_user, video_id)

    # Try Redis heartbeat first
    heartbeat_data = await redis.get(heartbeat_key(str(video_id)))

    if heartbeat_data:
        return VideoProgress(**json.loads(heartbeat_data))

    # Fallback to DB status
    status = video.status or {}
    return VideoProgress(
        state=status.get("state", "pending"),
        progress=status.get("progress", 0),
        message=status.get("message", ""),
    )


@router.get("/{video_id}/progress/stream")
async def stream_video_progress(
    video_id: uuid.UUID,
    after_seq: int = Query(0, ge=0),
    last_event_id: str | None = Header(None, alias="Last-Event-ID"),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
    sse_guard: SSEConnectionGuard = Depends(sse_concurrency_guard),
):
    """SSE endpoint: streams video processing progress via Redis Pub/Sub.

    Client connects once; server pushes updates as Celery publishes them.
    Automatically closes when state reaches 'done' or 'failed'.
    Falls back to last heartbeat on connect so client gets immediate state.

    Summary-stream deltas are replayed from a Redis buffer on (re)connect so a
    late / refreshing / reconnecting client does not lose previously published
    detailed-summary tokens. Resume point is max(after_seq query param,
    Last-Event-ID reconnect header). If the buffer has expired but the final
    summary is already persisted, a `snapshot` event carries the DB content.

    Rate limit: max 5 concurrent SSE connections per user.
    """
    import time as _time
    from fastapi.responses import StreamingResponse as _SR
    from app.core.database import async_session as session_factory

    await require_user_video(db, current_user, video_id)

    vid_str = str(video_id)
    user_id_str = str(current_user.id)

    # Resume point: native EventSource resends the last `id:` as Last-Event-ID
    # on auto-reconnect; an explicit ?after_seq also supports manual resume.
    resume_seq = after_seq
    if last_event_id:
        try:
            resume_seq = max(resume_seq, int(last_event_id))
        except (ValueError, TypeError):
            pass

    async def _snapshot_loader() -> dict | None:
        """Load the persisted detailed summary as a snapshot event.

        Used only when the Redis buffer has expired but the run already
        finished, so a freshly-connecting client still gets the final content
        instead of a blank page. Uses a fresh short-lived async session.
        """
        try:
            async with session_factory() as snap_db:
                result = await snap_db.execute(
                    select(Summary.content).where(
                        Summary.video_id == video_id,
                        Summary.level == "detailed",
                    )
                )
                content = result.scalar_one_or_none()
        except Exception as exc:
            logger.warning("[sse:%s] snapshot DB query failed: %s", vid_str, exc)
            return None
        if not content:
            return None
        return {
            "video_id": vid_str,
            "generation_id": None,
            "summary_level": "detailed",
            "event_type": "snapshot",
            "content": content,
            "_terminal": True,
        }

    logger.info(
        "[sse:%s] Connection opened by user=%s resume_seq=%d",
        vid_str, user_id_str, resume_seq,
    )
    connect_time = _time.monotonic()

    async def _monitored_stream():
        """Wrapper around sse_progress_stream that tracks events and disconnection."""
        event_count = 0
        try:
            async for chunk in sse_progress_stream(
                "video", vid_str, redis=redis,
                resume_seq=resume_seq, snapshot_loader=_snapshot_loader,
            ):
                event_count += 1
                yield chunk
        except asyncio.CancelledError:
            logger.info(
                "[sse:%s] Client disconnected (cancelled) after %.1fs, events_sent=%d",
                vid_str, _time.monotonic() - connect_time, event_count,
            )
            raise
        except Exception as exc:
            logger.warning(
                "[sse:%s] Stream error after %.1fs, events_sent=%d: %s",
                vid_str, _time.monotonic() - connect_time, event_count, exc,
            )
            raise
        finally:
            duration = _time.monotonic() - connect_time
            logger.info(
                "[sse:%s] Connection closed — duration=%.1fs events_sent=%d user=%s",
                vid_str, duration, event_count, user_id_str,
            )
            await sse_guard.release()

    return _SR(
        _monitored_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # 禁用 nginx/Zeabur 缓冲
            "Connection": "keep-alive",
            "Content-Encoding": "identity",  # 阻止 GZipMiddleware 压缩 SSE 流
        },
    )


@router.delete("/{video_id}", status_code=204)
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Remove a video from the current user's library.

    The video record itself is preserved (other users may still have it).
    """
    removed = await video_service.remove_user_video(db, current_user.id, video_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Video not found in your library")
    await cache_delete(videos_list_key(str(current_user.id)), video_detail_key(str(video_id)))
    return None


@router.post("/{video_id}/reprocess", response_model=VideoResponse)
async def reprocess_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Re-run the processing pipeline for a video (useful for failed videos)."""
    video = await require_user_video(db, current_user, video_id)

    # Invalidate subtitle cache so fresh subtitles are fetched
    from app.services.subtitle_service import invalidate_subtitle_cache
    invalidate_subtitle_cache(video.url, video.platform)

    video.status = {"state": "pending", "progress": 0, "message": "重新处理中..."}
    await db.commit()
    await db.refresh(video)

    dispatch_video_processing(str(video.id))
    await cache_delete(video_detail_key(str(video_id)))

    return video


@router.get("/{video_id}/debug")
async def debug_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Debug endpoint showing detailed pipeline status."""
    video = await require_user_video(db, current_user, video_id)

    # Get transcript info
    transcript = (await db.execute(
        select(Transcript).where(Transcript.video_id == video_id)
    )).scalar_one_or_none()

    summaries = (await db.execute(
        select(Summary).where(Summary.video_id == video_id)
    )).scalars().all()

    # Get Redis heartbeat
    redis = await get_redis()
    heartbeat_data = await redis.get(heartbeat_key(str(video_id)))

    return {
        "video": {
            "id": str(video.id),
            "url": video.url,
            "platform": video.platform,
            "title": video.title,
            "status": video.status,
            "created_at": str(video.created_at),
        },
        "transcript": {
            "exists": transcript is not None,
            "segment_count": len(transcript.segments) if transcript and transcript.segments else 0,
            "source": transcript.source if transcript else None,
        },
        "summaries": [
            {"level": s.level, "length": len(s.content) if s.content else 0}
            for s in summaries
        ],
        "heartbeat": heartbeat_data,
    }


# ---------------------------------------------------------------------------
# Video Q&A (streaming, no RAG)
# ---------------------------------------------------------------------------

from fastapi.responses import StreamingResponse
from pydantic import BaseModel as _BaseModel


class VideoAskRequest(_BaseModel):
    question: str


@router.post("/{video_id}/ask")
@limiter.limit("15/minute")
async def ask_video(
    request: Request,
    video_id: uuid.UUID,
    req: VideoAskRequest,
    db: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
    sse_guard: SSEConnectionGuard = Depends(sse_concurrency_guard),
):
    """Answer a question about a video using its summary or transcript (no RAG needed).

    Context priority: full summary → detailed summary → transcript full_text.
    Streams the answer as SSE tokens: ``data: {"delta": "..."}`` followed by
    ``data: [DONE]``.

    Rate limit: 15/minute + max 5 concurrent SSE connections per user.
    """
    import json as _json
    from app.services.video_chat_service import stream_video_answer

    # 1. Confirm video belongs to the current user
    await require_user_video(db, user, video_id)

    # 2. Degraded context retrieval
    context: str | None = None
    context_type: str | None = None

    # Try full summary
    summary_full = (await db.execute(
        select(Summary).where(Summary.video_id == video_id, Summary.level == "full")
    )).scalar_one_or_none()
    if summary_full and summary_full.content:
        context = summary_full.content
        context_type = "完整总结"

    # Try detailed summary
    if not context:
        summary_detailed = (await db.execute(
            select(Summary).where(Summary.video_id == video_id, Summary.level == "detailed")
        )).scalar_one_or_none()
        if summary_detailed and summary_detailed.content:
            context = summary_detailed.content
            context_type = "详细总结"

    # Try transcript full_text
    if not context:
        transcript = (await db.execute(
            select(Transcript).where(Transcript.video_id == video_id)
        )).scalar_one_or_none()
        if transcript and transcript.full_text:
            context = transcript.full_text
            context_type = "字幕文本"

    if not context:
        async def _no_content():
            yield "data: " + _json.dumps({"delta": "视频还在处理中，字幕和总结尚未生成，请稍后再试。"}) + "\n\n"
            yield "data: [DONE]\n\n"
        await sse_guard.release()
        return StreamingResponse(_no_content(), media_type="text/event-stream")

    # 3. Stream LLM response via service
    async def _guarded_stream():
        try:
            async for chunk in stream_video_answer(context, req.question, context_type):
                yield chunk
        finally:
            await sse_guard.release()

    return StreamingResponse(
        _guarded_stream(),
        media_type="text/event-stream",
    )


# ─── Chat History ────────────────────────────────────────────────────────────

class ChatMessageCreate(_BaseModel):
    role: str
    content: str


class ChatMessageResponse(_BaseModel):
    id: str
    role: str
    content: str
    created_at: str


@router.get("/{video_id}/chat/history")
async def get_chat_history(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    from app.models.chat_message import ChatMessage

    await require_user_video(db, user, video_id)

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.video_id == video_id, ChatMessage.user_id == user.id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]


@router.post("/{video_id}/chat/history", status_code=201)
async def save_chat_messages(
    video_id: uuid.UUID,
    messages: List[ChatMessageCreate],
    db: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    from app.models.chat_message import ChatMessage

    await require_user_video(db, user, video_id)

    for msg in messages:
        db.add(ChatMessage(
            video_id=video_id,
            user_id=user.id,
            role=msg.role,
            content=msg.content,
        ))
    await db.commit()
    return {"saved": len(messages)}


@router.delete("/{video_id}/chat/history")
async def clear_chat_history(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
    from app.models.chat_message import ChatMessage
    from sqlalchemy import delete

    await require_user_video(db, user, video_id)

    await db.execute(
        delete(ChatMessage).where(
            ChatMessage.video_id == video_id,
            ChatMessage.user_id == user.id,
        )
    )
    await db.commit()
    return {"cleared": True}
