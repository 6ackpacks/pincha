"""Celery tasks for video processing pipeline."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: F401 — used by legacy code paths

from app.config import settings
from app.core.constants import VideoState
from app.core.database import task_session
from app.models.summary import Summary
from app.services.mindmap_service import get_or_create_mindmap
from app.services.summary_service import (
    generate_and_store_fast_summaries,
    generate_and_store_full_summary,
)
from app.tasks.celery_app import celery_app
from app.tasks.shared import (
    _publish_event,
    get_sync_redis,
    heartbeat_key,
    release_pipeline_lock,
    set_heartbeat,
    try_acquire_pipeline_lock,
    update_video_status_sync,
)

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.video_tasks.generate_full_summary", queue="pingcha",
                 soft_time_limit=600, time_limit=660)
def generate_full_summary(video_id: str) -> dict:
    """Generate full (90%) summary on-demand, triggered by user click."""
    async def _do():
        vid = uuid.UUID(video_id)
        t0 = time.monotonic()
        logger.info("[full:%s] Starting on-demand full summary generation", video_id)
        try:
            async with task_session() as db:
                await generate_and_store_full_summary(db, vid)
            logger.info("[full:%s] Full summary complete in %.1fs", video_id, time.monotonic() - t0)
        except Exception as exc:
            logger.error("[full:%s] Full summary failed after %.1fs: %s", video_id, time.monotonic() - t0, exc)
            raise

    asyncio.run(_do())
    return {"video_id": video_id, "level": "full", "state": VideoState.DONE}


# Keep old task name registered so pending Celery messages don't fail
@celery_app.task(name="app.tasks.video_tasks.generate_deep_summaries", queue="pingcha")
def generate_deep_summaries(video_id: str) -> dict:
    """Deprecated: kept for backward compat with queued messages."""
    logger.info("[deep:%s] Legacy task called, skipping (detailed now in fast pipeline)", video_id)
    return {"video_id": video_id, "state": "skipped"}


def _delete_heartbeat(video_id: str) -> None:
    """Remove heartbeat key on completion."""
    get_sync_redis().delete(heartbeat_key(video_id))


def _step(video_id: str, state: str, progress: int, message: str = "") -> None:
    """Update both heartbeat and DB status in one call."""
    set_heartbeat(video_id, state, progress, message)
    update_video_status_sync(video_id, {"state": state, "progress": progress, "message": message})


def _run_async(coro):
    """Run an async coroutine from sync Celery task context."""
    return asyncio.run(coro)


def _backfill_duration_from_transcript(video_id: str) -> None:
    """If video duration is still null, infer from the last transcript segment's end time."""
    from app.services.video_service import backfill_duration_from_transcript_sync

    try:
        backfill_duration_from_transcript_sync(video_id)
        logger.info("[pipeline:%s] Duration backfill from transcript completed", video_id)
    except Exception as exc:
        logger.warning("[pipeline:%s] Duration backfill from transcript failed: %s", video_id, exc)


def _backfill_title_from_url(video_id: str) -> None:
    """If video title is still empty after pipeline, derive a neutral placeholder from the URL."""
    from app.services.video_service import backfill_title_from_url_sync

    try:
        backfill_title_from_url_sync(video_id)
        logger.info("[pipeline:%s] Title backfill from URL completed", video_id)
    except Exception as exc:
        logger.warning("[pipeline:%s] Title backfill failed: %s", video_id, exc)


