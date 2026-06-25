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
TRANSCRIPTAPI_BASE = "https://transcriptapi.com/api/v2"
TRANSCRIPTHQ_BASE = "https://api.transcripthq.io/v1"
TIKHUB_API_BASE = "https://api.tikhub.io"


# ---------------------------------------------------------------------------
# Circuit Breaker: 供应商连续失败 N 次后暂停一段时间，避免浪费超时等待
# ---------------------------------------------------------------------------
class _CircuitBreaker:
    """Per-provider circuit breaker with configurable thresholds.

    Supports per-provider overrides via provider_configs dict:
        {"supadata": {"failure_threshold": 5, "recovery_timeout": 30.0}}
    Providers not in the dict use the default values.
    """

    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout: float = 60.0,
        provider_configs: dict[str, dict] | None = None,
    ):
        self._default_failure_threshold = failure_threshold
        self._default_recovery_timeout = recovery_timeout
        self._provider_configs = provider_configs or {}
        self._failures: dict[str, int] = {}
        self._open_since: dict[str, float] = {}
        self._total_successes: dict[str, int] = {}
        self._total_failures: dict[str, int] = {}

    def _get_threshold(self, provider: str) -> int:
        cfg = self._provider_configs.get(provider, {})
        return cfg.get("failure_threshold", self._default_failure_threshold)

    def _get_timeout(self, provider: str) -> float:
        cfg = self._provider_configs.get(provider, {})
        return cfg.get("recovery_timeout", self._default_recovery_timeout)

    def is_open(self, provider: str) -> bool:
        if provider not in self._open_since:
            return False
        recovery_timeout = self._get_timeout(provider)
        elapsed = time.monotonic() - self._open_since[provider]
        if elapsed >= recovery_timeout:
            # Half-open -> closed: recovery attempt
            del self._open_since[provider]
            self._failures[provider] = 0
            logger.info(
                "[circuit-breaker] %s recovered (half-open -> closed) after %.0fs",
                provider, elapsed,
            )
            return False
        return True

    def record_success(self, provider: str):
        self._failures[provider] = 0
        self._open_since.pop(provider, None)
        self._total_successes[provider] = self._total_successes.get(provider, 0) + 1
        total_ok = self._total_successes[provider]
        total_fail = self._total_failures.get(provider, 0)
        total = total_ok + total_fail
        if total > 0 and total % 50 == 0:
            logger.info(
                "[circuit-breaker] %s stats: %d/%d success (%.1f%%)",
                provider, total_ok, total, total_ok / total * 100,
            )

    def record_failure(self, provider: str):
        self._failures[provider] = self._failures.get(provider, 0) + 1
        self._total_failures[provider] = self._total_failures.get(provider, 0) + 1
        threshold = self._get_threshold(provider)
        recovery_timeout = self._get_timeout(provider)
        if self._failures[provider] >= threshold:
            self._open_since[provider] = time.monotonic()
            total_ok = self._total_successes.get(provider, 0)
            total_fail = self._total_failures[provider]
            logger.warning(
                "[circuit-breaker] %s OPEN after %d consecutive failures, "
                "pausing %.0fs (lifetime: %d ok / %d fail)",
                provider, self._failures[provider], recovery_timeout,
                total_ok, total_fail,
            )


# Per-provider circuit breaker configuration:
# - supadata: stable service, tolerate more failures before tripping, recover faster
# - transcriptapi: less proven, keep conservative defaults
# - transcripthq: keep conservative defaults
_breaker = _CircuitBreaker(
    failure_threshold=3,
    recovery_timeout=60.0,
    provider_configs={
        "tikhub": {"failure_threshold": 3, "recovery_timeout": 60.0},
        "supadata": {"failure_threshold": 5, "recovery_timeout": 30.0},
        "transcriptapi": {"failure_threshold": 3, "recovery_timeout": 60.0},
        "transcripthq": {"failure_threshold": 3, "recovery_timeout": 60.0},
    },
)

# Rate limiter for Supadata: allow 2 concurrent requests.
# Supadata API rate limit is 3 req/s on paid plans; semaphore=2 balances
# throughput vs. avoiding 429 errors, with the 1.5s sleep already in place.
_supadata_semaphore = threading.Semaphore(2)


