"""Curate v2 — Content fetching and scoring engine.

This package provides:
- fetcher: Fetches yesterday's content from watcha.cn API
- content_parser: Extracts text/metrics from ProseMirror JSON
- scorer: Deterministic scoring with engagement/structure/authority weights
- classifier: LLM-based content classification
- picker: Daily pick selection logic
- notifier: Notification and email digest service
"""

from .content_parser import (
    count_images,
    count_links,
    count_paragraphs,
    extract_plain_text,
    has_list_or_heading,
)
from .fetcher import FetchedItem, FetchedProduct, fetch_yesterday_content, fetch_yesterday_products
from .scorer import ScoredItem, score_items

__all__ = [
    # Fetcher
    "FetchedItem",
    "FetchedProduct",
    "fetch_yesterday_content",
    "fetch_yesterday_products",
    # Content parser
    "extract_plain_text",
    "count_paragraphs",
    "count_links",
    "count_images",
    "has_list_or_heading",
    # Scorer
    "ScoredItem",
    "score_items",
]
