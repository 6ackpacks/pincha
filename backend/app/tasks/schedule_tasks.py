"""Celery Beat scheduled tasks."""
from __future__ import annotations

from app.tasks.celery_app import celery_app
from app.tasks.shared import (
    get_sync_engine,
    get_sync_redis,
    heartbeat_key,
    update_video_status_sync,
)

from sqlalchemy import text

ACTIVE_STATES = {"downloading", "transcribing", "summarizing"}


@celery_app.task(name="app.tasks.schedule_tasks.check_stale_heartbeats", queue="pingcha")
def check_stale_heartbeats() -> dict:
    """Check for videos with active status but missing Redis heartbeat.

    If a video is in an active state but has no heartbeat key in Redis,
    it means the worker died — mark it as failed.
    """
    r = get_sync_redis()
    engine = get_sync_engine()

    marked_failed = []

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT id, status->>'state' AS state FROM videos "
                "WHERE status->>'state' = ANY(:states)"
            ),
            {"states": list(ACTIVE_STATES)},
        ).fetchall()

        if rows:
            # Batch check all heartbeat keys via pipeline
            pipe = r.pipeline()
            for row in rows:
                pipe.exists(heartbeat_key(str(row[0])))
            results = pipe.execute()

            for row, exists in zip(rows, results):
                if not exists:
                    video_id = str(row[0])
                    update_video_status_sync(
                        video_id,
                        {"state": "failed", "progress": 0, "message": "Task stale - no heartbeat"},
                    )
                    marked_failed.append(video_id)

    return {"marked_failed": marked_failed, "checked": len(rows) if rows else 0}
