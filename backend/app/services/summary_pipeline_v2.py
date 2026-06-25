"""V2 摘要管道 — 分块并行摘要 + 三级并行合并。

从原始字幕文本出发，执行完整的摘要生成流程，返回三级摘要内容。
"""

import asyncio
import contextvars
import io
import json
import logging
import time
import re
import uuid

import redis.asyncio as aioredis

from app.core.async_utils import bounded_ordered_map

from app.config import settings
from app.services.summarization_engine import (
    _split_with_overlap,
    _summarize_single,
    wrap_user_content,
    _INJECTION_GUARD_SUFFIX,
    CHUNK_SIZE,
    CHUNK_OVERLAP,
)
from app.services.summary_stream import publish_summary_event, publish_terminal_event
from app.services.summary_prompts_v2 import (
    SKELETON_PROMPT,
    CHUNK_SUMMARY_PROMPT_TEMPLATE,
    MERGE_PROMPTS,
    FULL_CLEAN_PROMPT,
    CHUNK_CLEAN_PROMPT_TEMPLATE,
    DETAILED_OUTLINE_PROMPT,
    DETAILED_SECTION_PROMPT_TEMPLATE,
)

logger = logging.getLogger(__name__)

# Side channel so the caller (summary_service) can reconcile delta publish
# failures against the persisted summary without changing the return signature.
publish_fail_count_var: contextvars.ContextVar[int] = contextvars.ContextVar(
    "publish_fail_count", default=0
)


class _PublishStats:
    """Tracks delta publish failures within one summary generation round."""

    __slots__ = ("fail_count",)

    def __init__(self) -> None:
        self.fail_count = 0


async def _safe_publish(
    redis: aioredis.Redis,
    video_id: str,
    event: dict,
    generation_id: str,
    stats: _PublishStats,
    *,
    terminal: bool = False,
) -> bool:
    """Publish a summary event, logging structured warnings on failure.

    Replaces the previous `try: publish(...) except Exception: pass` so publish
    failures are observable instead of silently making a task look successful
    while the frontend gets nothing.
    """
    try:
        if terminal:
            await publish_terminal_event(redis, video_id, event, generation_id)
        else:
            await publish_summary_event(redis, video_id, event, generation_id)
        return True
    except Exception as exc:
        stats.fail_count += 1
        logger.warning(
            "[v2-publish-fail] video_id=%s generation_id=%s summary_level=%s seq=%s "
            "event_type=%s exc_type=%s exc_msg=%s publish_fail_count=%d still_persisted=%s",
            video_id, generation_id,
            event.get("summary_level") or event.get("level"),
            event.get("seq"),
            event.get("event_type") or event.get("type"),
            type(exc).__name__, exc, stats.fail_count, True,
        )
        return False

# Short text threshold — below this, skip chunking entirely.
_SHORT_TEXT_THRESHOLD = 15_000
# Full clean threshold — below this, process as single piece.
_FULL_CLEAN_THRESHOLD = 12_000
# Skeleton sampling config
_SKELETON_SAMPLE_COUNT = 6
_SKELETON_SAMPLE_SIZE = 500
# Bounded concurrency: max simultaneous chunk tasks per video
_CHUNK_CONCURRENCY = 8


def _get_redis_pool() -> aioredis.Redis:
    pool = aioredis.ConnectionPool.from_url(
        settings.REDIS_URL, decode_responses=True, max_connections=5,
    )
    return aioredis.Redis(connection_pool=pool)


