"""Audio download and ASR transcription functions.

Extracted from subtitle_service.py for modularity.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path

import httpx
import yt_dlp

from app.config import settings
from app.services.subtitle_parsers import _build_ydl_base_opts
from app.services.subtitle_providers import _extract_youtube_video_id

logger = logging.getLogger(__name__)


def _download_audio_via_rapidapi(video_id: str, output_dir: str) -> str | None:
    """Download YouTube audio via RapidAPI as fallback when yt-dlp is blocked.

    Returns path to downloaded MP3 file, or None on failure.
    Uses cobalt.tools API first (free, reliable), falls back to RapidAPI.
    """
    # Method 1: cobalt.tools (free, open-source, reliable)
    try:
        resp = httpx.post(
            "https://api.cobalt.tools/",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "audioFormat": "mp3",
                "isAudioOnly": True,
            },
            timeout=30,
        )

        if resp.status_code == 200:
            data = resp.json()
            download_url = data.get("url")
            if download_url:
                mp3_path = os.path.join(output_dir, "audio_api.mp3")
                with httpx.stream("GET", download_url, timeout=120, follow_redirects=True) as stream:
                    if stream.status_code == 200:
                        with open(mp3_path, "wb") as f:
                            for chunk in stream.iter_bytes(chunk_size=65536):
                                f.write(chunk)
                        if os.path.getsize(mp3_path) > 1024:
                            logger.info("[cobalt] Downloaded audio for %s (%.1f MB)",
                                        video_id, os.path.getsize(mp3_path) / 1024 / 1024)
                            return mp3_path
    except Exception as e:
        logger.debug("[cobalt] Failed for %s: %s", video_id, e)

    # Method 2: RapidAPI youtube-mp36
    if not settings.RAPIDAPI_KEY:
        return None

    try:
        resp = httpx.get(
            "https://youtube-mp36.p.rapidapi.com/dl",
            params={"id": video_id},
            headers={
                "X-RapidAPI-Key": settings.RAPIDAPI_KEY,
                "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
            },
            timeout=30,
        )

        if resp.status_code != 200:
            logger.warning("[rapidapi-dl] HTTP %s for %s", resp.status_code, video_id)
            return None

        data = resp.json()
        download_url = data.get("link")
        if not download_url:
            logger.warning("[rapidapi-dl] No download link in response for %s", video_id)
            return None

        mp3_path = os.path.join(output_dir, "audio_api.mp3")
        with httpx.stream("GET", download_url, timeout=120, follow_redirects=True) as stream:
            if stream.status_code != 200:
                logger.warning("[rapidapi-dl] Download link returned %s for %s", stream.status_code, video_id)
                return None
            with open(mp3_path, "wb") as f:
                for chunk in stream.iter_bytes(chunk_size=65536):
                    f.write(chunk)

        if os.path.getsize(mp3_path) < 1024:
            logger.warning("[rapidapi-dl] Downloaded file too small for %s", video_id)
            return None

        logger.info("[rapidapi-dl] Downloaded audio for %s (%.1f MB)",
                    video_id, os.path.getsize(mp3_path) / 1024 / 1024)
        return mp3_path

    except Exception as e:
        logger.warning("[rapidapi-dl] Failed for %s: %s", video_id, e)
        return None


def download_audio(url: str, output_dir: str) -> str:
    """Download audio from URL using yt-dlp, with RapidAPI fallback.

    Returns path to the WAV file.
    """
    output_template = os.path.join(output_dir, "audio.%(ext)s")

    ydl_opts = _build_ydl_base_opts()
    ydl_opts.update({
        "format": "worstaudio/worst",
        "outtmpl": output_template,
        "extractor_args": {
            **ydl_opts.get("extractor_args", {}),
            "youtube": {
                **ydl_opts.get("extractor_args", {}).get("youtube", {}),
                "player_client": ["android_vr", "web_embedded", "ios"],
                "player_skip": ["webpage", "js"],
            },
        },
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
        }],
    })

    # Try yt-dlp first
    ydl_success = False
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        ydl_success = True
    except Exception as e:
        logger.warning("[download_audio] yt-dlp failed: %s", e)

        # Fallback: RapidAPI audio download
        video_id = _extract_youtube_video_id(url)
        if video_id:
            logger.info("[download_audio] Trying RapidAPI fallback for %s", video_id)
            mp3_path = _download_audio_via_rapidapi(video_id, output_dir)
            if mp3_path:
                # Convert MP3 to 16kHz WAV
                final_path = os.path.join(output_dir, "audio_16k.wav")
                subprocess.run(
                    ["ffmpeg", "-y", "-i", mp3_path, "-ar", "16000", "-ac", "1", "-f", "wav", final_path],
                    check=True, capture_output=True,
                )
                return final_path

        raise RuntimeError(str(e)) from e

    if not ydl_success:
        raise RuntimeError("Audio download failed via all methods")

    # Find the downloaded file
    wav_path = os.path.join(output_dir, "audio.wav")
    if not os.path.exists(wav_path):
        for f in Path(output_dir).iterdir():
            if f.suffix in (".wav", ".webm", ".m4a", ".mp3", ".ogg"):
                wav_path = str(f)
                break

    # Convert to 16kHz mono WAV using ffmpeg
    final_path = os.path.join(output_dir, "audio_16k.wav")
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-protocol_whitelist", "file,crypto,data",
            "-i", wav_path,
            "-ar", "16000",
            "-ac", "1",
            "-f", "wav",
            final_path,
        ],
        check=True,
        capture_output=True,
    )

    return final_path


def transcribe_with_volc_asr(audio_path: str) -> list[dict]:
    """Transcribe audio using Volcengine (火山引擎) ASR - 录音文件识别大模型极速版.

    Returns list of segments [{start, end, text}].
    Raises exception on failure.
    """
    import base64
    import uuid as _uuid

    if not settings.VOLC_ASR_APP_ID or not settings.VOLC_ASR_ACCESS_TOKEN:
        raise RuntimeError("火山引擎 ASR 未配置：VOLC_ASR_APP_ID 或 VOLC_ASR_ACCESS_TOKEN 为空。")

    file_size = os.path.getsize(audio_path)
    if file_size > 100 * 1024 * 1024:
        raise RuntimeError(f"音频文件过大 ({file_size / 1024 / 1024:.0f}MB)，火山引擎限制 100MB")

    with open(audio_path, "rb") as f:
        audio_data = base64.b64encode(f.read()).decode()

    headers = {
        "X-Api-App-Key": settings.VOLC_ASR_APP_ID,
        "X-Api-Access-Key": settings.VOLC_ASR_ACCESS_TOKEN,
        "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
        "X-Api-Request-Id": str(_uuid.uuid4()),
        "X-Api-Sequence": "-1",
        "Content-Type": "application/json",
    }

    payload = {
        "user": {"uid": settings.VOLC_ASR_APP_ID},
        "audio": {"data": audio_data, "format": "mp3"},
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }

    resp = httpx.post(
        "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",
        headers=headers,
        json=payload,
        timeout=300,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"火山引擎 ASR 请求失败: HTTP {resp.status_code} - {resp.text[:200]}")

    data = resp.json()
    result = data.get("result", {})
    utterances = result.get("utterances", [])

    if not utterances and result.get("text"):
        return [{"start": 0.0, "end": 0.0, "text": result["text"].strip()}]

    segments = []
    for utt in utterances:
        text = utt.get("text", "").strip()
        if not text:
            continue
        start_ms = utt.get("start_time", 0)
        end_ms = utt.get("end_time", 0)
        segments.append({
            "start": round(start_ms / 1000.0, 3),
            "end": round(end_ms / 1000.0, 3),
            "text": text,
        })

    if not segments:
        raise RuntimeError("火山引擎 ASR 返回空结果")

    logger.info("[volc-asr] Transcribed %d segments from %s", len(segments), audio_path)
    return segments


def transcribe_with_asr(audio_path: str) -> list[dict]:
    """Transcribe audio using OpenAI Whisper API.

    Returns list of segments [{start, end, text}].
    Raises exception on failure.
    """
    import openai

    # 使用独立的 Whisper ASR endpoint，而非 LLM 摘要网关
    if not settings.WHISPER_API_BASE:
        raise RuntimeError(
            "ASR 语音识别未配置：WHISPER_API_BASE 为空。"
            "请在 .env 中设置 WHISPER_API_BASE 和 WHISPER_API_KEY。"
        )

    client = openai.OpenAI(
        api_key=settings.WHISPER_API_KEY or settings.OPENAI_API_KEY,
        base_url=settings.WHISPER_API_BASE,
    )

    with open(audio_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    segments = []
    for seg in response.segments or []:
        if isinstance(seg, dict):
            start = seg.get("start", 0.0)
            end = seg.get("end", 0.0)
            text = seg.get("text", "")
        else:
            start = getattr(seg, "start", 0.0)
            end = getattr(seg, "end", 0.0)
            text = getattr(seg, "text", "")
        segments.append({
            "start": float(start or 0.0),
            "end": float(end or 0.0),
            "text": (text or "").strip(),
        })

    if not segments and response.text:
        # Fallback: if no segments but has text, create a single segment
        segments = [{"start": 0.0, "end": 0.0, "text": response.text.strip()}]

    return segments
