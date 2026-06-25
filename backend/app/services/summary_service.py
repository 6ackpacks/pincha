import asyncio
import json
import logging
import time
import uuid

import redis.asyncio as aioredis
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.summary import Summary
from app.models.transcript import Transcript
from app.schemas.summary import SummaryLevel
from app.services.summarization_engine import (
    CHUNK_CHAR_THRESHOLD,
    _cascade_single as _engine_cascade_single,
    _chunk_and_merge as _engine_chunk_and_merge,
    _summarize_single as _engine_summarize_single,
    _summarize_with_chunking as _engine_summarize_with_chunking,
    wrap_user_content,
    _INJECTION_GUARD_SUFFIX,
)
from app.core.llm import llm_client
from app.services.summary_pipeline_v2 import (
    generate_fast_summaries_v2,
    generate_full_clean_v2,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hierarchical summarization thresholds
# ---------------------------------------------------------------------------
HIERARCHICAL_CHAR_THRESHOLD = 20_000   # Enable hierarchical when text > 20K chars
HIERARCHICAL_SEGMENT_THRESHOLD = 300   # Enable hierarchical when segments > 300

# Concurrency limiter for LLM calls to avoid upstream 429 rate-limiting.
_llm_semaphore = asyncio.Semaphore(9)

# Concurrency limiter for hierarchical group processing.
# Limits simultaneous Redis connections + memory from concurrent LLM responses.
_group_semaphore = asyncio.Semaphore(5)


def _get_redis_pool() -> aioredis.Redis:
    """Create a Redis client backed by a bounded connection pool.

    This avoids creating unbounded connections when called concurrently.
    The pool limits max connections to prevent memory/FD exhaustion on
    small containers (e.g., Zeabur K3s 512MB-1GB pods).
    """
    pool = aioredis.ConnectionPool.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        max_connections=10,
    )
    return aioredis.Redis(connection_pool=pool)

# Cascade order: raw transcript → full → detailed → highlight → express
# Each level is generated from the PREVIOUS level's output (except full, which uses raw transcript).
CASCADE_ORDER: list[SummaryLevel] = ["full", "detailed", "highlight", "express"]

# ---------------------------------------------------------------------------
# Prompts for independent single-level generation (backward compat / regenerate)
# ---------------------------------------------------------------------------
LEVEL_PROMPTS: dict[str, str] = {
    "express": (
        "你是一位视频内容分析师。请用极高信息密度概括这个视频，让读者 30 秒内判断是否值得观看。\n"
        "【前置判断】如果字幕内容极短（<100字）或不含实质观点（纯搞笑/闲聊/测试片段），"
        "诚实输出「- **内容类型**：[一词概括]」+「- 无实质信息可提取」后停止，不要硬凑。\n"
        "【任务】写出 3-5 条一句话判断，每条回答一个问题：这个视频最值得记住的是什么？\n"
        "【格式】直接输出无序列表（-），每条不超过 25 字，**加粗**最关键的词。不要标题、不要导语。\n"
        "【重要】无论原始字幕是什么语言，输出必须全程使用中文。"
    ),
    "highlight": (
        "你是一位视频内容分析师。请提取这个视频中最有价值的洞见，形成一份可以直接引用的精华笔记。\n"
        "【任务】不要罗列话题，要提炼洞见（例：不要写「视频讨论了 A 和 B」，要写「A 优于 B 因为 C」）。\n"
        "包含所有关键数据、结论和可操作建议，但不需要论证过程。\n"
        "【格式】3-5 个主题区块，每个用 ### 标题，下方 2-4 句话提炼核心洞见。\n"
        "关键数据用 **加粗**，总篇幅 300-500 字。\n"
        "【重要】无论原始字幕是什么语言，输出必须全程使用中文。"
    ),
    "detailed": (
        "你是一位深度内容分析师。请写一篇结构清晰的分析文章，完整呈现视频的论证逻辑。\n"
        "【任务】不只列要点——要呈现「观点→论据→推理→结论」的完整链条。\n"
        "保留所有主要论点、支撑论据、关键案例、数据对比和方法论。去除闲聊和重复。\n"
        "【格式】使用 ## 二级标题划分主题，每个主题下：\n"
        "- 先用 1-2 句话概括核心观点\n"
        "- 再用要点列表（-）展开论据和案例\n"
        "- 数据和关键引述用 **加粗** 或 > 引用块标注\n"
        "【重要】无论原始字幕是什么语言，输出必须全程使用中文。"
    ),
    "full": (
        "你是一位专业文字编辑。以下内容来自语音识别（STT）生成的视频逐字稿，可能含有识别错误、缺少标点、口头填充语。\n"
        "【唯一任务】对原文做最小限度的清洗，还原讲者的完整表达。输出长度应与原文接近——这不是总结。\n"
        "【只允许】去除填充语（嗯啊那个就是说）、修正语音识别错误、补充标点、合并卡壳重复、话题切换处加标题和换行\n"
        "【严格禁止】省略/压缩/合并任何实质内容；改写讲者措辞；重新排序；添加原文没有的概括句\n"
        "【格式】## 二级标题（标题词语来自原文）、关键数据 **加粗**、段落间空行\n"
        "【重要】无论原始字幕是什么语言，输出必须全程使用中文。"
    ),
}

