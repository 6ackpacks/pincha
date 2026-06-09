"""Subtitle transcript providers: third-party API clients and circuit breaker."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from urllib.parse import parse_qs, urlparse

import httpx

from app.config import settings
from app.services.subtitle_parsers import COOKIES_PATH, YOUTUBE_PROXY

logger = logging.getLogger(__name__)

SUPADATA_API_BASE = "https://api.supadata.ai/v1"
TRANSCRIPTAPI_BASE = "https://transcriptapi.com/api/v1"
TRANSCRIPTHQ_BASE = "https://api.transcripthq.io/v1"


# ---------------------------------------------------------------------------
# Circuit Breaker: 供应商连续失败 N 次后暂停一段时间，避免浪费超时等待
# ---------------------------------------------------------------------------
class _CircuitBreaker:
    def __init__(self, failure_threshold: int = 3, recovery_timeout: float = 60.0):
        self._failure_threshold = failure_threshold
        self._recovery_timeout = recovery_timeout
        self._failures: dict[str, int] = {}
        self._open_since: dict[str, float] = {}

    def is_open(self, provider: str) -> bool:
        if provider not in self._open_since:
            return False
        elapsed = time.monotonic() - self._open_since[provider]
        if elapsed >= self._recovery_timeout:
            del self._open_since[provider]
            self._failures[provider] = 0
            return False
        return True

    def record_success(self, provider: str):
        self._failures[provider] = 0
        self._open_since.pop(provider, None)

    def record_failure(self, provider: str):
        self._failures[provider] = self._failures.get(provider, 0) + 1
        if self._failures[provider] >= self._failure_threshold:
            self._open_since[provider] = time.monotonic()
            logger.warning("[circuit-breaker] %s tripped after %d failures, pausing %.0fs",
                          provider, self._failures[provider], self._recovery_timeout)


_breaker = _CircuitBreaker(failure_threshold=3, recovery_timeout=60.0)

# Rate limiter for Supadata: max 2 concurrent requests to avoid 429
_supadata_semaphore = threading.Semaphore(1)


def _extract_youtube_video_id(url: str) -> str | None:
    """Extract YouTube video ID from various URL formats."""
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    # youtu.be/VIDEO_ID
    if hostname in ("youtu.be", "www.youtu.be"):
        vid = parsed.path.lstrip("/").split("/")[0]
        return vid if vid else None

    # youtube.com/watch?v=VIDEO_ID
    if hostname in ("youtube.com", "www.youtube.com", "m.youtube.com"):
        if parsed.path == "/watch":
            qs = parse_qs(parsed.query)
            v = qs.get("v", [None])[0]
            return v
        # youtube.com/shorts/VIDEO_ID or youtube.com/embed/VIDEO_ID or youtube.com/v/VIDEO_ID
        for prefix in ("/shorts/", "/embed/", "/v/"):
            if parsed.path.startswith(prefix):
                vid = parsed.path[len(prefix):].split("/")[0].split("?")[0]
                return vid if vid else None

    return None


def fetch_supadata_transcript(url: str) -> list[dict] | None:
    """Fetch transcript via Supadata API (no cookies needed, cloud service).

    Returns list of segments [{start, end, text}] or None on failure.
    Costs 1 credit per request. Requires SUPADATA_API_KEY in settings.
    """
    from app.config import settings

    if not settings.SUPADATA_API_KEY:
        return None

    video_id = _extract_youtube_video_id(url)
    if not video_id:
        return None

    with _supadata_semaphore:
        try:
            # Try Chinese first, fall back to English, then any language
            for lang in ["zh", "en", None]:
                params: dict = {"videoId": video_id}
                if lang:
                    params["lang"] = lang

                resp = httpx.get(
                    f"{SUPADATA_API_BASE}/youtube/transcript",
                    headers={"x-api-key": settings.SUPADATA_API_KEY},
                    params=params,
                    timeout=30,
                )

                if resp.status_code in (404, 206):
                    continue
                if resp.status_code != 200:
                    logger.warning(
                        "Supadata API error %s for %s: %s",
                        resp.status_code, video_id, resp.text[:200],
                    )
                    return None

                data = resp.json()
                content = data.get("content", [])
                if not content:
                    continue

                segments = []
                for item in content:
                    text = str(item.get("text", "")).strip().replace("\n", " ")
                    offset_ms = item.get("offset", 0)
                    duration_ms = item.get("duration", 0)
                    if not text:
                        continue
                    start = offset_ms / 1000.0
                    end = (offset_ms + duration_ms) / 1000.0
                    segments.append({"start": round(start, 3), "end": round(end, 3), "text": text})

                if segments:
                    logger.info(
                        "Supadata fetched %d segments (lang=%s) for %s",
                        len(segments), lang or "auto", video_id,
                    )
                    time.sleep(1.5)
                    return segments

            logger.info("Supadata: no transcript content for %s", video_id)
            return None

        except (httpx.HTTPError, json.JSONDecodeError, KeyError, TimeoutError) as e:
            logger.warning("Supadata transcript fetch failed for %s: %s", url, e, exc_info=True)
            return None
        except Exception:
            logger.warning("Supadata transcript fetch failed for %s", url, exc_info=True)
            return None


def fetch_transcriptapi_transcript(url: str) -> list[dict] | None:
    """Fetch transcript via TranscriptAPI.com (YouTube, ~49ms median response)."""
    from app.config import settings

    if not settings.TRANSCRIPTAPI_API_KEY:
        return None

    video_id = _extract_youtube_video_id(url)
    if not video_id:
        return None

    if _breaker.is_open("transcriptapi"):
        logger.debug("[transcriptapi] circuit open, skipping")
        return None

    try:
        resp = httpx.get(
            f"{TRANSCRIPTAPI_BASE}/transcript",
            headers={"Authorization": f"Bearer {settings.TRANSCRIPTAPI_API_KEY}"},
            params={"video_id": video_id, "lang": "zh,en"},
            timeout=15,
        )

        if resp.status_code != 200:
            _breaker.record_failure("transcriptapi")
            logger.warning("TranscriptAPI error %s for %s", resp.status_code, video_id)
            return None

        data = resp.json()
        items = data.get("transcript") or data.get("segments") or []
        if not items:
            return None

        segments = []
        for item in items:
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            start = item.get("start", item.get("offset", 0))
            end = item.get("end", start + item.get("duration", 0))
            if isinstance(start, (int, float)) and start > 1000:
                start, end = start / 1000.0, end / 1000.0
            segments.append({"start": round(float(start), 3), "end": round(float(end), 3), "text": text})

        if segments:
            _breaker.record_success("transcriptapi")
            logger.info("[transcriptapi] OK: %d segments for %s", len(segments), video_id)
        return segments or None

    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TimeoutError) as e:
        _breaker.record_failure("transcriptapi")
        logger.warning("TranscriptAPI fetch failed for %s: %s", url, e, exc_info=True)
        return None
    except Exception:
        _breaker.record_failure("transcriptapi")
        logger.warning("TranscriptAPI fetch failed for %s", url, exc_info=True)
        return None


def fetch_transcripthq_transcript(url: str, platform: str) -> list[dict] | None:
    """Fetch transcript via TranscriptHQ.io (YouTube + multi-platform)."""
    from app.config import settings

    if not settings.TRANSCRIPTHQ_API_KEY:
        return None

    if _breaker.is_open("transcripthq"):
        logger.debug("[transcripthq] circuit open, skipping")
        return None

    try:
        resp = httpx.post(
            f"{TRANSCRIPTHQ_BASE}/transcript",
            headers={
                "Authorization": f"Bearer {settings.TRANSCRIPTHQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"url": url, "lang": "zh,en", "format": "json"},
            timeout=30,
        )

        if resp.status_code != 200:
            _breaker.record_failure("transcripthq")
            logger.warning("TranscriptHQ error %s for %s", resp.status_code, url)
            return None

        data = resp.json()
        items = data.get("transcript") or data.get("segments") or data.get("content") or []
        if not items:
            return None

        segments = []
        for item in items:
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            start = item.get("start", item.get("offset", 0))
            end = item.get("end", start + item.get("duration", 0))
            if isinstance(start, (int, float)) and start > 1000:
                start, end = start / 1000.0, end / 1000.0
            segments.append({"start": round(float(start), 3), "end": round(float(end), 3), "text": text})

        if segments:
            _breaker.record_success("transcripthq")
            logger.info("[transcripthq] OK: %d segments for %s", len(segments), url)
        return segments or None

    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TimeoutError) as e:
        _breaker.record_failure("transcripthq")
        logger.warning("TranscriptHQ fetch failed for %s: %s", url, e, exc_info=True)
        return None
    except Exception:
        _breaker.record_failure("transcripthq")
        logger.warning("TranscriptHQ fetch failed for %s", url, exc_info=True)
        return None


def fetch_youtube_transcript_api(url: str) -> list[dict] | None:
    """Fetch transcript using youtube-transcript-api (fastest method, ~1-3s).

    Returns list of segments [{start, end, text}] or None on failure.
    Compatible with youtube-transcript-api >= 1.0.0 (new instance-based API).
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        logger.warning("youtube-transcript-api not installed, skipping fast fetch")
        return None

    video_id = _extract_youtube_video_id(url)
    if not video_id:
        logger.warning("Could not extract YouTube video ID from %s", url)
        return None

    try:
        import os
        from youtube_transcript_api.proxies import GenericProxyConfig

        # Use dedicated YOUTUBE_PROXY (not global HTTP_PROXY which breaks LLM calls)
        proxy_url = YOUTUBE_PROXY
        api_kwargs = {}
        if proxy_url:
            api_kwargs["proxy_config"] = GenericProxyConfig(
                http_url=proxy_url,
                https_url=proxy_url,
            )

        if os.path.exists(COOKIES_PATH):
            logger.info("Using cookies file for youtube-transcript-api: %s", COOKIES_PATH)

        ytt_api = YouTubeTranscriptApi(**api_kwargs)

        # Try preferred languages first
        preferred_langs = ["zh", "zh-Hans", "zh-CN", "en", "en-US"]
        fetched = None
        try:
            fetched = ytt_api.fetch(video_id, languages=preferred_langs)
        except Exception as e:
            # Fall back to any available transcript
            logger.debug("Preferred languages not available for %s: %s, trying any language", video_id, type(e).__name__)
            try:
                transcript_list = ytt_api.list(video_id)
                # Pick the first available transcript
                for t in transcript_list:
                    fetched = ytt_api.fetch(video_id, languages=[t.language_code])
                    break
            except Exception as inner_e:
                logger.debug("youtube-transcript-api list/fetch fallback failed for %s: %s", video_id, inner_e)

        if fetched is None:
            logger.info("No transcripts available via youtube-transcript-api for %s", video_id)
            return None

        segments = []
        for entry in fetched:
            start = getattr(entry, "start", 0.0)
            duration = getattr(entry, "duration", 0.0)
            text = getattr(entry, "text", "")
            if isinstance(entry, dict):
                start = entry.get("start", 0.0)
                duration = entry.get("duration", 0.0)
                text = entry.get("text", "")
            text = str(text).strip().replace("\n", " ")
            if text:
                segments.append({
                    "start": round(start, 3),
                    "end": round(start + duration, 3),
                    "text": text,
                })

        if segments:
            logger.info(
                "youtube-transcript-api fetched %d segments for %s",
                len(segments), video_id,
            )
            return segments

        return None

    except (httpx.HTTPError, TimeoutError, OSError) as e:
        logger.warning("youtube-transcript-api failed for %s (video_id=%s): %s", url, video_id, e, exc_info=True)
        return None
    except Exception:
        logger.warning("youtube-transcript-api failed for %s", url, exc_info=True)
        return None
