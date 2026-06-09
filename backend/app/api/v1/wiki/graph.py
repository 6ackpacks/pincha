"""Wiki 知识图谱、搜索、标签、健康度、审阅和未链接提及路由。

包含图谱可视化、全文搜索、标签树、知识健康度分析、
review item 解决、以及未链接提及检测与链接功能。
"""

import logging
import re
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_kb_id, get_current_user
from app.core.cache import (
    WIKI_GRAPH_TTL,
    WIKI_HEALTH_TTL,
    WIKI_SEARCH_TTL,
    WIKI_TAGS_TTL,
    cache_delete,
    cache_delete_pattern,
    cache_get,
    cache_set,
    wiki_graph_key,
    wiki_health_key,
    wiki_page_key,
    wiki_search_key,
    wiki_tags_key,
)
from app.core.database import get_session
from app.models.user import User
from app.models.wiki import WikiPage, WikiRelation

from app.api.v1.wiki.schemas import (
    WikiPageSummary,
    GraphNode,
    GraphEdge,
    GraphData,
    LocalGraphNode,
    LocalGraphData,
    TagTreeNode,
    WikiSearchResult,
    UnlinkedMention,
    LinkMentionRequest,
)
from app.api.v1.wiki.deps import get_current_user_id

router = APIRouter(tags=["wiki"])


# ---------------------------------------------------------------------------
# 标签树
# ---------------------------------------------------------------------------

def _build_tag_tree(tags: list[str]) -> list[TagTreeNode]:
    """将扁平的 `/` 分隔标签列表构建为层级树。"""
    from collections import Counter

    tag_counts = Counter(tags)

    tree_dict: dict = {}
    for tag in tag_counts:
        parts = tag.split("/")
        node = tree_dict
        for part in parts:
            if part not in node:
                node[part] = {}
            node = node[part]

    def _to_nodes(d: dict, prefix: str) -> list[TagTreeNode]:
        nodes: list[TagTreeNode] = []
        for name in sorted(d.keys()):
            full_path = f"{prefix}/{name}" if prefix else name
            children = _to_nodes(d[name], full_path)
            count = tag_counts.get(full_path, 0)
            nodes.append(TagTreeNode(
                name=name,
                full_path=full_path,
                count=count,
                children=children,
            ))
        return nodes

    return _to_nodes(tree_dict, "")