# ---------------------------------------------------------------------------
# Prompts for hierarchical/cascading generation
# Cascade: raw transcript → full → detailed → highlight → express
# Each level is a DIFFERENT cognitive task, not just a shorter version.
# ---------------------------------------------------------------------------
CASCADE_PROMPTS: dict[str, str] = {
    # full: 逐字稿 → 清洁版完整文稿（清洗任务，非总结/重组）
    "full": (
        "你是一位专业文字编辑。以下内容来自语音识别（STT）生成的视频逐字稿，可能含有识别错误、缺少标点、口头填充语。\n\n"
        "【你的唯一任务】对原文做最小限度的清洗，还原讲者的完整表达。\n"
        "输出篇幅必须不低于原文字数的 80%——这是清洗，不是总结，不是改写，不是重组。\n\n"
        "【只允许做以下操作】\n"
        "1. 去除口头填充语：嗯、啊、那个、就是说、对对对、然后然后、这个这个 等\n"
        "2. 修正明显的语音识别错误（如同音字错误、缺字漏字）\n"
        "3. 补充缺失的标点符号（逗号、句号、问号）\n"
        "4. 将卡壳重复（如「我觉得我觉得」）合并为一次\n"
        "5. 在话题自然切换处添加段落换行和 ## 二级标题\n\n"
        "【严格禁止】\n"
        "- 禁止省略、压缩或合并任何实质性内容\n"
        "- 禁止改写、润色或替换讲者的原有措辞\n"
        "- 禁止删除任何论点、案例、故事、数据、类比或个人观点\n"
        "- 禁止重新排序（保持原始讲述顺序）\n"
        "- 禁止添加原文没有的概括句或过渡句\n"
        "- 禁止因为觉得内容重复就删除段落——讲者的重复本身是内容\n\n"
        "【格式】\n"
        "- 话题切换处使用 ## 二级标题（标题词语来自原文，不要自创）\n"
        "- 关键数据和专业术语用 **加粗**\n"
        "- 段落间保留空行\n\n"
        "【输出前自查】\n"
        "1. 输出字数是否达到原文的 80% 以上？如果没有，补充被遗漏的段落。\n"
        "2. 是否有任何完整的话题段落被跳过？如果有，请补全。\n\n"
        "【语言要求】无论原始字幕是什么语言（包括英文），输出必须全程使用中文翻译呈现。"
    ),

    # detailed: 视频逐字稿 → 深度分析文章（保留论证链，去除次要内容）
    "detailed": (
        "你是一位深度内容分析师。以下是一个视频的逐字稿（可能包含口语化表达和重复）。\n"
        "请将其改写为一篇深度分析文章，重点呈现视频的核心论证逻辑。\n\n"
        "【你的任务】\n"
        "不是简单删减——是重新组织为「观点 → 论据 → 推理 → 结论」的分析框架。\n"
        "保留所有主要论点及其最有力的论据，去除次要话题、重复论述和过渡性内容。\n\n"
        "【必须保留】\n"
        "- 每个核心论点及其 1-2 个最有力的支撑论据\n"
        "- 关键数据对比和统计数字\n"
        "- 最具说服力的案例（每个论点保留最佳案例）\n"
        "- 实操建议和方法论\n"
        "- 有争议或反直觉的观点\n\n"
        "【可以去除】\n"
        "- 重复论证同一观点的多个相似案例（保留最佳，去除其余）\n"
        "- 背景铺垫和过渡段落\n"
        "- 次要的补充说明\n\n"
        "【输出格式】\n"
        "- ## 二级标题划分主题\n"
        "- 每个主题开头用 1-2 句话概括核心观点\n"
        "- 用要点列表（-）展开论据、案例和数据\n"
        "- 数据和关键引述用 **加粗** 标注\n"
        "- 如有争议或对比，使用表格或对比列表呈现\n\n"
        "【语言要求】无论原始字幕是什么语言（包括英文），输出必须全程使用中文翻译呈现。"
    ),

    # highlight: 详细解读 → 精华洞见笔记（提炼洞见，非罗列话题）
    "highlight": (
        "你是一位知识提炼专家。以下是一篇视频的详细分析。\n"
        "请从中提取最有价值的洞见，写成一份可以直接分享给同事的精华笔记。\n\n"
        "【关键区别】\n"
        "不要罗列「视频讲了什么话题」——要提炼「我从中学到了什么洞见」。\n"
        "错误示例：「视频讨论了 AI 在医疗中的应用」\n"
        "正确示例：「AI 诊断皮肤癌的准确率已达 **95%**，超过普通皮肤科医生的 87%」\n\n"
        "【你的任务】\n"
        "提取 4-6 个最值得记住的洞见，每个洞见需要：\n"
        "- 一个清晰的结论或发现（不是话题标签）\n"
        "- 支撑这个结论的最关键证据（1-2 句）\n"
        "- 如果有的话，附上可操作的建议\n\n"
        "【输出格式】\n"
        "- 每个洞见用 ### 三级标题（标题本身就是洞见结论，不是话题名）\n"
        "- 标题下 2-4 句话展开\n"
        "- 关键数据用 **加粗**\n"
        "- 总篇幅 400-600 字\n\n"
        "【语言要求】无论原始字幕是什么语言（包括英文），输出必须全程使用中文翻译呈现。"
    ),

    # express: 精华摘要 → 极速判断（决策辅助，非内容缩写）
    "express": (
        "你是一位内容策展人。以下是一篇视频的精华笔记。\n"
        "请写出 3-5 条极简要点，帮助读者在 30 秒内判断这个视频是否值得深入阅读。\n\n"
        "【前置判断】\n"
        "先判断输入内容的信息密度。如果内容极短（<100字）或不含任何实质性观点/知识/结论"
        "（如纯闲聊、搞笑片段、重复无意义内容），请诚实输出：\n"
        "- **内容类型**：[搞笑/闲聊/片段/测试]（一词概括）\n"
        "- 无实质信息可提取\n"
        "然后停止，不要硬凑洞见。\n\n"
        "【正常任务】（仅当内容有实质信息时执行）\n"
        "每条要点回答一个问题：「如果只能记住一件事，应该记住什么？」\n"
        "写的是判断和结论，不是内容描述。\n"
        "错误示例：「视频介绍了三种投资策略」\n"
        "正确示例：「**指数基金**长期回报跑赢 90% 的主动管理基金」\n\n"
        "【输出格式】\n"
        "- 直接输出无序列表（-），不要标题、不要导语、不要总结语\n"
        "- 每条不超过 25 个中文字\n"
        "- **加粗**每条中最关键的词\n"
        "- 如果内容有明确的「一句话结论」，放在第一条\n\n"
        "【语言要求】无论原始字幕是什么语言（包括英文），输出必须全程使用中文翻译呈现。"
    ),
}

