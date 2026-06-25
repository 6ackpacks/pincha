"""Wiki 页面 CRUD 路由。

包含页面的列表、详情、随机漫游、创建、更新、删除等端点。
"""

import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.rag_service import embed_texts

from app.config import settings
from app.core.auth import get_current_kb_id, get_current_user
from app.core.cache import (
    WIKI_GRAPH_TTL,
    WIKI_PAGE_TTL,
    WIKI_PAGES_TTL,
    WIKI_SEARCH_TTL,
    WIKI_TAGS_TTL,
    cache_delete,
    cache_delete_pattern,
    cache_get,
    cache_set,
    wiki_page_key,
    wiki_pages_key,
)
from app.core.database import get_session
from app.core.utils import escape_like
from app.models.user import User
from app.models.wiki import WikiPage, WikiRelation, WikiSource

from app.services.wiki_utils import make_slug, sync_wikilinks_to_relations

from app.api.v1.wiki.schemas import (
    WikiPageSummary,
    WikiSourceInfo,
    WikiRelationInfo,
    WikiBacklinkInfo,
    WikiPageDetail,
    CreateWikiPageRequest,
    UpdateWikiPageRequest,
)
from app.api.v1.wiki.deps import get_current_user_id

router = APIRouter(tags=["wiki"])


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------


async def _generate_page_embedding(page: WikiPage) -> None:
    """为 wiki 页面生成 embedding（基于标题+摘要+内容）。"""
    parts = [page.title or ""]
    if page.summary:
        parts.append(page.summary)
    if page.content:
        parts.append(page.content[:2000])
    text = "\n".join(parts)
    embeddings = await embed_texts([text])
    if embeddings:
        page.embedding = embeddings[0]


# ---------------------------------------------------------------------------
# 页面列表与详情
# ---------------------------------------------------------------------------

@router.get("/pages", response_model=list[WikiPageSummary])
async def list_wiki_pages(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, description="按标题/摘要过滤"),
    tag: str | None = Query(None, description="按标签前缀过滤（支持嵌套，如 科技 匹配 科技/AI）"),
):
    from sqlalchemy import or_

    key = wiki_pages_key(f"{kb_id}:{search or ''}:tag={tag or ''}", offset, limit)
    cached = await cache_get(key)
    if cached is not None:
        return cached

    stmt = select(WikiPage).where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    if search:
        stmt = stmt.where(
            or_(
                WikiPage.title.ilike(f"%{escape_like(search)}%"),
                WikiPage.summary.ilike(f"%{escape_like(search)}%"),
            )
        )
    if tag:
        stmt = stmt.where(
            sa.text(
                "EXISTS (SELECT 1 FROM jsonb_array_elements_text(wiki_pages.tags) AS t "
                "WHERE t = :tag_prefix OR t LIKE :tag_prefix_like)"
            ).bindparams(
                sa.bindparam("tag_prefix", value=tag),
                sa.bindparam("tag_prefix_like", value=f"{tag}/%"),
            )
        )
    stmt = stmt.order_by(WikiPage.updated_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    pages = result.scalars().all()
    data = [
        WikiPageSummary(
            id=str(p.id),
            title=p.title,
            slug=p.slug,
            type=p.type or "concept",
            summary=p.summary,
            source_count=p.source_count,
            status=p.status,
            has_contradiction=p.has_contradiction,
            community_id=p.community_id,
            tags=p.tags or [],
            updated_at=p.updated_at,
        )
        for p in pages
    ]
    await cache_set(key, [d.model_dump(mode="json") for d in data], WIKI_PAGES_TTL)
    return data


@router.get("/pages/{slug}", response_model=WikiPageDetail)
async def get_wiki_page(
    slug: str,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    key = wiki_page_key(slug, str(user_id), str(kb_id))
    cached = await cache_get(key)
    if cached is not None:
        return cached

    result = await db.execute(
        select(WikiPage).where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id, WikiPage.slug == slug)
    )
    page = result.scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="话题页不存在")

    # Sources
    src_result = await db.execute(
        select(WikiSource).where(WikiSource.wiki_page_id == page.id)
    )
    sources = [
        WikiSourceInfo(
            id=str(s.id),
            source_type=s.source_type,
            source_id=str(s.source_id),
            contribution=s.contribution,
            created_at=s.created_at,
        )
        for s in src_result.scalars().all()
    ]

    # Relations (outgoing)
    rel_result = await db.execute(
        select(WikiRelation, WikiPage.title, WikiPage.slug)
        .join(WikiPage, WikiPage.id == WikiRelation.to_page_id)
        .where(WikiRelation.from_page_id == page.id)
        .limit(20)
    )
    relations = [
        WikiRelationInfo(
            id=str(rel.id),
            to_page_id=str(rel.to_page_id),
            to_page_slug=rel_slug,
            to_page_title=rel_title,
            relation_type=rel.relation_type,
            strength=rel.strength,
        )
        for rel, rel_title, rel_slug in rel_result.all()
    ]

    # Backlinks
    backlinks_result = await db.execute(
        select(WikiPage, WikiRelation)
        .join(WikiRelation, WikiRelation.from_page_id == WikiPage.id)
        .where(WikiRelation.to_page_id == page.id)
        .order_by(WikiPage.title)
    )
    backlinks = [
        WikiBacklinkInfo(
            id=str(wp.id),
            title=wp.title,
            slug=wp.slug,
            summary=wp.summary,
        )
        for wp, _ in backlinks_result.all()
    ]

    detail = WikiPageDetail(
        id=str(page.id),
        title=page.title,
        slug=page.slug,
        type=page.type or "concept",
        content=page.content,
        summary=page.summary,
        source_count=page.source_count,
        status=page.status,
        has_contradiction=page.has_contradiction,
        contradiction_details=page.contradiction_details or [],
        review_items=page.review_items or [],
        tags=page.tags or [],
        sources=sources,
        relations=relations,
        backlinks=backlinks,
        updated_at=page.updated_at,
    )
    await cache_set(key, detail.model_dump(mode="json"), WIKI_PAGE_TTL)
    return detail


