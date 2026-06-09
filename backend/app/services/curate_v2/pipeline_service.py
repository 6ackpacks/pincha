"""Extracted business logic for the curate v2 daily pipeline.

Each function handles one logical step of the pipeline, keeping the
Celery task file as a thin orchestrator.
"""

from __future__ import annotations

import json
import logging
from copy import copy
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services.curate_v2.classifier import classify_and_summarize, extract_daily_brief_items
from app.services.curate_v2.fetcher import OFFICIAL_USER_IDS
from app.services.curate_v2.picker import ClassifiedItem
from app.services.curate_v2.scorer import ScoredItem

logger = logging.getLogger(__name__)

# PRD 6.4: Daily brief account
DAILY_BRIEF_AUTHOR_ID = 10010174


def resolve_pick_date(target_date: str | None) -> date:
    """Determine the pick date from an explicit string or Beijing wall-clock."""
    if target_date:
        return date.fromisoformat(target_date)
    return datetime.now(ZoneInfo("Asia/Shanghai")).date()


def fetch_active_channels(engine: Engine) -> list[Any]:
    """Return active curate channels ordered by sort_order."""
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT id, slug, pick_count FROM curate_channels WHERE is_active = TRUE ORDER BY sort_order")
        )
        return result.fetchall()


def get_already_pushed_keys(engine: Engine, pick_date: date) -> set[tuple[str, int]]:
    """Return (source_type, source_id) pairs already pushed on previous days."""
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT DISTINCT source_type, source_id FROM curate_daily_picks WHERE pick_date < :today"),
            {"today": pick_date},
        )
        return {(row.source_type, row.source_id) for row in result.fetchall()}


def deduplicate_scored_items(
    scored_items: list[ScoredItem],
    already_pushed_keys: set[tuple[str, int]],
) -> list[ScoredItem]:
    """Filter out items already pushed on previous days (soft dedup)."""
    new_items = [s for s in scored_items if (s.source_type, s.source_id) not in already_pushed_keys]
    logger.info(
        "Soft dedup: %d new items (excluded %d already-pushed, will backfill from DB if needed)",
        len(new_items),
        len(scored_items) - len(new_items),
    )
    return new_items


def classify_items(
    new_scored_items: list[ScoredItem],
    already_pushed_keys: set[tuple[str, int]],
) -> list[ClassifiedItem]:
    """Classify new items with LLM. Daily brief items get special extraction."""
    classified_items: list[ClassifiedItem] = []

    for scored in new_scored_items:
        if scored.author_id == DAILY_BRIEF_AUTHOR_ID:
            _classify_daily_brief(scored, already_pushed_keys, classified_items)
        else:
            classification = classify_and_summarize(
                title=scored.title,
                content_text=scored.content_text,
                source_type=scored.source_type,
            )
            classified_items.append(ClassifiedItem(
                scored=scored,
                channels=classification["channels"],
                summary=classification["summary"],
                generated_title=classification["title"],
            ))

    return classified_items


def _classify_daily_brief(
    scored: ScoredItem,
    already_pushed_keys: set[tuple[str, int]],
    classified_items: list[ClassifiedItem],
) -> None:
    """Extract individual items from a daily brief post."""
    brief_items = extract_daily_brief_items(scored.content_text)
    if brief_items:
        for idx, brief in enumerate(brief_items):
            virtual_scored = copy(scored)
            virtual_scored.source_id = scored.source_id * 100 + idx + 1
            if (virtual_scored.source_type, virtual_scored.source_id) in already_pushed_keys:
                continue
            classified_items.append(ClassifiedItem(
                scored=virtual_scored,
                channels=["ai-daily-brief"],
                summary=brief.get("summary", ""),
                generated_title=brief.get("title"),
            ))
    else:
        # Fallback: treat the whole post as one item
        classified_items.append(ClassifiedItem(
            scored=scored,
            channels=["ai-daily-brief"],
            summary=scored.title or scored.content_text[:80],
            generated_title=scored.title,
        ))


