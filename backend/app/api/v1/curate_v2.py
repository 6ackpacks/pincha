"""Curate v2 API endpoints — channels, subscriptions, picks, notifications."""



import json
import uuid
from collections.abc import Iterable
from datetime import date, datetime, timezone
from typing import List
from zoneinfo import ZoneInfo

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_kb_id, get_current_user
from app.core.database import get_session
from app.core.redis import get_redis
from app.models.article import Article
from app.models.knowledge_base import KnowledgeBase
from app.models.curate_v2 import (
    CurateChannel,
    CurateDailyPick,
    CurateNotification,
    CurateSubscription,
)
from app.models.user import User
from app.schemas.curate_v2 import (
    ChannelPicksResponse,
    ChannelResponse,
    DailyPickResponse,
    DeepAnalyzeResponse,
    FeedResponse,
    NotificationResponse,
    SubscriptionCreate,
    SubscriptionResponse,
    SubscriptionUpdate,
    UnreadCountResponse,
)

router = APIRouter(prefix="/curate-v2", tags=["curate-v2"])


async def _get_article_map_for_picks(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    kb_id: uuid.UUID,
    source_urls: Iterable[str],
) -> dict[str, Article]:
    urls = list({url for url in source_urls if url})
    if not urls:
        return {}

    result = await db.execute(
        select(Article).where(
            Article.user_id == user_id,
            Article.kb_id == kb_id,
            Article.source_url.in_(urls),
        )
    )
    articles = result.scalars().all()
    return {article.source_url: article for article in articles if article.source_url}


async def _resolve_optional_kb_id(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    x_kb_id: str | None,
) -> uuid.UUID | None:
    """Best-effort KB resolution for optional notification enrichment."""
    if x_kb_id:
        try:
            kb_uuid = uuid.UUID(x_kb_id)
        except ValueError:
            return None
        kb = await db.get(KnowledgeBase, kb_uuid)
        if kb and kb.user_id == user_id:
            return kb.id
        return None

    result = await db.execute(
        select(KnowledgeBase.id)
        .where(KnowledgeBase.user_id == user_id, KnowledgeBase.is_default == True)
    )
    return result.scalar_one_or_none()


async def _get_table_columns(db: AsyncSession, table_name: str) -> set[str]:
    result = await db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    )
    return {row[0] for row in result.all()}


def _serialize_pick(
    pick: CurateDailyPick,
    *,
    article: Article | None = None,
) -> DailyPickResponse:
    return DailyPickResponse(
        id=pick.id,
        channel_id=pick.channel_id,
        pick_date=pick.pick_date,
        rank=pick.rank,
        source_type=pick.source_type,
        source_id=pick.source_id,
        title=pick.title,
        summary=pick.summary,
        author_name=pick.author_name,
        author_avatar=pick.author_avatar,
        original_url=pick.original_url,
        published_at=pick.published_at,
        score=pick.score,
        is_official=pick.is_official,
        article_id=article.id if article else None,
        article_status=article.status if article else None,
        article_in_wiki=article.in_wiki if article else False,
        created_at=pick.created_at,
    )


def _serialize_cached_pick(
    pick_data: dict,
    *,
    article: Article | None = None,
) -> DailyPickResponse:
    return DailyPickResponse(
        **pick_data,
        article_id=article.id if article else None,
        article_status=article.status if article else None,
        article_in_wiki=article.in_wiki if article else False,
    )


def _serialize_pick_for_cache(pick: CurateDailyPick) -> dict:
    return {
        "id": pick.id,
        "channel_id": pick.channel_id,
        "pick_date": pick.pick_date.isoformat(),
        "rank": pick.rank,
        "source_type": pick.source_type,
        "source_id": pick.source_id,
        "title": pick.title,
        "summary": pick.summary,
        "author_name": pick.author_name,
        "author_avatar": pick.author_avatar,
        "original_url": pick.original_url,
        "published_at": pick.published_at.isoformat() if pick.published_at else None,
        "score": pick.score,
        "is_official": pick.is_official,
        "created_at": pick.created_at.isoformat(),
    }


# --- Channels ---


