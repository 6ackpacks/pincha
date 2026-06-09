"""Wiki domain utilities.

Shared helper functions used by both the wiki API layer and wiki services.
These are domain-level utilities (not HTTP-specific), so they belong in the
service layer to avoid reverse dependencies (service -> API).
"""

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.wiki import WikiPage, WikiRelation


# ---------------------------------------------------------------------------
# Slug generation
# ---------------------------------------------------------------------------

def make_slug(title: str) -> str:
    """从标题生成 URL 安全的 slug。中文字符保持原样。

    CJK 范围: \\u4e00-\\u9fff (覆盖 CJK 统一汉字)。
    """
    slug = title.strip().lower().replace(" ", "-")
    slug = re.sub(r"[^\w\u4e00-\u9fff-]", "", slug)
    return slug[:80] or "untitled"


# ---------------------------------------------------------------------------
# WikiLink syncing
# ---------------------------------------------------------------------------

# 匹配 [[Target]] 或 [[Target|Alias]] 的正则
_WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")


async def sync_wikilinks_to_relations(
    db: AsyncSession, page: WikiPage, user_id: uuid.UUID, kb_id: uuid.UUID
) -> None:
    """解析页面内容中的 [[WikiLink]]，同步到 WikiRelation 表（type='wikilink'）。

    添加缺失的关系，删除过期的关系。不触碰其他 relation_type 的关系。
    """
    linked_titles: set[str] = set()
    if page.content:
        for m in _WIKILINK_RE.finditer(page.content):
            linked_titles.add(m.group(1).strip())

    target_page_ids: set[uuid.UUID] = set()
    for title in linked_titles:
        result = await db.execute(
            select(WikiPage.id).where(
                WikiPage.user_id == user_id,
                WikiPage.kb_id == kb_id,
                WikiPage.title == title,
                WikiPage.id != page.id,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            target_page_ids.add(row)
            continue
        slug = make_slug(title)
        result = await db.execute(
            select(WikiPage.id).where(
                WikiPage.user_id == user_id,
                WikiPage.kb_id == kb_id,
                WikiPage.slug == slug,
                WikiPage.id != page.id,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            target_page_ids.add(row)

    existing_result = await db.execute(
        select(WikiRelation).where(
            WikiRelation.from_page_id == page.id,
            WikiRelation.relation_type == "wikilink",
        )
    )
    existing_rels = existing_result.scalars().all()
    existing_target_ids = {r.to_page_id for r in existing_rels}

    for tid in target_page_ids - existing_target_ids:
        any_rel = await db.execute(
            select(WikiRelation).where(
                WikiRelation.from_page_id == page.id,
                WikiRelation.to_page_id == tid,
            )
        )
        if any_rel.scalar_one_or_none() is None:
            db.add(WikiRelation(
                from_page_id=page.id,
                to_page_id=tid,
                relation_type="wikilink",
                strength=0.8,
            ))

    for rel in existing_rels:
        if rel.to_page_id not in target_page_ids:
            await db.delete(rel)
