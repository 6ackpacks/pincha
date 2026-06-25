"""Subtitle fetching service: orchestrator that delegates to sub-modules.

This module is the main entry point for transcript extraction. It coordinates:
- subtitle_providers: third-party API clients (Supadata, TranscriptAPI, etc.)
- subtitle_parsers: yt-dlp subtitle download and parsing

ASR 已下线：仅支持平台字幕，无字幕则抛出结构化 NoSubtitleError。
"""

from __future__ import annotations

import hashlib
import json
import logging
import time

from app.tasks.shared import get_sync_redis

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Structured errors
# ---------------------------------------------------------------------------

class NoSubtitleError(RuntimeError):
    """无字幕（或不支持的平台）时抛出的结构化错误。

    携带 code（机器可读的错误码，用于前端区分文案）和 message（中文提示）。
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Re-exports from sub-modules (backward compatibility for existing importers)
# ---------------------------------------------------------------------------

from app.services.subtitle_providers import (  # noqa: E402
    fetch_tikhub_transcript,
    fetch_supadata_transcript,
    fetch_transcriptapi_transcript,
    fetch_transcripthq_transcript,
    fetch_youtube_transcript_api,
    _CircuitBreaker,
    _breaker,
    _extract_youtube_video_id,
    COOKIES_PATH,
    YOUTUBE_PROXY,
)

from app.services.subtitle_parsers import (  # noqa: E402
    fetch_platform_subtitles,
    _build_ydl_base_opts,
    POT_PROVIDER_BASE,
)


# ---------------------------------------------------------------------------
# Cache constants
# ---------------------------------------------------------------------------

SUBTITLE_CACHE_TTL = 604800  # 7 days


def _build_subtitle_cache_key(url: str, platform: str) -> str:
    """Build a consistent cache key for subtitle data.

    Args:
        url: Source URL
        platform: Platform identifier (youtube, podcast, etc.)

    Returns:
        Redis cache key string

    Raises:
        ValueError: If YouTube URL is invalid and video ID cannot be extracted
    """
    if platform == "youtube":
        video_id = _extract_youtube_video_id(url)
        if not video_id:
            raise ValueError(f"Failed to extract YouTube video ID from URL: {url}")
    elif platform == "podcast":
        # Use MD5 hash for long/complex podcast URLs to ensure fixed-length keys
        video_id = hashlib.md5(url.encode()).hexdigest()[:16]
    else:
        video_id = url
    return f"subtitle:cache:{platform}:{video_id}"


def invalidate_subtitle_cache(url: str, platform: str) -> bool:
    """Delete cached subtitle for a given video URL. Returns True if a key was deleted."""
    cache_key = _build_subtitle_cache_key(url, platform)
    try:
        redis = get_sync_redis()
        deleted = redis.delete(cache_key)
        if deleted:
            logger.info("[transcript] Cache invalidated: %s", cache_key)
        return bool(deleted)
    except Exception as e:
        logger.warning("[transcript] Cache invalidation failed: %s", e)
        return False


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def get_transcript_segments(url: str, platform: str, on_progress=None, bypass_cache: bool = False) -> tuple[list[dict], str]:
    """Main orchestration: 仅尝试平台字幕，无字幕则抛 NoSubtitleError。

    Returns (segments, source) where source is "platform".
    Raises NoSubtitleError if no platform subtitle is available.
    on_progress: optional callback(percent, message) for granular progress reporting.
    bypass_cache: if True, skip cache lookup (used during reprocess).
    """
    def _report(pct: int, msg: str):
        if on_progress:
            on_progress(pct, msg)

    # 播客解析已下线（ASR 下线）
    if platform == "podcast":
        raise NoSubtitleError(
            "PODCAST_UNSUPPORTED",
            "播客解析暂不可用，目前仅支持拥有字幕的 YouTube 视频",
        )

    # --- 缓存检查 ---
    cache_key = _build_subtitle_cache_key(url, platform)
    if not bypass_cache:
        try:
            redis = get_sync_redis()
            cached = redis.get(cache_key)
            if cached:
                data = json.loads(cached)
                logger.info("[transcript] Cache hit for %s (%d segments)", cache_key, len(data["segments"]))
                return data["segments"], data["source"]
        except Exception as e:
            logger.warning("[transcript] Redis cache read failed: %s", e)

    # --- Helper: write successful platform result to cache ---
    def _cache_platform_result(segs: list[dict]):
        try:
            redis = get_sync_redis()
            redis.setex(cache_key, SUBTITLE_CACHE_TTL, json.dumps({"segments": segs, "source": "platform"}))
            logger.info("[transcript] Cached %d segments for %s (TTL=%ds)", len(segs), cache_key, SUBTITLE_CACHE_TTL)
        except Exception as e:
            logger.warning("[transcript] Redis cache write failed: %s", e)

    # --- 多供应商字幕提取降级链 ---
    # 策略：串行尝试，谁先成功用谁；熔断器自动跳过连续失败的供应商

    # Step 1: TikHub (YouTube only, 支付宝/国内支付, $0.001/次)
    if platform == "youtube" and not _breaker.is_open("tikhub"):
        _report(28, "尝试 TikHub...")
        t0 = time.monotonic()
        segments = fetch_tikhub_transcript(url)
        if segments:
            _breaker.record_success("tikhub")
            logger.info("[transcript] TikHub OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
            _cache_platform_result(segments)
            return segments, "platform"
        logger.info("[transcript] TikHub miss in %.1fs", time.monotonic() - t0)

    # Step 2: TranscriptAPI (YouTube only, ~49ms median)
    if platform == "youtube" and not _breaker.is_open("transcriptapi"):
        _report(30, "尝试 TranscriptAPI...")
        t0 = time.monotonic()
        segments = fetch_transcriptapi_transcript(url)
        if segments:
            _breaker.record_success("transcriptapi")
            logger.info("[transcript] TranscriptAPI OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
            _cache_platform_result(segments)
            return segments, "platform"
        _breaker.record_failure("transcriptapi")
        logger.info("[transcript] TranscriptAPI miss in %.1fs", time.monotonic() - t0)

    # Step 3: youtube-transcript-api (YouTube only, local library, ~1-3s, free)
    if platform == "youtube":
        _report(33, "尝试 youtube-transcript-api...")
        t0 = time.monotonic()
        segments = fetch_youtube_transcript_api(url)
        if segments:
            logger.info("[transcript] youtube-transcript-api OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
            _cache_platform_result(segments)
            return segments, "platform"
        logger.info("[transcript] youtube-transcript-api miss in %.1fs", time.monotonic() - t0)

    # Step 4: Supadata API (YouTube only, ~5-8s, paid API fallback)
    if platform == "youtube" and not _breaker.is_open("supadata"):
        _report(36, "尝试 Supadata API...")
        t0 = time.monotonic()
        segments = fetch_supadata_transcript(url)
        if segments:
            _breaker.record_success("supadata")
            logger.info("[transcript] Supadata OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
            _cache_platform_result(segments)
            return segments, "platform"
        _breaker.record_failure("supadata")
        logger.info("[transcript] Supadata miss in %.1fs", time.monotonic() - t0)

    # Step 5: TranscriptHQ (YouTube + multi-platform)
    _report(39, "尝试 TranscriptHQ...")
    t0 = time.monotonic()
    segments = fetch_transcripthq_transcript(url, platform)
    if segments:
        logger.info("[transcript] TranscriptHQ OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
        _cache_platform_result(segments)
        return segments, "platform"
    logger.info("[transcript] TranscriptHQ miss in %.1fs", time.monotonic() - t0)

    # Step 6: yt-dlp platform subtitles (all platforms, ~10-20s, slowest platform method)
    _report(42, "尝试 yt-dlp 平台字幕...")
    t0 = time.monotonic()
    segments = fetch_platform_subtitles(url, platform)
    if segments:
        logger.info("[transcript] yt-dlp platform subs OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
        _cache_platform_result(segments)
        return segments, "platform"

    # 所有平台字幕方法均失败：ASR 已下线，直接返回结构化错误
    logger.info("[transcript] All platform subtitle methods failed; ASR is decommissioned")
    raise NoSubtitleError(
        "NO_SUBTITLE",
        "该视频没有字幕，无法进行识别解析。目前仅支持拥有 YouTube 字幕的视频。",
    )