# ---------------------------------------------------------------------------
# 随机漫游
# ---------------------------------------------------------------------------

@router.get("/random", response_model=WikiPageSummary)
async def get_random_wiki_page(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """返回一个随机 wiki 页面。"""
    result = await db.execute(
        select(WikiPage)
        .where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
        .order_by(func.random())
        .limit(1)
    )
    page = result.scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="知识库中暂无页面")

    return WikiPageSummary(
        id=str(page.id),
        title=page.title,
        slug=page.slug,
        type=page.type or "concept",
        summary=page.summary,
        source_count=page.source_count,
        status=page.status,
        has_contradiction=page.has_contradiction,
        community_id=page.community_id,
        tags=page.tags or [],
        updated_at=page.updated_at,
    )


# ---------------------------------------------------------------------------
# 页面 CRUD（手动创建/编辑/删除）
# ---------------------------------------------------------------------------

@router.post("/pages", status_code=201, response_model=WikiPageDetail)
async def create_wiki_page(
    body: CreateWikiPageRequest,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """手动创建新 wiki 页面（不经过 LLM 编译）。"""
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="标题不能为空")

    slug = make_slug(body.title)

    # 检查 slug 唯一性，冲突时追加后缀
    existing = await db.execute(
        select(WikiPage).where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id, WikiPage.slug == slug)
    )
    if existing.scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    page = WikiPage(
        user_id=user_id,
        kb_id=kb_id,
        title=body.title.strip(),
        slug=slug,
        content=body.content,
        summary=body.summary,
        tags=body.tags,
        type=body.type,
        status="ready",
        source_count=0,
    )
    db.add(page)
    await db.flush()

    await _generate_page_embedding(page)
    await sync_wikilinks_to_relations(db, page, user_id, kb_id)

    await db.commit()
    await db.refresh(page)

    await cache_delete_pattern("wiki:pages:*")
    await cache_delete_pattern("wiki:graph:*")
    await cache_delete_pattern("wiki:tags:*")

    return WikiPageDetail(
        id=str(page.id),
        title=page.title,
        slug=page.slug,
        type=page.type or "concept",
        content=page.content,
        summary=page.summary,
        source_count=page.source_count,
        status=page.status,
        has_contradiction=page.has_contradiction,
        contradiction_details=[],
        review_items=[],
        tags=page.tags or [],
        sources=[],
        relations=[],
        backlinks=[],
        updated_at=page.updated_at,
    )


