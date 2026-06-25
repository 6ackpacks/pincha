"""Curate v2 — Content fetcher from watcha.cn API.

Fetches yesterday's posts and reviews from multiple endpoints,
deduplicates, and returns normalized FetchedItem instances.

Designed to run in a sync Celery task context.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.config import settings

from .content_parser import extract_plain_text

logger = logging.getLogger(__name__)

BEIJING_TZ = ZoneInfo("Asia/Shanghai")
WATCHA_BASE = settings.WATCHA_API_BASE.rstrip("/")
BASE_URL = f"{WATCHA_BASE}/api/v2"
PAGE_LIMIT = 100
REQUEST_TIMEOUT = 30.0
MAX_RETRIES = 3
RETRY_BACKOFF = 2.0
POLITE_DELAY = 1.0

# Official / curated user IDs
OFFICIAL_USER_IDS = {10010174, 10010182, 10031720}


@dataclass
class FetchedItem:
    """Normalized content item from watcha.cn."""

    source_type: str  # "post", "review", "product"
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
    product_id: int | None = None


def fetch_yesterday_content(target_date: date | None = None) -> list[FetchedItem]:
    """Fetch all content from yesterday (Beijing time) across all endpoints."""
    window_start, window_end = _yesterday_window(target_date)
    logger.info(
        "Fetching content for window: %s ~ %s (Beijing)",
        window_start.astimezone(BEIJING_TZ).isoformat(),
        window_end.astimezone(BEIJING_TZ).isoformat(),
    )

    seen: set[tuple[str, int]] = set()
    all_items: list[FetchedItem] = []

    endpoints = [
        ("discuss_posts", "/discuss/posts", {"order_by": "newest"}),
        ("hot_reviews", "/hot/reviews", {}),
        ("hot_posts", "/hot/posts", {}),
    ]

    for user_id in OFFICIAL_USER_IDS:
        endpoints.append((f"user_{user_id}", f"/users/{user_id}/posts", {}))

    with httpx.Client(base_url=BASE_URL, timeout=REQUEST_TIMEOUT) as client:
        for idx, (endpoint_name, path, extra_params) in enumerate(endpoints):
            if idx > 0:
                time.sleep(POLITE_DELAY)
            logger.info("Fetching endpoint: %s (%s)", endpoint_name, path)
            items = _fetch_endpoint_paginated(
                client, path, extra_params, window_start, window_end
            )
            for item in items:
                key = (item.source_type, item.source_id)
                if key not in seen:
                    seen.add(key)
                    all_items.append(item)
            logger.info(
                "Endpoint %s yielded %d items (%d total unique so far)",
                endpoint_name, len(items), len(all_items),
            )

    all_items.sort(key=lambda x: x.published_at, reverse=True)
    logger.info("Total fetched items (deduplicated): %d", len(all_items))
    return all_items


def _yesterday_window(target_date: date | None = None) -> tuple[datetime, datetime]:
    """Compute yesterday's time window in UTC."""
    if target_date is None:
        target_date = datetime.now(BEIJING_TZ).date()
    yesterday_beijing = target_date - timedelta(days=1)

    start_beijing = datetime(
        yesterday_beijing.year, yesterday_beijing.month, yesterday_beijing.day,
        0, 0, 0, tzinfo=BEIJING_TZ,
    )
    end_beijing = datetime(
        yesterday_beijing.year, yesterday_beijing.month, yesterday_beijing.day,
        23, 59, 59, 999999, tzinfo=BEIJING_TZ,
    )

    return start_beijing.astimezone(timezone.utc), end_beijing.astimezone(timezone.utc)


def _fetch_endpoint_paginated(
    client: httpx.Client, path: str, extra_params: dict[str, str],
    window_start: datetime, window_end: datetime,
) -> list[FetchedItem]:
    """Paginate through an endpoint, collecting items within the time window."""
    items: list[FetchedItem] = []
    skip = 0

    while True:
        params = {"skip": str(skip), "limit": str(PAGE_LIMIT), **extra_params}
        data = _request_with_retry(client, path, params)

        if data is None:
            break

        raw_items = None
        if isinstance(data, list):
            raw_items = data
        elif isinstance(data, dict):
            if "data" in data and isinstance(data["data"], dict):
                raw_items = data["data"].get("items")
            elif "data" in data and isinstance(data["data"], list):
                raw_items = data["data"]
            elif "items" in data:
                raw_items = data["items"]

        if raw_items is None or not isinstance(raw_items, list):
            break

        if len(raw_items) == 0:
            break

        for raw in raw_items:
            item = _parse_item(raw)
            if item is None:
                continue
            if item.published_at > window_end:
                continue
            if item.published_at < window_start:
                return items
            items.append(item)

        if len(raw_items) < PAGE_LIMIT:
            break

        skip += PAGE_LIMIT
        time.sleep(POLITE_DELAY)

    return items


