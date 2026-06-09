"""讯飞录音文件转写大模型 ASR 服务

API 文档: https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html
接口地址: https://office-api-ist-dx.iflyaisol.com/v2/
鉴权: 参数在 URL query，signature 在 Header，文件作为 raw body
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import random
import string
import time
import urllib.parse
import wave
from datetime import datetime
from typing import Callable

import httpx

from app.config import settings
from app.services.audio_asr import transcribe_with_asr

logger = logging.getLogger(__name__)

LFASR_HOST = "https://office-api-ist-dx.iflyaisol.com"
UPLOAD_PATH = "/v2/upload"
GET_RESULT_PATH = "/v2/getResult"

POLL_INTERVAL = 10
POLL_TIMEOUT = 1800


def _random_str(length: int = 16) -> str:
    return "".join(random.choices(string.ascii_letters + string.digits, k=length))


def _get_datetime() -> str:
    local_now = datetime.now()
    tz_offset = local_now.astimezone().strftime("%z")
    return f"{local_now.strftime('%Y-%m-%dT%H:%M:%S')}{tz_offset}"


def _get_wav_duration_ms(path: str) -> int:
    try:
        with wave.open(path, "rb") as wf:
            return int(round(wf.getnframes() / wf.getframerate() * 1000))
    except Exception:
        return 0


def _generate_signature(params: dict, secret_key: str) -> str:
    """生成签名: 排除 signature，按 key 排序，URL 编码 key 和 value，HMAC-SHA1 + base64"""
    sign_params = {k: v for k, v in params.items() if k != "signature"}
    sorted_items = sorted(sign_params.items(), key=lambda x: x[0])

    parts = []
    for k, v in sorted_items:
        if v is not None and str(v).strip() != "":
            encoded_key = urllib.parse.quote(str(k), safe="")
            encoded_val = urllib.parse.quote(str(v), safe="")
            parts.append(f"{encoded_key}={encoded_val}")

    base_string = "&".join(parts)
    h = hmac.HMAC(secret_key.encode(), base_string.encode(), hashlib.sha1)
    return base64.b64encode(h.digest()).decode()


def _build_query_url(base_path: str, params: dict) -> str:
    """构建 URL: 参数 URL 编码后拼接到 query string"""
    encoded_parts = []
    for k, v in params.items():
        ek = urllib.parse.quote(str(k), safe="")
        ev = urllib.parse.quote(str(v), safe="")
        encoded_parts.append(f"{ek}={ev}")
    return f"{LFASR_HOST}{base_path}?{'&'.join(encoded_parts)}"


async def transcribe_audio(
    audio_path: str,
    language: str = "autodialect",
    enable_diarization: bool = True,
) -> list[dict]:
    """使用讯飞录音文件转写大模型转写音频。

    Args:
        audio_path: 本地 WAV 音频文件路径
        language: "cn"/"en"/"autodialect"
        enable_diarization: 是否开启说话人分离

    Returns:
        list of {start: float, end: float, text: str, speaker: str | None}
    """
    app_id = settings.XFYUN_APP_ID
    access_key_id = settings.XFYUN_ACCESS_KEY_ID
    access_key_secret = settings.XFYUN_API_SECRET

    if not app_id or not access_key_id or not access_key_secret:
        raise RuntimeError(
            "讯飞 ASR 未配置：需要 XFYUN_APP_ID、XFYUN_ACCESS_KEY_ID 和 XFYUN_API_SECRET"
        )

    if not os.path.exists(audio_path):
        raise RuntimeError(f"音频文件不存在: {audio_path}")

    file_size = os.path.getsize(audio_path)
    file_name = os.path.basename(audio_path)
    duration_ms = _get_wav_duration_ms(audio_path)
    sig_random = _random_str()

    logger.info("[xfyun] 上传: %s (%d bytes, %dms)", file_name, file_size, duration_ms)

    # Step 1: Upload
    upload_params = {
        "appId": app_id,
        "accessKeyId": access_key_id,
        "dateTime": _get_datetime(),
        "signatureRandom": sig_random,
        "fileSize": str(file_size),
        "fileName": file_name,
        "language": language,
        "duration": str(duration_ms) if duration_ms > 0 else "200000",
        "roleType": "2" if enable_diarization else "0",
    }

    signature = _generate_signature(upload_params, access_key_secret)
    upload_url = _build_query_url(UPLOAD_PATH, upload_params)

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            upload_url,
            content=audio_data,
            headers={
                "Content-Type": "application/octet-stream",
                "signature": signature,
            },
        )
        result = resp.json()
        logger.info("[xfyun] 上传响应: code=%s, desc=%s", result.get("code"), result.get("descInfo"))

        if result.get("code") != "000000":
            raise RuntimeError(f"讯飞上传失败: code={result.get('code')}, desc={result.get('descInfo')}")

        order_id = result["content"]["orderId"]
        estimate_ms = result["content"].get("taskEstimateTime", 60000)
        logger.info("[xfyun] 上传成功, orderId=%s, 预估=%dms", order_id, estimate_ms)

        # Step 2: Poll for result
        start_time = time.monotonic()
        while time.monotonic() - start_time < POLL_TIMEOUT:
            await asyncio.sleep(POLL_INTERVAL)

            query_params = {
                "appId": app_id,
                "accessKeyId": access_key_id,
                "dateTime": _get_datetime(),
                "ts": str(int(time.time())),
                "orderId": order_id,
                "signatureRandom": sig_random,
            }
            query_sig = _generate_signature(query_params, access_key_secret)
            query_url = _build_query_url(GET_RESULT_PATH, query_params)

            resp = await client.post(
                query_url,
                content=b"{}",
                headers={
                    "Content-Type": "application/json",
                    "signature": query_sig,
                },
            )
            result = resp.json()

            if result.get("code") != "000000":
                raise RuntimeError(f"讯飞查询失败: {result}")

            status = result["content"]["orderInfo"]["status"]
            if status == 4:
                elapsed = time.monotonic() - start_time
                logger.info("[xfyun] 转写完成, orderId=%s, 耗时%.1fs", order_id, elapsed)
                return _parse_result(result)
            elif status == -1:
                raise RuntimeError(f"讯飞转写失败: {result}")
            else:
                elapsed = time.monotonic() - start_time
                if int(elapsed) % 30 < POLL_INTERVAL:
                    logger.info("[xfyun] 等待中... status=%s, elapsed=%.0fs", status, elapsed)

        raise RuntimeError(f"讯飞转写超时 ({POLL_TIMEOUT}s)")


def _parse_result(result: dict) -> list[dict]:
    """解析讯飞转写结果为标准 segment 格式"""
    segments: list[dict] = []
    order_result = result.get("content", {}).get("orderResult")
    if not order_result:
        return segments

    if isinstance(order_result, str):
        order_result = json.loads(order_result)

    lattice_list = order_result.get("lattice", [])
    for item in lattice_list:
        json_1best = item.get("json_1best", "{}")
        if isinstance(json_1best, str):
            json_1best = json.loads(json_1best)

        st = json_1best.get("st", {})
        bg_ms = int(st.get("bg", "0"))
        ed_ms = int(st.get("ed", "0"))

        words: list[str] = []
        speaker: str | None = None
        for rt in st.get("rt", []):
            for ws in rt.get("ws", []):
                for cw in ws.get("cw", []):
                    w = cw.get("w", "")
                    if w:
                        words.append(w)
            if "rl" in rt:
                speaker = rt.get("rl")

        text = "".join(words).strip()
        if text:
            seg = {"start": bg_ms / 1000.0, "end": ed_ms / 1000.0, "text": text}
            if speaker:
                seg["speaker"] = speaker
            segments.append(seg)

    return segments


async def transcribe_podcast_audio(
    audio_path: str,
    language: str = "autodialect",
    on_progress: Callable[[int, str], None] | None = None,
) -> list[dict]:
    """播客音频转写入口 — 优先讯飞大模型，兜底 Whisper。"""

    def _report(pct: int, msg: str) -> None:
        if on_progress:
            on_progress(pct, msg)

    if settings.XFYUN_APP_ID and settings.XFYUN_ACCESS_KEY_ID and settings.XFYUN_API_SECRET:
        try:
            _report(50, "讯飞 ASR 转写中...")
            segments = await transcribe_audio(audio_path, language)
            if segments:
                logger.info("[asr] 讯飞转写成功，%d 个片段", len(segments))
                return segments
            logger.warning("[asr] 讯飞转写返回空结果")
        except Exception as exc:
            logger.warning("[asr] 讯飞转写失败，回退到 Whisper: %s", exc)

    logger.warning("[asr] 使用 Whisper 兜底转写")
    _report(50, "Whisper ASR 转写中...")

    segments = await asyncio.to_thread(transcribe_with_asr, audio_path)
    if segments:
        logger.info("[asr] Whisper 转写成功，%d 个片段", len(segments))
    return segments