def _extract_youtube_video_id(url: str) -> str | None:
    """Extract YouTube video ID from various URL formats.

    Supported formats:
    - https://www.youtube.com/watch?v=VIDEO_ID
    - https://m.youtube.com/watch?v=VIDEO_ID
    - https://music.youtube.com/watch?v=VIDEO_ID
    - https://gaming.youtube.com/watch?v=VIDEO_ID
    - https://youtu.be/VIDEO_ID
    - https://youtube.com/shorts/VIDEO_ID
    - https://youtube.com/embed/VIDEO_ID
    - https://youtube.com/v/VIDEO_ID
    - https://youtube.com/live/VIDEO_ID
    """
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    # youtu.be/VIDEO_ID
    if hostname in ("youtu.be", "www.youtu.be"):
        vid = parsed.path.lstrip("/").split("/")[0]
        return vid if vid else None

    # All youtube.com subdomains: www, m, music, gaming, etc.
    if hostname == "youtube.com" or hostname.endswith(".youtube.com"):
        if parsed.path == "/watch":
            qs = parse_qs(parsed.query)
            v = qs.get("v", [None])[0]
            return v
        # /shorts/VIDEO_ID, /embed/VIDEO_ID, /v/VIDEO_ID, /live/VIDEO_ID
        for prefix in ("/shorts/", "/embed/", "/v/", "/live/"):
            if parsed.path.startswith(prefix):
                vid = parsed.path[len(prefix):].split("/")[0].split("?")[0]
                return vid if vid else None

    return None


def fetch_tikhub_transcript(url: str) -> list[dict] | None:
    """Fetch transcript via TikHub — three strategies with automatic fallback.

    Strategy 1 (web_v2 captions_v2, preferred — best coverage, $0.001/req, SRT):
        GET /web_v2/get_video_captions_v2?video_id=xxx → list tracks
        GET /web_v2/get_video_captions_v2?video_id=xxx&language_code=...&format=srt

    Strategy 2 (web_v2 captions, json3 — fast but limited coverage):
        GET /web_v2/get_video_captions?video_id=xxx → list tracks
        GET /web_v2/get_video_captions?video_id=xxx&language_code=...&format=json3

    Strategy 3 (web legacy — broadest fallback, returns SRT):
        GET /web/get_video_info?video_id=xxx → subtitles.items[{url, code}]
        GET /web/get_video_subtitles?subtitle_url=... → SRT text

    TikHub proxies server-side — no direct YouTube access needed from our server.
    """
    from app.config import settings

    if not settings.TIKHUB_API_KEY:
        return None

    video_id = _extract_youtube_video_id(url)
    if not video_id:
        return None

    if _breaker.is_open("tikhub"):
        logger.debug("[tikhub] circuit open, skipping")
        return None

    headers = {"Authorization": f"Bearer {settings.TIKHUB_API_KEY}"}
    base = settings.TIKHUB_API_BASE or TIKHUB_API_BASE

    try:
        # Strategy 1: web_v2/get_video_captions_v2 (best coverage, $0.001/req, SRT)
        segments = _tikhub_web_v2_captions_v2(base, headers, video_id)
        if segments:
            return segments

        # Strategy 2: web_v2/get_video_captions (json3, fast but limited coverage)
        segments = _tikhub_web_v2_captions(base, headers, video_id)
        if segments:
            return segments

        # Strategy 3: web/get_video_info + web/get_video_subtitles (legacy fallback)
        segments = _tikhub_web_legacy_subtitles(base, headers, video_id)
        if segments:
            return segments

        logger.info("[tikhub] all strategies returned nothing for %s", video_id)
        return None

    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TimeoutError) as e:
        _breaker.record_failure("tikhub")
        logger.warning("[tikhub] fetch failed for %s: %s", url, e, exc_info=True)
        return None
    except Exception:
        _breaker.record_failure("tikhub")
        logger.warning("[tikhub] fetch failed for %s", url, exc_info=True)
        return None


def _tikhub_web_v2_captions(base: str, headers: dict, video_id: str) -> list[dict] | None:
    """Strategy A: web_v2/get_video_captions with json3 format."""
    endpoint = f"{base}/api/v1/youtube/web_v2/get_video_captions"

    resp = httpx.get(endpoint, headers=headers, params={"video_id": video_id}, timeout=15)
    if resp.status_code != 200:
        return None

    list_data = resp.json()
    if list_data.get("code") != 200:
        return None

    data_payload = list_data.get("data", {})
    captions = data_payload.get("captions", []) if isinstance(data_payload, dict) else []
    if not captions:
        return None

    chosen_lang = _pick_best_caption_language(captions)
    if not chosen_lang:
        return None

    resp = httpx.get(
        endpoint,
        headers=headers,
        params={"video_id": video_id, "language_code": chosen_lang, "format": "json3"},
        timeout=15,
    )
    if resp.status_code != 200:
        return None

    caption_data = resp.json()
    if caption_data.get("code") != 200:
        return None

    content = caption_data.get("data", {}).get("content", {})
    if not isinstance(content, dict):
        return None

    events = content.get("events", [])
    if not events:
        return None

    segments = _parse_json3_events(events)
    if segments:
        logger.info("[tikhub/v2] OK: %d segments for %s (lang=%s)", len(segments), video_id, chosen_lang)
    return segments