async def _summarize_single(text: str, system_prompt: str, model: str | None = None) -> str:
    """Call LiteLLM for a single summarization request (with video semaphore)."""
    return await _engine_summarize_single(
        text, system_prompt, model=model,
        semaphore=_llm_semaphore, log_prefix="[llm]",
    )


async def _chunk_and_merge(text: str, system_prompt: str, model: str | None = None) -> str:
    """Split text into chunks, summarize in parallel, then merge."""
    return await _engine_chunk_and_merge(
        text, system_prompt, model=model,
        content_type="视频", semaphore=_llm_semaphore, log_prefix="[llm]",
    )


async def _summarize_with_chunking(text: str, system_prompt: str, model: str | None = None) -> str:
    """Summarize text, chunking first if it exceeds the threshold."""
    return await _engine_summarize_with_chunking(
        text, system_prompt, model=model,
        content_type="视频", semaphore=_llm_semaphore, log_prefix="[llm]",
    )


async def generate_summary(transcript_text: str, level: SummaryLevel) -> str:
    """Generate a single summary level from raw transcript (backward compat)."""
    return await _summarize_with_chunking(transcript_text, LEVEL_PROMPTS[level])


async def _cascade_single(input_text: str, level: SummaryLevel, model: str | None = None) -> str:
    """Generate one cascade level. 'full' and 'detailed' may need chunking."""
    return await _engine_cascade_single(
        input_text, level, CASCADE_PROMPTS, model=model,
        content_type="视频", semaphore=_llm_semaphore, log_prefix="[llm]",
    )


