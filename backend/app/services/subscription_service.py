"""Service layer for subscription management and feed fetching."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import FeedItem, Subscription

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# yt-dlp helpers (sync, run in thread pool)
# ---------------------------------------------------------------------------

def _ydl_fetch_flat(url: str, max_results: int) -> list[dict[str, Any]]:
    """Synchronous yt-dlp call — must be wrapped with asyncio.to_thread."""
    try:
        import yt_dlp  # type: ignore
    except ImportError:
        raise RuntimeError("yt-dlp is not installed")

    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "playlist_items": f"1-{max_results}",
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info is None:
        return []

    entries = info.get("entries") or []
    results: list[dict[str, Any]] = []
    for entry in entries:
        if not entry:
            continue
        video_url = entry.get("url") or entry.get("webpage_url") or ""
        # Flat extraction gives short IDs; build full URL if needed
        if video_url and not video_url.startswith("http"):
            video_id = entry.get("id", "")
            if video_id:
                video_url = f"https://www.youtube.com/watch?v={video_id}"

        # thumbnail: first from thumbnails list, fallback to thumbnail field
        thumbnail_url = entry.get("thumbnail")
        thumbnails = entry.get("thumbnails") or []
        if thumbnails:
            # prefer the highest-res thumbnail
            thumbnail_url = thumbnails[-1].get("url", thumbnail_url)

        # published_at: yt-dlp returns upload_date as YYYYMMDD string
        published_at: datetime | None = None
        upload_date = entry.get("upload_date")
        if upload_date and len(upload_date) == 8:
            try:
                published_at = datetime(
                    int(upload_date[:4]),
                    int(upload_date[4:6]),
                    int(upload_date[6:]),
                    tzinfo=timezone.utc,
                )
            except ValueError:
                pass

        results.append(
            {
                "url": video_url,
                "title": entry.get("title"),
                "thumbnail_url": thumbnail_url,
                "published_at": published_at,
            }
        )

    return results


async def fetch_channel_videos(
    channel_url: str, max_results: int = 20
) -> list[dict[str, Any]]:
    """Fetch latest videos from a YouTube channel or playlist.

    Runs yt-dlp in a thread pool to avoid blocking the event loop.
    Returns a list of dicts: {url, title, thumbnail_url, published_at}.
    """
    try:
        return await asyncio.to_thread(_ydl_fetch_flat, channel_url, max_results)
    except Exception as exc:
        logger.error("yt-dlp fetch failed for %s: %s", channel_url, exc)
        raise


# ---------------------------------------------------------------------------
# Subscription CRUD helpers
# ---------------------------------------------------------------------------

def _detect_platform_and_type(url: str) -> tuple[str, str]:
    """Infer (platform, type) from URL string."""
    url_lower = url.lower()
    if "youtube.com" in url_lower or "youtu.be" in url_lower:
        platform = "youtube"
        if "playlist" in url_lower or "/playlist" in url_lower:
            sub_type = "playlist"
        elif "/@" in url_lower or "/channel/" in url_lower or "/user/" in url_lower or "/c/" in url_lower:
            sub_type = "channel"
        else:
            sub_type = "channel"
    else:
        platform = "rss"
        sub_type = "rss"
    return platform, sub_type


async def create_subscription(
    db: AsyncSession,
    url: str,
    auto_process: bool = True,
    check_interval_hours: int = 6,
) -> Subscription:
    """Persist a new Subscription record."""
    platform, sub_type = _detect_platform_and_type(url)
    sub = Subscription(
        url=url,
        platform=platform,
        type=sub_type,
        auto_process=auto_process,
        check_interval_hours=check_interval_hours,
        status="active",
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


async def list_subscriptions(db: AsyncSession) -> list[Subscription]:
    result = await db.execute(
        select(Subscription).order_by(Subscription.created_at.desc())
    )
    return list(result.scalars().all())


async def get_subscription(
    db: AsyncSession, subscription_id: uuid.UUID
) -> Subscription | None:
    result = await db.execute(
        select(Subscription).where(Subscription.id == subscription_id)
    )
    return result.scalar_one_or_none()


async def update_subscription(
    db: AsyncSession,
    subscription: Subscription,
    **kwargs: Any,
) -> Subscription:
    for key, value in kwargs.items():
        if hasattr(subscription, key):
            setattr(subscription, key, value)
    subscription.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(subscription)
    return subscription


async def delete_subscription(db: AsyncSession, subscription: Subscription) -> None:
    await db.delete(subscription)
    await db.commit()


# ---------------------------------------------------------------------------
# Feed refresh
# ---------------------------------------------------------------------------

async def refresh_subscription(
    subscription_id: uuid.UUID, db: AsyncSession
) -> dict[str, int]:
    """Pull latest videos and upsert new FeedItems.

    If auto_process is True, each new item triggers the video analysis pipeline.
    Returns {'new_items': N}.
    """
    sub = await get_subscription(db, subscription_id)
    if sub is None:
        raise ValueError(f"Subscription {subscription_id} not found")

    try:
        videos = await fetch_channel_videos(sub.url, max_results=20)
    except Exception as exc:
        sub.status = "error"
        sub.error_message = str(exc)
        sub.last_checked_at = datetime.now(timezone.utc)
        sub.updated_at = datetime.now(timezone.utc)
        await db.commit()
        raise

    # Fetch existing video_urls for this subscription to detect new ones
    existing_result = await db.execute(
        select(FeedItem.video_url).where(FeedItem.subscription_id == subscription_id)
    )
    existing_urls: set[str] = {row[0] for row in existing_result.all()}

    new_items = 0
    for video in videos:
        video_url = video.get("url") or ""
        if not video_url or video_url in existing_urls:
            continue

        item = FeedItem(
            subscription_id=subscription_id,
            video_url=video_url,
            title=video.get("title"),
            thumbnail_url=video.get("thumbnail_url"),
            published_at=video.get("published_at"),
        )
        db.add(item)
        existing_urls.add(video_url)
        new_items += 1

    sub.last_checked_at = datetime.now(timezone.utc)
    sub.updated_at = datetime.now(timezone.utc)
    if sub.status == "error":
        sub.status = "active"
        sub.error_message = None

    await db.commit()

    # Trigger analysis pipeline for new items if auto_process is enabled
    if sub.auto_process and new_items > 0:
        await _auto_process_new_items(db, subscription_id, sub.platform)

    logger.info(
        "Subscription %s refreshed: %d new item(s)", subscription_id, new_items
    )
    return {"new_items": new_items}


async def _auto_process_new_items(
    db: AsyncSession, subscription_id: uuid.UUID, platform: str
) -> None:
    """Submit unprocessed feed items to the video analysis pipeline."""
    from app.models.video import Video
    from app.tasks.video_tasks import process_video

    result = await db.execute(
        select(FeedItem).where(
            FeedItem.subscription_id == subscription_id,
            FeedItem.processed == False,  # noqa: E712
            FeedItem.video_id == None,    # noqa: E711
        )
    )
    items = list(result.scalars().all())

    for item in items:
        try:
            # Dedup: check if video already exists in videos table
            existing = (
                await db.execute(select(Video).where(Video.url == item.video_url))
            ).scalar_one_or_none()

            if existing is not None:
                item.video_id = existing.id
                item.processed = True
            else:
                # Create a new video record and dispatch the pipeline
                new_video = Video(
                    url=item.video_url,
                    platform=platform,
                )
                db.add(new_video)
                await db.flush()  # obtain the new id

                item.video_id = new_video.id
                item.processed = True

                process_video.delay(str(new_video.id))
                logger.info(
                    "Auto-submitted video %s for feed item %s", new_video.id, item.id
                )
        except Exception as exc:
            logger.error(
                "Failed to auto-process feed item %s (%s): %s",
                item.id,
                item.video_url,
                exc,
            )

    await db.commit()


# ---------------------------------------------------------------------------
# Feed queries
# ---------------------------------------------------------------------------

async def get_feed(
    db: AsyncSession,
    subscription_id: uuid.UUID,
    limit: int = 20,
    offset: int = 0,
) -> list[FeedItem]:
    result = await db.execute(
        select(FeedItem)
        .where(FeedItem.subscription_id == subscription_id)
        .order_by(FeedItem.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def get_all_feed(
    db: AsyncSession,
    limit: int = 30,
    offset: int = 0,
) -> list[FeedItem]:
    result = await db.execute(
        select(FeedItem)
        .order_by(FeedItem.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())