def _tikhub_web_v2_captions_v2(base: str, headers: dict, video_id: str) -> list[dict] | None:
    """Strategy B: web_v2/get_video_captions_v2 — better coverage, returns SRT.

    Same two-step flow as v1 but uses an alternative implementation that covers
    more videos (per TikHub docs). Returns SRT format which we parse.
    """
    endpoint = f"{base}/api/v1/youtube/web_v2/get_video_captions_v2"

    # Step 1: list available caption tracks (no language_code)
    resp = httpx.get(endpoint, headers=headers, params={"video_id": video_id}, timeout=15)
    if resp.status_code != 200:
        return None

    list_data = resp.json()
    if list_data.get("code") != 200:
        return None

    data_payload = list_data.get("data", {})
    captions = data_payload.get("captions", []) if isinstance(data_payload, dict) else []
    if not captions:
        return None

    # Pick best language: zh > en (non-ASR) > first non-ASR > first
    chosen_lang = _pick_best_caption_language(captions)
    if not chosen_lang:
        return None

    # Step 2: fetch caption content in SRT format
    resp = httpx.get(
        endpoint,
        headers=headers,
        params={"video_id": video_id, "language_code": chosen_lang, "format": "srt"},
        timeout=15,
    )
    if resp.status_code != 200:
        return None

    caption_data = resp.json()
    if caption_data.get("code") != 200:
        return None

    content = caption_data.get("data", {}).get("content", "")
    if not content or not isinstance(content, str):
        return None

    segments = _parse_srt(content)
    if segments:
        logger.info("[tikhub/v2-alt] OK: %d segments for %s (lang=%s)", len(segments), video_id, chosen_lang)
    return segments


def _tikhub_web_legacy_subtitles(base: str, headers: dict, video_id: str) -> list[dict] | None:
    """Strategy C: web/get_video_info → subtitle URLs → web/get_video_subtitles (SRT)."""
    info_resp = httpx.get(
        f"{base}/api/v1/youtube/web/get_video_info",
        headers=headers,
        params={"video_id": video_id},
        timeout=15,
    )
    if info_resp.status_code != 200:
        return None

    info_data = info_resp.json()
    if info_data.get("code") != 200:
        return None

    data = info_data.get("data", {})
    subtitle_items = data.get("subtitles", {}).get("items", [])
    if not subtitle_items:
        return None

    # Pick best track: zh > en (non-ASR, has name=) > en > first
    chosen_url = _pick_best_legacy_subtitle_url(subtitle_items)
    if not chosen_url:
        return None

    srt_resp = httpx.get(
        f"{base}/api/v1/youtube/web/get_video_subtitles",
        headers=headers,
        params={"subtitle_url": chosen_url},
        timeout=15,
    )
    if srt_resp.status_code != 200:
        return None

    srt_data = srt_resp.json()
    if srt_data.get("code") != 200:
        return None

    srt_text = srt_data.get("data", "")
    if not srt_text or not isinstance(srt_text, str):
        return None

    segments = _parse_srt(srt_text)
    if segments:
        logger.info("[tikhub/legacy] OK: %d segments for %s", len(segments), video_id)
    return segments


def _pick_best_legacy_subtitle_url(items: list[dict]) -> str | None:
    """Pick best subtitle URL from web/get_video_info items. Prefer zh > en (non-ASR) > en > first."""
    # Prefer Chinese
    for item in items:
        if item.get("code", "").startswith("zh"):
            return item.get("url")
    # Prefer English non-ASR (has "name=" in URL, no "kind=asr")
    for item in items:
        if item.get("code", "").startswith("en") and "kind=asr" not in item.get("url", ""):
            return item.get("url")
    # Any English
    for item in items:
        if item.get("code", "").startswith("en"):
            return item.get("url")
    # First available
    return items[0].get("url") if items else None


