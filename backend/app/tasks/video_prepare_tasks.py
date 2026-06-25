"""Celery task: video pipeline stage 1 — prepare (subtitle extraction).

litellm-free: this module only handles subtitle extraction, duration
backfill and thumbnail migration. No summary / mindmap generation here,
so the worker consuming the `pingcha.prepare` queue never loads litellm.
"""
from __future__ import annotations

import logging
import time

from app.core.constants import VideoState
from app.tasks.celery_app import celery_app
from app.tasks.shared import try_acquire_pipeline_lock
from app.tasks.video_pipeline_shared import (
    _backfill_duration_from_transcript,
    _step,
    _store_thumbnail,
)

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.video_prepare_tasks.video_prepare",
    queue="pingcha.prepare",
    time_limit=900,
    soft_time_limit=840,
    ignore_result=True,
)
def video_prepare(video_id: str) -> dict:
    """Pipeline stage 1: acquire lock + extract subtitles.

    Steps:
      1. Acquire distributed lock (skip if already processing — dedup via Redis NX).
      2. Subtitle extraction (delegated to subtitle_tasks logic).
      3. Duration backfill from transcript + thumbnail TOS migration.
    """
    from app.tasks.subtitle_tasks import _process_subtitles_core

    # --- Deduplication: skip if another worker is already processing this video ---
    if not try_acquire_pipeline_lock(video_id):
        logger.info("Video %s is already being processed by another worker, skipping.", video_id)
        return {"video_id": video_id, "state": "skipped"}

    _step(video_id, VideoState.TRANSCRIBING, 5, "Starting subtitle extraction...")

    # --- Stage 1: Subtitle extraction ---
    t0 = time.monotonic()
    subtitle_result = _process_subtitles_core(video_id)
    logger.info(
        "[pipeline:%s] Subtitle extraction took %.1fs, source=%s",
        video_id, time.monotonic() - t0, subtitle_result.get("source"),
    )

    # --- Duration backfill from transcript if still null ---
    _backfill_duration_from_transcript(video_id)

    # --- 封面图迁移到 TOS（non-fatal，失败保留原 URL 走 /img-proxy）---
    _store_thumbnail(video_id)

    return {"video_id": video_id, "subtitle_source": subtitle_result.get("source")}
