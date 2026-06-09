"""Mindmap generation service: LLM generates Markdown for markmap rendering."""

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.mindmap import Mindmap
from app.models.transcript import Transcript
from app.services.mindmap_engine import generate_mindmap_markdown
from app.services.summary_service import get_best_summary_content

logger = logging.getLogger(__name__)

MINDMAP_PROMPT = (
    "你是一位专业的知识结构化专家。请将以下视频内容转化为思维导图的 Markdown 格式。\n\n"
    "输入格式说明：每行字幕前面带有时间戳，格式为 [MM:SS]，表示该内容在视频中的起始时间。\n\n"
    "要求：\n"
    "- 使用 # 作为视频主题（根节点）\n"
    "- 使用 ## 作为 3-6 个核心主题分支\n"
    "- 使用 ### 作为每个主题下的 2-4 个子观点\n"
    "- 使用无序列表（-）列出关键细节，每条不超过15个字\n"
    "- 整体不超过4层深度\n"
    "- 节点文字要简洁精炼，避免长句\n"
    "- 【时间戳】每个 ##、### 和列表项末尾必须标注该内容对应的视频时间，格式为 [MM:SS]，取该段内容最早出现的时间戳\n"
    "- 示例：## 核心观点一 [03:25]\n"
    "- 示例：- 关键细节 [04:10]\n"
    "- 【重要】直接输出 Markdown 内容，禁止用代码块（```）包裹，不要任何解释或说明\n"
    "- 【重要】无论输入是什么语言，输出必须全程使用中文"
)


def _format_timestamp(seconds: float) -> str:
    """Format seconds to MM:SS."""
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m:02d}:{s:02d}"


async def _fetch_source_text(db: AsyncSession, video_id: uuid.UUID) -> str:
    """Fetch transcript segments with timestamps as primary source for mindmap."""
    # Prefer transcript segments (has timestamps for node linking)
    result = await db.execute(
        select(Transcript.segments).where(Transcript.video_id == video_id)
    )
    segments = result.scalar_one_or_none()
    if segments and isinstance(segments, list) and len(segments) > 0:
        lines = []
        for seg in segments:
            ts = _format_timestamp(seg.get("start", 0))
            text = seg.get("text", "").strip()
            if text:
                lines.append(f"[{ts}] {text}")
        if lines:
            return "\n".join(lines)

    # Fallback to summary (via summary_service to avoid cross-domain model dependency)
    content = await get_best_summary_content(db, video_id)
    if content:
        return content

    # Final fallback to transcript full_text
    result = await db.execute(
        select(Transcript.full_text).where(Transcript.video_id == video_id)
    )
    full_text = result.scalar_one_or_none()
    if full_text:
        return full_text[:50000]

    raise HTTPException(status_code=404, detail="No summary or transcript found for mindmap generation")


async def get_or_create_mindmap(
    db: AsyncSession, video_id: uuid.UUID
) -> tuple[Mindmap, bool]:
    """Return (mindmap, cached). If cached, cached=True."""
    result = await db.execute(
        select(Mindmap).where(Mindmap.video_id == video_id)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, True

    source_text = await _fetch_source_text(db, video_id)
    markdown = await generate_mindmap_markdown(source_text, system_prompt=MINDMAP_PROMPT)

    stmt = (
        pg_insert(Mindmap)
        .values(
            video_id=video_id,
            markdown=markdown,
            model_used=settings.SUMMARY_MODEL,
        )
        .on_conflict_do_nothing(constraint="uq_mindmaps_video")
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(Mindmap).where(Mindmap.video_id == video_id)
    )
    mindmap = result.scalar_one()
    return mindmap, False


async def regenerate_mindmap(
    db: AsyncSession, video_id: uuid.UUID
) -> Mindmap:
    """Force regenerate mindmap, overwriting cache."""
    source_text = await _fetch_source_text(db, video_id)
    markdown = await generate_mindmap_markdown(source_text, system_prompt=MINDMAP_PROMPT)

    stmt = (
        pg_insert(Mindmap)
        .values(
            video_id=video_id,
            markdown=markdown,
            model_used=settings.SUMMARY_MODEL,
        )
        .on_conflict_do_update(
            constraint="uq_mindmaps_video",
            set_={"markdown": markdown, "model_used": settings.SUMMARY_MODEL},
        )
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(Mindmap).where(Mindmap.video_id == video_id)
    )
    return result.scalar_one()
