"""Celery tasks for curate v2 daily pipeline.

Beat schedule (configured in celery_app.py):
    21:00 UTC (05:00 Beijing) — daily_curate_pipeline (fetch + score + classify + pick)
    00:00 UTC (08:00 Beijing) — send_daily_notifications (notifications + email)
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone

from app.tasks.celery_app import celery_app
from app.tasks.shared import get_sync_engine

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.curate_v2_tasks.daily_curate_pipeline",
    soft_time_limit=1800,
    time_limit=2100,
    ignore_result=True,
)
def daily_curate_pipeline(target_date: str | None = None) -> dict:
    """
    Main daily pipeline triggered at 05:00 Beijing (21:00 UTC previous day).

    Steps:
    1. Fetch yesterday's content from watcha.cn
    2. Score all items (deterministic scoring)
    3. Classify with LLM (one call per item)
    4. Pick top items per channel
    5. Write daily_picks to DB
    """
    try:
        result = _run_pipeline(target_date)
        return result
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        logger.error("Curate v2 pipeline failed: %s\n%s", e, tb)
        return {"error": str(e), "traceback": tb}


@celery_app.task(
    name="app.tasks.curate_v2_tasks.send_daily_notifications",
    soft_time_limit=300,
    time_limit=360,
    ignore_result=True,
)
def send_daily_notifications(target_date: str | None = None) -> dict:
    """
    Triggered at 08:00 Beijing (00:00 UTC).

    1. Create notification records for today's picks
    2. Send email digests to subscribers with email enabled
    """
    try:
        result = _run_notifications(target_date)
        return result
    except Exception as e:
        logger.error("Curate v2 notifications failed: %s", e, exc_info=True)
        return {"error": str(e)}


def _run_pipeline(target_date: str | None) -> dict:
    """Execute the full curate pipeline (sync context).

    Thin orchestrator — business logic lives in
    app.services.curate_v2.pipeline_service.
    """
    from app.services.curate_v2.fetcher import fetch_yesterday_content, fetch_yesterday_products
    from app.services.curate_v2.picker import generate_daily_picks
    from app.services.curate_v2.pipeline_service import (
        backfill_channels,
        classify_items,
        deduplicate_products,
        deduplicate_scored_items,
        fetch_active_channels,
        get_already_pushed_keys,
        resolve_pick_date,
    )
    from app.services.curate_v2.scorer import score_items

    engine = get_sync_engine()
    pick_date = resolve_pick_date(target_date)

    # Step 1: Fetch yesterday's content and products
    logger.info("Step 1: Fetching content from watcha.cn...")
    fetched_items = fetch_yesterday_content(pick_date)
    logger.info("Fetched %d items", len(fetched_items))

    logger.info("Step 1b: Fetching new products from watcha.cn...")
    fetched_products = fetch_yesterday_products(pick_date)
    logger.info("Fetched %d new products", len(fetched_products))

    if not fetched_items and not fetched_products:
        return {"pick_date": pick_date.isoformat(), "total_picks": 0, "message": "No content fetched"}

    # Step 2: Get active channels
    channels = fetch_active_channels(engine)
    if not channels:
        return {"pick_date": pick_date.isoformat(), "total_picks": 0, "message": "No active channels"}
    channel_slugs = [ch.slug for ch in channels]

    # Step 3: Score items
    logger.info("Step 2: Scoring %d items...", len(fetched_items))
    scored_items = score_items(fetched_items, "all")
    logger.info("Scored items: %d passed admission", len(scored_items))

    # Step 4: Soft dedup against previously pushed items
    already_pushed_keys = get_already_pushed_keys(engine, pick_date)
    new_scored_items = deduplicate_scored_items(scored_items, already_pushed_keys)

    # Step 5: Classify new items with LLM
    logger.info("Step 3: Classifying %d new items with LLM...", len(new_scored_items))
    classified_items = classify_items(new_scored_items, already_pushed_keys)
    logger.info("Classification complete for %d new items", len(classified_items))

    # Step 6: Pick top items per channel, then backfill
    logger.info("Step 4: Selecting picks per channel...")
    picks_by_channel = generate_daily_picks(classified_items, channel_slugs)
    picks_by_channel = backfill_channels(engine, picks_by_channel, channel_slugs, pick_date)

    # Step 7: Deduplicate and write products
    fetched_products = deduplicate_products(engine, fetched_products, pick_date)
    logger.info("Step 5: Writing products to DB...")
    product_picks = _write_products_to_db(engine, fetched_products, pick_date)

    # Step 8: Write classified picks (excluding product channel)
    logger.info("Step 6: Writing classified picks to DB...")
    picks_by_channel.pop("ai-product-launch", None)
    total_picks = _write_picks_to_db(engine, picks_by_channel, pick_date)
    total_picks += product_picks

    return {
        "pick_date": pick_date.isoformat(),
        "fetched": len(fetched_items),
        "products": len(fetched_products),
        "scored": len(scored_items),
        "classified": len(classified_items),
        "total_picks": total_picks,
        "picks_per_channel": {slug: len(items) for slug, items in picks_by_channel.items()},
        "product_picks": product_picks,
    }


def _insert_pick_rows(conn, rows: list[dict]) -> int:
    """Insert pick rows with ON CONFLICT DO NOTHING. Returns total rows inserted."""
    from sqlalchemy import text

    _INSERT_PICK_SQL = text("""
        INSERT INTO curate_daily_picks
            (channel_id, pick_date, rank, source_type, source_id,
             title, summary, author_name, author_avatar,
             original_url, published_at, score, score_detail,
             is_official, raw_content, created_at)
        VALUES
            (:channel_id, :pick_date, :rank, :source_type, :source_id,
             :title, :summary, :author_name, :author_avatar,
             :original_url, :published_at, :score, :score_detail,
             :is_official, :raw_content, NOW())
        ON CONFLICT (channel_id, pick_date, source_type, source_id) DO NOTHING
    """)

    total = 0
    for row in rows:
        result = conn.execute(_INSERT_PICK_SQL, row)
        total += result.rowcount
    return total


def _write_picks_to_db(engine, picks_by_channel: dict, pick_date: date) -> int:
    """Write daily picks to the database. Idempotent (skips existing)."""
    from sqlalchemy import text

    from app.services.curate_v2.fetcher import OFFICIAL_USER_IDS

    total = 0

    with engine.connect() as conn:
        # Get channel slug -> id mapping
        channels_result = conn.execute(
            text("SELECT id, slug FROM curate_channels WHERE is_active = TRUE")
        )
        slug_to_id = {row.slug: row.id for row in channels_result.fetchall()}

        rows = []
        for slug, items in picks_by_channel.items():
            channel_id = slug_to_id.get(slug)
            if channel_id is None:
                continue

            # Hard limit: max 5 per channel (10 for daily brief)
            max_items = 10 if slug == "ai-daily-brief" else 5
            capped_items = items[:max_items]

            for rank, ci in enumerate(capped_items, start=1):
                scored = ci.scored
                title = ci.generated_title or scored.title or ci.summary[:100]

                rows.append({
                    "channel_id": channel_id,
                    "pick_date": pick_date,
                    "rank": rank,
                    "source_type": scored.source_type,
                    "source_id": scored.source_id,
                    "title": title,
                    "summary": ci.summary,
                    "author_name": scored.author_name,
                    "author_avatar": scored.author_avatar,
                    "original_url": scored.original_url,
                    "published_at": scored.published_at,
                    "score": scored.total_score,
                    "score_detail": None,
                    "is_official": scored.is_official or scored.author_id in OFFICIAL_USER_IDS,
                    "raw_content": json.dumps(scored.content_json, ensure_ascii=False) if scored.content_json else scored.content_text[:5000],
                })

        total = _insert_pick_rows(conn, rows)
        conn.commit()

    logger.info("Wrote %d picks to DB for %s", total, pick_date)
    return total


def _run_notifications(target_date: str | None) -> dict:
    """Create notifications and send email digests (sync context)."""
    from app.services.curate_v2.notifier import create_notifications, send_email_digests

    engine = get_sync_engine()
    if target_date:
        pick_date = date.fromisoformat(target_date)
    else:
        from zoneinfo import ZoneInfo
        pick_date = datetime.now(ZoneInfo("Asia/Shanghai")).date()

    # Step 1: Create notification records
    logger.info("Creating notifications for %s...", pick_date)
    notif_count = create_notifications(pick_date, engine)

    # Step 2: Send email digests
    logger.info("Sending email digests for %s...", pick_date)
    email_count = send_email_digests(pick_date, engine)

    return {
        "pick_date": pick_date.isoformat(),
        "notifications_created": notif_count,
        "emails_sent": email_count,
    }


def _write_products_to_db(engine, products: list, pick_date: date) -> int:
    """Write new products directly to ai-product-launch channel. No scoring needed."""
    from sqlalchemy import text

    if not products:
        return 0

    # Hard limit: max 5 products per day
    products = products[:5]

    with engine.connect() as conn:
        # Get ai-product-launch channel ID
        result = conn.execute(
            text("SELECT id FROM curate_channels WHERE slug = 'ai-product-launch' AND is_active = TRUE")
        )
        row = result.fetchone()
        if row is None:
            return 0
        channel_id = row.id

        rows = []
        for rank, product in enumerate(products, start=1):
            rows.append({
                "channel_id": channel_id,
                "pick_date": pick_date,
                "rank": rank,
                "source_type": "product",
                "source_id": product.product_id,
                "title": product.name,
                "summary": product.slogan,
                "author_name": product.organization,
                "author_avatar": product.avatar_url,
                "original_url": product.original_url,
                "published_at": product.published_at,
                "score": None,
                "score_detail": None,
                "is_official": True,
                "raw_content": None,
            })

        total = _insert_pick_rows(conn, rows)
        conn.commit()

    logger.info("Wrote %d product picks to DB for %s", total, pick_date)
    return total