@router.put("/pages/{page_id}", response_model=WikiPageDetail)
async def update_wiki_page(
    page_id: uuid.UUID,
    body: UpdateWikiPageRequest,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """更新 wiki 页面的内容、标题、摘要、标签或类型。"""
    page = (await db.execute(
        select(WikiPage).where(WikiPage.id == page_id, WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")

    old_slug = page.slug
    content_changed = False

    if body.title is not None:
        page.title = body.title.strip()
        new_slug = make_slug(page.title)
        if new_slug != old_slug:
            dup = await db.execute(
                select(WikiPage).where(
                    WikiPage.user_id == user_id,
                    WikiPage.kb_id == kb_id,
                    WikiPage.slug == new_slug,
                    WikiPage.id != page_id,
                )
            )
            if dup.scalar_one_or_none():
                new_slug = f"{new_slug}-{uuid.uuid4().hex[:6]}"
            page.slug = new_slug
        content_changed = True

    if body.content is not None:
        page.content = body.content
        content_changed = True
    if body.summary is not None:
        page.summary = body.summary
        content_changed = True
    if body.tags is not None:
        page.tags = body.tags
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(page, "tags")
    if body.type is not None:
        page.type = body.type

    if content_changed:
        await _generate_page_embedding(page)

    if body.content is not None:
        await sync_wikilinks_to_relations(db, page, user_id, kb_id)

    page.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(page)

    await cache_delete_pattern("wiki:pages:*")
    await cache_delete_pattern("wiki:search:*")
    await cache_delete_pattern("wiki:graph:*")
    await cache_delete_pattern("wiki:tags:*")
    try:
        await cache_delete(wiki_page_key(old_slug, str(user_id), str(kb_id)))
        if page.slug != old_slug:
            await cache_delete(wiki_page_key(page.slug, str(user_id), str(kb_id)))
    except Exception:
        logger.exception("Failed to delete cache for page slug=%s (old=%s)", page.slug, old_slug)
        pass

    # 重新获取 sources, relations, backlinks
    src_result = await db.execute(
        select(WikiSource).where(WikiSource.wiki_page_id == page.id)
    )
    sources = [
        WikiSourceInfo(
            id=str(s.id), source_type=s.source_type,
            source_id=str(s.source_id), contribution=s.contribution,
            created_at=s.created_at,
        )
        for s in src_result.scalars().all()
    ]

    rel_result = await db.execute(
        select(WikiRelation, WikiPage.title, WikiPage.slug)
        .join(WikiPage, WikiPage.id == WikiRelation.to_page_id)
        .where(WikiRelation.from_page_id == page.id)
        .limit(20)
    )
    relations = [
        WikiRelationInfo(
            id=str(rel.id), to_page_id=str(rel.to_page_id),
            to_page_slug=rel_slug, to_page_title=rel_title,
            relation_type=rel.relation_type, strength=rel.strength,
        )
        for rel, rel_title, rel_slug in rel_result.all()
    ]

    backlinks_result = await db.execute(
        select(WikiPage, WikiRelation)
        .join(WikiRelation, WikiRelation.from_page_id == WikiPage.id)
        .where(WikiRelation.to_page_id == page.id)
        .order_by(WikiPage.title)
    )
    backlinks = [
        WikiBacklinkInfo(
            id=str(wp.id),
            title=wp.title,
            slug=wp.slug,
            summary=wp.summary,
        )
        for wp, _ in backlinks_result.all()
    ]

    return WikiPageDetail(
        id=str(page.id),
        title=page.title,
        slug=page.slug,
        type=page.type or "concept",
        content=page.content,
        summary=page.summary,
        source_count=page.source_count,
        status=page.status,
        has_contradiction=page.has_contradiction,
        contradiction_details=page.contradiction_details or [],
        review_items=page.review_items or [],
        tags=page.tags or [],
        sources=sources,
        relations=relations,
        backlinks=backlinks,
        updated_at=page.updated_at,
    )


@router.delete("/pages/{page_id}", status_code=200)
async def delete_wiki_page(
    page_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """删除 wiki 页面及其关联的 sources 和 relations。"""
    page = (await db.execute(
        select(WikiPage).where(WikiPage.id == page_id, WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")

    slug = page.slug

    await db.execute(
        sa.delete(WikiSource).where(WikiSource.wiki_page_id == page_id)
    )
    await db.execute(
        sa.delete(WikiRelation).where(
            sa.or_(
                WikiRelation.from_page_id == page_id,
                WikiRelation.to_page_id == page_id,
            )
        )
    )
    await db.delete(page)
    await db.commit()

    await cache_delete_pattern("wiki:pages:*")
    await cache_delete_pattern("wiki:graph:*")
    await cache_delete_pattern("wiki:search:*")
    await cache_delete_pattern("wiki:tags:*")
    try:
        await cache_delete(wiki_page_key(slug, str(user_id), str(kb_id)))
    except Exception:
        logger.exception("Failed to delete cache for deleted page slug=%s", slug)
        pass

    return {"message": "页面已删除"}
