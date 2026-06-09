"""Subtitle parsing utilities and yt-dlp subtitle download logic."""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
from pathlib import Path

import httpx
import yt_dlp

from app.config import settings

logger = logging.getLogger(__name__)

# Cookie file path for YouTube anti-bot bypass (optional)
COOKIES_PATH = os.environ.get("YOUTUBE_COOKIES_PATH", "/app/cookies/cookies.txt")
# Dedicated proxy for YouTube (not global HTTP_PROXY to avoid breaking LLM API calls)
YOUTUBE_PROXY = os.environ.get("YOUTUBE_PROXY") or os.environ.get("HTTP_PROXY") or os.environ.get("HTTPS_PROXY") or ""
# bgutil PO token provider (avoids need for cookies in most cases)
POT_PROVIDER_BASE = os.environ.get("POT_PROVIDER_HTTP_BASE", "")

# Language priority for subtitle selection
LANG_PRIORITY = ["zh", "zh-Hans", "zh-CN", "zh-hans", "zh-cn", "en", "en-US", "en-GB"]


def _build_ydl_base_opts() -> dict:
    """Build shared yt-dlp options: proxy, cookies, and PO token provider."""
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 3,
        "sleep_interval_requests": 1,
        "geo_bypass": True,
        "concurrent_fragment_downloads": 4,
    }

    if YOUTUBE_PROXY:
        opts["proxy"] = YOUTUBE_PROXY

    # cookies are optional — only add if the file exists
    if os.path.exists(COOKIES_PATH):
        opts["cookiefile"] = COOKIES_PATH
        logger.info("Using cookies file: %s", COOKIES_PATH)

    # bgutil PO token provider — allows bypassing bot-check without personal cookies
    # Plugin registers as yt-dlp extractor; just point it at the bgutil HTTP server
    if POT_PROVIDER_BASE:
        opts.setdefault("extractor_args", {})["youtubepot-bgutilhttp"] = {
            "base_url": [POT_PROVIDER_BASE]
        }
        logger.debug("PO token provider configured: %s", POT_PROVIDER_BASE)

    return opts


def _parse_srt_time(ts: str) -> float:
    """Parse SRT/VTT timestamp like '00:01:23,456' or '00:01:23.456' to seconds."""
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


def _parse_srt(content: str) -> list[dict]:
    """Parse SRT format into segments."""
    segments = []
    # Split by blank lines to get subtitle blocks
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 2:
            continue
        # Find the timestamp line (contains ' --> ')
        ts_line = None
        text_start = 0
        for i, line in enumerate(lines):
            if "-->" in line:
                ts_line = line
                text_start = i + 1
                break
        if ts_line is None:
            continue
        match = re.match(
            r"([\d:,.\s]+?)\s*-->\s*([\d:,.\s]+)", ts_line
        )
        if not match:
            continue
        start = _parse_srt_time(match.group(1))
        end = _parse_srt_time(match.group(2))
        text = " ".join(lines[text_start:]).strip()
        # Strip HTML tags (some SRT files have <i>, <b> etc.)
        text = re.sub(r"<[^>]+>", "", text)
        if text:
            segments.append({"start": start, "end": end, "text": text})
    return segments


def _parse_vtt(content: str) -> list[dict]:
    """Parse VTT format into segments."""
    # Remove WEBVTT header and metadata
    content = re.sub(r"^WEBVTT.*?\n\n", "", content, flags=re.DOTALL)
    # Remove NOTE blocks
    content = re.sub(r"NOTE\n.*?\n\n", "", content, flags=re.DOTALL)
    # VTT is structurally similar to SRT
    return _parse_srt(content)


def _parse_json3(content: str) -> list[dict]:
    """Parse YouTube JSON3 subtitle format."""
    data = json.loads(content) if isinstance(content, str) else content
    segments = []
    events = data.get("events", [])
    for event in events:
        start_ms = event.get("tStartMs", 0)
        duration_ms = event.get("dDurationMs", 0)
        segs = event.get("segs", [])
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs).strip()
        text = text.replace("\n", " ")
        if text:
            segments.append({
                "start": start_ms / 1000.0,
                "end": (start_ms + duration_ms) / 1000.0,
                "text": text,
            })
    return segments


def _pick_best_subtitle(subtitles: dict, auto_captions: dict) -> tuple[str, str, bool] | None:
    """Pick the best subtitle track by language priority.

    Returns (lang_code, subtitle_url_or_data, is_auto) or None.
    Prefers manual subtitles over auto-generated ones.
    """
    # Try manual subtitles first, then auto-generated
    for subs, is_auto in [(subtitles, False), (auto_captions, True)]:
        if not subs:
            continue
        for lang in LANG_PRIORITY:
            if lang in subs:
                return (lang, subs[lang], is_auto)
        # Also try prefix match (e.g., "zh-TW" matches "zh" priority)
        for lang in LANG_PRIORITY:
            for key in subs:
                if key.startswith(lang.split("-")[0]):
                    return (key, subs[key], is_auto)
    return None


