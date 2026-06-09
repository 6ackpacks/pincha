"""Subtitle fetching service: orchestrator that delegates to sub-modules.

This module is the main entry point for transcript extraction. It coordinates:
- subtitle_providers: third-party API clients (Supadata, TranscriptAPI, etc.)
- subtitle_parsers: yt-dlp subtitle download and parsing
- audio_asr: audio download and ASR transcription (Volc, Whisper)
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
import asyncio
import concurrent.futures

from app.config import settings
from app.services.audio_asr import download_audio, transcribe_with_asr, transcribe_with_volc_asr
from app.services.podcast_audio_service import download_podcast_audio
from app.services.xfyun_asr import transcribe_podcast_audio

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Re-exports from sub-modules (backward compatibility for existing importers)
# ---------------------------------------------------------------------------

from app.services.subtitle_providers import (  # noqa: E402
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

# audio_asr functions are imported at the top of this file and are available
# as module-level names for backward compatibility (download_audio,
# transcribe_with_asr, transcribe_with_volc_asr).
from app.services.audio_asr import _download_audio_via_rapidapi  # noqa: E402, F401


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def get_transcript_segments(url: str, platform: str, on_progress=None) -> tuple[list[dict], str]:
    """Main orchestration: try platform subtitles first, fallback to ASR.

    Returns (segments, source) where source is "platform", "asr", or "xfyun".
    Raises exception if both methods fail.
    on_progress: optional callback(percent, message) for granular progress reporting.
    """
    def _report(pct: int, msg: str):
        if on_progress:
            on_progress(pct, msg)

    # 播客专用路径：下载音频 → 讯飞/Whisper ASR 转写
    if platform == "podcast":
        return _process_podcast_transcript(url, on_progress=_report)

    # --- 多供应商字幕提取降级链 ---
    # 策略：串行尝试，谁先成功用谁；熔断器自动跳过连续失败的供应商

    # Step 1: Supadata API (YouTube only, ~1-3s)
    if platform == "youtube" and not _breaker.is_open("supadata"):
        _report(30, "尝试 Supadata API...")
        t0 = time.monotonic()
        segments = fetch_supadata_transcript(url)
        if segments:
            _breaker.record_success("supadata")
            logger.info("[transcript] Supadata OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
            return segments, "platform"
        _breaker.record_failure("supadata")
        logger.info("[transcript] Supadata miss in %.1fs", time.monotonic() - t0)

    # Step 2: TranscriptAPI (YouTube only, ~49ms median)
    if platform == "youtube":
        _report(33, "尝试 TranscriptAPI...")
        t0 = time.monotonic()
        segments = fetch_transcriptapi_transcript(url)
        if segments:
            logger.info("[transcript] TranscriptAPI OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
            return segments, "platform"
        logger.info("[transcript] TranscriptAPI miss in %.1fs", time.monotonic() - t0)

    # Step 3: TranscriptHQ (YouTube + multi-platform)
    _report(36, "尝试 TranscriptHQ...")
    t0 = time.monotonic()
    segments = fetch_transcripthq_transcript(url, platform)
    if segments:
        logger.info("[transcript] TranscriptHQ OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
        return segments, "platform"
    logger.info("[transcript] TranscriptHQ miss in %.1fs", time.monotonic() - t0)

    # Step 4: youtube-transcript-api (YouTube only, local library, ~1-3s)
    if platform == "youtube":
        _report(39, "尝试 youtube-transcript-api...")
        t0 = time.monotonic()
        segments = fetch_youtube_transcript_api(url)
        if segments:
            logger.info("[transcript] youtube-transcript-api OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
            return segments, "platform"
        logger.info("[transcript] youtube-transcript-api miss in %.1fs", time.monotonic() - t0)

    # Step 5: yt-dlp platform subtitles (all platforms, ~10-20s, 最慢的平台字幕方式)
    _report(42, "尝试 yt-dlp 平台字幕...")
    t0 = time.monotonic()
    segments = fetch_platform_subtitles(url, platform)
    if segments:
        logger.info("[transcript] yt-dlp platform subs OK: %d segments in %.1fs", len(segments), time.monotonic() - t0)
        return segments, "platform"

    logger.info("[transcript] All platform methods failed, falling back to ASR")
    _report(45, "平台字幕不可用，准备 ASR 语音识别...")

    # Step 6: Fallback to ASR (last resort)
    # 优先火山引擎，备选 Whisper
    has_volc = bool(settings.VOLC_ASR_APP_ID and settings.VOLC_ASR_ACCESS_TOKEN)
    has_whisper = bool(settings.WHISPER_API_BASE)

    if not has_volc and not has_whisper:
        raise RuntimeError(
            "该视频没有字幕，需要 ASR 语音识别但未配置任何 ASR 服务。"
            "请在 .env 中设置 VOLC_ASR_APP_ID + VOLC_ASR_ACCESS_TOKEN（火山引擎）"
            "或 WHISPER_API_BASE + WHISPER_API_KEY（Whisper）。"
        )

    # Cookies 检查仅对 YouTube 生效（有 PO token provider 时可跳过）
    if platform == "youtube" and not os.path.exists(COOKIES_PATH) and not POT_PROVIDER_BASE:
        raise RuntimeError(
            "该视频暂无可用字幕（YouTube 反爬虫限制，需要登录验证）。\n"
            "解决方法：在已登录 YouTube 的浏览器中导出 cookies，"
            "保存到 backend/cookies/cookies.txt 后重新提交视频。\n"
            "导出命令（Chrome）：yt-dlp --cookies-from-browser chrome --cookies cookies.txt https://youtube.com"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            t_dl = time.monotonic()
            _report(50, "下载音频中...")
            audio_path = download_audio(url, tmpdir)
            logger.info("[transcript] Audio download took %.1fs", time.monotonic() - t_dl)
        except Exception as e:
            raise RuntimeError(
                f"音频下载失败，无法进行语音识别。"
                f"该视频可能没有字幕且无法下载音频（YouTube 反爬虫限制）。"
                f"建议换一个有字幕的视频，或配置 cookies 文件后重试。"
                f"详情：{e}"
            ) from e

        t_asr = time.monotonic()
        segments = None

        # 优先火山引擎 ASR
        if has_volc:
            try:
                _report(60, "火山引擎 ASR 识别中...")
                segments = transcribe_with_volc_asr(audio_path)
                logger.info("[transcript] Volc ASR took %.1fs, %d segments", time.monotonic() - t_asr, len(segments))
            except Exception as e:
                logger.warning("[transcript] Volc ASR failed: %s", e)
                if has_whisper:
                    logger.info("[transcript] Falling back to Whisper ASR")

        # 火山失败则回退 Whisper
        if not segments and has_whisper:
            try:
                _report(60, "Whisper ASR 识别中...")
                segments = transcribe_with_asr(audio_path)
                logger.info("[transcript] Whisper ASR took %.1fs, %d segments", time.monotonic() - t_asr, len(segments))
            except Exception as e:
                raise RuntimeError(f"ASR failed: {e}") from e

    if not segments:
        raise RuntimeError("ASR returned empty transcript")

    logger.info("Using ASR transcript (%d segments)", len(segments))
    return segments, "asr"


# ---------------------------------------------------------------------------
# Podcast-specific flow
# ---------------------------------------------------------------------------

def _process_podcast_transcript(url: str, on_progress=None) -> tuple[list[dict], str]:
    """播客专用字幕提取流程。

    步骤：
    1. 尝试 yt-dlp 提取平台字幕（少数播客平台可能提供）
    2. 下载音频文件
    3. 讯飞 ASR（或 Whisper 兜底）转写

    Returns (segments, source) where source is "platform" or "xfyun" or "asr".
    """

    def _run_async(coro):
        """Run an async coroutine from sync context, handling existing event loops."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result()

    def _report(pct: int, msg: str):
        if on_progress:
            on_progress(pct, msg)

    # Step 1: 尝试 yt-dlp 平台字幕（极少数播客有字幕）
    _report(32, "尝试获取播客平台字幕...")
    t0 = time.monotonic()
    try:
        segments = fetch_platform_subtitles(url, "podcast")
        if segments:
            logger.info(
                "[podcast] 平台字幕获取成功: %d 个片段，耗时 %.1fs",
                len(segments), time.monotonic() - t0,
            )
            return segments, "platform"
    except Exception as exc:
        logger.debug("[podcast] 平台字幕获取失败: %s", exc)

    logger.info("[podcast] 无平台字幕，准备下载音频进行 ASR 转写")

    # Step 2: 下载播客音频
    _report(35, "下载播客音频中...")
    t_dl = time.monotonic()
    try:
        audio_path = _run_async(download_podcast_audio(url))
        logger.info(
            "[podcast] 音频下载完成，耗时 %.1fs: %s",
            time.monotonic() - t_dl, audio_path,
        )
    except Exception as e:
        raise RuntimeError(
            f"播客音频下载失败: {e}\n"
            f"请确认 URL 可访问，或尝试提供 RSS enclosure 直链。"
        ) from e

    # Step 3: ASR 转写（优先讯飞，兜底 Whisper）
    _report(45, "ASR 语音识别中...")
    t_asr = time.monotonic()

    # 判断使用哪种 ASR
    has_xfyun = bool(settings.XFYUN_APP_ID and settings.XFYUN_API_SECRET)
    has_whisper = bool(settings.WHISPER_API_BASE)

    if not has_xfyun and not has_whisper:
        raise RuntimeError(
            "播客需要 ASR 语音识别但未配置任何 ASR 服务。"
            "请在 .env 中设置 XFYUN_APP_ID + XFYUN_API_SECRET（讯飞）"
            "或 WHISPER_API_BASE + WHISPER_API_KEY（Whisper）。"
        )

    source = "asr"
    segments = []

    if has_xfyun:
        # 讯飞 ASR（支持说话人分离，更适合播客对话场景）
        try:
            _report(48, "讯飞 ASR 转写中（支持说话人分离）...")
            segments = _run_async(
                transcribe_podcast_audio(audio_path, on_progress=on_progress)
            )
            source = "xfyun"
            logger.info(
                "[podcast] 讯飞 ASR 完成: %d 个片段，耗时 %.1fs",
                len(segments), time.monotonic() - t_asr,
            )
        except Exception as exc:
            logger.warning("[podcast] 讯飞 ASR 失败: %s，回退 Whisper", exc)
            segments = []

    if not segments and has_whisper:
        # Whisper 兜底
        _report(50, "Whisper ASR 转写中...")
        try:
            segments = transcribe_with_asr(audio_path)
            source = "asr"
            logger.info(
                "[podcast] Whisper ASR 完成: %d 个片段，耗时 %.1fs",
                len(segments), time.monotonic() - t_asr,
            )
        except Exception as e:
            raise RuntimeError(f"播客 ASR 转写失败: {e}") from e

    if not segments:
        raise RuntimeError("播客 ASR 转写返回空结果")

    # 清理临时音频文件
    try:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
            # 同时清理所在临时目录（如果空的话）
            parent = os.path.dirname(audio_path)
            if parent and os.path.isdir(parent) and not os.listdir(parent):
                os.rmdir(parent)
    except OSError:
        pass  # 清理失败不影响主流程

    return segments, source
