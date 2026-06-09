"""Article mindmap generation service — Markdown for markmap rendering."""

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.article import Article, ArticleMindmap, ArticleSummary
from app.services.mindmap_engine import generate_mindmap_markdown

logger = logging.getLogger(__name__)

ARTICLE_MINDMAP_PROMPT = (
    "你是一位专业的知识结构化专家。请将以下文章内容转化为思维导图的 Markdown 格式。\n\n"
    "要求：\n"
    "- 使用 # 作为文章主题（根节点）\n"
    "- 使用 ## 作为 3-6 个核心主题分支\n"
    "- 使用 ### 作为每个主题下的 2-4 个子观点\n"
    "- 使用无序列表（-）列出关键细节，每条不超过15个字\n"
    "- 整体不超过4层深度\n"
    "- 节点文字要简洁精炼，避免长句\n"
    "- 【重要】直接输出 Markdown 内容，禁止用代码块（```）包裹，不要任何解释或说明\n"
    "- 【重要】无论输入是什么语言，输出必须全程使用中文"
)


async def _fetch_article_source_text(db: AsyncSession, article_id: uuid.UUID) -> str:
    for level in ("highlight", "detailed", "full"):
        result = await db.execute(
            select(ArticleSummary.content).where(
                ArticleSummary.article_id == article_id, ArticleSummary.level == level
            )
        )
        content = result.scalar_one_or_none()
        if content:
            return content

    result = await db.execute(
        select(Article.content).where(Article.id == article_id)
    )
    content = result.scalar_one_or_none()
    if content:
        return content[:50000]

    raise HTTPException(status_code=404, detail="No content found for mindmap generation")


async def get_or_create_article_mindmap(
    db: AsyncSession, article_id: uuid.UUID
) -> tuple[ArticleMindmap, bool]:
    result = await db.execute(
        select(ArticleMindmap).where(ArticleMindmap.article_id == article_id)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, True

    source_text = await _fetch_article_source_text(db, article_id)
    markdown = await generate_mindmap_markdown(source_text, system_prompt=ARTICLE_MINDMAP_PROMPT)

    stmt = (
        pg_insert(ArticleMindmap)
        .values(article_id=article_id, markdown=markdown, model_used=settings.SUMMARY_MODEL)
        .on_conflict_do_nothing(constraint="uq_article_mindmaps_article")
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(ArticleMindmap).where(ArticleMindmap.article_id == article_id)
    )
    return result.scalar_one(), False


async def regenerate_article_mindmap(
    db: AsyncSession, article_id: uuid.UUID
) -> ArticleMindmap:
    source_text = await _fetch_article_source_text(db, article_id)
    markdown = await generate_mindmap_markdown(source_text, system_prompt=ARTICLE_MINDMAP_PROMPT)

    stmt = (
        pg_insert(ArticleMindmap)
        .values(article_id=article_id, markdown=markdown, model_used=settings.SUMMARY_MODEL)
        .on_conflict_do_update(
            constraint="uq_article_mindmaps_article",
            set_={"markdown": markdown, "model_used": settings.SUMMARY_MODEL},
        )
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(ArticleMindmap).where(ArticleMindmap.article_id == article_id)
    )
    return result.scalar_one()
