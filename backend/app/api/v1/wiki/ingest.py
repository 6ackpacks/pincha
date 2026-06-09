"""Wiki 视频导入与跨源问答路由。

包含视频加入/移除知识库、编译状态查询、跨源 Q&A 流式回答、
以及已入库视频列表等端点。
"""

import logging
import uuid
from collections import defaultdict

logger = logging.getLogger(__name__)

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.rag_service import embed_texts

from app.config import settings
from app.core.auth import get_current_kb_id, get_current_user
from app.core.rate_limit import limiter
from app.core.cache import (
    WIKI_VIDEOS_TTL,
    cache_delete_pattern,
    cache_get,
    cache_set,
    wiki_videos_key,
)
from app.core.database import get_session
from app.core.deps import require_user_article, require_user_video
from app.models.user import User
from app.models.wiki import WikiPage, WikiSource

from app.api.v1.wiki.schemas import (
    AskRequest,
    WikiVideoPageRef,
    WikiVideoItem,
)
from app.api.v1.wiki.deps import get_current_user_id

router = APIRouter(tags=["wiki"])


# ---------------------------------------------------------------------------
# 视频 → Wiki
# ---------------------------------------------------------------------------

@router.post("/videos/{video_id}/ingest", status_code=202)
async def add_video_to_wiki(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """触发视频的 wiki 编译。要求视频已处理完成。"""
    video = await require_user_video(db, current_user, video_id)

    state = (video.status or {}).get("state")
    if state != "done":
        raise HTTPException(status_code=400, detail="视频尚未处理完成，请等待分析完成后再加入知识库")

    existing_source = await db.execute(
        select(WikiSource.id)
        .join(WikiPage, WikiPage.id == WikiSource.wiki_page_id)
        .where(
            WikiSource.source_type == "video",
            WikiSource.source_id == video_id,
            WikiPage.user_id == current_user.id,
            WikiPage.kb_id == kb_id,
        )
        .limit(1)
    )
    if existing_source.scalar_one_or_none():
        return {"message": "已在知识库中", "already_ingested": True}

    # 分布式锁：防止快速点击重复派发
    from app.core.redis import get_redis
    _redis = await get_redis()
    lock_key = f"wiki:compile_lock:{video_id}"
    acquired = await _redis.set(lock_key, "1", ex=600, nx=True)
    if not acquired:
        return {"message": "已在编译队列中", "already_ingested": False}

    # 提交 session 以持久化可能新创建的默认 KB
    await db.commit()

    from app.tasks.wiki_tasks import compile_wiki_from_video
    compile_wiki_from_video.apply_async(
        args=[str(video_id), str(current_user.id), str(kb_id)],
        queue="pingcha.pipeline",
    )
    await cache_delete_pattern("wiki:pages:*")
    await cache_delete_pattern("wiki:tags:*")
    return {"message": "已加入编译队列", "already_ingested": False}


@router.get("/compile-status/{video_id}")
async def get_compile_status(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """查询视频（或文章）的 wiki 编译进度。"""
    try:
        await require_user_video(db, current_user, video_id)
    except HTTPException:
        await require_user_article(db, current_user, kb_id, video_id)

    import json
    from app.core.redis import get_redis
    _redis = await get_redis()
    raw = await _redis.get(f"wiki:compile:{video_id}")
    if raw:
        return json.loads(raw)
    return {"state": "idle", "progress": 0, "message": ""}


@router.delete("/videos/{video_id}", status_code=200)
async def remove_video_from_wiki(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """从知识库移除视频的贡献（标记 in_wiki=false，删除 wiki_sources 记录）。"""
    video = await require_user_video(db, current_user, video_id)

    sources = await db.execute(
        select(WikiSource)
        .join(WikiPage, WikiPage.id == WikiSource.wiki_page_id)
        .where(
            WikiSource.source_type == "video",
            WikiSource.source_id == video_id,
            WikiPage.user_id == current_user.id,
            WikiPage.kb_id == kb_id,
        )
    )
    for src in sources.scalars().all():
        await db.delete(src)

        page_result = await db.execute(
            select(WikiPage).where(WikiPage.id == src.wiki_page_id)
        )
        page = page_result.scalar_one_or_none()
        if page:
            page.source_count = max(0, (page.source_count or 1) - 1)

    remaining_sources = await db.execute(
        select(func.count()).select_from(WikiSource).where(
            WikiSource.source_type == "video",
            WikiSource.source_id == video_id,
        )
    )
    if remaining_sources.scalar_one() == 0:
        video.in_wiki = False
    await db.commit()
    await cache_delete_pattern("wiki:pages:*")
    await cache_delete_pattern("wiki:tags:*")
    return {"message": "已从知识库移除"}


# ---------------------------------------------------------------------------
# 跨源问答
# ---------------------------------------------------------------------------

@router.post("/ask")
@limiter.limit("15/minute")
async def ask_wiki(
    request: Request,
    body: AskRequest,
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """通过 SSE 流式返回跨源 wiki 问答结果。"""
    import litellm
    import json as _json_sse

    q = body.question
    topic = body.topic

    try:
        # 主路径：基于 pgvector embedding 的语义搜索
        pages = []
        search_text = topic or q
        try:
            embeddings = await embed_texts([search_text])
        except Exception:
            logger.exception("Failed to embed text for wiki ask (topic=%s)", topic)
            embeddings = None

        if embeddings:
            emb = embeddings[0]
            emb_str = "[" + ",".join(str(x) for x in emb) + "]"
            raw = await db.execute(
                sa.text("""
                    SELECT id, (embedding <=> CAST(:emb AS vector)) AS dist
                    FROM wiki_pages
                    WHERE user_id = :uid AND kb_id = :kbid AND embedding IS NOT NULL
                    ORDER BY dist
                    LIMIT 8
                """),
                {"emb": emb_str, "uid": str(user_id), "kbid": str(kb_id)},
            )
            rows = raw.all()
            if rows:
                page_ids = [r.id for r in rows]
                page_result = await db.execute(
                    select(WikiPage).where(WikiPage.id.in_(page_ids))
                )
                pages_by_id = {p.id: p for p in page_result.scalars().all()}
                pages = [pages_by_id[pid] for pid in page_ids if pid in pages_by_id]

        # 回退：ILIKE 文本匹配
        if not pages:
            from sqlalchemy import or_
            result = await db.execute(
                select(WikiPage)
                .where(
                    WikiPage.user_id == user_id,
                    WikiPage.kb_id == kb_id,
                    or_(
                        WikiPage.title.ilike(f"%{search_text}%"),
                        WikiPage.content.ilike(f"%{search_text}%"),
                    ),
                )
                .order_by(WikiPage.updated_at.desc())
                .limit(8)
            )
            pages = result.scalars().all()

            if not pages and topic:
                result = await db.execute(
                    select(WikiPage)
                    .where(
                        WikiPage.user_id == user_id,
                        WikiPage.kb_id == kb_id,
                        or_(
                            WikiPage.title.ilike(f"%{q}%"),
                            WikiPage.content.ilike(f"%{q}%"),
                        ),
                    )
                    .order_by(WikiPage.updated_at.desc())
                    .limit(8)
                )
                pages = result.scalars().all()

        # 最终回退：最近的页面
        if not pages:
            result = await db.execute(
                select(WikiPage)
                .where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id)
                .order_by(WikiPage.updated_at.desc())
                .limit(8)
            )
            pages = result.scalars().all()

    except Exception as exc:
        logger.exception("wiki/ask pre-stream error")
        async def _error_stream():
            yield f"data: {_json_sse.dumps({'delta': f'知识库查询出错，请稍后重试。'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(_error_stream(), media_type="text/event-stream",
                                 headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})

    if not pages:
        async def _empty():
            yield f"data: {_json_sse.dumps({'delta': '知识库中暂无相关内容，请先将视频或文章加入知识库。'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(_empty(), media_type="text/event-stream",
                                 headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})

    # 构建上下文
    context_parts = []
    for p in pages:
        context_parts.append(f"## {p.title}\n{p.content[:2000]}")
    context = "\n\n---\n\n".join(context_parts)

    system_prompt = (
        "你是用户的个人知识库助手。根据以下知识库页面内容回答问题。\n"
        "回答时标注来源（用「来自《话题名》」）。如有矛盾观点请指出。\n"
        "只使用知识库中的内容，不要引入外部知识。\n"
        "用中文回答。\n"
        "输出格式要求：使用纯文本，不要使用 Markdown 语法（不要用 **加粗**、## 标题、- 列表符号等）。"
        "回答要简洁，控制在 200 字以内，除非用户明确要求详细。"
    )

    llm_messages = [
        {"role": "system", "content": system_prompt},
    ]
    if body.history:
        for msg in body.history[-6:]:
            llm_messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    llm_messages.append({"role": "user", "content": f"知识库内容：\n{context}\n\n问题：{q}"})

    async def _stream():
        try:
            resp = await litellm.acompletion(
                model=settings.SUMMARY_MODEL,
                messages=llm_messages,
                api_base=settings.SUMMARY_API_BASE,
                api_key=settings.OPENAI_API_KEY,
                stream=True,
                temperature=0.5,
            )
            async for chunk in resp:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    yield f"data: {_json_sse.dumps({'delta': delta})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: {_json_sse.dumps({'delta': f'问答出错：{exc}'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


