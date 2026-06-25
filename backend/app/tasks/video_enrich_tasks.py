"""Celery task: video pipeline stage 2 — enrich (summaries + mindmap).

This is the ONLY pipeline module that loads litellm: the summary / mindmap
services pull in the litellm import chain at top level here, isolated from
the prepare / finalize stages.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid

from app.core.constants import VideoState
from app.core.database import task_session
from app.services.mindmap_service import get_or_create_mindmap
from app.services.summary_service import generate_and_store_fast_summaries
from app.tasks.celery_app import celery_app
from app.tasks.shared import _publish_event, get_sync_redis, run_async, set_heartbeat

logger = logging.getLogger(__name__)


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

    return run_async(_do())


@celery_app.task(
    name="app.tasks.video_enrich_tasks.video_enrich",
    queue="pingcha.llm",
    time_limit=3600,
    soft_time_limit=3540,
    max_retries=2,
    default_retry_delay=30,
    ignore_result=True,
)
def video_enrich(video_id: str) -> dict:
    """Pipeline stage 2: generate summaries + mindmap (litellm).

    Uses an immutable signature (.si()) — receives only video_id, not the
    upstream task's return value.
    """
    set_heartbeat(video_id, VideoState.SUMMARIZING, 65, "生成摘要和思维导图中...")
    gen_results = _do_summaries_and_mindmap(video_id)
    return {"video_id": video_id, **gen_results}
