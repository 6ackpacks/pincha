"""Celery task for subtitle/transcript processing."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.tasks.celery_app import celery_app
from app.tasks.shared import (
    get_sync_engine,
    set_heartbeat,
    update_video_status_sync,
)

logger = logging.getLogger(__name__)


def _process_subtitles_core(video_id: str) -> dict:
    """Core subtitle processing logic: platform subtitles first, ASR fallback.

    This function contains the actual processing logic and can be called directly
    (e.g. from video_tasks pipeline) without going through Celery dispatch.
    """
    from app.services.subtitle_service import get_transcript_segments

    logger.info("[subtitle:%s] Starting subtitle processing", video_id)
    t_start = time.monotonic()

    with Session(get_sync_engine()) as session:
        # Fetch video
        row = session.execute(
            text("SELECT id, url, platform FROM videos WHERE id = :id"),
            {"id": video_id},
        ).fetchone()

        if row is None:
            logger.error("Video %s not found", video_id)
            raise RuntimeError("video not found")

        video_url = row[1]
        platform = row[2]

        # Update status: transcribing
        update_video_status_sync(video_id, {"state": "transcribing", "progress": 30, "message": "正在尝试获取字幕..."})
        set_heartbeat(video_id, "transcribing", 30, "正在尝试获取字幕...")

        def _progress_cb(pct, msg):
            set_heartbeat(video_id, "transcribing", pct, msg)
            update_video_status_sync(video_id, {"state": "transcribing", "progress": pct, "message": msg})
            logger.debug("[subtitle:%s] Progress: %d%% - %s", video_id, pct, msg)

        t_fetch = time.monotonic()
        try:
            segments, source = get_transcript_segments(video_url, platform, on_progress=_progress_cb)
        except Exception as exc:
            reason = str(exc)
            error_code = getattr(exc, "code", "SUBTITLE_FAILED")
            logger.error("[subtitle:%s] Subtitle fetch failed after %.1fs: %s", video_id, time.monotonic() - t_fetch, reason)
            update_video_status_sync(video_id, {"state": "failed", "progress": 0, "message": reason, "error_code": error_code})
            set_heartbeat(video_id, "failed", 0, reason, error_code=error_code)
            raise RuntimeError(reason)

        if not segments:
            logger.error("[subtitle:%s] Empty segments returned after %.1fs", video_id, time.monotonic() - t_fetch)
            update_video_status_sync(video_id, {"state": "failed", "progress": 0, "message": "字幕提取失败: 未获取到任何字幕内容"})
            raise RuntimeError("empty segments")

        logger.info("[subtitle:%s] Got %d segments via %s in %.1fs", video_id, len(segments), source, time.monotonic() - t_fetch)

        set_heartbeat(video_id, "transcribing", 50, "解析字幕文本...")
        update_video_status_sync(video_id, {"state": "transcribing", "progress": 50, "message": "解析字幕文本..."})

        # Build full_text
        full_text = " ".join(seg["text"] for seg in segments)

        # Detect language (simple heuristic)
        has_chinese = any("\u4e00" <= ch <= "\u9fff" for ch in full_text[:200])
        language = "zh" if has_chinese else "en"

        # Store transcript
        set_heartbeat(video_id, "transcribing", 55, "保存字幕数据...")
        update_video_status_sync(video_id, {"state": "transcribing", "progress": 55, "message": "保存字幕数据..."})
        transcript_id = str(uuid.uuid4())
        session.execute(
            text(
                """
                INSERT INTO transcripts (id, video_id, language, source, segments, full_text, created_at)
                VALUES (:id, :video_id, :language, :source, :segments, :full_text, NOW())
                ON CONFLICT (video_id) DO UPDATE SET
                    language = EXCLUDED.language,
                    source = EXCLUDED.source,
                    segments = EXCLUDED.segments,
                    full_text = EXCLUDED.full_text,
                    created_at = NOW()
                """
            ),
            {
                "id": transcript_id,
                "video_id": video_id,
                "language": language,
                "source": source,
                "segments": json.dumps(segments),
                "full_text": full_text,
            },
        )
        session.commit()

        # Backfill title / thumbnail_url / duration if still missing
        t_meta = time.monotonic()
        _backfill_video_meta(session, video_id, video_url)
        logger.info("[subtitle:%s] Meta backfill took %.1fs", video_id, time.monotonic() - t_meta)

        # Update status: ready for next step
        total_elapsed = time.monotonic() - t_start
        update_video_status_sync(video_id, {"state": "transcribing", "progress": 60, "message": "字幕提取完成"})
        set_heartbeat(video_id, "transcribing", 60, "字幕提取完成")

        logger.info(
            "[subtitle:%s] Complete in %.1fs: source=%s, segments=%d, lang=%s",
            video_id, total_elapsed, source, len(segments), language,
        )
        return {
            "transcript_id": transcript_id,
            "source": source,
            "segments_count": len(segments),
            "language": language,
        }


@celery_app.task(
    name="app.tasks.subtitle_tasks.process_subtitles",
    max_retries=2,
    default_retry_delay=30,
    ignore_result=True,
)
def process_subtitles(video_id: str) -> dict:
    """Celery task entry point for subtitle processing."""
    return _process_subtitles_core(video_id)


def _backfill_video_meta(session: Session, video_id: str, video_url: str) -> None:
    """Fetch title/thumbnail/duration via multiple methods (oEmbed → page scrape → yt-dlp)."""
    import re
    import httpx

    row = session.execute(
        text("SELECT title, thumbnail_url FROM videos WHERE id = :id"),
        {"id": video_id},
    ).fetchone()
    if row is None:
        return
    if row[0] and row[1]:
        return

    # YouTube video ID and thumbnail from URL pattern
    thumb = None
    video_id_yt = None
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", video_url)
    if m:
        video_id_yt = m.group(1)
        thumb = f"https://img.youtube.com/vi/{video_id_yt}/maxresdefault.jpg"

    title = None
    duration_str = None

    # Method 1: YouTube oEmbed (fast, free, no auth)
    if not title and video_id_yt:
        try:
            resp = httpx.get(
                f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id_yt}&format=json",
                timeout=8, follow_redirects=True,
            )
            if resp.status_code == 200:
                data = resp.json()
                title = data.get("title")
                if title:
                    logger.info("Meta via oEmbed for %s: %s", video_id, title[:60])
        except Exception as exc:
            logger.debug("oEmbed failed for %s: %s", video_id, exc)

    # Method 2: noembed.com fallback (third-party oEmbed proxy)
    if not title and video_id_yt:
        try:
            resp = httpx.get(
                f"https://noembed.com/embed?url=https://www.youtube.com/watch?v={video_id_yt}",
                timeout=8, follow_redirects=True,
            )
            if resp.status_code == 200:
                data = resp.json()
                title = data.get("title")
                if title:
                    logger.info("Meta via noembed for %s: %s", video_id, title[:60])
        except Exception as exc:
            logger.debug("noembed failed for %s: %s", video_id, exc)

    # Method 3: Scrape YouTube page <title> and duration
    if not title and video_id_yt:
        try:
            resp = httpx.get(
                f"https://www.youtube.com/watch?v={video_id_yt}",
                timeout=10, follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; bot)", "Accept-Language": "en"},
            )
            if resp.status_code == 200:
                m_title = re.search(r"<title>(.+?)(?:\s*-\s*YouTube)?</title>", resp.text)
                if m_title:
                    t = m_title.group(1).strip()
                    if t and t != "YouTube":
                        title = t
                        logger.info("Meta via page scrape for %s: %s", video_id, title[:60])
                m_dur = re.search(r'"lengthSeconds":"(\d+)"', resp.text)
                if m_dur:
                    secs = int(m_dur.group(1))
                    h, r = divmod(secs, 3600)
                    mm, ss = divmod(r, 60)
                    duration_str = f"{h:02d}:{mm:02d}:{ss:02d}"
        except Exception as exc:
            logger.debug("Page scrape failed for %s: %s", video_id, exc)

    # Method 4: yt-dlp fallback (slowest, may be blocked)
    if not title:
        try:
            import yt_dlp
            proxy = os.environ.get("YOUTUBE_PROXY") or os.environ.get("HTTP_PROXY") or ""
            ydl_opts: dict = {"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 15}
            if proxy:
                ydl_opts["proxy"] = proxy
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=False)
            if info:
                title = info.get("title")
                if not thumb:
                    thumb = info.get("thumbnail")
                secs = info.get("duration")
                if secs and not duration_str:
                    h, r = divmod(int(secs), 3600)
                    mm, ss = divmod(r, 60)
                    duration_str = f"{h:02d}:{mm:02d}:{ss:02d}"
        except Exception as exc:
            logger.warning("Meta backfill yt-dlp failed for %s: %s", video_id, exc)

    column_values: dict = {}
    if title and not row[0]:
        column_values["title"] = title
    if thumb and not row[1]:
        column_values["thumbnail_url"] = thumb
    if duration_str:
        column_values["duration"] = duration_str

    if not column_values:
        return

    set_clause = ", ".join(f"{col} = :{col}" for col in column_values)
    column_values["id"] = video_id

    session.execute(
        text(f"UPDATE videos SET {set_clause} WHERE id = :id"),
        column_values,
    )
    session.commit()
    logger.info("Meta backfill complete for %s: cols=%s", video_id, list(column_values.keys()))
