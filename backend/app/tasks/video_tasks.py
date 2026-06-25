"""Celery tasks for video processing pipeline.

LEGACY：迁移期由 worker-legacy 消费旧 pingcha.pipeline 队列残留的 process_video。
新流程已拆分到 video_prepare_tasks / video_enrich_tasks / video_finalize_tasks
（prepare → enrich → finalize 三阶段 chain）。待旧队列清空后删除本文件。
本文件 process_video 逻辑保持不变，迁移期需保证仍能跑。
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

from celery.exceptions import SoftTimeLimitExceeded

from app.config import settings
from app.core.constants import VideoState
from app.core.database import task_session
from app.core.monitoring import capture_exception, start_transaction
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
    run_async,
    set_heartbeat,
    try_acquire_pipeline_lock,
    update_video_status_sync,
)

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.video_tasks.generate_full_summary", queue="pingcha",
                 soft_time_limit=600, time_limit=660, ignore_result=True)
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
            capture_exception(exc)
            raise

    run_async(_do())
    return {"video_id": video_id, "level": "full", "state": VideoState.DONE}


# Keep old task name registered so pending Celery messages don't fail
@celery_app.task(name="app.tasks.video_tasks.generate_deep_summaries", queue="pingcha",
                 ignore_result=True)
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
    """Run an async coroutine from sync Celery task context.

    Delegates to shared.run_async for consistent event-loop handling.
    """
    return run_async(coro)


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


def _store_thumbnail(video_id: str) -> None:
    """下载外部封面图并上传到火山 TOS，把 thumbnail_url 替换为 CDN 地址。

    best-effort + non-fatal：任一失败都保留原 URL（继续走 /img-proxy），
    绝不让视频处理管道失败。
    """
    from app.services.video_service import fetch_and_store_thumbnail_sync

    try:
        fetch_and_store_thumbnail_sync(video_id)
    except Exception as exc:
        logger.warning("[pipeline:%s] Thumbnail TOS migration failed: %s", video_id, exc)


def _do_summaries_and_mindmap(video_id: str) -> dict:
    """Parallel generation of all fast summaries (detailed+highlight+express) and mindmap.

    Runs two independent tracks concurrently:
    - Fast summaries via generate_and_store_fast_summaries (detailed → highlight → express)
    - Mindmap generation

    Both tracks are isolated: failure in one does not block the other.

    Returns:
        dict with "summaries", "summary_count", and "mindmap" keys
    """
    async def _do():
        vid = uuid.UUID(video_id)
        results = {"summaries": False, "summary_count": 0, "mindmap": False}

        async def _generate_summaries():
            """Generate all fast summaries (detailed → highlight → express)."""
            try:
                t0 = time.monotonic()
                logger.info("[pipeline:%s] Starting fast summaries generation (v2 pipeline)", video_id)
                async with task_session() as db:
                    created = await generate_and_store_fast_summaries(db, vid)

                elapsed = time.monotonic() - t0
                results["summary_count"] = len(created)
                logger.info(
                    "[pipeline:%s] Fast summaries complete in %.1fs — %d levels created",
                    video_id, elapsed, len(created),
                )

                # Clear available-levels cache (events already published by summary_service)
                get_sync_redis().delete(f"summary:available:{video_id}")
                results["summaries"] = True

            except Exception as exc:
                logger.error("[pipeline:%s] Fast summaries generation failed: %s", video_id, exc)
                # Non-fatal: don't propagate exception

        async def _generate_mindmap():
            """Generate mindmap from transcript."""
            try:
                t0 = time.monotonic()
                logger.info("[pipeline:%s] Starting mindmap generation", video_id)
                async with task_session() as db:
                    mindmap, cached = await get_or_create_mindmap(db, vid)

                elapsed = time.monotonic() - t0
                logger.info("[pipeline:%s] Mindmap complete (cached=%s) in %.1fs", video_id, cached, elapsed)

                # Publish event with metadata
                if not cached:
                    node_count = mindmap.markdown.count('#') if mindmap.markdown else 0
                    _publish_event(video_id, "mindmap_ready", {
                        "node_count": node_count,
                        "cached": False,
                    })
                else:
                    _publish_event(video_id, "mindmap_ready", {
                        "cached": True,
                    })
                results["mindmap"] = True

            except Exception as exc:
                logger.warning("[pipeline:%s] Mindmap generation failed: %s", video_id, exc)
                # Non-fatal: don't propagate exception

        # Run both tracks in parallel with exception isolation
        await asyncio.gather(
            _generate_summaries(),
            _generate_mindmap(),
            return_exceptions=True
        )

        return results

    return _run_async(_do())


@celery_app.task(
    name="app.tasks.video_tasks.process_video",
    time_limit=3600,       # Hard kill after 1 h — prevents zombie workers
    soft_time_limit=3540,  # Graceful shutdown signal 1 min before hard kill
    ignore_result=True,
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

    # --- Sentry transaction for pipeline performance tracking ---
    _sentry_txn = start_transaction(
        op="pipeline",
        name="process_video",
        description=f"Video pipeline for {video_id}",
    )
    if _sentry_txn:
        _sentry_txn.__enter__()

    try:
        # 幂等性检查：防止重复处理
        from app.tasks.shared import get_sync_engine
        from sqlalchemy import text as _text
        with get_sync_engine().connect() as _conn:
            _row = _conn.execute(
                _text("SELECT status, url FROM videos WHERE id = :vid"),
                {"vid": video_id},
            ).fetchone()
        if _row and _row[0] and _row[0].get("state") == "done":
            logger.info(f"Video {video_id} already processed, skipping")
            return {"status": "skipped", "reason": "already_done"}

        # SSRF 防护：在实际抓取之前再次校验 URL（双重保险）
        if _row and _row[1]:
            from app.core.url_validator import validate_url as _validate_url_sync, SSRFError as _SSRFError
            try:
                _validate_url_sync(_row[1])
            except _SSRFError as e:
                logger.warning("[pipeline:%s] SSRF blocked: %s", video_id, e)
                _step(video_id, VideoState.FAILED, 0, f"URL 安全校验失败：{e}")
                return {"video_id": video_id, "state": VideoState.FAILED, "reason": "ssrf_blocked"}

        pipeline_start = time.monotonic()
        logger.info("[pipeline:%s] === Pipeline started ===", video_id)

        _step(video_id, VideoState.PENDING, 0, "Task started")
        _step(video_id, VideoState.TRANSCRIBING, 5, "Starting subtitle extraction...")

        # --- Stage 1: Subtitle extraction ---
        t0 = time.monotonic()
        subtitle_result = _process_subtitles_core(video_id)
        subtitle_elapsed = time.monotonic() - t0
        logger.info("[pipeline:%s] Subtitle extraction took %.1fs, result=%s", video_id, subtitle_elapsed, {k: v for k, v in subtitle_result.items() if k != "transcript_id"})

        _step(video_id, VideoState.TRANSCRIBING, 60, "字幕提取完成")

        # Publish subtitle_ready event
        _publish_event(video_id, "subtitle_ready", {})

        # --- Duration backfill from transcript if still null ---
        _backfill_duration_from_transcript(video_id)

        # --- Stage 2: Parallel generation of summaries (detailed+highlight+express) and mindmap ---
        _step(video_id, VideoState.SUMMARIZING, 65, "生成摘要和思维导图中...")

        t_gen_start = time.monotonic()
        gen_results = _do_summaries_and_mindmap(video_id)
        gen_elapsed = time.monotonic() - t_gen_start

        summary_count = gen_results.get("summary_count", 0)
        logger.info(
            "[pipeline:%s] Summaries + mindmap complete in %.1fs: summaries=%s (%d levels), mindmap=%s",
            video_id, gen_elapsed,
            gen_results.get("summaries"), summary_count, gen_results.get("mindmap")
        )

        # --- Stage 4: Title backfill if still missing ---
        _backfill_title_from_url(video_id)

        # --- Stage 5: 封面图迁移到 TOS（non-fatal，失败保留原 URL 走 /img-proxy）---
        _store_thumbnail(video_id)

        total_elapsed = time.monotonic() - pipeline_start

        # === Structured performance metrics ===
        metrics = {
            "video_id": video_id,
            "subtitle_elapsed": round(subtitle_elapsed, 2),
            "generation_elapsed": round(gen_elapsed, 2),
            "total_elapsed": round(total_elapsed, 2),
            "subtitle_source": subtitle_result.get("source", "unknown"),
            "subtitle_cached": subtitle_result.get("cached", False),
            "summary_count": summary_count,
            "summaries_ok": gen_results.get("summaries", False),
            "mindmap_ok": gen_results.get("mindmap", False),
        }
        logger.info("[pipeline:%s] === Performance metrics === %s", video_id, json.dumps(metrics))

        # === Human-readable performance timeline ===
        def _bar(elapsed, label, total):
            pct = int((elapsed / total) * 20) if total > 0 else 0
            return f"{'█' * pct}{'░' * (20 - pct)} {elapsed:.1f}s {label}"

        slowest_stage = max(
            [("SUBTITLE", subtitle_elapsed), ("GENERATION", gen_elapsed)],
            key=lambda x: x[1]
        )
        logger.info(
            "\n[pipeline:%s] ═══ PERFORMANCE TIMELINE (total %.1fs) ═══\n"
            "  ├─ [SUBTITLE]    %s  src=%s cached=%s\n"
            "  ├─ [GENERATION]  %s  (summaries + mindmap parallel)\n"
            "  │   ├─ [SUMMARIES] %d levels  ok=%s\n"
            "  │   └─ [MINDMAP]   ok=%s\n"
            "  └─ [BOTTLENECK] %s (%.1fs / %.0f%% of total)\n"
            "  model=%s  summaries=%d",
            video_id, total_elapsed,
            _bar(subtitle_elapsed, "", total_elapsed),
            subtitle_result.get("source", "?"), subtitle_result.get("cached", False),
            _bar(gen_elapsed, "", total_elapsed),
            summary_count, gen_results.get("summaries", False),
            gen_results.get("mindmap", False),
            slowest_stage[0], slowest_stage[1],
            (slowest_stage[1] / total_elapsed * 100) if total_elapsed > 0 else 0,
            settings.FAST_SUMMARY_MODEL, summary_count,
        )

        # Mark done — users can now view detailed + highlight + express + mindmap
        _step(video_id, VideoState.DONE, 100, "处理完成")
        _delete_heartbeat(video_id)

        if _sentry_txn:
            _sentry_txn.set_status("ok")

        return {"video_id": video_id, "state": VideoState.DONE, "summary_count": summary_count}

    except SoftTimeLimitExceeded:
        elapsed = time.monotonic() - pipeline_start if 'pipeline_start' in locals() else 0
        # Log detailed timing breakdown on timeout
        timeout_detail = {
            "video_id": video_id,
            "elapsed_at_timeout": round(elapsed, 2),
            "subtitle_elapsed": round(subtitle_elapsed, 2) if 'subtitle_elapsed' in locals() else None,
            "generation_elapsed": round(gen_elapsed, 2) if 'gen_elapsed' in locals() else None,
        }
        logger.error(
            "[pipeline:%s] Soft time limit exceeded after %.1fs — timing breakdown: %s",
            video_id, elapsed, json.dumps(timeout_detail)
        )
        capture_exception()
        if _sentry_txn:
            _sentry_txn.set_status("deadline_exceeded")
        _step(video_id, VideoState.FAILED, 0, "处理超时（>10分钟），请重试")
        _delete_heartbeat(video_id)
        raise

    except Exception as exc:
        elapsed = time.monotonic() - pipeline_start if 'pipeline_start' in locals() else 0
        logger.exception("[pipeline:%s] Pipeline failed after %.1fs: %s", video_id, elapsed, exc)
        capture_exception(exc)
        if _sentry_txn:
            _sentry_txn.set_status("internal_error")
        _step(video_id, VideoState.FAILED, 0, str(exc))
        _delete_heartbeat(video_id)
        raise

    finally:
        # Always release the distributed lock, even on failure or exception.
        release_pipeline_lock(video_id)
        if _sentry_txn:
            _sentry_txn.__exit__(None, None, None)