# ---------------------------------------------------------------------------
# Hierarchical summarization: split long transcripts into time-based groups,
# summarize each group concurrently, then merge into a final coherent summary.
# ---------------------------------------------------------------------------


def _format_time(seconds: float) -> str:
    """Convert seconds to MM:SS or HH:MM:SS format."""
    seconds = int(seconds)
    if seconds >= 3600:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        s = seconds % 60
        return f"{h}:{m:02d}:{s:02d}"
    m = seconds // 60
    s = seconds % 60
    return f"{m}:{s:02d}"


def _split_into_time_groups(
    segments: list[dict], group_duration_seconds: int = 120
) -> list[list[dict]]:
    """Split subtitle segments into time-based groups of ~2 minutes each."""
    if not segments:
        return []

    groups: list[list[dict]] = []
    current_group: list[dict] = []
    group_start = segments[0].get("start", 0)

    for seg in segments:
        seg_start = seg.get("start", 0)
        if seg_start - group_start >= group_duration_seconds and current_group:
            groups.append(current_group)
            current_group = [seg]
            group_start = seg_start
        else:
            current_group.append(seg)

    if current_group:
        groups.append(current_group)

    return groups


async def _summarize_group(
    group: list[dict], video_id: uuid.UUID, group_idx: int, total_groups: int,
    redis_client: aioredis.Redis | None = None,
) -> dict:
    """Summarize a single time-based group and publish progress via Redis.

    Args:
        redis_client: Shared Redis connection (from caller). If None, creates
            and closes its own connection (backward compat).
    """
    # Gate overall group concurrency to limit memory + Redis connections
    async with _group_semaphore:
        text = " ".join([seg.get("text", "") for seg in group])
        start_time = group[0].get("start", 0)
        end_time = group[-1].get("end", group[-1].get("start", 0))

        system_prompt = (
            "你是一位视频片段摘要助手。请用 2-3 句话概括以下视频片段的核心内容。\n"
            "要求：提炼关键观点和结论，不要罗列话题。\n"
            "输出 JSON 格式：{\"title\": \"一句话标题\", \"summary\": \"2-3句核心内容\", \"keywords\": [\"关键词1\", \"关键词2\"]}\n"
            + _INJECTION_GUARD_SUFFIX
        )

        user_message = wrap_user_content(text[:5000])

        async with _llm_semaphore:
            content = await llm_client().complete(
                model=settings.FAST_SUMMARY_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                response_format={"type": "json_object"},
            )

        try:
            result = json.loads(content) if content else {}
        except (json.JSONDecodeError, TypeError):
            logger.warning("[hierarchical:%s] Group %d JSON parse failed, using fallback", video_id, group_idx + 1)
            result = {"title": f"Segment {group_idx + 1}", "summary": content or "", "keywords": []}
        result["start_time"] = _format_time(start_time)
        result["end_time"] = _format_time(end_time)

        # Publish progress using shared Redis connection
        try:
            r = redis_client or aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            await r.publish(f"video:{video_id}:summary_stream", json.dumps({
                "type": "delta",
                "level": "detailed",
                "delta": f"\n\n**[{result['start_time']}-{result['end_time']}] {result.get('title', '')}**\n{result.get('summary', '')}\n",
            }))
        except Exception as pub_exc:
            logger.warning("[hierarchical:%s] Failed to publish group progress: %s", video_id, pub_exc)
        finally:
            # Only close if we created our own connection
            if redis_client is None and 'r' in locals():
                await r.close()

        # Release reference to text/messages to help GC in concurrent scenarios
        del text, user_message

        logger.info(
            "[hierarchical:%s] Group %d/%d done [%s-%s]: %s",
            video_id, group_idx + 1, total_groups,
            result["start_time"], result["end_time"], result.get("title", ""),
        )
        return result