def backfill_channels(
    engine: Engine,
    picks_by_channel: dict[str, list[ClassifiedItem]],
    channel_slugs: list[str],
    pick_date: date,
) -> dict[str, list[ClassifiedItem]]:
    """Backfill channels that have fewer than max items from yesterday's historical picks."""
    beijing_tz = ZoneInfo("Asia/Shanghai")
    yesterday_beijing = pick_date - timedelta(days=1)
    yesterday_start = datetime(
        yesterday_beijing.year, yesterday_beijing.month, yesterday_beijing.day,
        0, 0, 0, tzinfo=beijing_tz,
    )
    yesterday_end = datetime(
        yesterday_beijing.year, yesterday_beijing.month, yesterday_beijing.day,
        23, 59, 59, tzinfo=beijing_tz,
    )

    for slug in channel_slugs:
        current = picks_by_channel.get(slug, [])
        max_items = 10 if slug == "ai-daily-brief" else 5
        if len(current) >= max_items:
            continue
        needed = max_items - len(current)
        current_source_keys = {(ci.scored.source_type, ci.scored.source_id) for ci in current}

        backfill_rows = _query_backfill_rows(
            engine, slug, yesterday_start, yesterday_end, current_source_keys, needed,
        )

        if backfill_rows:
            logger.info("Backfilling %s with %d historical picks", slug, len(backfill_rows))
            for row in backfill_rows:
                current.append(_backfill_row_to_classified_item(row, slug))
        picks_by_channel[slug] = current[:max_items]

    logger.info("After backfill: %s", {s: len(p) for s, p in picks_by_channel.items()})
    return picks_by_channel


def _query_backfill_rows(
    engine: Engine,
    slug: str,
    yesterday_start: datetime,
    yesterday_end: datetime,
    current_source_keys: set[tuple[str, int]],
    needed: int,
) -> list[Any]:
    """Query historical picks for backfill."""
    with engine.connect() as conn:
        exclude_clause = ""
        params: dict[str, Any] = {
            "slug": slug,
            "yesterday_start": yesterday_start,
            "yesterday_end": yesterday_end,
            "needed": needed,
        }
        if current_source_keys:
            placeholders = ",".join(
                f"(:ex_type_{i}, :ex_id_{i})" for i in range(len(current_source_keys))
            )
            exclude_clause = f"AND (source_type, source_id) NOT IN ({placeholders})"
            for i, (stype, sid) in enumerate(current_source_keys):
                params[f"ex_type_{i}"] = stype
                params[f"ex_id_{i}"] = sid

        result = conn.execute(
            text(f"""
                SELECT source_id, title, summary, author_name, author_avatar,
                       original_url, published_at, score, score_detail, is_official,
                       raw_content, source_type
                FROM curate_daily_picks
                WHERE channel_id = (SELECT id FROM curate_channels WHERE slug = :slug)
                  AND published_at >= :yesterday_start
                  AND published_at <= :yesterday_end
                  {exclude_clause}
                ORDER BY score DESC NULLS LAST
                LIMIT :needed
            """),
            params,
        )
        return result.fetchall()


def _backfill_row_to_classified_item(row: Any, slug: str) -> ClassifiedItem:
    """Convert a backfill DB row into a ClassifiedItem."""
    dummy_scored = ScoredItem(
        source_type=row.source_type or "post",
        source_id=row.source_id,
        title=row.title,
        content_json=None,
        content_text=row.raw_content or "",
        author_id=0,
        author_name=row.author_name or "",
        author_avatar=row.author_avatar,
        is_official=row.is_official or False,
        is_gold_member=False,
        has_bio=False,
        upvotes=0,
        root_floors=0,
        published_at=row.published_at or datetime.now(timezone.utc),
        original_url=row.original_url or "",
        product_id=None,
        engagement_score=0,
        structure_score=0,
        authority_score=0,
        total_score=row.score or 0,
    )
    return ClassifiedItem(
        scored=dummy_scored,
        channels=[slug],
        summary=row.summary or "",
        generated_title=row.title,
    )


def deduplicate_products(engine: Engine, products: list, pick_date: date) -> list:
    """Exclude products already pushed in previous days."""
    if not products:
        return products

    with engine.connect() as conn:
        result = conn.execute(
            text(
                "SELECT DISTINCT source_id FROM curate_daily_picks "
                "WHERE source_type = 'product' AND pick_date < :today"
            ),
            {"today": pick_date},
        )
        already_pushed_product_ids = {row.source_id for row in result.fetchall()}

    if already_pushed_product_ids:
        before_count = len(products)
        products = [
            p for p in products if p.product_id not in already_pushed_product_ids
        ]
        logger.info(
            "After product cross-day dedup: %d products (excluded %d already-pushed)",
            len(products),
            before_count - len(products),
        )

    return products
