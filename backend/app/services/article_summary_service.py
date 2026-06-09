"""Article summary service — cascade summarization for blog/article content.

Reuses the same cascade pattern as video summaries but with article-specific prompts
(no timestamp references, treats input as written text rather than speech transcript).
"""

import logging
import time
import uuid
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.article import Article, ArticleSummary
from app.services.summarization_engine import (
    _cascade_single as _engine_cascade_single,
    _summarize_with_chunking as _engine_summarize_with_chunking,
)

logger = logging.getLogger(__name__)

ArticleSummaryLevel = Literal["express", "highlight", "detailed", "full"]

FAST_CASCADE_ORDER: list[ArticleSummaryLevel] = ["detailed", "highlight", "express"]

CASCADE_PROMPTS: dict[str, str] = {
    "full": (
        "你是一位专业文字编辑。以下是一篇网络文章的全文内容。\n\n"
        "【你的任务】对原文做最小限度的清洗和格式化，保留文章的完整信息。\n"
        "输出篇幅必须不低于原文的 80%——这是格式整理，不是总结。\n\n"
        "【只允许做以下操作】\n"
        "1. 修正明显的格式错误和排版问题\n"
        "2. 补充缺失的标点符号\n"
        "3. 在段落切换处添加适当的分隔和标题\n\n"
        "【严格禁止】\n"
        "- 省略、压缩或合并任何实质性内容\n"
        "- 改写或替换作者的原有措辞\n"
        "- 重新排序内容\n\n"
        "【格式】## 二级标题划分主题、关键数据 **加粗**、段落间空行\n"
        "【语言要求】无论原文是什么语言，输出必须全程使用中文。"
    ),
    "detailed": (
        "你是一位深度内容分析师。以下是一篇文章的全文。\n"
        "请将其改写为一篇深度分析，重点呈现文章的核心论证逻辑。\n\n"
        "【你的任务】\n"
        "重新组织为「观点 → 论据 → 推理 → 结论」的分析框架。\n"
        "保留所有主要论点及其最有力的论据，去除次要话题和重复论述。\n\n"
        "【必须保留】\n"
        "- 每个核心论点及其 1-2 个最有力的支撑论据\n"
        "- 关键数据对比和统计数字\n"
        "- 最具说服力的案例\n"
        "- 实操建议和方法论\n"
        "- 有争议或反直觉的观点\n\n"
        "【输出格式】\n"
        "- ## 二级标题划分主题\n"
        "- 每个主题开头用 1-2 句话概括核心观点\n"
        "- 用要点列表（-）展开论据、案例和数据\n"
        "- 数据和关键引述用 **加粗** 标注\n\n"
        "【语言要求】无论原文是什么语言，输出必须全程使用中文。"
    ),
    "highlight": (
        "你是一位知识提炼专家。以下是一篇文章的详细分析。\n"
        "请从中提取最有价值的洞见，写成一份可以直接分享的精华笔记。\n\n"
        "【关键区别】\n"
        "不要罗列「文章讲了什么话题」——要提炼「我从中学到了什么洞见」。\n\n"
        "【你的任务】\n"
        "提取 4-6 个最值得记住的洞见，每个洞见需要：\n"
        "- 一个清晰的结论或发现\n"
        "- 支撑这个结论的最关键证据（1-2 句）\n"
        "- 如果有的话，附上可操作的建议\n\n"
        "【输出格式】\n"
        "- 每个洞见用 ### 三级标题（标题本身就是洞见结论）\n"
        "- 标题下 2-4 句话展开\n"
        "- 关键数据用 **加粗**\n"
        "- 总篇幅 400-600 字\n\n"
        "【语言要求】无论原文是什么语言，输出必须全程使用中文。"
    ),
    "express": (
        "你是一位内容策展人。以下是一篇文章的精华笔记。\n"
        "请写出 3-5 条极简要点，帮助读者在 30 秒内判断这篇文章是否值得深入阅读。\n\n"
        "【你的任务】\n"
        "每条要点回答一个问题：「如果只能记住一件事，应该记住什么？」\n\n"
        "【输出格式】\n"
        "- 直接输出无序列表（-），不要标题、不要导语\n"
        "- 每条不超过 25 个中文字\n"
        "- **加粗**每条中最关键的词\n\n"
        "【语言要求】无论原文是什么语言，输出必须全程使用中文。"
    ),
}

LEVEL_PROMPTS = CASCADE_PROMPTS


async def _summarize_with_chunking(text: str, system_prompt: str, model: str | None = None) -> str:
    """Summarize article text, chunking first if it exceeds the threshold."""
    return await _engine_summarize_with_chunking(
        text, system_prompt, model=model,
        content_type="文章", semaphore=None, log_prefix="[article-llm]",
    )


async def _cascade_single(input_text: str, level: ArticleSummaryLevel, model: str | None = None) -> str:
    """Generate one cascade level for an article."""
    return await _engine_cascade_single(
        input_text, level, CASCADE_PROMPTS, model=model,
        content_type="文章", semaphore=None, log_prefix="[article-llm]",
    )


