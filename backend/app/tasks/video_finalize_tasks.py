"""Celery task: video pipeline stage 3 — finalize (title backfill + cleanup).

litellm-free: title backfill, final status update, heartbeat cleanup and
lock release. Runs on the lightweight `pingcha.light` queue.
"""
from __future__ import annotations

import logging

from app.core.constants import VideoState
from app.tasks.celery_app import celery_app
from app.tasks.shared import release_pipeline_lock
from app.tasks.video_pipeline_shared import (
    _backfill_title_from_url,
    _delete_heartbeat,
    _step,
)

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.video_finalize_tasks.video_finalize",
    queue="pingcha.light",
    ignore_result=True,
)
def video_finalize(video_id: str) -> dict:
    """Pipeline stage 3: title backfill, mark done, cleanup heartbeat + lock."""
    # --- Title backfill if still missing ---
    _backfill_title_from_url(video_id)

    # Mark done — users can now view detailed + highlight + express + mindmap
    _step(video_id, VideoState.DONE, 100, "处理完成")
    _delete_heartbeat(video_id)

    # Release the distributed lock acquired in the prepare stage.
    release_pipeline_lock(video_id)

    return {"video_id": video_id, "state": "done"}
