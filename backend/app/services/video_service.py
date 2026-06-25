from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, func, update, case, literal, Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import escape_like
from app.models.video import Video
from app.models.user_video import UserVideo


def validate_url(url: str) -> dict[str, Any]:
    """Use yt-dlp to validate a video URL and extract basic info.

    Returns a dict with title, thumbnail, and duration if available.
    Raises ValueError if the URL is not a valid video URL.
    """
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": True,   # 只提取元数据，跳过 ffmpeg 探针
        "no_check_formats": True,  # 不检查格式，避免额外网络请求
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(str(url), download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise ValueError(f"Invalid or unsupported video URL: {exc}") from exc

    if info is None:
        raise ValueError("Could not extract video information from URL")

    # Format duration from seconds to HH:MM:SS
    duration_str = None
    if info.get("duration"):
        total_seconds = int(info["duration"])
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    return {
        "title": info.get("title"),
        "thumbnail_url": info.get("thumbnail"),
        "duration": duration_str,
    }


async def create_video(
    db: AsyncSession,
    url: str,
    platform: str,
    info: dict[str, Any],
) -> Video:
    """Create a new video record in the database."""
    video = Video(
        url=url,
        platform=platform,
        title=info.get("title"),
        thumbnail_url=info.get("thumbnail_url"),
        duration=info.get("duration"),
    )
    db.add(video)
    await db.commit()
    await db.refresh(video)
    return video


async def list_videos(
    db: AsyncSession,
    user_id: uuid.UUID,
    q: str | None = None,
) -> list[Video]:
    """List videos belonging to a user, newest first.

    If *q* is provided, filters by title ILIKE or summary content ILIKE.
    """
    from sqlalchemy import or_, exists
    from app.models.summary import Summary

    stmt = (
        select(Video)
        .join(UserVideo, UserVideo.video_id == Video.id)
        .where(UserVideo.user_id == user_id)
    )

    if q:
        pattern = f"%{escape_like(q)}%"
        stmt = stmt.where(
            or_(
                Video.title.ilike(pattern),
                exists(
                    select(Summary.id).where(
                        Summary.video_id == Video.id,
                        Summary.content.ilike(pattern),
                    )
                ),
            )
        )

    stmt = stmt.order_by(Video.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_video(db: AsyncSession, video_id: uuid.UUID) -> Video | None:
    """Get a video by ID."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    return result.scalar_one_or_none()


async def add_user_video(
    db: AsyncSession,
    user_id: uuid.UUID,
    video_id: uuid.UUID,
    source: str = "manual",
) -> UserVideo:
    """Associate a video with a user. Idempotent — returns existing record if already linked."""
    existing = await db.execute(
        select(UserVideo).where(
            UserVideo.user_id == user_id,
            UserVideo.video_id == video_id,
        )
    )
    uv = existing.scalar_one_or_none()
    if uv:
        return uv
    uv = UserVideo(user_id=user_id, video_id=video_id, source=source)
    db.add(uv)
    await db.commit()
    return uv


async def remove_user_video(
    db: AsyncSession,
    user_id: uuid.UUID,
    video_id: uuid.UUID,
) -> bool:
    """Remove a video from a user's library. Returns True if removed, False if not found."""
    result = await db.execute(
        select(UserVideo).where(
            UserVideo.user_id == user_id,
            UserVideo.video_id == video_id,
        )
    )
    uv = result.scalar_one_or_none()
    if uv is None:
        return False
    await db.delete(uv)
    await db.commit()
    return True


async def update_video_status(
    db: AsyncSession,
    video_id: uuid.UUID,
    status_dict: dict[str, Any],
) -> Video | None:
    """Update the status JSONB field of a video."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if video is None:
        return None
    video.status = status_dict
    await db.commit()
    await db.refresh(video)
    return video


async def list_popular_videos(
    db: AsyncSession,
    limit: int = 20,
    user_id: uuid.UUID | None = None,
) -> list[Video]:
    """Return popular videos with mixed ranking:
    1. Pinned videos first (admin override)
    2. Hidden videos excluded
    3. Remaining ranked by: admin_score (if set) OR (user_count*0.7 + view_count*0.3) * time_decay
    Time decay: half-life of 7 days.
    """
    now = datetime.now(timezone.utc)
    age_seconds = func.extract("epoch", literal(now) - Video.created_at)
    half_life_seconds = 7 * 86400.0
    time_decay = func.power(literal(0.5), age_seconds / half_life_seconds)

    organic_score = (func.count(UserVideo.id) * 0.7 + Video.view_count * 0.3) * time_decay
    final_score = case(
        (Video.admin_score.isnot(None), Video.admin_score),
        else_=organic_score,
    ).label("final_score")

    stmt = (
        select(Video)
        .outerjoin(UserVideo, UserVideo.video_id == Video.id)
        .where(Video.status["state"].astext == "done")
        .where(Video.title.isnot(None))
        .where(Video.title != "")
        .where(Video.is_hidden == False)
    )

    if user_id is not None:
        stmt = stmt.where(
            Video.id.in_(
                select(UserVideo.video_id).where(UserVideo.user_id == user_id)
            )
        )

    stmt = stmt.group_by(Video.id).order_by(
        Video.is_pinned.desc(),
        final_score.desc(),
    ).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def increment_view_count(db: AsyncSession, video_id: uuid.UUID) -> None:
    """Atomically increment the view count of a video."""
    await db.execute(
        update(Video).where(Video.id == video_id).values(view_count=Video.view_count + 1)
    )
    await db.commit()


def dispatch_video_processing(video_id: str) -> str:
    """Dispatch video processing to Celery. Returns task ID.

    新流程：prepare → enrich → finalize 三阶段 chain，按队列隔离。
    用 .si() 不可变签名，每阶段只吃 video_id（上游返回值不传递给下游）。
    """
    from celery import chain
    from app.tasks.video_prepare_tasks import video_prepare
    from app.tasks.video_enrich_tasks import video_enrich
    from app.tasks.video_finalize_tasks import video_finalize

    sig = chain(
        video_prepare.si(str(video_id)),
        video_enrich.si(str(video_id)),
        video_finalize.si(str(video_id)),
    )
    return sig.apply_async().id


def backfill_duration_from_transcript_sync(video_id: str) -> None:
    """If video duration is still null, infer from the last transcript segment's end time.

    Sync function intended for use from Celery tasks.
    """
    import json as _json
    from sqlalchemy import text
    from app.tasks.shared import get_sync_engine

    engine = get_sync_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT duration FROM videos WHERE id = :id"),
            {"id": video_id},
        ).fetchone()
        if row is None or row[0]:
            return

        seg_row = conn.execute(
            text("SELECT segments FROM transcripts WHERE video_id = :id"),
            {"id": video_id},
        ).fetchone()
        if not seg_row or not seg_row[0]:
            return

        segments = seg_row[0] if isinstance(seg_row[0], list) else _json.loads(seg_row[0])
        if not segments:
            return

        last_end = segments[-1].get("end")
        if not last_end:
            return

        total_seconds = int(float(last_end))
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

        conn.execute(
            text("UPDATE videos SET duration = :dur WHERE id = :id AND (duration IS NULL OR duration = '')"),
            {"id": video_id, "dur": duration_str},
        )
        conn.commit()


def fetch_and_store_thumbnail_sync(video_id: str) -> None:
    """下载视频外部封面图并上传到火山 TOS，把 thumbnail_url 替换为 CDN 地址。

    目的：让前端不再走 /img-proxy 实时回源外部图床（YouTube/B站）。

    best-effort + non-fatal：任一环节失败（TOS 未配置 / 下载失败 / 上传失败 /
    非图片内容）都保持原 thumbnail_url 不变，绝不抛异常影响视频处理管道。

    幂等：thumbnail_url 已是 TOS/CDN 地址，或对象已存在时跳过下载与上传。

    同步函数，供 Celery 任务（process_video，sync 上下文）直接调用。
    """
    import logging

    from sqlalchemy import text

    from app.services import storage_service
    from app.tasks.shared import get_sync_engine

    logger = logging.getLogger(__name__)

    # TOS 未配置：直接降级，继续走 /img-proxy
    if not storage_service.is_enabled():
        return

    engine = get_sync_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT thumbnail_url FROM videos WHERE id = :vid"),
            {"vid": video_id},
        ).fetchone()

    if not row or not row[0]:
        return  # 没有封面 URL，无可迁移

    src_url = row[0]
    if not str(src_url).startswith(("http://", "https://")):
        return  # 非外部 URL（可能已是相对路径），跳过

    key = f"thumbnails/{video_id}.jpg"

    # 幂等检查：已是已迁移地址，或对象已存在 → 仅在 URL 仍指向外部时补写
    public_url_str = storage_service.public_url(key)
    if src_url == public_url_str:
        return
    if storage_service.object_exists(key):
        _update_thumbnail_url(engine, video_id, public_url_str, src_url)
        return

    # --- 下载图片字节（参考 /img-proxy 的代理回退策略）---
    data = _download_image_sync(src_url)
    if data is None:
        logger.warning("[thumbnail:%s] 封面下载失败，保留原 URL", video_id)
        return

    # --- 上传到 TOS ---
    cdn_url = storage_service.upload_bytes(key, data, content_type="image/jpeg")
    if not cdn_url:
        logger.warning("[thumbnail:%s] 封面上传 TOS 失败，保留原 URL", video_id)
        return

    _update_thumbnail_url(engine, video_id, cdn_url, src_url)
    logger.info("[thumbnail:%s] 封面已迁移到 TOS: %s", video_id, cdn_url)


def _download_image_sync(src_url: str) -> bytes | None:
    """同步下载图片字节，先走代理（如配置）再回退直连。失败返回 None。

    校验返回内容确为图片（content-type 以 image/ 开头），否则视为失败。
    """
    import logging
    import os

    import httpx

    logger = logging.getLogger(__name__)
    proxy = os.environ.get("HTTP_PROXY") or os.environ.get("YOUTUBE_PROXY")

    def _fetch(proxy_arg: str | None) -> bytes | None:
        client_kwargs: dict = {"timeout": 10, "follow_redirects": True}
        if proxy_arg:
            # httpx>=0.28 移除了 proxies=，改用单值 proxy=（0.27 亦支持），两版本通吃
            client_kwargs["proxy"] = proxy_arg
        with httpx.Client(**client_kwargs) as client:
            resp = client.get(src_url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if not content_type.lower().startswith("image/"):
                logger.warning("封面 content-type 非图片: %s", content_type)
                return None
            return resp.content

    try:
        return _fetch(proxy)
    except Exception as exc:
        if not proxy:
            logger.warning("封面直连下载失败: %s", exc)
            return None
        # 代理失败 → 回退直连再试一次
        try:
            return _fetch(None)
        except Exception as exc2:
            logger.warning("封面下载失败（代理+直连均失败）: %s", exc2)
            return None


def _update_thumbnail_url(engine, video_id: str, new_url: str, old_url: str) -> None:
    """把 videos.thumbnail_url 从外部 URL 更新为 TOS/CDN 地址（仅当仍为旧值）。"""
    from sqlalchemy import text

    with engine.connect() as conn:
        conn.execute(
            text("UPDATE videos SET thumbnail_url = :new WHERE id = :vid AND thumbnail_url = :old"),
            {"new": new_url, "vid": video_id, "old": old_url},
        )
        conn.commit()


def backfill_title_from_url_sync(video_id: str) -> None:
    """If video title is still empty, derive a neutral placeholder from the URL."""
    from app.tasks.shared import get_sync_engine
    from sqlalchemy import text
    from urllib.parse import urlparse

    engine = get_sync_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT title, url FROM videos WHERE id = :vid"),
            {"vid": video_id},
        ).fetchone()

        if not row or row[0] or not row[1]:
            return

        url = row[1]
        parsed = urlparse(url)
        host = (parsed.hostname or "").removeprefix("www.")
        last_segment = parsed.path.rstrip("/").rsplit("/", 1)[-1] if parsed.path else ""

        if host and last_segment:
            title = f"{host} \u00b7 {last_segment}"
        elif host:
            title = host
        else:
            return

        if len(title) > 80:
            title = title[:77] + "..."

        conn.execute(
            text("UPDATE videos SET title = :title WHERE id = :vid"),
            {"vid": video_id, "title": title},
        )
        conn.commit()
