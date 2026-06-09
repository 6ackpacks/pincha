"""Celery tasks for wiki KB compilation."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.cache import video_detail_key
from app.tasks.celery_app import celery_app
from app.tasks.shared import get_async_session, get_sync_engine, get_sync_redis

logger = logging.getLogger(__name__)

WIKI_COMPILE_TTL = 600  # seconds

# Cache key patterns to invalidate after wiki compilation
WIKI_CACHE_PATTERNS = [
    "wiki:pages:*",
    "wiki:tags:*",
    "wiki:graph:*",
    "wiki:search:*",
    "wiki:health:*",
    "wiki:videos:*",
]


def _invalidate_wiki_caches() -> None:
    """Delete all wiki-related Redis caches after compilation completes."""
    r = get_sync_redis()
    for pattern in WIKI_CACHE_PATTERNS:
        keys = list(r.scan_iter(match=pattern, count=100))
        if keys:
            r.delete(*keys)
    logger.info("Invalidated wiki caches: %s", WIKI_CACHE_PATTERNS)


def _set_compile_progress(video_id: str, state: str, progress: int, message: str) -> None:
    """Write wiki compile progress to Redis."""
    r = get_sync_redis()
    r.setex(
        f"wiki:compile:{video_id}",
        WIKI_COMPILE_TTL,
        json.dumps({"state": state, "progress": progress, "message": message}),
    )


def _run_async(coro):
    """Run an async coroutine from a sync Celery task context.

    Uses asyncio.run() which properly handles Task cancellation and
    event loop cleanup, preventing leaked coroutines/tasks.
    """
    return asyncio.run(coro)


@celery_app.task(
    name="app.tasks.wiki_tasks.compile_wiki_from_video",
    max_retries=2,
    default_retry_delay=60,
    soft_time_limit=1800,
    time_limit=1920,
)
def compile_wiki_from_video(video_id: str, user_id: str, kb_id: str | None = None) -> dict:
    """Compile wiki pages from a video's full-level summary.

    Triggered after the user clicks "加入知识库" on the video detail page.
    Runs on pingcha.pipeline queue.
    """
    from app.services.wiki_compiler_service import compile_source_into_wiki

    logger.info("Wiki compile task started: video=%s user=%s", video_id, user_id)

    engine = get_sync_engine()
    with Session(engine) as session:
        # Get video title and full summary content
        row = session.execute(
            text("""
                SELECT v.title, s.content
                FROM videos v
                JOIN summaries s ON s.video_id = v.id AND s.level = 'full'
                WHERE v.id = :vid
            """),
            {"vid": video_id},
        ).fetchone()

        if row is None:
            # Try detailed level as fallback
            row = session.execute(
                text("""
                    SELECT v.title, s.content
                    FROM videos v
                    JOIN summaries s ON s.video_id = v.id AND s.level = 'detailed'
                    WHERE v.id = :vid
                """),
                {"vid": video_id},
            ).fetchone()

        if row is None:
            logger.error("No summary found for video %s — cannot compile wiki", video_id)
            return {"error": "no_summary"}

        video_title = row[0] or f"视频 {video_id[:8]}"
        content = row[1]

    _set_compile_progress(video_id, "analyzing", 10, "正在分析内容")

    # Run async compilation
    async def _compile():
        async with get_async_session() as db:
            result = await compile_source_into_wiki(
                user_id=uuid.UUID(user_id),
                source_type="video",
                source_id=uuid.UUID(video_id),
                source_title=video_title,
                content=content,
                db=db,
                kb_id=uuid.UUID(kb_id) if kb_id else None,
            )
        return result

    try:
        _set_compile_progress(video_id, "extracting", 30, "正在提取知识实体")
        result = _run_async(_compile())

        pages_written = result.get("pages_created", 0) + result.get("pages_updated", 0)
        _set_compile_progress(video_id, "done", 100, f"已生成 {pages_written} 个知识词条")
        # Invalidate wiki caches so frontend sees fresh data
        _invalidate_wiki_caches()
        r = get_sync_redis()
        if pages_written > 0:
            with Session(engine) as session:
                session.execute(
                    text("UPDATE videos SET in_wiki = true, updated_at = NOW() WHERE id = :vid"),
                    {"vid": video_id},
                )
                session.commit()
            r.delete(video_detail_key(video_id))
        else:
            with Session(engine) as session:
                session.execute(
                    text("UPDATE videos SET in_wiki = false, updated_at = NOW() WHERE id = :vid"),
                    {"vid": video_id},
                )
                session.commit()
            r.delete(video_detail_key(video_id))
            logger.warning(
                "Wiki compile produced 0 pages for video %s — in_wiki reset to false", video_id
            )

        logger.info("Wiki compile done: video=%s result=%s", video_id, result)
        return result
    except Exception as exc:
        # Report failure to Redis for frontend polling
        _set_compile_progress(video_id, "failed", 0, f"编译失败: {exc}")
        # Reset in_wiki on hard failure so user can retry
        try:
            with Session(engine) as session:
                session.execute(
                    text("UPDATE videos SET in_wiki = false, updated_at = NOW() WHERE id = :vid"),
                    {"vid": video_id},
                )
                session.commit()
        except Exception:
            pass
        logger.error("Wiki compile failed: video=%s error=%s", video_id, exc)
        raise
    finally:
        # Release the distributed lock so the endpoint can re-dispatch if needed
        try:
            get_sync_redis().delete(f"wiki:compile_lock:{video_id}")
        except Exception:
            pass


@celery_app.task(
    name="app.tasks.wiki_tasks.ingest_article",
    max_retries=2,
    default_retry_delay=60,
)
def ingest_article(article_id: str, user_id: str, kb_id: str | None = None) -> dict:
    """Fetch article content (if URL) and compile into wiki.

    Runs on pingcha.pipeline queue.
    """
    from app.services.wiki_compiler_service import compile_source_into_wiki

    logger.info("Article ingest task started: article=%s user=%s", article_id, user_id)

    engine = get_sync_engine()
    _set_compile_progress(article_id, "fetching", 5, "正在获取文章内容")

    with Session(engine) as session:
        row = session.execute(
            text("SELECT source_type, source_url, title, content FROM articles WHERE id = :aid"),
            {"aid": article_id},
        ).fetchone()

        if row is None:
            logger.error("Article %s not found", article_id)
            return {"error": "article_not_found"}

        source_type_val, source_url, title, content = row

    # If URL type and content not yet fetched, fetch via TikHub
    if source_type_val == "url" and not content:
        # Mark as fetching
        with Session(engine) as session:
            session.execute(
                text("UPDATE articles SET status = CAST(:s AS jsonb), updated_at = NOW() WHERE id = :aid"),
                {"s": json.dumps({"state": "fetching", "progress": 10, "message": "正在抓取网页内容"}), "aid": article_id},
            )
            session.commit()
        try:
            content = _run_async(_fetch_tikhub(source_url))
            if not title:
                title = source_url

            with Session(engine) as session:
                session.execute(
                    text("""
                        UPDATE articles
                        SET content = :content, title = :title,
                            status = CAST(:status AS jsonb), updated_at = NOW()
                        WHERE id = :aid
                    """),
                    {
                        "content": content,
                        "title": title,
                        "status": json.dumps({"state": "compiling", "progress": 50, "message": "正在编译知识库"}),
                        "aid": article_id,
                    },
                )
                session.commit()
        except Exception as exc:
            logger.error("TikHub fetch failed for article %s: %s", article_id, exc)
            with Session(engine) as session:
                session.execute(
                    text("""
                        UPDATE articles
                        SET status = CAST(:status AS jsonb), updated_at = NOW()
                        WHERE id = :aid
                    """),
                    {
                        "status": json.dumps({"state": "failed", "progress": 0, "message": f"抓取失败: {exc}"}),
                        "aid": article_id,
                    },
                )
                session.commit()
            return {"error": str(exc)}

    if not content:
        logger.error("Article %s has no content", article_id)
        with Session(engine) as session:
            session.execute(
                text("""
                    UPDATE articles
                    SET status = CAST(:status AS jsonb), updated_at = NOW()
                    WHERE id = :aid
                """),
                {
                    "status": json.dumps({"state": "failed", "progress": 0, "message": "内容为空，无法编译"}),
                    "aid": article_id,
                },
            )
            session.commit()
        return {"error": "no_content"}

    article_title = title or f"文章 {article_id[:8]}"

    _set_compile_progress(article_id, "extracting", 30, "正在提取知识实体")

    # Update status to compiling before starting (text type skips fetching step)
    with Session(engine) as session:
        session.execute(
            text("""
                UPDATE articles
                SET status = CAST(:status AS jsonb), updated_at = NOW()
                WHERE id = :aid AND status->>'state' NOT IN ('compiling', 'done', 'failed')
            """),
            {
                "status": json.dumps({"state": "compiling", "progress": 30, "message": "正在编译知识库"}),
                "aid": article_id,
            },
        )
        session.commit()

    # Compile into wiki
    async def _compile():
        async with get_async_session() as db:
            result = await compile_source_into_wiki(
                user_id=uuid.UUID(user_id),
                source_type="article",
                source_id=uuid.UUID(article_id),
                source_title=article_title,
                content=content,
                db=db,
                kb_id=uuid.UUID(kb_id) if kb_id else None,
            )
        return result

    try:
        result = _run_async(_compile())

        _set_compile_progress(article_id, "done", 100, "已加入知识库")
        # Invalidate wiki caches so frontend sees fresh data
        _invalidate_wiki_caches()

        with Session(engine) as session:
            session.execute(
                text("""
                    UPDATE articles
                    SET in_wiki = true,
                        status = CAST(:status AS jsonb),
                        updated_at = NOW()
                    WHERE id = :aid
                """),
                {
                    "status": json.dumps({"state": "done", "progress": 100, "message": "已加入知识库"}),
                    "aid": article_id,
                },
            )
            session.commit()

        logger.info("Article ingest done: article=%s result=%s", article_id, result)
        return result
    except Exception as exc:
        logger.error("Article ingest failed: article=%s error=%s", article_id, exc)
        _set_compile_progress(article_id, "failed", 0, f"编译失败: {exc}")
        # Mark article as failed so UI can surface the error
        try:
            with Session(engine) as session:
                session.execute(
                    text("""
                        UPDATE articles
                        SET status = CAST(:status AS jsonb), updated_at = NOW()
                        WHERE id = :aid
                    """),
                    {
                        "status": json.dumps({"state": "failed", "progress": 0, "message": f"编译失败: {exc}"}),
                        "aid": article_id,
                    },
                )
                session.commit()
        except Exception:
            pass
        raise


async def _fetch_tikhub(url: str) -> str:
    """Fetch article content from TikHub API.

    TikHub endpoint: GET /api/v1/web_crawler/get_web_content?url=<url>
    Response schema: {"code": 200, "data": {"content": "...", "title": "..."}}
    """
    import httpx
    from app.config import settings

    if not settings.TIKHUB_API_KEY:
        raise ValueError("TIKHUB_API_KEY not configured")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(
            f"{settings.TIKHUB_API_BASE}/api/v1/web_crawler/get_web_content",
            params={"url": url},
            headers={"Authorization": f"Bearer {settings.TIKHUB_API_KEY}"},
        )
        resp.raise_for_status()
        data = resp.json()

    # TikHub response: {"code": 200, "data": {"content": "...", "title": "..."}}
    # Gracefully handle multiple possible shapes
    inner = data.get("data") or {}
    if isinstance(inner, dict):
        content = (
            inner.get("content")
            or inner.get("text")
            or inner.get("markdown")
            or ""
        )
    else:
        content = str(inner) if inner else ""

    # Fallback: top-level content key
    if not content:
        content = data.get("content") or data.get("text") or ""

    if not content:
        raise ValueError(f"TikHub returned no content for {url} — response: {str(data)[:200]}")
    return content
