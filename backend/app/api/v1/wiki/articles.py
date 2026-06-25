"""Wiki 文章 CRUD 路由。

包含文章配额查询、创建（URL/文本导入）、列表和删除等端点。
"""

import logging
import uuid

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import get_current_kb_id, get_current_user
from app.core.database import get_session
from app.models.article import Article
from app.models.user import User
from app.models.wiki import WikiPage, WikiSource

from app.api.v1.wiki.schemas import (
    ArticleSummary,
    QuotaResponse,
    CreateArticleRequest,
)
from app.api.v1.wiki.deps import get_current_user_id

router = APIRouter(tags=["wiki"])


# ---------------------------------------------------------------------------
# 文章配额
# ---------------------------------------------------------------------------

@router.get("/quota", response_model=QuotaResponse)
async def get_article_quota(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    result = await db.execute(
        select(func.count()).select_from(Article).where(Article.user_id == user_id, Article.kb_id == kb_id)
    )
    used = result.scalar_one() or 0
    limit = settings.WIKI_ARTICLE_LIMIT
    return QuotaResponse(used=used, limit=limit, remaining=max(0, limit - used))


# ---------------------------------------------------------------------------
# 文章 CRUD
# ---------------------------------------------------------------------------

@router.post("/articles", status_code=201, response_model=ArticleSummary)
async def create_article(
    body: CreateArticleRequest,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """通过 URL 或粘贴文本导入文章。"""
    # 检查配额
    count_result = await db.execute(
        select(func.count()).select_from(Article).where(Article.user_id == user_id, Article.kb_id == kb_id)
    )
    used = count_result.scalar_one() or 0
    if used >= settings.WIKI_ARTICLE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"已达文章上限（{settings.WIKI_ARTICLE_LIMIT} 篇），请删除旧文章后再导入",
        )

    if body.source_type == "url":
        if not body.source_url:
            raise HTTPException(status_code=422, detail="URL 类型需要提供 source_url")
        article = Article(
            user_id=user_id,
            kb_id=kb_id,
            source_type="url",
            source_url=body.source_url,
            title=body.title,
            content=None,
            status={"state": "pending", "progress": 0, "message": "等待抓取"},
        )
    elif body.source_type == "text":
        if not body.content:
            raise HTTPException(status_code=422, detail="文本类型需要提供 content")
        article = Article(
            user_id=user_id,
            kb_id=kb_id,
            source_type="text",
            source_url=None,
            title=body.title or "粘贴文本",
            content=body.content,
            status={"state": "pending", "progress": 0, "message": "等待编译"},
        )
    else:
        raise HTTPException(status_code=422, detail="source_type 必须为 url 或 text")

    db.add(article)
    await db.commit()
    await db.refresh(article)

    # 派发导入任务
    from app.tasks.wiki_tasks import ingest_article
    ingest_article.apply_async(
        args=[str(article.id), str(user_id), str(kb_id)],
        queue="pingcha.llm",
    )

    return ArticleSummary(
        id=str(article.id),
        source_type=article.source_type,
        source_url=article.source_url,
        title=article.title,
        status=article.status,
        in_wiki=article.in_wiki or False,
        created_at=article.created_at,
    )


@router.get("/articles", response_model=list[ArticleSummary])
async def list_articles(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    result = await db.execute(
        select(Article)
        .where(Article.user_id == user_id, Article.kb_id == kb_id)
        .order_by(Article.created_at.desc())
    )
    articles = result.scalars().all()
    return [
        ArticleSummary(
            id=str(a.id),
            source_type=a.source_type,
            source_url=a.source_url,
            title=a.title,
            status=a.status,
            in_wiki=a.in_wiki or False,
            created_at=a.created_at,
        )
        for a in articles
    ]


@router.delete("/articles/{article_id}", status_code=200)
async def delete_article(
    article_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    result = await db.execute(
        select(Article).where(Article.id == article_id, Article.user_id == user_id, Article.kb_id == kb_id)
    )
    article = result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status_code=404, detail="文章不存在")

    # 删除该文章关联的 wiki sources
    src_result = await db.execute(
        select(WikiSource).where(
            WikiSource.source_type == "article",
            WikiSource.source_id == article_id,
        )
    )
    for src in src_result.scalars().all():
        await db.delete(src)
        page_result = await db.execute(
            select(WikiPage).where(WikiPage.id == src.wiki_page_id)
        )
        page = page_result.scalar_one_or_none()
        if page:
            page.source_count = max(0, (page.source_count or 1) - 1)

    await db.delete(article)
    await db.commit()
    return {"message": "文章已删除"}