def _parse_srt(srt_text: str) -> list[dict] | None:
    """Parse SRT formatted subtitle text into [{start, end, text}] segments."""
    segments = []
    blocks = re.split(r"\n\s*\n", srt_text.strip())
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 2:
            continue
        # Find the timestamp line (format: HH:MM:SS.mmm --> HH:MM:SS.mmm)
        ts_line = None
        text_start_idx = 0
        for i, line in enumerate(lines):
            if "-->" in line:
                ts_line = line
                text_start_idx = i + 1
                break
        if not ts_line:
            continue
        match = re.match(
            r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})",
            ts_line.strip(),
        )
        if not match:
            continue
        g = [int(x) for x in match.groups()]
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000.0
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000.0
        text = " ".join(lines[text_start_idx:]).strip()
        if text:
            segments.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    return segments or None


def _pick_best_caption_language(captions: list[dict]) -> str | None:
    """Pick best caption track: zh > en (non-ASR) > first non-ASR > first."""
    for c in captions:
        lang = c.get("language_code", "")
        if lang.startswith("zh"):
            return lang
    for c in captions:
        lang = c.get("language_code", "")
        if lang.startswith("en") and c.get("kind") != "asr":
            return lang
    for c in captions:
        if c.get("kind") != "asr":
            return c.get("language_code", "")
    return captions[0].get("language_code") if captions else None


def _parse_json3_events(events: list[dict]) -> list[dict] | None:
    """Parse YouTube json3 format events into [{start, end, text}] segments."""
    segments = []
    for ev in events:
        segs_list = ev.get("segs", [])
        text_parts = []
        for s in segs_list:
            t = s.get("utf8", "").strip()
            if t and t != "\n":
                text_parts.append(t)
        text = " ".join(text_parts).strip()
        if not text:
            continue
        start_ms = ev.get("tStartMs", 0)
        dur_ms = ev.get("dDurationMs", 0)
        segments.append({
            "start": round(start_ms / 1000.0, 3),
            "end": round((start_ms + dur_ms) / 1000.0, 3),
            "text": text,
        })
    return segments or None


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

    if _breaker.is_open("supadata"):
        logger.debug("[supadata] circuit open, skipping")
        return None

    with _supadata_semaphore:
        try:
            # Single request with auto language detection.
            # Previously tried zh -> en -> None serially, which tripled latency
            # for non-Chinese videos (~5-6s per request). Auto-detect lets
            # Supadata return whatever transcript is available in one shot.
            params: dict = {"videoId": video_id}

            resp = httpx.get(
                f"{SUPADATA_API_BASE}/youtube/transcript",
                headers={"x-api-key": settings.SUPADATA_API_KEY},
                params=params,
                timeout=15,
            )

            if resp.status_code in (404, 206):
                logger.info("Supadata: no transcript (status %s) for %s", resp.status_code, video_id)
                return None
            if resp.status_code != 200:
                _breaker.record_failure("supadata")
                logger.warning(
                    "Supadata API error %s for %s: %s",
                    resp.status_code, video_id, resp.text[:200],
                )
                return None

            data = resp.json()
            content = data.get("content", [])
            if not content:
                logger.info("Supadata: empty content for %s", video_id)
                return None

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
                _breaker.record_success("supadata")
                logger.info(
                    "Supadata fetched %d segments (auto lang) for %s",
                    len(segments), video_id,
                )
                time.sleep(1.5)
                return segments

            logger.info("Supadata: no transcript content for %s", video_id)
            return None

        except (httpx.HTTPError, json.JSONDecodeError, KeyError, TimeoutError) as e:
            _breaker.record_failure("supadata")
            logger.warning("Supadata transcript fetch failed for %s: %s", url, e, exc_info=True)
            return None
        except Exception:
            _breaker.record_failure("supadata")
            logger.warning("Supadata transcript fetch failed for %s", url, exc_info=True)
            return None


def fetch_transcriptapi_transcript(url: str) -> list[dict] | None:
    """Fetch transcript via TranscriptAPI.com v2 (YouTube, ~49ms median response).

    API docs: https://transcriptapi.com/api/v2/youtube/transcript
    Params: video_url (video ID or full URL), format=json
    Returns: {"video_id": "...", "language": "...", "transcript": [{text, start, duration}]}
    """
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
            f"{TRANSCRIPTAPI_BASE}/youtube/transcript",
            headers={"Authorization": f"Bearer {settings.TRANSCRIPTAPI_API_KEY}"},
            params={"video_url": video_id, "format": "json"},
            timeout=15,
        )

        if resp.status_code != 200:
            _breaker.record_failure("transcriptapi")
            logger.warning("TranscriptAPI error %s for %s", resp.status_code, video_id)
            return None

        data = resp.json()
        items = data.get("transcript") or []
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
