"""Admin API — category/source management + video management."""

import asyncio
import logging
import uuid as uuid_mod
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin_user
from app.core.database import get_session
from app.core.utils import escape_like
from app.models.video import Video

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Curate v2 admin endpoints
# ---------------------------------------------------------------------------



@router.post("/curate-v2/trigger", dependencies=[Depends(require_admin_user)])
async def admin_trigger_curate_v2(
    target_date: Optional[str] = Query(default=None, description="YYYY-MM-DD, defaults to today Beijing time"),
):
    """Manually trigger curate v2 pipeline for a specific date."""
    from app.tasks.curate_v2_tasks import daily_curate_pipeline
    task = daily_curate_pipeline.delay(target_date)
    return {"task_id": task.id, "target_date": target_date, "status": "queued"}


# ---------------------------------------------------------------------------
# Video management (品阅)
# ---------------------------------------------------------------------------


@router.get("/videos", dependencies=[Depends(require_admin_user)])
async def admin_list_videos(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, le=100),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_session),
):
    """List all videos with pagination, filtering, and search."""
    query = select(Video)
    if status:
        from sqlalchemy import text as sa_text
        query = query.where(Video.status["state"].as_string() == status)
    if search:
        pattern = f"%{escape_like(search)}%"
        query = query.where(Video.title.ilike(pattern) | Video.url.ilike(pattern))
    query = query.order_by(Video.created_at.desc())

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    videos = result.scalars().all()
    return {
        "items": [
            {
                "id": str(v.id),
                "url": v.url,
                "platform": v.platform,
                "title": v.title,
                "status": v.status,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in videos
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/videos/{video_id}/retry", dependencies=[Depends(require_admin_user)])
async def admin_retry_video(video_id: str, db: AsyncSession = Depends(get_session)):
    from uuid import UUID
    from app.services.video_service import dispatch_video_processing

    video = await db.get(Video, UUID(video_id))
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    video.status = {"state": "pending", "progress": 0, "message": "Retrying..."}
    await db.commit()

    task_id = dispatch_video_processing(video_id)
    return {"task_id": task_id, "status": "queued"}


@router.delete("/videos/{video_id}", dependencies=[Depends(require_admin_user)])
async def admin_delete_video(video_id: str, db: AsyncSession = Depends(get_session)):
    from uuid import UUID

    video = await db.get(Video, UUID(video_id))
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.delete(video)
    await db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------


# --- Monitor ---


@router.get("/monitor/overview", dependencies=[Depends(require_admin_user)])
async def admin_monitor_overview(db: AsyncSession = Depends(get_session)):
    from sqlalchemy import text

    state_dist_result = await db.execute(
        text("SELECT status->>'state' AS state, COUNT(*) AS cnt FROM videos GROUP BY status->>'state'")
    )
    video_counts = {row.state: row.cnt for row in state_dist_result}

    failed_result = await db.execute(
        select(Video)
        .where(Video.status["state"].as_string() == "failed")
        .order_by(Video.created_at.desc())
        .limit(20)
    )
    failed_videos = failed_result.scalars().all()
    recent_failed = [
        {
            "id": str(v.id),
            "title": v.title or "",
            "url": v.url,
            "platform": v.platform,
            "error": (v.status or {}).get("message", "未知错误"),
            "failed_at": v.created_at.isoformat() if v.created_at else "",
        }
        for v in failed_videos
    ]

    return {
        "video_counts": video_counts,
        "recent_failed": recent_failed,
    }


@router.get("/monitor/workers", dependencies=[Depends(require_admin_user)])
async def admin_monitor_workers():
    from app.tasks.celery_app import celery_app

    def _inspect():
        inspector = celery_app.control.inspect(timeout=5)
        ping = inspector.ping() or {}
        active = inspector.active() or {}
        return ping, active

    ping, active = await asyncio.to_thread(_inspect)

    workers = []
    for name in ping:
        tasks = active.get(name, [])
        task_names = [t.get("name", "unknown") if isinstance(t, dict) else str(t) for t in tasks]
        workers.append({
            "name": name,
            "alive": True,
            "active_tasks": task_names,
            "last_heartbeat": None,
        })
    return workers


@router.get("/monitor/system", dependencies=[Depends(require_admin_user)])
async def admin_monitor_system():
    from app.core.redis import get_redis

    redis = await get_redis()
    info = await redis.info(section="memory")
    clients_info = await redis.info(section="clients")

    queue_names = ["pingcha", "pingcha.pipeline", "pingcha.cron", "pingcha.curate"]
    queues = {}
    for q in queue_names:
        length = await redis.llen(q)
        queues[q] = length

    return {
        "redis_memory_used": info.get("used_memory_human", "N/A"),
        "redis_connected_clients": clients_info.get("connected_clients", 0),
        "queue_lengths": queues,
    }


# --- Video management (enhanced) ---


class VideoUpdateBody(BaseModel):
    url: Optional[str] = None
    platform: Optional[str] = None
    title: Optional[str] = None
    status: Optional[dict] = None


@router.patch("/videos/{video_id}", dependencies=[Depends(require_admin_user)])
async def admin_update_video(
    video_id: str, body: VideoUpdateBody, db: AsyncSession = Depends(get_session)
):
    video = await db.get(Video, uuid_mod.UUID(video_id))
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(video, field, value)
    await db.commit()
    return {"id": video_id, "updated": True}


class BatchActionBody(BaseModel):
    action: Literal["retry", "delete", "force_fail"]
    video_ids: list[str] = Field(..., min_length=1, max_length=100)


@router.post("/videos/batch", dependencies=[Depends(require_admin_user)])
async def admin_batch_videos(body: BatchActionBody, db: AsyncSession = Depends(get_session)):
    results = []
    for vid in body.video_ids:
        video = await db.get(Video, uuid_mod.UUID(vid))
        if not video:
            results.append({"id": vid, "ok": False, "error": "not found"})
            continue

        if body.action == "delete":
            await db.delete(video)
            results.append({"id": vid, "ok": True})
        elif body.action == "force_fail":
            video.status = {"state": "failed", "progress": 0, "message": "Force failed by admin"}
            results.append({"id": vid, "ok": True})
        elif body.action == "retry":
            from app.services.video_service import dispatch_video_processing
            video.status = {"state": "pending", "progress": 0, "message": "Retrying..."}
            task_id = dispatch_video_processing(vid)
            results.append({"id": vid, "ok": True, "task_id": task_id})

    await db.commit()
    return {"results": results}


# --- Trending management ---


class TrendingUpdateBody(BaseModel):
    is_pinned: Optional[bool] = None
    is_hidden: Optional[bool] = None
    admin_score: Optional[float] = Field(default=None, description="Set to override organic score, null to clear")


@router.get("/trending", dependencies=[Depends(require_admin_user)])
async def admin_list_trending(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, le=100),
    filter: Optional[str] = Query(default=None, description="pinned|hidden|override|all"),
    db: AsyncSession = Depends(get_session),
):
    """List videos with trending admin fields for management."""
    query = (
        select(Video)
        .where(Video.status["state"].as_string() == "done")
        .where(Video.title.isnot(None))
        .where(Video.title != "")
    )
    if filter == "pinned":
        query = query.where(Video.is_pinned == True)
    elif filter == "hidden":
        query = query.where(Video.is_hidden == True)
    elif filter == "override":
        query = query.where(Video.admin_score.isnot(None))

    query = query.order_by(Video.is_pinned.desc(), Video.view_count.desc())

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    videos = result.scalars().all()

    return {
        "items": [
            {
                "id": str(v.id),
                "title": v.title,
                "url": v.url,
                "platform": v.platform,
                "view_count": v.view_count,
                "is_pinned": v.is_pinned,
                "is_hidden": v.is_hidden,
                "admin_score": v.admin_score,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in videos
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/trending/{video_id}", dependencies=[Depends(require_admin_user)])
async def admin_update_trending(
    video_id: str, body: TrendingUpdateBody, db: AsyncSession = Depends(get_session)
):
    """Update trending admin fields for a video (pin/hide/admin_score)."""
    video = await db.get(Video, uuid_mod.UUID(video_id))
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if body.is_pinned is not None:
        video.is_pinned = body.is_pinned
    if body.is_hidden is not None:
        video.is_hidden = body.is_hidden
    if body.admin_score is not None:
        video.admin_score = body.admin_score
    elif "admin_score" in (body.model_fields_set or set()):
        video.admin_score = None
    await db.commit()
    return {"id": video_id, "updated": True}


@router.post("/trending/batch", dependencies=[Depends(require_admin_user)])
async def admin_batch_trending(
    body: dict,
    db: AsyncSession = Depends(get_session),
):
    """Batch update trending fields. Body: {video_ids: [...], is_pinned?, is_hidden?, admin_score?}"""
    video_ids = body.get("video_ids", [])
    if not video_ids or len(video_ids) > 100:
        raise HTTPException(status_code=400, detail="video_ids required (max 100)")

    results = []
    for vid in video_ids:
        video = await db.get(Video, uuid_mod.UUID(vid))
        if not video:
            results.append({"id": vid, "ok": False, "error": "not found"})
            continue
        if "is_pinned" in body:
            video.is_pinned = body["is_pinned"]
        if "is_hidden" in body:
            video.is_hidden = body["is_hidden"]
        if "admin_score" in body:
            video.admin_score = body["admin_score"]
        results.append({"id": vid, "ok": True})

    await db.commit()
    return {"results": results}