def _do_parallel_generation(video_id: str) -> dict:
    """Parallel generation of detailed summary and mindmap after subtitle extraction.

    Runs two independent tasks concurrently:
    - detailed summary (from raw transcript)
    - mindmap generation (from transcript)

    Both tasks are fire-and-forget with return_exceptions=True, so failure in
    one does not block the other. Events are published upon completion.

    Returns:
        dict with "detailed" and "mindmap" keys containing success status
    """
    async def _do():
        vid = uuid.UUID(video_id)
        results = {"detailed": False, "mindmap": False}

        async def _generate_detailed():
            """Generate detailed summary from raw transcript."""
            try:
                t0 = time.monotonic()
                logger.info("[pipeline:%s] Starting detailed summary generation", video_id)
                async with task_session() as db:
                    # Fetch transcript
                    from app.services.summary_service import _fetch_transcript_text
                    transcript_text = await _fetch_transcript_text(db, vid)

                    # Generate detailed summary using cascade
                    from app.services.summary_service import _cascade_single
                    content = await _cascade_single(transcript_text, "detailed", model=settings.FAST_SUMMARY_MODEL)

                    # Store to DB
                    from sqlalchemy.dialects.postgresql import insert as pg_insert
                    stmt = (
                        pg_insert(Summary)
                        .values(
                            video_id=vid,
                            level="detailed",
                            content=content,
                            model_used=settings.FAST_SUMMARY_MODEL,
                        )
                        .on_conflict_do_update(
                            constraint="uq_summaries_video_level",
                            set_={"content": content, "model_used": settings.FAST_SUMMARY_MODEL},
                        )
                    )
                    await db.execute(stmt)
                    await db.commit()

                elapsed = time.monotonic() - t0
                logger.info("[pipeline:%s] Detailed summary complete in %.1fs", video_id, elapsed)

                # Publish event
                _publish_event(video_id, "level_ready", {"level": "detailed"})
                results["detailed"] = True

            except Exception as exc:
                logger.error("[pipeline:%s] Detailed summary generation failed: %s", video_id, exc)
                # Non-fatal: don't propagate exception

        async def _generate_mindmap():
            """Generate mindmap from transcript."""
            try:
                t0 = time.monotonic()
                logger.info("[pipeline:%s] Starting mindmap generation", video_id)
                async with task_session() as db:
                    await get_or_create_mindmap(db, vid)

                elapsed = time.monotonic() - t0
                logger.info("[pipeline:%s] Mindmap generation complete in %.1fs", video_id, elapsed)

                # Publish event
                _publish_event(video_id, "mindmap_ready", {})
                results["mindmap"] = True

            except Exception as exc:
                logger.warning("[pipeline:%s] Mindmap generation failed: %s", video_id, exc)
                # Non-fatal: don't propagate exception

        # Run both tasks in parallel with exception isolation
        await asyncio.gather(
            _generate_detailed(),
            _generate_mindmap(),
            return_exceptions=True
        )

        return results

    return _run_async(_do())


def _do_cascade_summaries(video_id: str) -> dict:
    """Cascade generation of highlight and express summaries from detailed.

    This runs AFTER detailed summary is complete, generating:
    - highlight (compressed from detailed)
    - express (compressed from highlight)

    Each level publishes a level_ready event upon completion.

    Returns:
        dict with "highlight" and "express" keys containing success status
    """
    async def _do():
        vid = uuid.UUID(video_id)
        results = {"highlight": False, "express": False}

        try:
            async with task_session() as db:
                # Fetch detailed summary as input
                result = await db.execute(
                    select(Summary.content).where(
                        Summary.video_id == vid,
                        Summary.level == "detailed"
                    )
                )
                detailed_content = result.scalar_one_or_none()

                if not detailed_content:
                    logger.error("[pipeline:%s] Cascade summaries: detailed summary not found", video_id)
                    return results

                # Generate highlight from detailed
                t0 = time.monotonic()
                logger.info("[pipeline:%s] Starting highlight generation from detailed", video_id)
                from app.services.summary_service import _cascade_single
                highlight_content = await _cascade_single(
                    detailed_content, "highlight", model=settings.FAST_SUMMARY_MODEL
                )

                # Store highlight
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                stmt = (
                    pg_insert(Summary)
                    .values(
                        video_id=vid,
                        level="highlight",
                        content=highlight_content,
                        model_used=settings.FAST_SUMMARY_MODEL,
                    )
                    .on_conflict_do_update(
                        constraint="uq_summaries_video_level",
                        set_={"content": highlight_content, "model_used": settings.FAST_SUMMARY_MODEL},
                    )
                )
                await db.execute(stmt)
                await db.commit()

                elapsed = time.monotonic() - t0
                logger.info("[pipeline:%s] Highlight complete in %.1fs", video_id, elapsed)
                _publish_event(video_id, "level_ready", {"level": "highlight"})
                results["highlight"] = True

                # Generate express from highlight
                t0 = time.monotonic()
                logger.info("[pipeline:%s] Starting express generation from highlight", video_id)
                express_content = await _cascade_single(
                    highlight_content, "express", model=settings.FAST_SUMMARY_MODEL
                )

                # Store express
                stmt = (
                    pg_insert(Summary)
                    .values(
                        video_id=vid,
                        level="express",
                        content=express_content,
                        model_used=settings.FAST_SUMMARY_MODEL,
                    )
                    .on_conflict_do_update(
                        constraint="uq_summaries_video_level",
                        set_={"content": express_content, "model_used": settings.FAST_SUMMARY_MODEL},
                    )
                )
                await db.execute(stmt)
                await db.commit()

                elapsed = time.monotonic() - t0
                logger.info("[pipeline:%s] Express complete in %.1fs", video_id, elapsed)
                _publish_event(video_id, "level_ready", {"level": "express"})
                results["express"] = True

        except Exception as exc:
            logger.error("[pipeline:%s] Cascade summaries failed: %s", video_id, exc)
            # Non-fatal in pipeline context

        return results

    return _run_async(_do())