async def _stream_final_summary(
    merged_input: str, video_id: uuid.UUID, level: str
) -> str:
    """Merge group summaries into a coherent final summary with streaming output."""
    r = _get_redis_pool()

    system_prompt = (
        "你是一位视频内容分析师。以下是视频各时间段的摘要。\n"
        "请将它们整合为一篇连贯、结构化的详细笔记。\n"
        "要求：\n"
        "- 使用 ## 二级标题分区\n"
        "- 提炼核心洞见，不要重复罗列\n"
        "- 保持逻辑连贯，像是一篇完整的分析文章\n"
        "- 保留关键数据和案例\n"
        "- 无论原文语言，输出使用中文"
        + _INJECTION_GUARD_SUFFIX
    )

    user_message = wrap_user_content(merged_input)

    full_content = ""
    try:
        # Notify frontend that merging phase has started
        try:
            await r.publish(f"video:{video_id}:summary_stream", json.dumps({
                "type": "delta",
                "level": level,
                "delta": "\n\n---\n\n*正在整合为完整笔记...*\n\n",
            }))
        except Exception:
            pass

        async with _llm_semaphore:
            async for delta in llm_client().stream(
                model=settings.FAST_SUMMARY_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
            ):
                if delta:
                    full_content += delta
                    try:
                        await r.publish(f"video:{video_id}:summary_stream", json.dumps({
                            "type": "delta",
                            "level": level,
                            "delta": delta,
                        }))
                    except Exception:
                        pass
    finally:
        await r.close()

    return full_content


async def _hierarchical_summarize(
    transcript_text: str, segments: list[dict], video_id: uuid.UUID, level: str
) -> str:
    """Hierarchical summarization: group by time, summarize concurrently, merge with streaming.

    Strategy:
    1. Split segments into ~2-minute time groups
    2. Concurrently summarize each group (publishes incremental progress)
       - Concurrency limited by _group_semaphore (max 5 simultaneous)
       - Single shared Redis connection for all group progress publishing
    3. Stream-merge all group summaries into a coherent final summary

    This reduces total latency from 4-5 min to 30-60 sec for long transcripts
    because group summaries run in parallel and each is small enough to be fast.
    """
    t0 = time.monotonic()

    # Step 1: Split into time-based groups
    groups = _split_into_time_groups(segments, group_duration_seconds=120)
    logger.info(
        "[hierarchical:%s] Starting: %d chars, %d segments -> %d groups",
        video_id, len(transcript_text), len(segments), len(groups),
    )

    # Step 2: Summarize all groups with bounded concurrency and shared Redis
    # Use a single pooled Redis connection for all group progress publishing
    shared_redis = _get_redis_pool()
    try:
        group_summaries = await asyncio.gather(*[
            _summarize_group(group, video_id, group_idx, len(groups), redis_client=shared_redis)
            for group_idx, group in enumerate(groups)
        ])
    finally:
        await shared_redis.close()

    # Step 3: Build merged input from all group summaries
    merged_input = "\n\n".join([
        f"[{gs['start_time']}-{gs['end_time']}] {gs.get('title', '')}\n{gs.get('summary', '')}"
        for gs in group_summaries
    ])

    # Release reference to large data structures before final merge
    del group_summaries

    logger.info(
        "[hierarchical:%s] Group phase done in %.1fs, merging",
        video_id, time.monotonic() - t0,
    )

    # Step 4: Stream-generate the final coherent summary
    final_summary = await _stream_final_summary(merged_input, video_id, level)

    logger.info(
        "[hierarchical:%s] Complete in %.1fs, output %d chars",
        video_id, time.monotonic() - t0, len(final_summary),
    )
    return final_summary