def _request_with_retry(client: httpx.Client, path: str, params: dict[str, str]) -> Any | None:
    """Make a GET request with exponential backoff retries."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = client.get(path, params=params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning("HTTP %d for %s (attempt %d/%d)", e.response.status_code, path, attempt, MAX_RETRIES)
            if e.response.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF * attempt)
                continue
            return None
        except (httpx.RequestError, httpx.TimeoutException) as e:
            logger.warning("Request error for %s (attempt %d/%d): %s", path, attempt, MAX_RETRIES, str(e))
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF * attempt)
                continue
            return None
    return None


def _parse_item(raw: dict[str, Any]) -> FetchedItem | None:
    """Parse a raw API item dict into a FetchedItem."""
    try:
        source_type = "post"
        if raw.get("type") == "review" or "rating" in raw:
            source_type = "review"

        source_id = raw.get("id")
        if source_id is None:
            return None

        author = raw.get("author") or raw.get("user") or {}
        author_id = author.get("id", 0)
        author_name = author.get("nickname") or author.get("name") or ""
        author_avatar = author.get("avatar_url") or author.get("avatar")

        title = raw.get("title")
        content_json = raw.get("content")
        content_text = extract_plain_text(content_json)

        is_official = bool(raw.get("is_official", False))
        is_gold_member = bool(author.get("is_gold_member", False) or author.get("is_vip", False))
        has_bio = bool(author.get("bio") or author.get("description"))

        upvotes = int(raw.get("upvotes", 0) or raw.get("likes_count", 0) or 0)
        root_floors = int(raw.get("root_floors", 0) or raw.get("comments_count", 0) or raw.get("reply_count", 0) or 0)

        published_at = _parse_datetime(raw.get("create_at") or raw.get("created_at") or raw.get("published_at"))
        if published_at is None:
            return None

        original_url = raw.get("url") or f"{WATCHA_BASE}/discuss/{source_id}"

        product_id = None
        product = raw.get("product") or raw.get("subject")
        if product and isinstance(product, dict):
            product_id = product.get("id")

        return FetchedItem(
            source_type=source_type, source_id=int(source_id), title=title,
            content_json=content_json, content_text=content_text,
            author_id=int(author_id), author_name=author_name, author_avatar=author_avatar,
            is_official=is_official, is_gold_member=is_gold_member, has_bio=has_bio,
            upvotes=upvotes, root_floors=root_floors, published_at=published_at,
            original_url=original_url, product_id=int(product_id) if product_id else None,
        )
    except (KeyError, TypeError, ValueError) as e:
        logger.debug("Failed to parse item: %s — %s", raw.get("id"), e)
        return None


def _parse_datetime(value: Any) -> datetime | None:
    """Parse a datetime string or unix timestamp into a timezone-aware datetime."""
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)

    if not isinstance(value, str):
        return None

    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=BEIJING_TZ)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(value, fmt)
            dt = dt.replace(tzinfo=BEIJING_TZ)
            return dt.astimezone(timezone.utc)
        except ValueError:
            continue

    return None


@dataclass
class FetchedProduct:
    """Normalized product item from watcha.cn."""

    product_id: int
    slug: str
    name: str
    slogan: str
    organization: str | None
    avatar_url: str | None
    image_url: str | None
    score: float | None
    review_count: int
    upvotes: int
    published_at: datetime
    original_url: str


MIN_PRODUCTS = 5


def fetch_yesterday_products(target_date: date | None = None) -> list[FetchedProduct]:
    """Fetch at least MIN_PRODUCTS products, starting from yesterday and going back."""
    _, window_end = _yesterday_window(target_date)
    logger.info(
        "Fetching products up to: %s (Beijing), minimum %d",
        window_end.astimezone(BEIJING_TZ).isoformat(),
        MIN_PRODUCTS,
    )

    products: list[FetchedProduct] = []
    skip = 0

    with httpx.Client(base_url=BASE_URL, timeout=REQUEST_TIMEOUT) as client:
        while len(products) < MIN_PRODUCTS:
            params = {
                "limit": str(PAGE_LIMIT),
                "skip": str(skip),
                "status": "PUBLISHED",
                "sort": "new",
                "order": "desc",
            }
            data = _request_with_retry(client, "/products", params)
            if data is None:
                break

            items = None
            if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
                items = data["data"].get("items")

            if not items or not isinstance(items, list):
                break

            for raw in items:
                product = _parse_product_no_floor(raw, window_end)
                if product is None:
                    continue
                products.append(product)
                if len(products) >= MIN_PRODUCTS:
                    break

            if len(products) >= MIN_PRODUCTS:
                break
            if len(items) < PAGE_LIMIT:
                break

            skip += PAGE_LIMIT
            time.sleep(POLITE_DELAY)

    logger.info("Fetched %d products (min target: %d)", len(products), MIN_PRODUCTS)
    return products[:MIN_PRODUCTS]


def _parse_product_no_floor(raw: dict[str, Any], window_end: datetime) -> "FetchedProduct | None":
    """Parse a product. Only filter by upper bound (must be before window_end), no lower bound."""
    try:
        created = _parse_datetime(raw.get("create_at") or raw.get("created_at"))
        if created is None:
            return None
        if created > window_end:
            return None

        stats = raw.get("stats") or {}
        slug = raw.get("slug") or str(raw["id"])

        return FetchedProduct(
            product_id=int(raw["id"]),
            slug=slug,
            name=raw.get("name", ""),
            slogan=raw.get("slogan", ""),
            organization=raw.get("organization"),
            avatar_url=raw.get("avatar_url"),
            image_url=raw.get("image_url"),
            score=stats.get("score"),
            review_count=int(stats.get("review_count", 0)),
            upvotes=int(stats.get("upvotes", 0) or raw.get("upvotes", 0)),
            published_at=created,
            original_url=f"{WATCHA_BASE}/products/{slug}",
        )
    except (KeyError, TypeError, ValueError) as e:
        logger.debug("Failed to parse product: %s — %s", raw.get("id"), e)
        return None