@router.get("/channels", response_model=List[ChannelResponse])
async def list_channels(
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List all active channels with user's subscription status."""
    # Get all active channels
    channels_result = await db.execute(
        select(CurateChannel)
        .where(CurateChannel.is_active == True)
        .order_by(CurateChannel.sort_order)
    )
    channels = channels_result.scalars().all()

    # Get user's subscriptions
    subs_result = await db.execute(
        select(CurateSubscription).where(
            CurateSubscription.user_id == current_user.id
        )
    )
    subscriptions = {s.channel_id: s for s in subs_result.scalars().all()}

    # Build response with subscription status
    result = []
    for ch in channels:
        sub = subscriptions.get(ch.id)
        resp = ChannelResponse.model_validate(ch)
        resp.is_subscribed = sub is not None
        resp.subscription_id = sub.id if sub else None
        result.append(resp)

    return result


@router.get("/channels/{slug}/picks", response_model=ChannelPicksResponse)
async def get_channel_picks(
    slug: str,
    pick_date: date | None = Query(default=None, alias="date"),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Get picks for a channel on a specific date."""
    target_date = pick_date or datetime.now(ZoneInfo("Asia/Shanghai")).date()
    cache_key = f"curate:picks:{slug}:{target_date.isoformat()}"

    # Try Redis cache first
    cached = await redis.get(cache_key)
    if cached:
        cached_data = json.loads(cached)
        # Still need user-specific subscription info
        ch_result = await db.execute(
            select(CurateChannel).where(CurateChannel.slug == slug)
        )
        channel = ch_result.scalar_one_or_none()
        if channel is None:
            raise HTTPException(status_code=404, detail="频道不存在")

        sub_result = await db.execute(
            select(CurateSubscription).where(
                CurateSubscription.user_id == current_user.id,
                CurateSubscription.channel_id == channel.id,
            )
        )
        sub = sub_result.scalar_one_or_none()
        channel_resp = ChannelResponse.model_validate(channel)
        channel_resp.is_subscribed = sub is not None
        channel_resp.subscription_id = sub.id if sub else None

        article_map = await _get_article_map_for_picks(
            db,
            user_id=current_user.id,
            kb_id=kb_id,
            source_urls=[pick["original_url"] for pick in cached_data["picks"]],
        )

        return ChannelPicksResponse(
            channel=channel_resp,
            picks=[
                _serialize_cached_pick(p, article=article_map.get(p["original_url"]))
                for p in cached_data["picks"]
            ],
            pick_date=target_date,
        )

    # Get channel
    ch_result = await db.execute(
        select(CurateChannel).where(CurateChannel.slug == slug)
    )
    channel = ch_result.scalar_one_or_none()
    if channel is None:
        raise HTTPException(status_code=404, detail="频道不存在")

    # Get picks
    picks_result = await db.execute(
        select(CurateDailyPick)
        .where(
            CurateDailyPick.channel_id == channel.id,
            CurateDailyPick.pick_date == target_date,
        )
        .order_by(CurateDailyPick.score.desc().nulls_last())
    )
    picks = picks_result.scalars().all()

    # Cache picks data (without user-specific info), TTL 2 hours
    picks_for_cache = [_serialize_pick_for_cache(p) for p in picks]
    await redis.setex(cache_key, 7200, json.dumps({"picks": picks_for_cache}))

    # Check subscription
    sub_result = await db.execute(
        select(CurateSubscription).where(
            CurateSubscription.user_id == current_user.id,
            CurateSubscription.channel_id == channel.id,
        )
    )
    sub = sub_result.scalar_one_or_none()

    channel_resp = ChannelResponse.model_validate(channel)
    channel_resp.is_subscribed = sub is not None
    channel_resp.subscription_id = sub.id if sub else None
    article_map = await _get_article_map_for_picks(
        db,
        user_id=current_user.id,
        kb_id=kb_id,
        source_urls=[pick.original_url for pick in picks],
    )

    return ChannelPicksResponse(
        channel=channel_resp,
        picks=[_serialize_pick(p, article=article_map.get(p.original_url)) for p in picks],
        pick_date=target_date,
    )


# --- Subscriptions ---


@router.post("/channels/{channel_id}/subscribe", response_model=SubscriptionResponse, status_code=201)
async def subscribe_to_channel(
    channel_id: int,
    payload: SubscriptionCreate | None = None,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Subscribe to a channel."""
    # Verify channel exists
    ch_result = await db.execute(
        select(CurateChannel).where(CurateChannel.id == channel_id)
    )
    if ch_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="频道不存在")

    # Check if already subscribed
    existing = await db.execute(
        select(CurateSubscription).where(
            CurateSubscription.user_id == current_user.id,
            CurateSubscription.channel_id == channel_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="已订阅该频道")

    body = payload or SubscriptionCreate()
    sub = CurateSubscription(
        user_id=current_user.id,
        channel_id=channel_id,
        email_enabled=body.email_enabled,
        email_address=body.email_address,
        site_enabled=body.site_enabled,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


@router.delete("/channels/{channel_id}/subscribe", status_code=204)
async def unsubscribe_from_channel(
    channel_id: int,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Unsubscribe from a channel."""
    result = await db.execute(
        select(CurateSubscription).where(
            CurateSubscription.user_id == current_user.id,
            CurateSubscription.channel_id == channel_id,
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="未订阅该频道")

    await db.delete(sub)
    await db.commit()
    return None


@router.patch("/channels/{channel_id}/subscribe", response_model=SubscriptionResponse)
async def update_subscription(
    channel_id: int,
    payload: SubscriptionUpdate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Update subscription settings."""
    result = await db.execute(
        select(CurateSubscription).where(
            CurateSubscription.user_id == current_user.id,
            CurateSubscription.channel_id == channel_id,
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="未订阅该频道")

    if payload.email_enabled is not None:
        sub.email_enabled = payload.email_enabled
    if payload.email_address is not None:
        sub.email_address = payload.email_address
    if payload.site_enabled is not None:
        sub.site_enabled = payload.site_enabled

    await db.commit()
    await db.refresh(sub)
    return sub


# --- Feed ---


@router.get("/feed", response_model=FeedResponse)
async def get_feed(
    pick_date: date | None = Query(default=None, alias="date"),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """Get all subscribed channels' picks for a date."""
    target_date = pick_date or datetime.now(ZoneInfo("Asia/Shanghai")).date()

    # Get user's subscriptions
    subs_result = await db.execute(
        select(CurateSubscription).where(
            CurateSubscription.user_id == current_user.id,
            CurateSubscription.site_enabled == True,
        )
    )
    subscriptions = subs_result.scalars().all()
    channel_ids = [s.channel_id for s in subscriptions]

    if not channel_ids:
        return FeedResponse(date=target_date, channels=[])

    # Get channels
    channels_result = await db.execute(
        select(CurateChannel)
        .where(CurateChannel.id.in_(channel_ids))
        .order_by(CurateChannel.sort_order)
    )
    channels = channels_result.scalars().all()

    # Get picks for all subscribed channels
    picks_result = await db.execute(
        select(CurateDailyPick)
        .where(
            CurateDailyPick.channel_id.in_(channel_ids),
            CurateDailyPick.pick_date == target_date,
        )
        .order_by(CurateDailyPick.channel_id, CurateDailyPick.score.desc().nulls_last())
    )
    all_picks = picks_result.scalars().all()

    # Group picks by channel
    picks_by_channel: dict[int, list] = {}
    for pick in all_picks:
        picks_by_channel.setdefault(pick.channel_id, []).append(pick)

    # Build response
    sub_map = {s.channel_id: s for s in subscriptions}
    article_map = await _get_article_map_for_picks(
        db,
        user_id=current_user.id,
        kb_id=kb_id,
        source_urls=[pick.original_url for pick in all_picks],
    )
    channel_responses = []
    for ch in channels:
        sub = sub_map.get(ch.id)
        ch_resp = ChannelResponse.model_validate(ch)
        ch_resp.is_subscribed = True
        ch_resp.subscription_id = sub.id if sub else None

        ch_picks = picks_by_channel.get(ch.id, [])
        channel_responses.append(ChannelPicksResponse(
            channel=ch_resp,
            picks=[_serialize_pick(p, article=article_map.get(p.original_url)) for p in ch_picks],
            pick_date=target_date,
        ))

    return FeedResponse(date=target_date, channels=channel_responses)


# --- Notifications ---


@router.get("/notifications", response_model=list[NotificationResponse])
async def list_notifications(
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    unread_only: bool = Query(default=False),
    x_kb_id: str | None = Header(default=None, alias="X-KB-ID"),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List notifications with associated pick details."""
    columns = await _get_table_columns(db, "curate_notifications")
    n = CurateNotification.__table__.c
    selected_columns = [
        n.id,
        n.user_id,
        n.pick_id,
        n.is_read,
        n.created_at,
    ]
    for optional_column in ("notif_type", "title", "body", "action_url"):
        if optional_column in columns:
            selected_columns.append(getattr(n, optional_column))

    query = (
        select(*selected_columns)
        .where(n.user_id == current_user.id)
        .order_by(n.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if unread_only:
        query = query.where(n.is_read == False)

    result = await db.execute(query)
    notifications = result.mappings().all()
    pick_ids = [row["pick_id"] for row in notifications if row["pick_id"] is not None]
    picks_by_id: dict[int, CurateDailyPick] = {}
    if pick_ids:
        pick_result = await db.execute(
            select(CurateDailyPick).where(CurateDailyPick.id.in_(pick_ids))
        )
        picks_by_id = {pick.id: pick for pick in pick_result.scalars().all()}

    kb_id = await _resolve_optional_kb_id(db, user_id=current_user.id, x_kb_id=x_kb_id)
    picks = list(picks_by_id.values())
    article_map = (
        await _get_article_map_for_picks(
            db,
            user_id=current_user.id,
            kb_id=kb_id,
            source_urls=[pick.original_url for pick in picks],
        )
        if kb_id
        else {}
    )

    responses = []
    for row in notifications:
        pick_resp = None
        pick = picks_by_id.get(row["pick_id"]) if row["pick_id"] is not None else None
        if pick:
            pick_resp = _serialize_pick(pick, article=article_map.get(pick.original_url))
        responses.append(NotificationResponse(
            id=row["id"],
            user_id=row["user_id"],
            pick_id=row["pick_id"],
            notif_type=row.get("notif_type") or "pick",
            title=row.get("title"),
            body=row.get("body"),
            action_url=row.get("action_url"),
            is_read=row["is_read"],
            created_at=row["created_at"],
            pick=pick_resp,
        ))
    return responses


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get unread notification count."""
    result = await db.execute(
        select(func.count(CurateNotification.id)).where(
            CurateNotification.user_id == current_user.id,
            CurateNotification.is_read == False,
        )
    )
    count = result.scalar() or 0
    return UnreadCountResponse(count=count)


@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Mark one notification as read."""
    n = CurateNotification.__table__.c
    result = await db.execute(
        select(n.id).where(
            n.id == notification_id,
            n.user_id == current_user.id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="通知不存在")

    values = {"is_read": True}
    if "read_at" in await _get_table_columns(db, "curate_notifications"):
        values["read_at"] = datetime.now(timezone.utc)
    await db.execute(
        update(CurateNotification.__table__)
        .where(n.id == notification_id, n.user_id == current_user.id)
        .values(**values)
    )
    await db.commit()
    return {"message": "已标记为已读"}


@router.put("/notifications/read-all")
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Mark all notifications as read."""
    n = CurateNotification.__table__.c
    values = {"is_read": True}
    if "read_at" in await _get_table_columns(db, "curate_notifications"):
        values["read_at"] = datetime.now(timezone.utc)
    await db.execute(
        update(CurateNotification.__table__)
        .where(
            n.user_id == current_user.id,
            n.is_read == False,
        )
        .values(**values)
    )
    await db.commit()
    return {"message": "已全部标记为已读"}


# --- Pick Detail ---


@router.get("/picks/{pick_id}")
async def get_pick_detail(
    pick_id: int,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """Get full pick detail including raw_content for preview."""
    result = await db.execute(
        select(CurateDailyPick).where(CurateDailyPick.id == pick_id)
    )
    pick = result.scalar_one_or_none()
    if pick is None:
        raise HTTPException(status_code=404, detail="内容不存在")

    # Get channel info
    ch_result = await db.execute(
        select(CurateChannel).where(CurateChannel.id == pick.channel_id)
    )
    channel = ch_result.scalar_one_or_none()
    article_map = await _get_article_map_for_picks(
        db,
        user_id=current_user.id,
        kb_id=kb_id,
        source_urls=[pick.original_url],
    )
    article = article_map.get(pick.original_url)

    return {
        "id": pick.id,
        "channel_id": pick.channel_id,
        "channel_slug": channel.slug if channel else None,
        "channel_name": channel.name if channel else None,
        "pick_date": pick.pick_date.isoformat(),
        "rank": pick.rank,
        "source_type": pick.source_type,
        "source_id": pick.source_id,
        "title": pick.title,
        "summary": pick.summary,
        "author_name": pick.author_name,
        "author_avatar": pick.author_avatar,
        "original_url": pick.original_url,
        "published_at": pick.published_at.isoformat() if pick.published_at else None,
        "score": pick.score,
        "is_official": pick.is_official,
        "raw_content": pick.raw_content,
        "article_id": str(article.id) if article else None,
        "article_status": article.status if article else None,
        "article_in_wiki": article.in_wiki if article else False,
        "created_at": pick.created_at.isoformat() if pick.created_at else None,
    }


# --- Deep Analyze ---


@router.post("/picks/{pick_id}/deep-analyze", response_model=DeepAnalyzeResponse)
async def deep_analyze_pick(
    pick_id: int,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Trigger deep analysis for a pick — creates an article and dispatches processing."""
    from app.tasks.article_tasks import process_article

    async def _invalidate_pick_cache(pick: CurateDailyPick) -> None:
        """Drop the channel's cached picks so the list reflects the new article_id."""
        ch = await db.get(CurateChannel, pick.channel_id)
        if ch is not None:
            await redis.delete(f"curate:picks:{ch.slug}:{pick.pick_date.isoformat()}")

    async def _queue_article(article: Article) -> DeepAnalyzeResponse:
        article_state = (article.status or {}).get("state")
        if article.in_wiki:
            return DeepAnalyzeResponse(
                article_id=article.id,
                status="exists",
                message="该精选已收进知识库",
            )

        if article_state in {"pending", "fetching", "summarizing", "compiling"}:
            return DeepAnalyzeResponse(
                article_id=article.id,
                status="queued",
                message="深度整理任务进行中",
            )

        article.status = {"state": "pending", "progress": 0, "message": "等待深度分析..."}
        await db.commit()
        process_article.delay(str(article.id))
        return DeepAnalyzeResponse(
            article_id=article.id,
            status="queued",
            message="已提交深度分析任务",
        )

    # Get the pick
    result = await db.execute(
        select(CurateDailyPick).where(CurateDailyPick.id == pick_id)
    )
    pick = result.scalar_one_or_none()
    if pick is None:
        raise HTTPException(status_code=404, detail="精选内容不存在")

    # Check if article already exists for this pick in the current user's active KB.
    if pick.article_id:
        article_result = await db.execute(
            select(Article).where(
                Article.id == pick.article_id,
                Article.user_id == current_user.id,
                Article.kb_id == kb_id,
            )
        )
        linked_article = article_result.scalar_one_or_none()
        if linked_article:
            return await _queue_article(linked_article)

    from app.services.curate_v2.content_parser import extract_plain_text

    # Create article from pick content
    source_url = pick.original_url
    content = extract_plain_text(pick.raw_content) or pick.summary or ""

    # Check if article with this URL already exists for this user and KB.
    existing = await db.execute(
        select(Article).where(
            Article.user_id == current_user.id,
            Article.kb_id == kb_id,
            Article.source_url == source_url,
        )
    )
    existing_article = existing.scalar_one_or_none()
    if existing_article:
        pick.article_id = existing_article.id
        await db.commit()
        await _invalidate_pick_cache(pick)
        return await _queue_article(existing_article)

    # Create new article
    article = Article(
        user_id=current_user.id,
        kb_id=kb_id,
        source_type="curate_pick",
        source_url=source_url,
        title=pick.title,
        content=content if content else None,
        status={"state": "pending", "progress": 0, "message": "等待深度分析..."},
    )
    db.add(article)
    await db.commit()
    await db.refresh(article)

    # Link article back to the pick
    pick.article_id = article.id
    await db.commit()
    await _invalidate_pick_cache(pick)

    # Dispatch processing task
    process_article.delay(str(article.id))

    return DeepAnalyzeResponse(
        article_id=article.id,
        status="queued",
        message="已提交深度分析任务",
    )


# --- Product Proxy ---


@router.get("/products/{slug}")
async def get_product_detail(
    slug: str,
    current_user: User = Depends(get_current_user),
):
    """Proxy to the configured product detail API."""
    import httpx
    import os

    source_api_base = os.getenv("CURATE_SOURCE_API_BASE", "https://example.com/api/v2").rstrip("/")

    async with httpx.AsyncClient(timeout=15) as client:
        # Fetch product detail
        resp = await client.get(f"{source_api_base}/products/{slug}")
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="产品不存在")
        data = resp.json()

    product = data.get("data", data)

    # Parse description — keep both plain text and JSON for frontend rendering
    description_text = None
    description_json = None
    desc_raw = product.get("description")
    if desc_raw and isinstance(desc_raw, str):
        import json as _json
        try:
            desc_parsed = _json.loads(desc_raw)
            if isinstance(desc_parsed, dict):
                from app.services.curate_v2.content_parser import extract_plain_text
                description_text = extract_plain_text(desc_parsed)
                description_json = desc_parsed
            else:
                description_text = desc_raw
        except (ValueError, TypeError):
            description_text = desc_raw
    elif desc_raw and isinstance(desc_raw, dict):
        from app.services.curate_v2.content_parser import extract_plain_text
        description_text = extract_plain_text(desc_raw)
        description_json = desc_raw

    # Parse images — may be a semicolon-separated string or already a list
    raw_images = product.get("images")
    if isinstance(raw_images, str):
        images = [url.strip() for url in raw_images.split(";") if url.strip()]
    elif isinstance(raw_images, list):
        images = raw_images
    else:
        images = []

    return {
        "id": product.get("id"),
        "slug": product.get("slug"),
        "name": product.get("name"),
        "slogan": product.get("slogan"),
        "description": description_text,
        "description_json": description_json,
        "organization": product.get("organization"),
        "avatar_url": product.get("avatar_url"),
        "image_url": product.get("image_url"),
        "images": images,
        "website_url": product.get("website_url"),
        "categories": product.get("categories"),
        "stats": product.get("stats"),
        "tag": product.get("tag"),
        "create_at": product.get("create_at"),
    }


@router.get("/products/{product_id}/reviews")
async def get_product_reviews(
    product_id: int,
    limit: int = Query(default=10, le=50),
    skip: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
):
    """Proxy to the configured product reviews API."""
    import httpx
    import os

    source_api_base = os.getenv("CURATE_SOURCE_API_BASE", "https://example.com/api/v2").rstrip("/")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{source_api_base}/products/{product_id}/reviews",
            params={"order_by": "hot", "limit": limit, "skip": skip},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="产品不存在")
        data = resp.json()

    items = data.get("data", {}).get("items", [])

    # Parse review content and return simplified structure
    from app.services.curate_v2.content_parser import extract_plain_text

    reviews = []
    for r in items:
        user = r.get("user", {})
        content_json = r.get("content")
        reviews.append({
            "id": r.get("id"),
            "user_name": user.get("nickname"),
            "user_avatar": user.get("avatar_url"),
            "vote_value": r.get("vote_value"),
            "content_text": extract_plain_text(content_json) if content_json else "",
            "images": r.get("images"),
            "create_at": r.get("create_at"),
        })

    return {"reviews": reviews, "total": data.get("data", {}).get("total", 0)}