# ---------------------------------------------------------------------------
# 已入库视频列表
# ---------------------------------------------------------------------------

@router.get("/videos", response_model=list[WikiVideoItem])
async def list_wiki_videos(
    db: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_current_user_id),
    kb_id: uuid.UUID = Depends(get_current_kb_id),
):
    """列出所有已加入知识库的视频及其贡献的页面。"""

    cache_key = wiki_videos_key(str(user_id), str(kb_id))
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached

    from sqlalchemy import text as _text
    rows = (await db.execute(
        _text("""
            SELECT
                v.id, v.title, v.thumbnail_url, v.created_at,
                wp.id AS page_id, wp.title AS page_title, wp.slug AS page_slug
            FROM videos v
            JOIN wiki_sources ws ON ws.source_type = 'video' AND ws.source_id = v.id
            JOIN wiki_pages wp ON wp.id = ws.wiki_page_id AND wp.user_id = :uid AND wp.kb_id = :kbid
            WHERE v.in_wiki = true
            ORDER BY v.created_at DESC, wp.title
        """),
        {"uid": str(user_id), "kbid": str(kb_id)},
    )).all()

    video_map: dict = {}
    video_order: list = []
    page_map: dict = defaultdict(list)
    for row in rows:
        vid = str(row.id)
        if vid not in video_map:
            video_map[vid] = row
            video_order.append(vid)
        page_map[vid].append(WikiVideoPageRef(
            id=str(row.page_id), title=row.page_title, slug=row.page_slug
        ))

    result = [
        WikiVideoItem(
            id=vid,
            title=video_map[vid].title,
            thumbnail_url=video_map[vid].thumbnail_url,
            created_at=video_map[vid].created_at,
            wiki_pages=page_map[vid],
        )
        for vid in video_order
    ]

    serialized = [item.model_dump(mode="json") for item in result]
    await cache_set(cache_key, serialized, WIKI_VIDEOS_TTL)
    return result