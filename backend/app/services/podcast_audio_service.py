"""播客音频下载服务

支持两条下载路径：
1. yt-dlp（喜马拉雅/Apple Podcasts/SoundCloud/蜻蜓FM 等）
2. HTTP 直接下载（RSS feed 中的 enclosure URL）

下载后统一转换为 16kHz mono WAV（适配 ASR 输入要求）。
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx

from app.core.url_validator import validate_url_async, safe_async_client, SSRFError

logger = logging.getLogger(__name__)

# 500 MB — generous for podcasts, but prevents infinite streams from filling disk
_MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024


async def download_podcast_audio(url: str, platform: str = "podcast") -> str:
    """下载播客音频到临时文件，返回本地 WAV 文件路径。

    优先尝试 yt-dlp，失败后尝试 HTTP 直接下载。
    下载完成后自动转换为 16kHz mono WAV 以适配 ASR。
    """
    raw_path: str | None = None
    wav_path: str | None = None

    try:
        # 1. 尝试 yt-dlp（适用于喜马拉雅、Apple Podcasts 等平台）
        try:
            raw_path = await _download_with_ytdlp(url)
            if raw_path and os.path.exists(raw_path):
                logger.info("[podcast-dl] yt-dlp 下载成功: %s", raw_path)
        except Exception as e:
            logger.warning("[podcast-dl] yt-dlp 失败: %s，尝试 HTTP 直接下载", e)
            raw_path = None

        # 2. 尝试 HTTP 直接下载（适用于 RSS enclosure URL）
        if not raw_path or not os.path.exists(raw_path):
            raw_path = await _download_with_http(url)

        # 3. 转换为 16kHz mono WAV（ASR 标准输入格式）
        wav_path = await _convert_to_wav(raw_path)

        # 清理原始下载文件（转换后不再需要）
        if raw_path and os.path.exists(raw_path) and os.path.abspath(raw_path) != os.path.abspath(wav_path):
            try:
                os.unlink(raw_path)
            except OSError:
                pass

        return wav_path
    except Exception:
        # 异常时清理已下载的临时文件，防止 /tmp 写满
        if raw_path and os.path.exists(raw_path):
            try:
                os.unlink(raw_path)
            except OSError:
                pass
            # 如果 raw_path 在 mkdtemp 创建的目录中，清理整个目录
            raw_dir = os.path.dirname(raw_path)
            if os.path.basename(raw_dir).startswith("podcast_"):
                shutil.rmtree(raw_dir, ignore_errors=True)
        if wav_path and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                pass
        raise


async def _download_with_ytdlp(url: str) -> str | None:
    """使用 yt-dlp 下载音频"""
    import yt_dlp

    await validate_url_async(url)

    tmp_dir = tempfile.mkdtemp(prefix="podcast_")
    output_path = os.path.join(tmp_dir, "audio.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_path,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "0",
            }
        ],
        "socket_timeout": 30,
        "retries": 3,
    }

    # yt-dlp 是同步的，放到线程池
    def _do() -> str | None:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)
            # 找到下载后的文件
            for f in os.listdir(tmp_dir):
                fpath = os.path.join(tmp_dir, f)
                if os.path.isfile(fpath):
                    return fpath
        return None

    try:
        return await asyncio.to_thread(_do)
    except Exception:
        # 下载失败时清理临时目录，防止泄漏
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise


async def _download_with_http(url: str) -> str:
    """直接 HTTP 下载音频文件"""
    # 根据 URL 推断后缀，默认 .mp3
    suffix = ".mp3"
    url_lower = url.lower().split("?")[0]
    for ext in (".m4a", ".wav", ".ogg", ".flac", ".aac", ".opus"):
        if url_lower.endswith(ext):
            suffix = ext
            break

    tmp_file = tempfile.NamedTemporaryFile(
        suffix=suffix, prefix="podcast_", delete=False
    )

    try:
        await validate_url_async(url)
        async with safe_async_client(timeout=300, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                bytes_written = 0
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    bytes_written += len(chunk)
                    if bytes_written > _MAX_DOWNLOAD_BYTES:
                        raise ValueError(
                            f"Download exceeded maximum size of {_MAX_DOWNLOAD_BYTES} bytes"
                        )
                    tmp_file.write(chunk)
    except Exception:
        tmp_file.close()
        os.unlink(tmp_file.name)
        raise

    tmp_file.close()
    file_size = os.path.getsize(tmp_file.name)
    logger.info(
        "[podcast-dl] HTTP 下载完成: %s (%d bytes)", tmp_file.name, file_size
    )
    return tmp_file.name


async def _convert_to_wav(input_path: str) -> str:
    """使用 ffmpeg 转换为 16kHz mono WAV（ASR 标准输入格式）"""
    output_dir = os.path.dirname(input_path)
    output_path = os.path.join(output_dir, "audio_16k.wav")

    # 如果输入已经是同名文件，换个输出名
    if os.path.abspath(input_path) == os.path.abspath(output_path):
        output_path = os.path.join(output_dir, "audio_16k_converted.wav")

    def _do() -> str:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-protocol_whitelist",
                "file,crypto,data",
                "-i",
                input_path,
                "-ar",
                "16000",
                "-ac",
                "1",
                "-f",
                "wav",
                output_path,
            ],
            check=True,
            capture_output=True,
        )
        return output_path

    result = await asyncio.to_thread(_do)
    logger.info(
        "[podcast-dl] 音频转换完成: %s -> %s (%d bytes)",
        input_path,
        result,
        os.path.getsize(result),
    )
    return result