async def _generate_skeleton(
    transcript_text: str, semaphore: asyncio.Semaphore
) -> str:
    """等距采样生成 5-8 行目录骨架，失败时返回空字符串。"""
    text_len = len(transcript_text)
    if text_len == 0:
        return ""

    # 等距采样 6 个 500 字片段
    step = max(1, text_len // (_SKELETON_SAMPLE_COUNT + 1))
    samples: list[str] = []
    for i in range(1, _SKELETON_SAMPLE_COUNT + 1):
        start = step * i
        end = min(start + _SKELETON_SAMPLE_SIZE, text_len)
        samples.append(transcript_text[start:end])

    sampled_text = "\n---\n".join(samples)

    try:
        # 骨架提取不受主 semaphore 限制，独立执行避免排队
        from app.core.llm import llm_client
        content = await llm_client().complete(
            model=settings.FAST_SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": SKELETON_PROMPT + _INJECTION_GUARD_SUFFIX},
                {"role": "user", "content": wrap_user_content(sampled_text)},
            ],
            max_tokens=256,
        )
        return content if content else ""
    except Exception as e:
        logger.warning("[v2-skeleton] 骨架提取失败，继续无骨架模式: %s", e)
    return ""


async def _summarize_chunk(
    chunk_text: str,
    idx: int,
    total: int,
    skeleton: str,
    semaphore: asyncio.Semaphore,
) -> str:
    """对单个分块执行摘要，失败时返回空字符串。"""
    overlap_hint = ""
    if idx > 0:
        overlap_hint = (
            f"注意：本段开头与上一段结尾有约 {CHUNK_OVERLAP} 字重叠，合并时将去重。\n"
        )

    system_prompt = CHUNK_SUMMARY_PROMPT_TEMPLATE.format(
        skeleton=skeleton or "(无骨架)",
        idx=idx + 1,
        total=total,
        overlap_hint=overlap_hint,
    )

    try:
        result = await _summarize_single(
            chunk_text,
            system_prompt,
            model=settings.FAST_SUMMARY_MODEL,
            max_tokens=1024,
            semaphore=semaphore,
            log_prefix=f"[v2-chunk-{idx+1}/{total}]",
        )
        return result
    except Exception as e:
        logger.warning("[v2-chunk-%d/%d] 分块摘要失败: %s", idx + 1, total, e)
        return ""


async def _merge_for_level(
    chunk_summaries_text: str,
    level: str,
    skeleton: str,
    chunk_count: int,
    semaphore: asyncio.Semaphore,
) -> str:
    """将分块摘要合并为指定级别的最终摘要。"""
    max_tokens_map = {"detailed": 2048, "highlight": 1536, "express": 512}
    max_tokens = max_tokens_map.get(level, 2048)

    prompt_template = MERGE_PROMPTS[level]
    # chunk_summaries 只通过 user message 传入，system prompt 用占位符标记
    system_prompt = prompt_template.format(
        chunk_summaries="(见下方 user message)",
        skeleton=skeleton or "(无骨架)",
        chunk_count=chunk_count,
    )

    result = await _summarize_single(
        chunk_summaries_text,
        system_prompt,
        model=settings.FAST_SUMMARY_MODEL,
        max_tokens=max_tokens,
        semaphore=semaphore,
        log_prefix=f"[v2-merge-{level}]",
    )
    return result


async def _merge_for_level_streaming(
    chunk_summaries_text: str,
    level: str,
    skeleton: str,
    chunk_count: int,
    semaphore: asyncio.Semaphore,
    video_id: uuid.UUID,
    generation_id: str,
    stats: _PublishStats,
) -> str:
    """将分块摘要合并为 detailed 级别，streaming 推送 delta 到 Redis。"""
    max_tokens = 2048

    prompt_template = MERGE_PROMPTS[level]
    system_prompt = prompt_template.format(
        chunk_summaries="(见下方 user message)",
        skeleton=skeleton or "(无骨架)",
        chunk_count=chunk_count,
    ) + _INJECTION_GUARD_SUFFIX

    redis = _get_redis_pool()
    buffer = io.StringIO()

    try:
        async with semaphore:
            from app.core.llm import llm_client
            async for delta in llm_client().stream(
                model=settings.FAST_SUMMARY_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": wrap_user_content(chunk_summaries_text)},
                ],
                max_tokens=max_tokens,
            ):
                if delta:
                    buffer.write(delta)
                    await _safe_publish(redis, str(video_id), {
                        "event_type": "delta", "summary_level": level, "content": delta,
                    }, generation_id, stats)
    finally:
        await redis.close()

    full_content = buffer.getvalue()
    buffer.close()

    logger.info("[v2-merge-%s-stream] output=%d chars", level, len(full_content))
    return full_content