@celery_app.task(
    name="app.tasks.video_tasks.process_video",
    queue="pingcha.pipeline",
    time_limit=3600,       # Hard kill after 1 h — prevents zombie workers
    soft_time_limit=3540,  # Graceful shutdown signal 1 min before hard kill
)
def process_video(video_id: str) -> dict:
    """Main video processing pipeline.

    Steps:
      1. Acquire distributed lock (skip if already processing — dedup via Redis NX).
      2. Subtitle extraction (delegated to subtitle_tasks logic).
      3. Hierarchical summarization (full -> detailed -> highlight -> express).
      4. Mindmap generation.

    Lock pattern inspired by DOVideo-AI's Redisson distributed lock design.
    """
    from app.tasks.subtitle_tasks import _process_subtitles_core

    # --- Deduplication: skip if another worker is already processing this video ---
    if not try_acquire_pipeline_lock(video_id):
        logger.info("Video %s is already being processed by another worker, skipping.", video_id)
        return {"video_id": video_id, "state": "skipped", "reason": "already_processing"}

    try:
        # 幂等性检查：防止重复处理
        from app.tasks.shared import get_sync_engine
        from sqlalchemy import text as _text
        with get_sync_engine().connect() as _conn:
            _row = _conn.execute(
                _text("SELECT status FROM videos WHERE id = :vid"),
                {"vid": video_id},
            ).fetchone()
        if _row and _row[0] and _row[0].get("state") == "done":
            logger.info(f"Video {video_id} already processed, skipping")
            release_pipeline_lock(video_id)
            return {"status": "skipped", "reason": "already_done"}

        pipeline_start = time.monotonic()
        logger.info("[pipeline:%s] === Pipeline started ===", video_id)

        _step(video_id, VideoState.PENDING, 0, "Task started")
        _step(video_id, VideoState.TRANSCRIBING, 5, "Starting subtitle extraction...")

        t0 = time.monotonic()
        subtitle_result = _process_subtitles_core(video_id)
        subtitle_elapsed = time.monotonic() - t0
        logger.info("[pipeline:%s] Subtitle extraction took %.1fs, result=%s", video_id, subtitle_elapsed, {k: v for k, v in subtitle_result.items() if k != "transcript_id"})

        _step(video_id, VideoState.TRANSCRIBING, 60, "字幕提取完成")

        # Publish subtitle_ready event
        _publish_event(video_id, "subtitle_ready", {})

        # --- Duration backfill from transcript if still null ---
        _backfill_duration_from_transcript(video_id)

        # --- Step 2: Parallel generation of detailed summary and mindmap ---
        _step(video_id, VideoState.SUMMARIZING, 65, "生成详细总结和思维导图中...")

        t_parallel_start = time.monotonic()
        parallel_results = _do_parallel_generation(video_id)
        parallel_elapsed = time.monotonic() - t_parallel_start

        logger.info(
            "[pipeline:%s] Parallel generation complete in %.1fs: detailed=%s, mindmap=%s",
            video_id, parallel_elapsed,
            parallel_results.get("detailed"), parallel_results.get("mindmap")
        )

        # --- Step 3: Cascade summaries (highlight + express from detailed) ---
        _step(video_id, VideoState.SUMMARIZING, 80, "生成精华和速览摘要中...")

        t_cascade_start = time.monotonic()
        cascade_results = _do_cascade_summaries(video_id)
        cascade_elapsed = time.monotonic() - t_cascade_start

        logger.info(
            "[pipeline:%s] Cascade summaries complete in %.1fs: highlight=%s, express=%s",
            video_id, cascade_elapsed,
            cascade_results.get("highlight"), cascade_results.get("express")
        )

        # Count successful summary levels
        summary_count = sum([
            parallel_results.get("detailed", False),
            cascade_results.get("highlight", False),
            cascade_results.get("express", False)
        ])

        # --- Step 4: Title backfill if still missing ---
        _backfill_title_from_url(video_id)

        total_elapsed = time.monotonic() - pipeline_start
        logger.info("[pipeline:%s] === Pipeline complete in %.1fs ===", video_id, total_elapsed)

        # Mark done — users can now view detailed + highlight + express + mindmap
        _step(video_id, VideoState.DONE, 100, "处理完成")
        _delete_heartbeat(video_id)

        return {"video_id": video_id, "state": VideoState.DONE, "summary_count": summary_count}

    except SoftTimeLimitExceeded:
        elapsed = time.monotonic() - pipeline_start if 'pipeline_start' in locals() else 0
        logger.error("[pipeline:%s] Soft time limit exceeded after %.1fs", video_id, elapsed)
        _step(video_id, VideoState.FAILED, 0, "处理超时（>10分钟），请重试")
        _delete_heartbeat(video_id)
        raise

    except Exception as exc:
        elapsed = time.monotonic() - pipeline_start if 'pipeline_start' in locals() else 0
        logger.exception("[pipeline:%s] Pipeline failed after %.1fs: %s", video_id, elapsed, exc)
        _step(video_id, VideoState.FAILED, 0, str(exc))
        _delete_heartbeat(video_id)
        raise

    finally:
        # Always release the distributed lock, even on failure or exception.
        release_pipeline_lock(video_id)
