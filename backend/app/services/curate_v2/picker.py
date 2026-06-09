"""Daily pick selector for curate v2.

Selects top items for each channel based on scoring rules and constraints.
Designed to run in sync Celery task context.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .fetcher import OFFICIAL_USER_IDS
from .scorer import ScoredItem

logger = logging.getLogger(__name__)

MAX_ITEMS_PER_CHANNEL = 5
MAX_DAILY_BRIEF_ITEMS = 10  # Daily brief can have more items since it's extracted news
MAX_CHANNELS_PER_ITEM = 1
MIN_TOTAL_SCORE = 3.0
SHORT_POST_THRESHOLD = 10
SHORT_POST_MAX_PER_CHANNEL = 1
SHORT_POST_MIN_ENGAGEMENT = 7.0

# PRD 3.2: Official account -> guaranteed channel mapping
OFFICIAL_CHANNEL_MAP: dict[int, str] = {
    10010174: "ai-daily-brief",
    10010182: "ai-deep-read",
    10031720: "ai-tutorial",
}


@dataclass
class ClassifiedItem:
    """A scored item with classification and summary attached."""
    scored: ScoredItem
    channels: list[str]
    summary: str
    generated_title: str | None


def generate_daily_picks(
    classified_items: list[ClassifiedItem],
    channel_slugs: list[str],
) -> dict[str, list[ClassifiedItem]]:
    """
    Select top items for each channel.

    Rules:
    - Each channel gets up to 5 items
    - Official account items get guaranteed slots in their designated channels
    - Remaining slots filled by score descending
    - One item can appear in max 2 channels
    - Short posts (< 10 chars) max 1 per channel, needs engagement_score >= 7
    - Items must have total_score >= 3.0
    """
    item_channel_count: dict[int, int] = {}
    picks_by_channel: dict[str, list[ClassifiedItem]] = {slug: [] for slug in channel_slugs}

    # Phase 1: Place official account items into their guaranteed channels
    for ci in classified_items:
        author_id = ci.scored.author_id
        if author_id in OFFICIAL_CHANNEL_MAP:
            target_slug = OFFICIAL_CHANNEL_MAP[author_id]
            if target_slug in picks_by_channel:
                max_items = MAX_DAILY_BRIEF_ITEMS if target_slug == "ai-daily-brief" else MAX_ITEMS_PER_CHANNEL
                current = picks_by_channel[target_slug]
                if len(current) < max_items:
                    if item_channel_count.get(ci.scored.source_id, 0) < MAX_CHANNELS_PER_ITEM:
                        current.append(ci)
                        item_channel_count[ci.scored.source_id] = (
                            item_channel_count.get(ci.scored.source_id, 0) + 1
                        )
                        # Ensure the channel is in the item's channels list
                        if target_slug not in ci.channels:
                            ci.channels.append(target_slug)

    # Phase 2: For each channel, fill remaining slots
    for slug in channel_slugs:
        picked = picks_by_channel[slug]
        max_for_channel = MAX_DAILY_BRIEF_ITEMS if slug == "ai-daily-brief" else MAX_ITEMS_PER_CHANNEL
        picked_ids = {ci.scored.source_id for ci in picked}
        short_post_count = sum(
            1 for ci in picked if len(ci.scored.content_text) < SHORT_POST_THRESHOLD
        )

        # Gather candidate items for this channel (excluding already-picked items)
        channel_items = [
            ci for ci in classified_items
            if slug in ci.channels and ci.scored.source_id not in picked_ids
        ]

        # Separate official (non-guaranteed-mapped) and regular items
        official_items = [
            ci for ci in channel_items
            if (ci.scored.is_official or ci.scored.author_id in OFFICIAL_USER_IDS)
            and ci.scored.author_id not in OFFICIAL_CHANNEL_MAP
        ]
        regular_items = [
            ci for ci in channel_items
            if not (ci.scored.is_official or ci.scored.author_id in OFFICIAL_USER_IDS)
        ]

        official_items.sort(key=lambda x: x.scored.total_score, reverse=True)
        regular_items.sort(key=lambda x: x.scored.total_score, reverse=True)

        # Fill with remaining official items first, then regular
        for ci in official_items:
            if len(picked) >= max_for_channel:
                break
            if not _can_pick(ci, item_channel_count, short_post_count):
                continue
            picked.append(ci)
            item_channel_count[ci.scored.source_id] = item_channel_count.get(ci.scored.source_id, 0) + 1
            if len(ci.scored.content_text) < SHORT_POST_THRESHOLD:
                short_post_count += 1

        for ci in regular_items:
            if len(picked) >= max_for_channel:
                break
            if not _can_pick(ci, item_channel_count, short_post_count):
                continue
            picked.append(ci)
            item_channel_count[ci.scored.source_id] = item_channel_count.get(ci.scored.source_id, 0) + 1
            if len(ci.scored.content_text) < SHORT_POST_THRESHOLD:
                short_post_count += 1

        picks_by_channel[slug] = picked

    # Final safety cap: ensure no channel exceeds its limit regardless of logic above
    for slug in list(picks_by_channel.keys()):
        max_items = MAX_DAILY_BRIEF_ITEMS if slug == "ai-daily-brief" else MAX_ITEMS_PER_CHANNEL
        picks_by_channel[slug] = picks_by_channel[slug][:max_items]

    return picks_by_channel


def _can_pick(ci: ClassifiedItem, item_channel_count: dict[int, int], short_post_count: int) -> bool:
    """Check if an item can be picked given the constraints."""
    scored = ci.scored
    is_official = scored.is_official or scored.author_id in OFFICIAL_USER_IDS

    if not is_official and scored.total_score < MIN_TOTAL_SCORE:
        return False

    if item_channel_count.get(scored.source_id, 0) >= MAX_CHANNELS_PER_ITEM:
        return False

    is_short = len(scored.content_text) < SHORT_POST_THRESHOLD
    if is_short:
        if short_post_count >= SHORT_POST_MAX_PER_CHANNEL:
            return False
        if scored.engagement_score < SHORT_POST_MIN_ENGAGEMENT:
            return False

    return True