@router.get("/tags", response_model=list[TagTreeNode])
async def get_wiki_tags(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """返回用户 wiki 页面中所有标签的层级树。"""
    key = wiki_tags_key(str(user_id), str(kb_id))
    cached = await cache_get(key)
    if cached is not None:
        return cached

    result = await db.execute(
        select(WikiPage.tags).where(
            WikiPage.user_id == user_id,
            WikiPage.kb_id == kb_id,
            WikiPage.tags.isnot(None),
        )
    )
    all_tags: list[str] = []
    for (tags_col,) in result.all():
        if tags_col:
            all_tags.extend(tags_col)

    tree = _build_tag_tree(all_tags)
    serialized = [node.model_dump() for node in tree]
    await cache_set(key, serialized, WIKI_TAGS_TTL)
    return tree


# ---------------------------------------------------------------------------
# 搜索
# ---------------------------------------------------------------------------

def _build_snippet(keyword: str, title: str, summary: str | None, content: str | None) -> str | None:
    """构建高亮片段（<=200字符），围绕匹配关键词。"""
    kw_lower = keyword.lower()
    kw_len = len(keyword)

    def _mark(text: str) -> str:
        return re.sub(re.escape(keyword), lambda m: f"<mark>{m.group(0)}</mark>", text, flags=re.IGNORECASE)

    if kw_lower in title.lower():
        if summary:
            snippet = summary[:200]
            return _mark(snippet)
        if content:
            snippet = content[:200]
            return _mark(snippet)
        return None

    for text_source in [content, summary]:
        if not text_source:
            continue
        idx = text_source.lower().find(kw_lower)
        if idx == -1:
            continue
        start = max(0, idx - 80)
        end = min(len(text_source), idx + kw_len + 80)
        snippet = text_source[start:end].replace("\n", " ").strip()
        if start > 0:
            snippet = "…" + snippet
        if end < len(text_source):
            snippet = snippet + "…"
        return _mark(snippet)

    return None


@router.get("/search", response_model=list[WikiSearchResult])
async def search_wiki(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
    limit: int = Query(10, ge=1, le=50),
):
    """全文搜索 wiki 页面（标题+内容），带片段高亮。"""
    from sqlalchemy import or_

    key = wiki_search_key(str(user_id), q, limit, str(kb_id))
    cached = await cache_get(key)
    if cached is not None:
        return cached

    result = await db.execute(
        select(WikiPage)
        .where(
            WikiPage.user_id == user_id,
            WikiPage.kb_id == kb_id,
            or_(
                WikiPage.title.ilike(f"%{q}%"),
                WikiPage.content.ilike(f"%{q}%"),
                WikiPage.summary.ilike(f"%{q}%"),
            ),
        )
        .order_by(WikiPage.updated_at.desc())
        .limit(limit)
    )
    pages = result.scalars().all()
    result_data = [
        WikiSearchResult(
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
            highlight=_build_snippet(q, p.title, p.summary, p.content),
        )
        for p in pages
    ]
    await cache_set(key, [d.model_dump(mode="json") for d in result_data], WIKI_SEARCH_TTL)
    return result_data


# ---------------------------------------------------------------------------
# 知识图谱
# ---------------------------------------------------------------------------

@router.get("/graph", response_model=GraphData)
async def get_wiki_graph(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """返回所有 wiki 页面及其关系的图谱数据。"""

    cache_key = wiki_graph_key(f"{user_id}:{kb_id}")
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached

    pages_result = await db.execute(
        select(WikiPage).where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )
    pages = pages_result.scalars().all()

    page_ids = [p.id for p in pages]
    if not page_ids:
        return GraphData(nodes=[], edges=[])

    relations_result = await db.execute(
        select(WikiRelation).where(
            WikiRelation.from_page_id.in_(page_ids),
            WikiRelation.to_page_id.in_(page_ids),
        )
    )
    relations = relations_result.scalars().all()

    nodes = [
        GraphNode(
            id=str(p.id),
            title=p.title,
            slug=p.slug,
            type=p.type or "concept",
            community_id=p.community_id,
            source_count=p.source_count or 0,
        )
        for p in pages
    ]

    edges = [
        GraphEdge(
            id=str(r.id),
            from_id=str(r.from_page_id),
            to_id=str(r.to_page_id),
            relation_type=r.relation_type,
            strength=r.strength or 0.5,
        )
        for r in relations
    ]

    graph = GraphData(nodes=nodes, edges=edges)
    await cache_set(cache_key, graph.model_dump(mode="json"), WIKI_GRAPH_TTL)
    return graph


# ---------------------------------------------------------------------------
# 局部图谱（BFS 邻域）
# ---------------------------------------------------------------------------

@router.get("/pages/{page_id}/local-graph", response_model=LocalGraphData)
async def get_local_graph(
    page_id: uuid.UUID,
    depth: int = Query(default=1, ge=1, le=2),
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """返回以 page_id 为中心、BFS 扩展 depth 跳的局部子图。"""

    page = (await db.execute(
        select(WikiPage).where(WikiPage.id == page_id, WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    visited: set[uuid.UUID] = {page_id}
    frontier: set[uuid.UUID] = {page_id}

    for _ in range(depth):
        if not frontier:
            break
        rels = (await db.execute(
            select(WikiRelation).where(
                sa.or_(
                    WikiRelation.from_page_id.in_(frontier),
                    WikiRelation.to_page_id.in_(frontier),
                )
            )
        )).scalars().all()

        next_frontier: set[uuid.UUID] = set()
        for r in rels:
            for pid in (r.from_page_id, r.to_page_id):
                if pid not in visited:
                    next_frontier.add(pid)
                    visited.add(pid)
        frontier = next_frontier

    if not visited:
        return LocalGraphData(nodes=[], edges=[])

    pages = (await db.execute(
        select(WikiPage).where(
            WikiPage.id.in_(visited),
            WikiPage.user_id == user_id,
            WikiPage.kb_id == kb_id,
        )
    )).scalars().all()

    valid_ids = {p.id for p in pages}

    relations = (await db.execute(
        select(WikiRelation).where(
            WikiRelation.from_page_id.in_(valid_ids),
            WikiRelation.to_page_id.in_(valid_ids),
        )
    )).scalars().all()

    nodes = [
        LocalGraphNode(
            id=str(p.id),
            title=p.title,
            slug=p.slug,
            type=p.type or "concept",
            community_id=p.community_id,
            source_count=p.source_count or 0,
            is_center=(p.id == page_id),
        )
        for p in pages
    ]

    edges = [
        GraphEdge(
            id=str(r.id),
            from_id=str(r.from_page_id),
            to_id=str(r.to_page_id),
            relation_type=r.relation_type,
            strength=r.strength or 0.5,
        )
        for r in relations
    ]

    return LocalGraphData(nodes=nodes, edges=edges)


# ---------------------------------------------------------------------------
# 知识健康度
# ---------------------------------------------------------------------------

@router.get("/health")
async def get_knowledge_health(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """返回知识健康度指标：孤立页面、稀疏社区、桥接节点。"""
    key = wiki_health_key(str(user_id), str(kb_id))
    cached = await cache_get(key)
    if cached is not None:
        return cached

    pages_result = await db.execute(
        select(WikiPage).where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )
    pages = pages_result.scalars().all()
    page_ids = [p.id for p in pages]

    if not page_ids:
        result = {"isolated_pages": [], "sparse_communities": [], "bridge_nodes": [], "overall_score": 100}
        await cache_set(key, result, WIKI_HEALTH_TTL)
        return result

    relations_result = await db.execute(
        select(WikiRelation).where(
            WikiRelation.from_page_id.in_(page_ids),
            WikiRelation.to_page_id.in_(page_ids),
        )
    )
    relations = relations_result.scalars().all()

    # 计算度
    degree: dict[str, int] = {str(p.id): 0 for p in pages}
    for r in relations:
        degree[str(r.from_page_id)] = degree.get(str(r.from_page_id), 0) + 1
        degree[str(r.to_page_id)] = degree.get(str(r.to_page_id), 0) + 1

    # 孤立页面（度 <= 1）
    isolated = [
        {"id": str(p.id), "title": p.title, "slug": p.slug}
        for p in pages if degree.get(str(p.id), 0) <= 1
    ]

    # 桥接节点（连接 3+ 社区）
    node_neighbor_communities: dict[str, set[int]] = {str(p.id): set() for p in pages}
    page_map = {str(p.id): p for p in pages}
    for r in relations:
        from_p = page_map.get(str(r.from_page_id))
        to_p = page_map.get(str(r.to_page_id))
        if from_p and to_p:
            if to_p.community_id is not None:
                node_neighbor_communities[str(r.from_page_id)].add(to_p.community_id)
            if from_p.community_id is not None:
                node_neighbor_communities[str(r.to_page_id)].add(from_p.community_id)

    bridges = [
        {"id": str(p.id), "title": p.title, "slug": p.slug,
         "communities_connected": len(node_neighbor_communities.get(str(p.id), set()))}
        for p in pages
        if len(node_neighbor_communities.get(str(p.id), set())) >= 3
    ]

    # 稀疏社区
    community_pages: dict[int, list] = {}
    for p in pages:
        if p.community_id is not None:
            community_pages.setdefault(p.community_id, []).append(p)

    sparse = []
    for comm_id, comm_pages in community_pages.items():
        if len(comm_pages) < 3:
            continue
        comm_page_ids = {str(p.id) for p in comm_pages}
        internal_edges = sum(
            1 for r in relations
            if str(r.from_page_id) in comm_page_ids and str(r.to_page_id) in comm_page_ids
        )
        max_edges = len(comm_pages) * (len(comm_pages) - 1) / 2
        cohesion = internal_edges / max_edges if max_edges > 0 else 0
        if cohesion < 0.15:
            sparse.append({
                "community_id": comm_id,
                "page_count": len(comm_pages),
                "cohesion": round(cohesion, 3),
            })

    score = max(0, 100 - len(isolated) * 5 - len(sparse) * 10)
    result = {
        "isolated_pages": isolated,
        "sparse_communities": sparse,
        "bridge_nodes": bridges,
        "overall_score": score,
    }
    await cache_set(key, result, WIKI_HEALTH_TTL)
    return result


# ---------------------------------------------------------------------------
# Review items
# ---------------------------------------------------------------------------

@router.post("/pages/{page_id}/review-items/{item_index}/resolve")
async def resolve_review_item(
    page_id: uuid.UUID,
    item_index: int,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """标记一个 review item 为已解决。"""
    page = (await db.execute(
        select(WikiPage).where(WikiPage.id == page_id, WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    items = list(page.review_items or [])
    if item_index < 0 or item_index >= len(items):
        raise HTTPException(status_code=400, detail="无效的 review item 索引")
    items[item_index]["resolved"] = True
    page.review_items = items
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(page, "review_items")
    await db.commit()
    try:
        await cache_delete_pattern(f"wiki:page:{page.slug}*")
    except Exception:
        logger.exception("Failed to delete cache for page slug=%s", page.slug)
        pass
    return {"success": True}


# ---------------------------------------------------------------------------
# 未链接提及
# ---------------------------------------------------------------------------

def _is_inside_wikilink(content: str, start: int) -> bool:
    """检查位置 start 是否已在 [[ ]] 内。"""
    prefix = content[max(0, start - 80):start]
    if "[[" in prefix:
        bp = prefix.rfind("[[")
        if "]]" not in prefix[bp + 2:]:
            return True
    return False


@router.get("/pages/{page_id}/unlinked-mentions", response_model=list[UnlinkedMention])
async def get_unlinked_mentions(
    page_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """查找提及当前页面标题但未使用 [[链接]] 的页面。"""
    import re

    page = (await db.execute(
        select(WikiPage).where(WikiPage.id == page_id, WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")

    title = page.title
    if not title or len(title) < 2:
        return []

    result = await db.execute(
        select(WikiPage).where(
            WikiPage.user_id == user_id,
            WikiPage.kb_id == kb_id,
            WikiPage.id != page_id,
            WikiPage.content.ilike(f"%{title}%"),
        ).limit(50)
    )
    candidates = result.scalars().all()

    mentions: list[UnlinkedMention] = []
    for cand in candidates:
        content = cand.content or ""
        for m in re.finditer(re.escape(title), content, re.IGNORECASE):
            start, end = m.start(), m.end()
            before = content[max(0, start - 2):start]
            after = content[end:end + 2]
            if before.endswith("[[") and after.startswith("]]"):
                continue
            if _is_inside_wikilink(content, start):
                continue
            ctx_start = max(0, start - 50)
            ctx_end = min(len(content), end + 50)
            ctx = content[ctx_start:ctx_end].replace("\n", " ").strip()
            if ctx_start > 0:
                ctx = "…" + ctx
            if ctx_end < len(content):
                ctx = ctx + "…"
            mentions.append(UnlinkedMention(
                page_id=str(cand.id), page_title=cand.title,
                page_slug=cand.slug, context=ctx,
            ))
            break
        if len(mentions) >= 20:
            break

    return mentions


@router.post("/pages/{page_id}/link-mention")
async def link_mention(
    page_id: uuid.UUID,
    body: LinkMentionRequest,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """将来源页面中第一个未链接的提及转为 [[wikilink]]。"""
    import re

    target = (await db.execute(
        select(WikiPage).where(WikiPage.id == page_id, WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="目标页面不存在")

    source = (await db.execute(
        select(WikiPage).where(
            WikiPage.id == uuid.UUID(body.source_page_id),
            WikiPage.user_id == user_id,
            WikiPage.kb_id == kb_id,
        )
    )).scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="来源页面不存在")

    content = source.content or ""
    for m in re.finditer(re.escape(body.mention_text), content, re.IGNORECASE):
        start, end = m.start(), m.end()
        before = content[max(0, start - 2):start]
        after = content[end:end + 2]
        if before.endswith("[[") and after.startswith("]]"):
            continue
        if _is_inside_wikilink(content, start):
            continue
        actual = content[start:end]
        content = content[:start] + f"[[{actual}]]" + content[end:]
        break

    source.content = content
    source.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(source)

    await cache_delete_pattern("wiki:pages:*")
    await cache_delete_pattern("wiki:search:*")
    try:
        await cache_delete(wiki_page_key(source.slug, str(user_id), str(kb_id)))
    except Exception:
        logger.exception("Failed to delete cache for source slug=%s", source.slug)
        pass

    return {"success": True, "page_id": str(source.id), "slug": source.slug}