def _parse_outline(raw: str) -> list[str]:
    """从 LLM 输出中解析章节标题列表，容错 markdown 代码块包裹。"""
    text = raw.strip()
    # 去除 ```json ... ``` 或 ``` ... ``` 包裹
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    try:
        parsed = json.loads(text)
    except Exception:
        # 尝试截取第一个 [...] 片段
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if not match:
            return []
        try:
            parsed = json.loads(match.group(0))
        except Exception:
            return []
    if not isinstance(parsed, list):
        return []
    titles = [str(t).strip() for t in parsed if str(t).strip()]
    return titles[:8]


async def _expand_section(
    chunk_summaries_text: str,
    outline_json: str,
    section_title: str,
    idx: int,
    total: int,
    semaphore: asyncio.Semaphore,
) -> str:
    """展开单个章节，失败/超时返回空字符串。"""
    system_prompt = DETAILED_SECTION_PROMPT_TEMPLATE.format(
        outline_json=outline_json,
        section_title=section_title,
        idx=idx,
        total=total,
    ) + _INJECTION_GUARD_SUFFIX

    try:
        async with semaphore:
            from app.core.llm import llm_client
            content = await asyncio.wait_for(
                llm_client().complete(
                    model=settings.FAST_SUMMARY_MODEL,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": wrap_user_content(chunk_summaries_text)},
                    ],
                    max_tokens=512,
                ),
                timeout=70,
            )
        if content:
            return content
    except Exception as e:
        logger.warning("[v2-detailed-seg-%d/%d] 段落展开失败: %s", idx, total, e)
    return ""


async def _merge_detailed_parallel(
    chunk_summaries_text: str,
    skeleton: str,
    chunk_count: int,
    semaphore: asyncio.Semaphore,
    video_id: uuid.UUID,
    generation_id: str,
    stats: _PublishStats,
) -> str:
    """detailed 级别：大纲 + 分段并行展开，逐段 streaming 推送。

    Step A 失败时抛出异常，由调用方 fallback 到单次调用。
    """
    video_id_str = str(video_id)

    # Step A: 生成章节大纲
    t0 = time.monotonic()
    from app.core.llm import llm_client
    raw_outline = await llm_client().complete(
        model=settings.FAST_SUMMARY_MODEL,
        messages=[
            {"role": "system", "content": DETAILED_OUTLINE_PROMPT + _INJECTION_GUARD_SUFFIX},
            {"role": "user", "content": wrap_user_content(chunk_summaries_text)},
        ],
        max_tokens=256,
    )
    titles = _parse_outline(raw_outline)
    if not titles:
        raise RuntimeError("detailed 大纲解析为空")
    logger.info(
        "[v2-detailed-outline] %.1fs, %d 个章节", time.monotonic() - t0, len(titles)
    )

    outline_json = json.dumps(titles, ensure_ascii=False)
    total = len(titles)

    # Step B: 并行展开各章节
    t1 = time.monotonic()
    tasks = [
        _expand_section(
            chunk_summaries_text, outline_json, title, idx + 1, total, semaphore
        )
        for idx, title in enumerate(titles)
    ]
    sections = await asyncio.gather(*tasks)
    logger.info("[v2-detailed-expand] %.1fs, %d 段", time.monotonic() - t1, total)

    # 拼接 + 按大纲顺序逐段 streaming 推送
    redis = _get_redis_pool()
    parts: list[str] = []
    try:
        for title, body in zip(titles, sections):
            if not body.strip():
                continue
            segment = f"### {title}\n\n{body.strip()}"
            parts.append(segment)
            delta = segment + "\n\n"
            await _safe_publish(redis, video_id_str, {
                "event_type": "delta", "summary_level": "detailed", "content": delta,
            }, generation_id, stats)
    finally:
        await redis.close()

    full_content = "\n\n".join(parts)
    logger.info("[v2-detailed-parallel] output=%d chars", len(full_content))
    if not full_content.strip():
        raise RuntimeError("detailed 分段全部失败")
    return full_content