async def generate_all_summaries(transcript_text: str) -> dict[str, str]:
    """Generate all 4 summary levels in cascade order.

    Cascade: raw transcript -> full(90%) -> detailed(60%) -> highlight(30%) -> express(5%)

    Each level is generated from the previous level's output (rolling context pattern,
    inspired by tldw the-crypt-keeper). This is faster, cheaper, and produces more
    consistent results than generating each level independently from the raw transcript.

    Compression ratios are logged for quality monitoring.

    Returns:
        dict mapping level name to generated content, e.g.
        {"full": "...", "detailed": "...", "highlight": "...", "express": "..."}
    """
    results: dict[str, str] = {}
    current_input = transcript_text
    source_len = len(transcript_text)

    logger.info(
        "Cascade start: raw transcript %d chars | levels: %s",
        source_len,
        " -> ".join(CASCADE_ORDER),
    )

    for level in CASCADE_ORDER:
        input_len = len(current_input)
        logger.info("Cascade [%s]: input %d chars (%.0f%% of source)", level, input_len, input_len / source_len * 100)
        content = await _cascade_single(current_input, level)
        output_len = len(content)
        ratio = output_len / input_len * 100 if input_len else 0
        logger.info(
            "Cascade [%s]: output %d chars (%.0f%% of input, %.0f%% of source)",
            level, output_len, ratio, output_len / source_len * 100,
        )
        results[level] = content
        # Each level's output feeds into the next (rolling context cascade)
        current_input = content

    logger.info(
        "Cascade complete: source %d -> express %d chars (%.1fx compression)",
        source_len, len(results.get("express", "")),
        source_len / max(len(results.get("express", "x")), 1),
    )
    return results


async def _fetch_transcript_text(db: AsyncSession, video_id: uuid.UUID) -> str:
    """Fetch only the full_text column for a video's transcript.

    This function is a pure data-access helper — it does NOT check video state.
    Callers in the route layer should validate video status before calling this
    (see :func:`app.api.v1.summaries._check_transcript_ready`).
    """
    result = await db.execute(
        select(Transcript.full_text).where(Transcript.video_id == video_id)
    )
    full_text = result.scalar_one_or_none()
    if full_text is None:
        raise HTTPException(status_code=404, detail="Transcript not found for this video")
    if not full_text:
        raise HTTPException(status_code=404, detail="Transcript has no full text content")
    return full_text


async def get_or_create_summary(
    db: AsyncSession, video_id: uuid.UUID, level: SummaryLevel
) -> tuple[Summary, bool]:
    """Return (summary, cached). If cached, cached=True."""
    # Check cache
    result = await db.execute(
        select(Summary).where(Summary.video_id == video_id, Summary.level == level)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, True

    # Generate
    transcript_text = await _fetch_transcript_text(db, video_id)
    content = await generate_summary(transcript_text, level)

    # Insert with ON CONFLICT DO NOTHING to handle concurrent requests
    stmt = (
        pg_insert(Summary)
        .values(
            video_id=video_id,
            level=level,
            content=content,
            model_used=settings.SUMMARY_MODEL,
        )
        .on_conflict_do_nothing(constraint="uq_summaries_video_level")
    )
    await db.execute(stmt)
    await db.commit()

    # Re-fetch to get the row (ours or the concurrent winner's)
    result = await db.execute(
        select(Summary).where(Summary.video_id == video_id, Summary.level == level)
    )
    summary = result.scalar_one()
    return summary, False


# Fast cascade: raw → full → highlight → express
# full is generated first to clean the transcript, then highlight/express cascade from it.
# detailed is skipped here and generated in the background by generate_deep_summaries.
FAST_CASCADE_ORDER: list[SummaryLevel] = ["detailed", "highlight", "express"]


async def _publish_summary_event(video_id: uuid.UUID, event_type: str, data: dict) -> None:
    """Publish a summary event to Redis Pub/Sub for SSE subscribers.

    Uses a pooled Redis connection with bounded max_connections to avoid
    connection leaks when called from Celery tasks via asyncio.run().
    """
    redis = _get_redis_pool()
    try:
        payload = json.dumps({"type": event_type, **data})
        await redis.publish(f"video:{video_id}:summary_stream", payload)
    finally:
        await redis.close()


async def _stream_cascade_single(
    input_text: str, level: str, video_id: uuid.UUID, model: str | None = None
) -> str:
    """Generate one cascade level with streaming, publishing tokens to Redis in real-time.

    Uses a pooled Redis connection to avoid connection leaks when called
    from Celery tasks via asyncio.run() (which creates a new loop).
    """

    if len(input_text) <= CHUNK_CHAR_THRESHOLD:
        redis = _get_redis_pool()
        try:
            channel = f"video:{video_id}:summary_stream"
            system_prompt = CASCADE_PROMPTS[level] + _INJECTION_GUARD_SUFFIX

            full_content = ""
            async with _llm_semaphore:
                async for delta in llm_client().stream(
                    model=model or settings.FAST_SUMMARY_MODEL,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": wrap_user_content(input_text)},
                    ],
                ):
                    if delta:
                        full_content += delta
                        try:
                            await redis.publish(channel, json.dumps({
                                "type": "delta", "level": level, "delta": delta,
                            }))
                        except Exception:
                            pass
            return full_content
        finally:
            await redis.close()

    # Fallback to non-streaming for chunked text
    return await _cascade_single(input_text, level, model=model)


