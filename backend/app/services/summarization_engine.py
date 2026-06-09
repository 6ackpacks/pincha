"""Shared summarization engine — core chunking and LLM call logic.

Extracted from summary_service.py and article_summary_service.py to eliminate
duplication of _split_into_chunks, _summarize_single, _chunk_and_merge,
_summarize_with_chunking, and _cascade_single.
"""

import asyncio
import logging
import re
import time

import litellm

from app.config import settings

logger = logging.getLogger(__name__)

# Beyond this threshold, split into chunks before summarizing.
CHUNK_CHAR_THRESHOLD = 40_000
CHUNK_SIZE = 40_000

# Merge prompt template — {content_type} is replaced with "视频" or "文章".
MERGE_PROMPT_TEMPLATE = (
    "以下是对一个长{content_type}分段整理的结果。请将这些段落合并为一份完整、连贯的长文。\n"
    "【要求】\n"
    "- 去除段落之间的重复内容\n"
    "- 按主题重新组织（相关内容合并到同一章节）\n"
    "- 保留所有实质内容，不做压缩\n"
    "- 使用 ## 标题划分章节\n"
    "输出结构化 Markdown。"
)


def _split_into_chunks(text: str, chunk_size: int = CHUNK_SIZE) -> list[str]:
    """Split text into chunks at sentence boundaries (。！？.!?)."""
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        if end >= len(text):
            chunks.append(text[start:])
            break
        # Look for a sentence boundary near the end of the chunk
        window = text[max(start, end - 500):end + 500]
        matches = list(re.finditer(r'[。！？.!?\n]', window))
        if matches:
            best = min(matches, key=lambda m: abs((max(start, end - 500) + m.end()) - end))
            split_at = max(start, end - 500) + best.end()
            chunks.append(text[start:split_at])
            start = split_at
        else:
            chunks.append(text[start:end])
            start = end
    return chunks


async def _summarize_single(
    text: str,
    system_prompt: str,
    model: str | None = None,
    semaphore: asyncio.Semaphore | None = None,
    log_prefix: str = "[llm]",
) -> str:
    """Call LiteLLM for a single summarization request.

    Args:
        text: Input text to summarize.
        system_prompt: System prompt for the LLM.
        model: Model override (defaults to settings.SUMMARY_MODEL).
        semaphore: Optional concurrency limiter.
        log_prefix: Prefix for log messages.
    """
    t0 = time.monotonic()

    async def _call():
        return await litellm.acompletion(
            model=model or settings.SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            timeout=180,
            num_retries=2,
            api_base=settings.SUMMARY_API_BASE or None,
            api_key=settings.OPENAI_API_KEY or None,
        )

    if semaphore is not None:
        async with semaphore:
            response = await _call()
    else:
        response = await _call()

    if not response.choices:
        raise RuntimeError("LLM returned empty choices (possible content filter block)")
    logger.info(
        "%s call took %.1fs, input=%d chars, output=%d chars",
        log_prefix, time.monotonic() - t0, len(text), len(response.choices[0].message.content),
    )
    return response.choices[0].message.content


async def _chunk_and_merge(
    text: str,
    system_prompt: str,
    model: str | None = None,
    content_type: str = "视频",
    semaphore: asyncio.Semaphore | None = None,
    log_prefix: str = "[llm]",
) -> str:
    """Split text into chunks, summarize in parallel, then merge."""
    chunks = _split_into_chunks(text)
    logger.info("%s Chunking %d chars into %d chunks (parallel)", log_prefix, len(text), len(chunks))

    t0 = time.monotonic()
    tasks = [
        _summarize_single(
            chunk,
            f"{system_prompt}\n\n这是{content_type}的第 {i}/{len(chunks)} 部分。",
            model=model,
            semaphore=semaphore,
            log_prefix=log_prefix,
        )
        for i, chunk in enumerate(chunks, 1)
    ]
    summaries = await asyncio.gather(*tasks)
    logger.info("%s Parallel chunk summarization took %.1fs for %d chunks", log_prefix, time.monotonic() - t0, len(chunks))

    combined = "\n\n---\n\n".join(
        f"## 第 {i} 部分\n\n{s}" for i, s in enumerate(summaries, 1)
    )
    merge_prompt = MERGE_PROMPT_TEMPLATE.format(content_type=content_type)
    t1 = time.monotonic()
    merge_system = f"{merge_prompt}\n\n原始要求：{system_prompt}"
    result = await _summarize_single(combined, merge_system, model=model, semaphore=semaphore, log_prefix=log_prefix)
    logger.info("%s Merge step took %.1fs", log_prefix, time.monotonic() - t1)
    return result


async def _summarize_with_chunking(
    text: str,
    system_prompt: str,
    model: str | None = None,
    content_type: str = "视频",
    semaphore: asyncio.Semaphore | None = None,
    log_prefix: str = "[llm]",
) -> str:
    """Summarize text, chunking first if it exceeds the threshold."""
    if len(text) <= CHUNK_CHAR_THRESHOLD:
        return await _summarize_single(text, system_prompt, model=model, semaphore=semaphore, log_prefix=log_prefix)
    return await _chunk_and_merge(text, system_prompt, model=model, content_type=content_type, semaphore=semaphore, log_prefix=log_prefix)


async def _cascade_single(
    input_text: str,
    level: str,
    cascade_prompts: dict[str, str],
    model: str | None = None,
    content_type: str = "视频",
    semaphore: asyncio.Semaphore | None = None,
    log_prefix: str = "[llm]",
) -> str:
    """Generate one cascade level. 'full' and 'detailed' may need chunking."""
    if level in ("full", "detailed"):
        return await _summarize_with_chunking(
            input_text, cascade_prompts[level], model=model,
            content_type=content_type, semaphore=semaphore, log_prefix=log_prefix,
        )
    return await _summarize_single(
        input_text, cascade_prompts[level], model=model,
        semaphore=semaphore, log_prefix=log_prefix,
    )