async def _fetch_article_content(db: AsyncSession, article_id: uuid.UUID) -> str:
    result = await db.execute(
        select(Article.content, Article.status).where(Article.id == article_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Article not found")
    content, status = row
    if not content:
        state = status.get("state", "pending") if isinstance(status, dict) else "pending"
        if state in ("pending", "fetching"):
            raise HTTPException(status_code=409, detail=f"Article still processing (state: {state})")
        raise HTTPException(status_code=404, detail="Article content not available")
    return content


async def generate_and_store_fast_summaries(
    db: AsyncSession, article_id: uuid.UUID
) -> list[ArticleSummary]:
    content = await _fetch_article_content(db, article_id)

    results: dict[str, str] = {}
    current_input = content
    source_len = len(content)

    logger.info("[article-summary:%s] Fast cascade start: %d chars", article_id, source_len)
    t_cascade = time.monotonic()

    for level in FAST_CASCADE_ORDER:
        t_level = time.monotonic()
        summary_text = await _cascade_single(current_input, level, model=settings.FAST_SUMMARY_MODEL)
        logger.info("[article-summary:%s] [%s] %d→%d chars in %.1fs",
                     article_id, level, len(current_input), len(summary_text), time.monotonic() - t_level)
        results[level] = summary_text
        current_input = summary_text

    logger.info("[article-summary:%s] Cascade took %.1fs", article_id, time.monotonic() - t_cascade)

    for level, text in results.items():
        stmt = (
            pg_insert(ArticleSummary)
            .values(article_id=article_id, level=level, content=text, model_used=settings.FAST_SUMMARY_MODEL)
            .on_conflict_do_update(
                constraint="uq_article_summaries_article_level",
                set_={"content": text, "model_used": settings.FAST_SUMMARY_MODEL},
            )
        )
        await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(ArticleSummary).where(
            ArticleSummary.article_id == article_id,
            ArticleSummary.level.in_(["detailed", "highlight", "express"]),
        )
    )
    return list(result.scalars().all())


async def generate_and_store_full_summary(
    db: AsyncSession, article_id: uuid.UUID
) -> ArticleSummary:
    content = await _fetch_article_content(db, article_id)
    t0 = time.monotonic()
    summary_text = await _cascade_single(content, "full", model=settings.DEEP_SUMMARY_MODEL)
    logger.info("[article-summary:%s] Full generation in %.1fs", article_id, time.monotonic() - t0)
    stmt = (
        pg_insert(ArticleSummary)
        .values(article_id=article_id, level="full", content=summary_text, model_used=settings.DEEP_SUMMARY_MODEL)
        .on_conflict_do_update(
            constraint="uq_article_summaries_article_level",
            set_={"content": summary_text, "model_used": settings.DEEP_SUMMARY_MODEL},
        )
    )
    await db.execute(stmt)
    await db.commit()
    result = await db.execute(
        select(ArticleSummary).where(ArticleSummary.article_id == article_id, ArticleSummary.level == "full")
    )
    return result.scalar_one()


async def get_or_create_article_summary(
    db: AsyncSession, article_id: uuid.UUID, level: ArticleSummaryLevel
) -> tuple[ArticleSummary, bool]:
    result = await db.execute(
        select(ArticleSummary).where(ArticleSummary.article_id == article_id, ArticleSummary.level == level)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, True

    content = await _fetch_article_content(db, article_id)
    summary_text = await _summarize_with_chunking(content, LEVEL_PROMPTS[level])

    stmt = (
        pg_insert(ArticleSummary)
        .values(article_id=article_id, level=level, content=summary_text, model_used=settings.SUMMARY_MODEL)
        .on_conflict_do_nothing(constraint="uq_article_summaries_article_level")
    )
    await db.execute(stmt)
    await db.commit()
    result = await db.execute(
        select(ArticleSummary).where(ArticleSummary.article_id == article_id, ArticleSummary.level == level)
    )
    return result.scalar_one(), False


async def regenerate_article_summary(
    db: AsyncSession, article_id: uuid.UUID, level: ArticleSummaryLevel
) -> ArticleSummary:
    content = await _fetch_article_content(db, article_id)
    summary_text = await _summarize_with_chunking(content, LEVEL_PROMPTS[level])
    stmt = (
        pg_insert(ArticleSummary)
        .values(article_id=article_id, level=level, content=summary_text, model_used=settings.SUMMARY_MODEL)
        .on_conflict_do_update(
            constraint="uq_article_summaries_article_level",
            set_={"content": summary_text, "model_used": settings.SUMMARY_MODEL},
        )
    )
    await db.execute(stmt)
    await db.commit()
    result = await db.execute(
        select(ArticleSummary).where(ArticleSummary.article_id == article_id, ArticleSummary.level == level)
    )
    return result.scalar_one()