async def _fetch_transcript_segments(db: AsyncSession, video_id: uuid.UUID) -> list[dict]:
    """Fetch the segments JSONB column for a video's transcript."""
    result = await db.execute(
        select(Transcript.segments).where(Transcript.video_id == video_id)
    )
    segments = result.scalar_one_or_none()
    return segments or []


def _should_use_hierarchical(transcript_text: str, segments: list[dict]) -> bool:
    """Determine whether hierarchical summarization should be used."""
    return (
        len(transcript_text) > HIERARCHICAL_CHAR_THRESHOLD
        or len(segments) > HIERARCHICAL_SEGMENT_THRESHOLD
    )


async def generate_and_store_fast_summaries(
    db: AsyncSession, video_id: uuid.UUID
) -> list[Summary]:
    """Generate detailed + highlight + express via v2 pipeline (parallel).

    New flow: split → parallel chunk summaries → parallel 3-level merge.
    """
    transcript_text = await _fetch_transcript_text(db, video_id)
    source_len = len(transcript_text)

    # Authoritative generation_id for this round — threaded through every
    # published event so the frontend can discard stale-round deltas.
    generation_id = str(uuid.uuid4())

    logger.info(
        "[summary:%s] V2 pipeline start: %d chars, generation_id=%s",
        video_id, source_len, generation_id,
    )
    t_start = time.monotonic()

    # Use the new v2 pipeline
    from app.services.summary_pipeline_v2 import publish_fail_count_var
    results = await generate_fast_summaries_v2(
        transcript_text, semaphore=_llm_semaphore,
        video_id=video_id, generation_id=generation_id,
    )

    logger.info(
        "[summary:%s] V2 pipeline complete in %.1fs: %s",
        video_id, time.monotonic() - t_start,
        {k: len(v) for k, v in results.items()},
    )

    # Store all levels
    for level, content in results.items():
        stmt = (
            pg_insert(Summary)
            .values(
                video_id=video_id,
                level=level,
                content=content,
                model_used=settings.FAST_SUMMARY_MODEL,
            )
            .on_conflict_do_update(
                constraint="uq_summaries_video_level",
                set_={"content": content, "model_used": settings.FAST_SUMMARY_MODEL},
            )
        )
        await db.execute(stmt)
        await db.commit()
        await _publish_summary_event(video_id, "level_ready", {"level": level})

    await _publish_summary_event(video_id, "done", {"levels": list(results.keys())})

    # Reconciliation: summary is persisted above, but some delta publishes may
    # have failed mid-stream. Warn so a "successful" task with a silent stream
    # gap is visible in logs.
    fail_count = publish_fail_count_var.get()
    if fail_count > 0:
        logger.warning(
            "[summary:%s] persisted OK but generation_id=%s had publish_fail_count=%d "
            "delta publish failures — frontend may rely on snapshot/poll fallback",
            video_id, generation_id, fail_count,
        )

    result = await db.execute(
        select(Summary).where(
            Summary.video_id == video_id,
            Summary.level.in_(["detailed", "highlight", "express"]),
        )
    )
    return list(result.scalars().all())


async def generate_and_store_full_summary(
    db: AsyncSession, video_id: uuid.UUID
) -> Summary:
    """Generate full (cleaned transcript) on-demand via v2 pipeline."""
    transcript_text = await _fetch_transcript_text(db, video_id)
    t0 = time.monotonic()
    logger.info("[summary:%s] On-demand full generation start: %d chars", video_id, len(transcript_text))

    content = await generate_full_clean_v2(transcript_text, semaphore=_llm_semaphore, video_id=video_id)

    logger.info("[summary:%s] On-demand full generation complete in %.1fs", video_id, time.monotonic() - t0)
    stmt = (
        pg_insert(Summary)
        .values(video_id=video_id, level="full", content=content, model_used=settings.DEEP_SUMMARY_MODEL)
        .on_conflict_do_update(
            constraint="uq_summaries_video_level",
            set_={"content": content, "model_used": settings.DEEP_SUMMARY_MODEL},
        )
    )
    await db.execute(stmt)
    await db.commit()
    result = await db.execute(
        select(Summary).where(Summary.video_id == video_id, Summary.level == "full")
    )
    return result.scalar_one()


