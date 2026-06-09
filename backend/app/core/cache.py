"""Redis cache helpers for Pingcha API.

Usage pattern (cache-aside):
    cached = await cache_get(KEY)
    if cached is not None:
        return cached
    result = await db_query(...)
    await cache_set(KEY, result, TTL)
    return result

Invalidation:  await cache_delete(KEY1, KEY2, ...)
"""

import hashlib
import json
import logging
import time
from typing import Any, Optional

from app.core.redis import get_redis

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL constants
# ---------------------------------------------------------------------------
VIDEOS_LIST_TTL = 60           # 1 min  – list changes on submit/delete
VIDEO_DETAIL_TTL = 3_600       # 1 h    – metadata (title/thumbnail) stable
TRANSCRIPT_TTL = 86_400 * 30   # 30 d   – never changes once written
SUMMARY_TTL = 86_400 * 30      # 30 d
MINDMAP_TTL = 86_400 * 30      # 30 d
WIKI_PAGES_TTL = 1_800         # 30 min – list refreshed on ingest/delete
WIKI_PAGE_TTL = 1_800          # 30 min
WIKI_GRAPH_TTL = 300           # 5 min  – graph refreshed on ingest
WIKI_VIDEOS_TTL = 300          # 5 min  – wiki video list
CURATE_FEED_TTL = 1_800        # 30 min – daily feed is stable
SUMMARY_AVAILABLE_TTL = 60     # 1 min  – available levels list
WIKI_HEALTH_TTL = 300          # 5 min  – health metrics
WIKI_SEARCH_TTL = 120          # 2 min  – search results
WIKI_TAGS_TTL = 300            # 5 min  – tag tree


# ---------------------------------------------------------------------------
# Key builders
# ---------------------------------------------------------------------------

def videos_list_key(user_id: str) -> str:
    return f"videos:list:{user_id}"


def video_detail_key(video_id: str) -> str:
    return f"video:{video_id}"


def transcript_key(video_id: str) -> str:
    return f"transcript:{video_id}"


def summary_key(video_id: str, level: str) -> str:
    return f"summary:{video_id}:{level}"


def mindmap_key(video_id: str) -> str:
    return f"mindmap:{video_id}"


def wiki_pages_key(search: str, offset: int, limit: int) -> str:
    h = hashlib.md5(f"{search}:{offset}:{limit}".encode()).hexdigest()[:8]
    return f"wiki:pages:{h}"


def wiki_page_key(slug: str, user_id: str = "", kb_id: str = "") -> str:
    return f"wiki:page:{user_id}:{kb_id}:{slug}"


def wiki_graph_key(user_id: str) -> str:
    return f"wiki:graph:{user_id}"


def wiki_videos_key(user_id: str, kb_id: str = "") -> str:
    return f"wiki:videos:{user_id}:{kb_id}"


def curate_feed_key(user_id: str, feed_date: str, category_id: str) -> str:
    return f"curate:feed:{user_id}:{feed_date}:{category_id}"


def wiki_health_key(user_id: str, kb_id: str = "") -> str:
    return f"wiki:health:{user_id}:{kb_id}"


def wiki_search_key(user_id: str, q: str, limit: int, kb_id: str = "") -> str:
    h = hashlib.md5(f"{q}:{limit}".encode()).hexdigest()[:8]
    return f"wiki:search:{user_id}:{kb_id}:{h}"


def summary_available_key(video_id: str) -> str:
    return f"summary:available:{video_id}"


def wiki_tags_key(user_id: str, kb_id: str = "") -> str:
    return f"wiki:tags:{user_id}:{kb_id}"


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

async def cache_get(key: str) -> Optional[Any]:
    """Return deserialized value or None on miss/error."""
    try:
        t0 = time.perf_counter()
        redis = await get_redis()
        raw = await redis.get(key)
        ms = (time.perf_counter() - t0) * 1000
        if raw is None:
            logger.debug("cache MISS  key=%s  (%.0fms)", key, ms)
            return None
        logger.debug("cache HIT   key=%s  (%.0fms)", key, ms)
        return json.loads(raw)
    except Exception as exc:
        logger.debug("cache_get failed key=%s: %s", key, exc)
        return None


async def cache_set(key: str, value: Any, ttl: int) -> None:
    """Serialize and store value with TTL.  Silently ignores errors."""
    try:
        t0 = time.perf_counter()
        redis = await get_redis()
        await redis.setex(key, ttl, json.dumps(value, default=str))
        ms = (time.perf_counter() - t0) * 1000
        logger.debug("cache SET   key=%s  ttl=%d  (%.0fms)", key, ttl, ms)
    except Exception as exc:
        logger.debug("cache_set failed key=%s: %s", key, exc)


async def cache_delete(*keys: str) -> None:
    """Delete one or more keys.  Silently ignores errors."""
    if not keys:
        return
    try:
        redis = await get_redis()
        await redis.delete(*keys)
    except Exception as exc:
        logger.debug("cache_delete failed: %s", exc)


async def cache_delete_pattern(pattern: str) -> None:
    """Delete all keys matching a glob pattern using SCAN (non-blocking)."""
    try:
        redis = await get_redis()
        cursor = 0
        while True:
            cursor, keys = await redis.scan(cursor, match=pattern, count=100)
            if keys:
                await redis.delete(*keys)
            if cursor == 0:
                break
    except Exception as exc:
        logger.debug("cache_delete_pattern failed pattern=%s: %s", pattern, exc)
