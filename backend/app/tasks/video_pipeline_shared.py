"""Shared helpers for the split video pipeline tasks (litellm-free).

This module holds the pure helper functions used across the prepare /
finalize pipeline stages. It is intentionally free of any litellm import
chain (no summary_service / mindmap_service at top level), so that workers
consuming the prepare / finalize / light queues never load litellm.
"""
from __future__ import annotations

import logging

from app.tasks.shared import (
    get_sync_redis,
    heartbeat_key,
    run_async,
    set_heartbeat,
    update_video_status_sync,
)

logger = logging.getLogger(__name__)


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