async def generate_all_summaries_and_store(
    db: AsyncSession, video_id: uuid.UUID
) -> list[Summary]:
    """Generate all 4 summary levels via cascade and store them in DB.

    This is the preferred entry point for the video pipeline.
    It fetches the transcript, runs hierarchical summarization, and upserts
    all 4 summaries in one go.

    Returns:
        List of Summary ORM objects (all 4 levels).
    """
    transcript_text = await _fetch_transcript_text(db, video_id)
    all_content = await generate_all_summaries(transcript_text)

    for level, content in all_content.items():
        stmt = (
            pg_insert(Summary)
            .values(
                video_id=video_id,
                level=level,
                content=content,
                model_used=settings.SUMMARY_MODEL,
            )
            .on_conflict_do_update(
                constraint="uq_summaries_video_level",
                set_={"content": content, "model_used": settings.SUMMARY_MODEL},
            )
        )
        await db.execute(stmt)

    await db.commit()

    # Fetch all 4 summaries as ORM objects
    result = await db.execute(
        select(Summary).where(Summary.video_id == video_id)
    )
    return list(result.scalars().all())


async def regenerate_summary(
    db: AsyncSession, video_id: uuid.UUID, level: SummaryLevel
) -> Summary:
    """Force regenerate summary, overwriting cache via upsert."""
    transcript_text = await _fetch_transcript_text(db, video_id)
    content = await generate_summary(transcript_text, level)

    # Upsert: INSERT ... ON CONFLICT DO UPDATE
    stmt = (
        pg_insert(Summary)
        .values(
            video_id=video_id,
            level=level,
            content=content,
            model_used=settings.SUMMARY_MODEL,
        )
        .on_conflict_do_update(
            constraint="uq_summaries_video_level",
            set_={"content": content, "model_used": settings.SUMMARY_MODEL},
        )
    )
    await db.execute(stmt)
    await db.commit()

    # Fetch the ORM object
    result = await db.execute(
        select(Summary).where(Summary.video_id == video_id, Summary.level == level)
    )
    return result.scalar_one()


async def stream_generate_summary(transcript_text: str, level: SummaryLevel):
    """Yield content deltas for streaming summary regeneration.

    For short texts, streams directly from LLM. For long texts that require
    chunking, falls back to non-streaming (yields full content at once).
    """
    if len(transcript_text) > CHUNK_CHAR_THRESHOLD:
        # Chunked summarization is multi-step and cannot be streamed incrementally.
        # Fall back to generating the full content and yielding it in one piece.
        content = await _chunk_and_merge(transcript_text, LEVEL_PROMPTS[level])
        yield content
        return

    system_prompt = LEVEL_PROMPTS[level] + _INJECTION_GUARD_SUFFIX
    async with _llm_semaphore:
        async for delta in llm_client().stream(
            model=settings.SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": wrap_user_content(transcript_text)},
            ],
        ):
            if delta:
                yield delta


async def save_regenerated_summary(
    db: AsyncSession, video_id: uuid.UUID, level: SummaryLevel, content: str
) -> Summary:
    """Save a regenerated summary to DB (used after streaming completes)."""
    stmt = (
        pg_insert(Summary)
        .values(
            video_id=video_id,
            level=level,
            content=content,
            model_used=settings.SUMMARY_MODEL,
        )
        .on_conflict_do_update(
            constraint="uq_summaries_video_level",
            set_={"content": content, "model_used": settings.SUMMARY_MODEL},
        )
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(Summary).where(Summary.video_id == video_id, Summary.level == level)
    )
    return result.scalar_one()


async def get_best_summary_content(
    db: AsyncSession, video_id: uuid.UUID
) -> str | None:
    """Return the best available summary content for a video (highlight > detailed > full).

    Returns None if no summary exists. Used by other services that need summary
    text without importing the Summary model directly.
    """
    for level in ("highlight", "detailed", "full"):
        result = await db.execute(
            select(Summary.content).where(
                Summary.video_id == video_id, Summary.level == level
            )
        )
        content = result.scalar_one_or_none()
        if content:
            return content
    return None
