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
    set_entity_heartbeat,
    try_acquire_entity_lock,
)

logger = logging.getLogger(__name__)


def _step(article_id: str, state: str, progress: int, message: str = "") -> None:
    """Update both heartbeat and DB status for an article."""
    pipeline_step("article", article_id, state, progress, message)


@celery_app.task(
    name="app.tasks.article_tasks.process_article",
    queue="pingcha.pipeline",
    time_limit=3600,
    soft_time_limit=3540,
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

        _step(article_id, "pending", 0, "任务开始")
        _step(article_id, "fetching", 5, "正在提取文章内容...")

        async def _do():
            aid = uuid.UUID(article_id)

            # Step 1: Extract article content
            async with task_session() as db:
                result = await db.execute(select(Article).where(Article.id == aid))
                article = result.scalar_one_or_none()
                if not article:
                    raise RuntimeError(f"Article {article_id} not found")

                if article.content:
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
                        raise RuntimeError(f"Failed to extract article content from {article.source_url}")

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

            return fast_summaries

        fast_summaries = asyncio.run(_do())

        total = time.monotonic() - pipeline_start
        logger.info("[article-pipeline:%s] === Complete in %.1fs ===", article_id, total)

        _step(article_id, "done", 100, "处理完成")
        delete_entity_heartbeat("article", article_id)

        return {"article_id": article_id, "state": "done", "summary_count": len(fast_summaries)}

    except SoftTimeLimitExceeded:
        logger.error("[article-pipeline:%s] Timeout", article_id)
        _step(article_id, "failed", 0, "处理超时，请重试")
        raise

    except Exception as exc:
        logger.exception("[article-pipeline:%s] Failed: %s", article_id, exc)
        _step(article_id, "failed", 0, str(exc))
        raise

    finally:
        release_entity_lock("article", article_id)


@celery_app.task(name="app.tasks.article_tasks.generate_full_article_summary", queue="pingcha",
                 soft_time_limit=600, time_limit=660)
def generate_full_article_summary(article_id: str) -> dict:
    """Generate full (90%) summary on-demand."""
    async def _do():
        aid = uuid.UUID(article_id)
        async with task_session() as db:
            await generate_and_store_full_summary(db, aid)

    asyncio.run(_do())
    return {"article_id": article_id, "level": "full", "state": "done"}