def _parse_subtitle_entries(entries: list[dict], content: str | None = None) -> list[dict]:
    """Parse subtitle entries from yt-dlp format list into segments."""
    # yt-dlp returns a list of format dicts with 'ext' and 'url' or 'data'
    # Try to find json3 first, then vtt, then srt
    for preferred_ext in ["json3", "vtt", "srt"]:
        for entry in entries:
            if entry.get("ext") == preferred_ext:
                if "data" in entry:
                    raw = entry["data"]
                elif content:
                    raw = content
                else:
                    continue
                if preferred_ext == "json3":
                    return _parse_json3(raw)
                elif preferred_ext == "vtt":
                    return _parse_vtt(raw)
                else:
                    return _parse_srt(raw)
    return []


def fetch_platform_subtitles(url: str, platform: str) -> list[dict] | None:
    """Fetch subtitles from the platform using yt-dlp.

    Returns list of segments [{start, end, text}] or None if unavailable.
    """
    try:
        t0 = time.monotonic()
        # Single yt-dlp call: extract info and download subtitles in one pass
        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = _build_ydl_base_opts()
            ydl_opts.update({
                "skip_download": True,
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitleslangs": [l for l in LANG_PRIORITY],
                "subtitlesformat": "json3/vtt/srt",
                "outtmpl": os.path.join(tmpdir, "sub"),
                "extractor_args": {
                    **ydl_opts.get("extractor_args", {}),
                    "youtube": {
                        **ydl_opts.get("extractor_args", {}).get("youtube", {}),
                        "player_client": ["ios", "tv_embedded", "android"],
                        "player_skip": ["webpage"],
                    },
                },
            })

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            logger.info("[yt-dlp] extract_info took %.1fs for %s", time.monotonic() - t0, url)

            if not info:
                return None

            subtitles = info.get("subtitles") or {}
            auto_captions = info.get("automatic_captions") or {}

            pick = _pick_best_subtitle(subtitles, auto_captions)
            if pick is None:
                logger.info("No subtitles found for %s", url)
                return None

            lang, entries, is_auto = pick
            logger.info(
                "Found %s subtitles (lang=%s, auto=%s) for %s",
                "auto" if is_auto else "manual",
                lang,
                is_auto,
                url,
            )

            # Try parsing inline data from entries first (avoids second download)
            if isinstance(entries, list):
                segments = _parse_subtitle_entries(entries)
                if segments:
                    return segments

            # Fall back to downloading the subtitle file
            logger.info("[yt-dlp] Inline parse failed, downloading subtitle file for %s", url)
            t_dl = time.monotonic()
            sub_opts = _build_ydl_base_opts()
            sub_opts.update({
                "skip_download": True,
                "writesubtitles": not is_auto,
                "writeautomaticsub": is_auto,
                "subtitleslangs": [lang],
                "subtitlesformat": "json3/vtt/srt",
                "outtmpl": os.path.join(tmpdir, "sub"),
                "extractor_args": {
                    **sub_opts.get("extractor_args", {}),
                    "youtube": {
                        **sub_opts.get("extractor_args", {}).get("youtube", {}),
                        "player_client": ["web_embedded", "tv_embedded", "ios"],
                        "player_skip": ["webpage", "js"],
                    },
                },
            })
            with yt_dlp.YoutubeDL(sub_opts) as ydl:
                ydl.download([url])

            logger.info("[yt-dlp] Subtitle download took %.1fs", time.monotonic() - t_dl)

            # Find the downloaded subtitle file
            for f in Path(tmpdir).iterdir():
                if f.suffix in (".json3", ".vtt", ".srt"):
                    content = f.read_text(encoding="utf-8")
                    if f.suffix == ".json3":
                        return _parse_json3(content)
                    elif f.suffix == ".vtt":
                        return _parse_vtt(content)
                    else:
                        return _parse_srt(content)

        return None

    except (yt_dlp.utils.DownloadError, yt_dlp.utils.ExtractorError) as e:
        logger.error("yt-dlp download/extractor error for %s (platform=%s): %s", url, platform, e)
        return None
    except (httpx.HTTPError, TimeoutError, OSError) as e:
        logger.error("Network error fetching platform subtitles for %s (platform=%s): %s", url, platform, e)
        return None
    except Exception:
        logger.exception("Failed to fetch platform subtitles for %s (platform=%s)", url, platform)
        return None
