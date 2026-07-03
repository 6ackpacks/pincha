"""Celery tasks for article processing pipeline."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import select

from app.core.database import task_session
from app.models.article import Article
from app.services.article_mindmap_service import get_or_create_article_mindmap
from app.services.article_service import extract_article
from app.services.article_summary_service import (
    generate_and_store_fast_summaries,
    generate_and_store_full_summary,
)
from app.tasks.celery_app import celery_app
from app.tasks.shared import (
    delete_entity_heartbeat,
    pipeline_step,
    release_entity_lock,
    run_async,
    set_entity_heartbeat,
    try_acquire_entity_lock,
)
from app.tasks.wiki_tasks import ingest_article

logger = logging.getLogger(__name__)


SOURCE_UNAVAILABLE_ERROR = "source_unavailable"


def _step(article_id: str, state: str, progress: int, message: str = "") -> None:
    """Update both heartbeat and DB status for an article."""
    pipeline_step("article", article_id, state, progress, message)


@celery_app.task(
    name="app.tasks.article_tasks.process_article",
    time_limit=3600,
    soft_time_limit=3540,
    ignore_result=True,
)
def process_article(article_id: str) -> dict:
    """Main article processing pipeline.

    Steps:
      1. Acquire distributed lock
      2. Fetch and extract article fulltext (trafilatura)
      3. Generate fast summaries (detailed -> highlight -> express)
      4. Generate mindmap
    """
    if not try_acquire_entity_lock("article", article_id):
        logger.info("Article %s already being processed, skipping.", article_id)
        return {"article_id": article_id, "state": "skipped", "reason": "already_processing"}

    try:
        pipeline_start = time.monotonic()
        logger.info("[article-pipeline:%s] === Started ===", article_id)

        # SSRF 防护：在抓取之前同步校验 URL（双重保险）
        from app.core.url_validator import validate_url as _validate_url_sync, SSRFError as _SSRFError
        from app.tasks.shared import get_sync_engine
        from sqlalchemy import text as _text
        with get_sync_engine().connect() as _conn:
            _url_row = _conn.execute(
                _text("SELECT source_url FROM articles WHERE id = :aid"),
                {"aid": article_id},
            ).fetchone()
        if _url_row and _url_row[0]:
            try:
                _validate_url_sync(_url_row[0])
            except _SSRFError as e:
                logger.warning("[article-pipeline:%s] SSRF blocked: %s", article_id, e)
                _step(article_id, "failed", 0, f"URL 安全校验失败：{e}")
                return {"article_id": article_id, "state": "failed", "reason": "ssrf_blocked"}

        _step(article_id, "pending", 0, "任务开始")
        _step(article_id, "fetching", 5, "正在提取文章内容...")

        async def _do():
            aid = uuid.UUID(article_id)
            article_source_type: str | None = None
            article_user_id: uuid.UUID | None = None
            article_kb_id: uuid.UUID | None = None
            article_in_wiki = False

            # Step 1: Extract article content
            async with task_session() as db:
                result = await db.execute(select(Article).where(Article.id == aid))
                article = result.scalar_one_or_none()
                if not article:
                    raise RuntimeError(f"Article {article_id} not found")

                article_source_type = article.source_type
                article_user_id = article.user_id
                article_kb_id = article.kb_id
                article_in_wiki = article.in_wiki

                if article.content:
                    if article.source_type == "curate_pick":
                        from app.services.curate_v2.content_parser import extract_plain_text

                        normalized_content = extract_plain_text(article.content)
                        if normalized_content and normalized_content != article.content:
                            article.content = normalized_content
                            article.word_count = len(normalized_content)
                            await db.commit()
                    logger.info(
                        "[article-pipeline:%s] Content already provided (%s mode), skipping extraction",
                        article_id,
                        article.source_type,
                    )
                else:
                    t0 = time.monotonic()
                    extracted = await extract_article(article.source_url)
                    logger.info("[article-pipeline:%s] Extraction took %.1fs, success=%s",
                                article_id, time.monotonic() - t0, extracted["success"])

                    if not extracted["success"]:
                        raise RuntimeError(SOURCE_UNAVAILABLE_ERROR)

                    article.content = extracted["content"]
                    article.title = extracted.get("title") or article.title
                    article.author = extracted.get("author")
                    article.thumbnail_url = extracted.get("thumbnail_url")
                    article.word_count = extracted.get("word_count")
                    article.language = extracted.get("language")
                    await db.commit()

            _step(article_id, "fetching", 30, "文章内容提取完成")
            _step(article_id, "summarizing", 35, "生成快速总结中...")

            # Step 2: Fast summaries
            async def _hb_loop():
                try:
                    tick = 0
                    while True:
                        await asyncio.sleep(30)
                        tick += 1
                        elapsed_min = tick * 30 / 60
                        set_entity_heartbeat("article", article_id, "summarizing", 50, f"AI 总结生成中... ({elapsed_min:.1f}分钟)")
                except asyncio.CancelledError:
                    pass

            hb_task = asyncio.create_task(_hb_loop())
            try:
                async with task_session() as db:
                    fast_summaries = await generate_and_store_fast_summaries(db, aid)
            finally:
                hb_task.cancel()
                await asyncio.gather(hb_task, return_exceptions=True)

            logger.info("[article-pipeline:%s] Fast summaries: %d levels", article_id, len(fast_summaries))
            _step(article_id, "summarizing", 85, "生成思维导图中...")

            # Step 3: Mindmap
            t_mm = time.monotonic()
            try:
                async with task_session() as db:
                    await get_or_create_article_mindmap(db, aid)
                logger.info("[article-pipeline:%s] Mindmap in %.1fs", article_id, time.monotonic() - t_mm)
            except Exception as exc:
                logger.warning("[article-pipeline:%s] Mindmap failed: %s", article_id, exc)

            return {
                "summary_count": len(fast_summaries),
                "source_type": article_source_type,
                "user_id": str(article_user_id) if article_user_id else None,
                "kb_id": str(article_kb_id) if article_kb_id else None,
                "in_wiki": article_in_wiki,
            }

        result = run_async(_do())

        if (
            result["source_type"] == "curate_pick"
            and not result["in_wiki"]
            and result["user_id"]
        ):
            logger.info("[article-pipeline:%s] Handing off to wiki ingest", article_id)
            _step(article_id, "compiling", 90, "内容已整理完成，正在加入知识库...")
            delete_entity_heartbeat("article", article_id)
            ingest_article(article_id, result["user_id"], result["kb_id"])
        else:
            _step(article_id, "done", 100, "处理完成")

        total = time.monotonic() - pipeline_start
        logger.info("[article-pipeline:%s] === Complete in %.1fs ===", article_id, total)
        delete_entity_heartbeat("article", article_id)

        # 持久化「解析完成」通知：给文章 owner 写一条（幂等）
        try:
            from app.services.curate_v2.notifier import (
                create_organize_done_notification_for_article,
            )
            from app.tasks.shared import get_sync_engine
            from sqlalchemy import text as _text
            _art_user_id = result.get("user_id")
            if _art_user_id:
                with get_sync_engine().connect() as _nconn:
                    _trow = _nconn.execute(
                        _text("SELECT title FROM articles WHERE id = :aid"),
                        {"aid": article_id},
                    ).fetchone()
                _art_title = _trow[0] if _trow and _trow[0] else None
                create_organize_done_notification_for_article(
                    _art_user_id, article_id, _art_title
                )
        except Exception as _ne:
            logger.warning("[article-pipeline:%s] organize_done notification failed: %s", article_id, _ne)

        return {"article_id": article_id, "state": "done", "summary_count": result["summary_count"]}

    except SoftTimeLimitExceeded:
        logger.error("[article-pipeline:%s] Timeout", article_id)
        _step(article_id, "failed", 0, "处理超时，请重试")
        raise

    except Exception as exc:
        logger.exception("[article-pipeline:%s] Failed: %s", article_id, exc)
        message = "原帖已删除或暂时不可访问" if str(exc) == SOURCE_UNAVAILABLE_ERROR else "文章整理失败，请稍后重试"
        _step(article_id, "failed", 0, message)
        raise

    finally:
        release_entity_lock("article", article_id)


@celery_app.task(name="app.tasks.article_tasks.generate_full_article_summary", queue="pingcha",
                 soft_time_limit=600, time_limit=660, ignore_result=True)
def generate_full_article_summary(article_id: str) -> dict:
    """Generate full (90%) summary on-demand."""
    async def _do():
        aid = uuid.UUID(article_id)
        async with task_session() as db:
            await generate_and_store_full_summary(db, aid)

    run_async(_do())
    return {"article_id": article_id, "level": "full", "state": "done"}
