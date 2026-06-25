"""Article API routes — submit, list, progress, summaries, mindmap."""

import json
import uuid
from typing import List

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.deps import AuthKBDeps, require_user_article
from app.core.rate_limit import limiter
from app.core.progress import sse_progress_stream
from app.core.redis import get_redis
from app.core.url_validator import validate_url_async, SSRFError
from app.models.article import Article, ArticleSummary
from app.schemas.article import (
    ArticleCreate,
    ArticleMindmapResponse,
    ArticleProgress,
    ArticleResponse,
    ArticleSummaryResponse,
)
from app.services.article_service import dispatch_article_processing

router = APIRouter(prefix="/articles", tags=["articles"])


@router.get("/trending", response_model=List[ArticleResponse])
async def trending_articles(
    db: AsyncSession = Depends(get_session),
    limit: int = Query(20, ge=1, le=100),
):
    """List recent articles across all users (public trending feed).
    Only returns successfully parsed articles with valid titles.
    """
    result = await db.execute(
        select(Article)
        .where(Article.status["state"].astext == "done")
        .where(Article.title.isnot(None))
        .where(Article.title != "")
        .order_by(Article.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("", response_model=List[ArticleResponse])
async def list_articles(deps: AuthKBDeps = Depends()):
    result = await deps.db.execute(
        select(Article)
        .where(Article.user_id == deps.user.id, Article.kb_id == deps.kb_id)
        .order_by(Article.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ArticleResponse, status_code=201)
@limiter.limit("30/minute")
async def submit_article(
    request: Request,
    payload: ArticleCreate,
    deps: AuthKBDeps = Depends(),
):
    if payload.url:
        url_str = str(payload.url)

        # SSRF 防护：校验用户提交的 URL 不指向内网
        try:
            await validate_url_async(url_str)
        except SSRFError as e:
            return JSONResponse(
                status_code=400,
                content={"detail": f"URL 不合法：{e}"},
            )

        existing = (await deps.db.execute(
            select(Article).where(
                Article.source_url == url_str,
                Article.user_id == deps.user.id,
                Article.kb_id == deps.kb_id,
            )
        )).scalar_one_or_none()

        if existing is not None:
            return JSONResponse(
                status_code=200,
                content=ArticleResponse.model_validate(existing).model_dump(mode="json"),
            )

        article = Article(
            user_id=deps.user.id,
            kb_id=deps.kb_id,
            source_type="url",
            source_url=url_str,
        )
    else:
        article = Article(
            user_id=deps.user.id,
            kb_id=deps.kb_id,
            source_type="text",
            source_url=None,
            title=payload.content[:60].split("\n")[0] if payload.content else None,
            content=payload.content,
            word_count=len(payload.content) if payload.content else 0,
            status={"state": "fetching", "progress": 30, "message": "文本已接收"},
        )

    deps.db.add(article)
    await deps.db.commit()
    await deps.db.refresh(article)

    dispatch_article_processing(str(article.id))

    return article


@router.get("/{article_id}", response_model=ArticleResponse)
async def get_article(article_id: uuid.UUID, deps: AuthKBDeps = Depends()):
    return await require_user_article(deps.db, deps.user, deps.kb_id, article_id)


@router.get("/{article_id}/progress", response_model=ArticleProgress)
async def get_article_progress(
    article_id: uuid.UUID,
    deps: AuthKBDeps = Depends(),
    redis=Depends(get_redis),
):
    article = await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    hb_key = f"article:{article_id}:heartbeat"
    heartbeat_data = await redis.get(hb_key)
    if heartbeat_data:
        return ArticleProgress(**json.loads(heartbeat_data))

    return ArticleProgress(**article.status)


@router.get("/{article_id}/progress/stream")
async def stream_article_progress(
    article_id: uuid.UUID,
    deps: AuthKBDeps = Depends(),
    redis=Depends(get_redis),
):
    from fastapi.responses import StreamingResponse

    await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    return StreamingResponse(
        sse_progress_stream("article", str(article_id), redis=redis),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive", "Content-Encoding": "identity"},
    )


@router.delete("/{article_id}", status_code=204)
async def delete_article(article_id: uuid.UUID, deps: AuthKBDeps = Depends()):
    article = await require_user_article(deps.db, deps.user, deps.kb_id, article_id)
    await deps.db.delete(article)
    await deps.db.commit()
    return None


@router.post("/{article_id}/reprocess", response_model=ArticleResponse)
async def reprocess_article(article_id: uuid.UUID, deps: AuthKBDeps = Depends()):
    article = await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    article.status = {"state": "pending", "progress": 0, "message": "重新处理中..."}
    await deps.db.commit()
    await deps.db.refresh(article)

    dispatch_article_processing(str(article.id))
    return article


# --- Summaries ---

@router.get("/{article_id}/summary/available")
async def available_summaries(article_id: uuid.UUID, deps: AuthKBDeps = Depends()):
    await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    result = await deps.db.execute(
        select(ArticleSummary.level).where(ArticleSummary.article_id == article_id)
    )
    levels = [row[0] for row in result.all()]
    return {"article_id": str(article_id), "levels": levels}


@router.get("/{article_id}/summary/{level}", response_model=ArticleSummaryResponse)
async def get_article_summary(
    article_id: uuid.UUID,
    level: str,
    deps: AuthKBDeps = Depends(),
):
    from app.services.article_summary_service import get_or_create_article_summary
    await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    summary, cached = await get_or_create_article_summary(deps.db, article_id, level)
    resp = ArticleSummaryResponse.model_validate(summary)
    resp.cached = cached
    return resp


@router.post("/{article_id}/summary/{level}/regenerate", response_model=ArticleSummaryResponse)
async def regenerate_article_summary_endpoint(
    article_id: uuid.UUID,
    level: str,
    deps: AuthKBDeps = Depends(),
):
    from app.services.article_summary_service import regenerate_article_summary
    await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    summary = await regenerate_article_summary(deps.db, article_id, level)
    return ArticleSummaryResponse.model_validate(summary)


@router.post("/{article_id}/summary/full/generate")
async def trigger_full_summary(article_id: uuid.UUID, deps: AuthKBDeps = Depends()):
    await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    result = await deps.db.execute(
        select(ArticleSummary).where(
            ArticleSummary.article_id == article_id, ArticleSummary.level == "full"
        )
    )
    if result.scalar_one_or_none():
        return {"status": "already_exists"}

    from app.tasks.article_tasks import generate_full_article_summary
    task = generate_full_article_summary.delay(str(article_id))
    return {"status": "queued", "task_id": task.id}


# --- Mindmap ---

@router.get("/{article_id}/mindmap", response_model=ArticleMindmapResponse)
async def get_article_mindmap(article_id: uuid.UUID, deps: AuthKBDeps = Depends()):
    from app.services.article_mindmap_service import get_or_create_article_mindmap
    await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    mindmap, cached = await get_or_create_article_mindmap(deps.db, article_id)
    resp = ArticleMindmapResponse.model_validate(mindmap)
    resp.cached = cached
    return resp


@router.post("/{article_id}/mindmap/regenerate", response_model=ArticleMindmapResponse)
async def regenerate_article_mindmap_endpoint(article_id: uuid.UUID, deps: AuthKBDeps = Depends()):
    from app.services.article_mindmap_service import regenerate_article_mindmap
    await require_user_article(deps.db, deps.user, deps.kb_id, article_id)

    mindmap = await regenerate_article_mindmap(deps.db, article_id)
    return ArticleMindmapResponse.model_validate(mindmap)
