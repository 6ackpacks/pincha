"""Curate v2 — Deterministic scoring engine.

Scores fetched items using a weighted formula combining engagement,
content structure, and author authority signals.

Total score = engagement * 0.35 + structure * 0.35 + authority * 0.30
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .content_parser import count_images, count_links, count_paragraphs, has_list_or_heading
from .fetcher import FetchedItem, OFFICIAL_USER_IDS

logger = logging.getLogger(__name__)

W_ENGAGEMENT = 0.35
W_STRUCTURE = 0.35
W_AUTHORITY = 0.30

ADMISSION_THRESHOLD = 3.0
SHORT_POST_CHAR_LIMIT = 10
SHORT_POST_MAX_PER_CHANNEL = 1
SHORT_POST_MIN_ENGAGEMENT = 7.0


@dataclass
class ScoredItem:
    """A FetchedItem with scoring breakdown attached."""

    source_type: str
    source_id: int
    title: str | None
    content_json: dict[str, Any] | None
    content_text: str
    author_id: int
    author_name: str
    author_avatar: str | None
    is_official: bool
    is_gold_member: bool
    has_bio: bool
    upvotes: int
    root_floors: int
    published_at: datetime
    original_url: str
    product_id: int | None

    engagement_score: float
    structure_score: float
    authority_score: float
    total_score: float

    @classmethod
    def from_fetched(
        cls, item: FetchedItem,
        engagement_score: float, structure_score: float, authority_score: float,
    ) -> ScoredItem:
        total = (
            engagement_score * W_ENGAGEMENT
            + structure_score * W_STRUCTURE
            + authority_score * W_AUTHORITY
        )
        return cls(
            source_type=item.source_type, source_id=item.source_id,
            title=item.title, content_json=item.content_json,
            content_text=item.content_text, author_id=item.author_id,
            author_name=item.author_name, author_avatar=item.author_avatar,
            is_official=item.is_official, is_gold_member=item.is_gold_member,
            has_bio=item.has_bio, upvotes=item.upvotes,
            root_floors=item.root_floors, published_at=item.published_at,
            original_url=item.original_url, product_id=item.product_id,
            engagement_score=engagement_score, structure_score=structure_score,
            authority_score=authority_score, total_score=total,
        )


def score_items(items: list[FetchedItem], channel_slug: str) -> list[ScoredItem]:
    """Score all items and apply admission rules."""
    if not items:
        return []

    now_utc = datetime.now(timezone.utc)
    raw_heats = [_raw_heat(item, now_utc) for item in items]
    engagement_scores = _min_max_normalize(raw_heats, 0.0, 10.0)

    scored: list[ScoredItem] = []
    for i, item in enumerate(items):
        eng = engagement_scores[i]
        struct = _structure_score(item)
        auth = _authority_score(item)
        scored.append(ScoredItem.from_fetched(item, eng, struct, auth))

    admitted = _apply_admission_rules(scored)
    admitted.sort(key=lambda x: x.total_score, reverse=True)
    logger.info("Scoring: %d in, %d admitted (channel=%s)", len(items), len(admitted), channel_slug)
    return admitted


def _raw_heat(item: FetchedItem, now_utc: datetime) -> float:
    """Compute raw engagement heat value."""
    hours_since = max((now_utc - item.published_at).total_seconds() / 3600.0, 0.0)
    numerator = item.root_floors * 3 + item.upvotes
    denominator = (hours_since + 2) ** 1.2
    return numerator / denominator if denominator > 0 else 0.0


def _min_max_normalize(values: list[float], target_min: float, target_max: float) -> list[float]:
    if not values:
        return []
    v_min, v_max = min(values), max(values)
    spread = v_max - v_min
    if spread == 0:
        mid = (target_min + target_max) / 2.0
        return [mid] * len(values)
    return [target_min + (v - v_min) / spread * (target_max - target_min) for v in values]


def _structure_score(item: FetchedItem) -> float:
    """Compute structure score (0-10) based on content richness."""
    s = 0.0
    word_count = len(item.content_text)
    paragraph_count = count_paragraphs(item.content_json)
    link_count = count_links(item.content_json)
    image_count = count_images(item.content_json)
    has_structured = has_list_or_heading(item.content_json)

    s += min(word_count / 500.0, 1.0) * 3.0
    s += min(paragraph_count / 4.0, 1.0) * 2.0
    s += min(link_count / 2.0, 1.0) * 2.0
    s += min(image_count / 2.0, 1.0) * 1.5
    s += (1.0 if has_structured else 0.0) * 1.5

    return min(s, 10.0)


def _authority_score(item: FetchedItem) -> float:
    """Compute authority score (0-10) based on author signals."""
    if item.author_id in OFFICIAL_USER_IDS:
        return 10.0
    if item.is_official:
        return 8.0
    if item.is_gold_member:
        return 7.0
    if item.has_bio:
        return 5.0
    return 3.0


def _apply_admission_rules(items: list[ScoredItem]) -> list[ScoredItem]:
    """Filter items based on admission threshold and short-post rules."""
    admitted: list[ScoredItem] = []
    short_post_count = 0

    for item in items:
        if item.total_score < ADMISSION_THRESHOLD:
            continue
        if len(item.content_text) < SHORT_POST_CHAR_LIMIT:
            if item.engagement_score < SHORT_POST_MIN_ENGAGEMENT:
                continue
            if short_post_count >= SHORT_POST_MAX_PER_CHANNEL:
                continue
            short_post_count += 1
        admitted.append(item)

    return admitted