async def generate_fast_summaries_v2(
    transcript_text: str,
    semaphore: asyncio.Semaphore | None = None,
    video_id: uuid.UUID | None = None,
    generation_id: str | None = None,
) -> dict[str, str]:
    """V2 主入口：生成 detailed / highlight / express 三级摘要。

    Args:
        generation_id: 本轮生成的权威 ID（uuid）。贯穿本轮所有 publish 事件，
            供前端按 generation_id 过滤、丢弃上一轮残留 delta。未传则自动生成。
    """
    if semaphore is None:
        semaphore = asyncio.Semaphore(8)

    if generation_id is None:
        generation_id = str(uuid.uuid4())

    # Reset per-round publish failure counter (exposed via contextvar so the
    # caller can reconcile against the persisted summary).
    stats = _PublishStats()
    publish_fail_count_var.set(0)

    video_id_str = str(video_id) if video_id else None

    t_start = time.monotonic()
    text_len = len(transcript_text)
    logger.info(
        "[v2] 开始生成三级摘要, 文本长度=%d chars, generation_id=%s",
        text_len, generation_id,
    )

    # 短文本：跳过分块，直接用独立 prompt 生成各级
    if text_len < _SHORT_TEXT_THRESHOLD:
        logger.info("[v2] 短文本模式，跳过分块直接生成")
        skeleton = ""
        chunk_summaries_text = transcript_text
        chunk_count = 1
        shared_redis = _get_redis_pool() if video_id else None
    else:
        # 共享 Redis 连接用于事件推送
        shared_redis = _get_redis_pool() if video_id else None

        # Phase 0: 骨架提取
        t0 = time.monotonic()
        skeleton = await _generate_skeleton(transcript_text, semaphore)
        logger.info("[v2] Phase 0 骨架提取 %.1fs", time.monotonic() - t0)

        # Phase 1: 分块
        chunks = _split_with_overlap(transcript_text)
        if not chunks:
            logger.warning("[v2] 分块结果为空，降级为短文本模式")
            skeleton = ""
            chunk_summaries_text = transcript_text
            chunk_count = 1
        else:
            chunk_count = len(chunks)
            logger.info("[v2] Phase 1 分块完成: %d 块", chunk_count)

            # Phase 2: 有界并发摘要（最多 _CHUNK_CONCURRENCY 个活跃任务）
            t1 = time.monotonic()
            chunk_results: list[str] = ["" for _ in range(len(chunks))]
            async def _summarize_one(idx_chunk: tuple[int, str]) -> tuple[int, str]:
                idx, chunk = idx_chunk
                result = await _summarize_chunk(
                    chunk, idx, len(chunks), skeleton, semaphore,
                )
                return (idx, result)

            async for idx, result in bounded_ordered_map(
                list(enumerate(chunks)),
                _summarize_one,
                concurrency=_CHUNK_CONCURRENCY,
            ):
                chunk_results[idx] = result

            success_count = sum(1 for r in chunk_results if r)
            logger.info(
                "[v2] Phase 2 有界并发摘要 %.1fs, 成功 %d/%d 块",
                time.monotonic() - t1, success_count, chunk_count,
            )

            # 推送 Phase 2 完成事件
            if shared_redis and video_id_str:
                await _safe_publish(shared_redis, video_id_str, {
                    "event_type": "phase", "phase": "chunks_done",
                    "success": success_count, "total": chunk_count,
                }, generation_id, stats)

            # 所有块失败时降级为原文直接传入
            if success_count == 0:
                logger.warning("[v2] 所有分块摘要失败，降级为原文直接合并")
                chunk_summaries_text = transcript_text
                chunk_count = 1
            else:
                chunk_summaries_text = "\n\n---\n\n".join(
                    f"## 第 {i+1} 部分\n\n{s}"
                    for i, s in enumerate(chunk_results)
                    if s
                )

    # Phase 3: 三级全并行（express / highlight / detailed），各自完成时 publish
    t2 = time.monotonic()

    async def _run_express() -> str:
        t = time.monotonic()
        result = await _merge_for_level(
            chunk_summaries_text, "express", skeleton, chunk_count, semaphore
        )
        logger.info("[v2] Phase 3 express 完成 %.1fs", time.monotonic() - t)
        if shared_redis and video_id_str:
            await _safe_publish(shared_redis, video_id_str, {
                "event_type": "level_generated", "summary_level": "express",
            }, generation_id, stats)
        return result

    async def _run_highlight() -> str:
        t = time.monotonic()
        result = await _merge_for_level(
            chunk_summaries_text, "highlight", skeleton, chunk_count, semaphore
        )
        logger.info("[v2] Phase 3 highlight 完成 %.1fs", time.monotonic() - t)
        if shared_redis and video_id_str:
            await _safe_publish(shared_redis, video_id_str, {
                "event_type": "level_generated", "summary_level": "highlight",
            }, generation_id, stats)
        return result

    async def _run_detailed() -> str:
        t = time.monotonic()
        if video_id:
            # 优先 streaming 单次调用（真流式，用户体感最好）
            attempt = 0
            try:
                result = await _merge_for_level_streaming(
                    chunk_summaries_text, "detailed", skeleton, chunk_count,
                    semaphore, video_id, generation_id, stats,
                )
            except Exception as e:
                logger.warning(
                    "[v2] streaming detailed 失败，fallback 到分段并行: %s", e
                )
                # L0 可能已 publish 部分 delta：通知前端丢弃本轮已显示内容后重来。
                attempt += 1
                if shared_redis and video_id_str:
                    await _safe_publish(shared_redis, video_id_str, {
                        "event_type": "reset", "summary_level": "detailed",
                        "reason": f"streaming failed: {type(e).__name__}",
                        "attempt": attempt,
                    }, generation_id, stats)
                try:
                    result = await _merge_detailed_parallel(
                        chunk_summaries_text, skeleton, chunk_count,
                        semaphore, video_id, generation_id, stats,
                    )
                except Exception as e2:
                    logger.warning(
                        "[v2] 分段并行也失败，fallback 到非流式: %s", e2
                    )
                    # 进入非流式 L2 前再发一次 reset。
                    attempt += 1
                    if shared_redis and video_id_str:
                        await _safe_publish(shared_redis, video_id_str, {
                            "event_type": "reset", "summary_level": "detailed",
                            "reason": f"parallel failed: {type(e2).__name__}",
                            "attempt": attempt,
                        }, generation_id, stats)
                    result = await _merge_for_level(
                        chunk_summaries_text, "detailed", skeleton, chunk_count, semaphore
                    )
                    # L2 非流式无 delta：把最终内容作为 snapshot 一次性下发。
                    if shared_redis and video_id_str and result.strip():
                        await _safe_publish(shared_redis, video_id_str, {
                            "event_type": "snapshot", "summary_level": "detailed",
                            "content": result,
                        }, generation_id, stats)
        else:
            result = await _merge_for_level(
                chunk_summaries_text, "detailed", skeleton, chunk_count, semaphore
            )
        logger.info("[v2] Phase 3 detailed 完成 %.1fs", time.monotonic() - t)
        if shared_redis and video_id_str:
            await _safe_publish(shared_redis, video_id_str, {
                "event_type": "level_generated", "summary_level": "detailed",
            }, generation_id, stats)
        return result

    results = await asyncio.gather(
        _run_express(), _run_highlight(), _run_detailed(),
        return_exceptions=True,
    )
    # Unpack with fallback: if any level threw, use empty string
    express = results[0] if isinstance(results[0], str) else ""
    highlight = results[1] if isinstance(results[1], str) else ""
    detailed = results[2] if isinstance(results[2], str) else ""
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            level_name = ["express", "highlight", "detailed"][i]
            logger.error("[v2] Phase 3 %s 异常: %s", level_name, r)

    logger.info("[v2] Phase 3 总耗时 %.1fs", time.monotonic() - t2)

    logger.info("[v2] 全流程完成 %.1fs", time.monotonic() - t_start)

    # 推送终端事件，标记流结束
    if shared_redis and video_id_str:
        await _safe_publish(shared_redis, video_id_str, {
            "event_type": "done", "levels": ["detailed", "highlight", "express"],
        }, generation_id, stats, terminal=True)

    # 关闭共享 Redis
    if shared_redis:
        await shared_redis.close()

    # 暴露本轮 delta publish 失败计数，供调用方落库后对账。
    publish_fail_count_var.set(stats.fail_count)
    if stats.fail_count > 0:
        logger.warning(
            "[v2-publish-recon] video_id=%s generation_id=%s publish_fail_count=%d "
            "— 摘要已生成但部分 delta 推送失败，前端可能需依赖 snapshot/轮询补偿",
            video_id_str, generation_id, stats.fail_count,
        )

    return {
        "detailed": detailed,
        "highlight": highlight,
        "express": express,
    }


async def generate_full_clean_v2(
    transcript_text: str,
    semaphore: asyncio.Semaphore | None = None,
    video_id: uuid.UUID | None = None,
) -> str:
    """Full 级别独立路径：字幕清洗整理为完整文稿。"""
    if semaphore is None:
        semaphore = asyncio.Semaphore(8)

    text_len = len(transcript_text)
    logger.info("[v2-full] 开始 Full 清洗, 文本长度=%d chars", text_len)
    t_start = time.monotonic()

    if text_len < _FULL_CLEAN_THRESHOLD:
        # 短文本：直接清洗
        result = await _summarize_single(
            transcript_text,
            FULL_CLEAN_PROMPT,
            model=settings.DEEP_SUMMARY_MODEL,
            max_tokens=8192,
            semaphore=semaphore,
            log_prefix="[v2-full-single]",
        )
        logger.info("[v2-full] 单次清洗完成 %.1fs", time.monotonic() - t_start)
        return result

    # 长文本：分块并行清洗 → 拼接
    chunks = _split_with_overlap(transcript_text)
    chunk_count = len(chunks)
    logger.info("[v2-full] 分块清洗模式: %d 块", chunk_count)

    async def _clean_chunk(chunk: str, idx: int) -> str:
        system_prompt = CHUNK_CLEAN_PROMPT_TEMPLATE.format(
            idx=idx + 1, total=chunk_count
        )
        try:
            return await _summarize_single(
                chunk,
                system_prompt,
                model=settings.DEEP_SUMMARY_MODEL,
                max_tokens=8192,
                semaphore=semaphore,
                log_prefix=f"[v2-full-chunk-{idx+1}/{chunk_count}]",
            )
        except Exception as e:
            logger.warning("[v2-full-chunk-%d] 清洗失败: %s", idx + 1, e)
            return ""

    t1 = time.monotonic()
    cleaned_map: dict[int, str] = {}
    async for idx, text in bounded_ordered_map(
        list(enumerate(chunks)),
        lambda idx_text: _clean_chunk(idx_text[1], idx_text[0]),
        concurrency=_CHUNK_CONCURRENCY,
    ):
        cleaned_map[idx] = text

    cleaned_chunks = [cleaned_map.get(i, "") for i in range(len(chunks))]
    logger.info("[v2-full] 有界并发清洗 %.1fs", time.monotonic() - t1)

    # 拼接时去重 overlap 区域：找到第一个完整句子边界后开始
    parts: list[str] = []
    for i, text in enumerate(cleaned_chunks):
        if not text:
            continue
        if i == 0:
            parts.append(text)
        else:
            # 在前 trim_size 范围内找第一个句子边界，从边界后开始
            trim_size = min(CHUNK_OVERLAP // 2, len(text) // 3)
            boundary_match = re.search(r'[。！？.!?\n]', text[:trim_size])
            if boundary_match:
                trimmed = text[boundary_match.end():]
            else:
                trimmed = text[trim_size:] if len(text) > trim_size else text
            parts.append(trimmed)

    result = "\n\n".join(parts)
    logger.info("[v2-full] 全流程完成 %.1fs", time.monotonic() - t_start)
    return result
