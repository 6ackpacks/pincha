"""Wiki entity service.

Handles entity extraction from source content, similarity matching,
page content generation, and merging entities into wiki pages.
"""

import json
import logging
import uuid
from typing import TypedDict

import litellm
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.wiki import WikiPage
from app.services.rag_service import embed_texts

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class Entity(TypedDict):
    title: str            # e.g. "注意力机制"
    type: str             # concept | entity | method | source | insight
    summary: str          # one-paragraph description
    key_claims: list[str] # bullet claims from this source
    tags: list[str]       # topic keywords
    related_titles: list[str]  # other entities extracted from same source


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

ANALYSIS_PROMPT = """你是一个知识分析专家。请深入分析以下内容，产出结构化分析报告。

【分析要求】
1. 识别所有重要实体（人物、组织、产品、工具）
2. 识别所有核心概念（理论、原理、框架、定义）
3. 识别所有方法论（技术路线、算法、流程、最佳实践）
4. 提炼每个知识点的：定义、工作原理、核心特征、应用场景、局限性
5. 识别知识点之间的关联关系和因果链条
6. 标注内容中存在的争议观点或矛盾之处
7. 与用户现有知识库对比，发现矛盾和可补充之处
8. 提炼内容中的核心观点和反直觉结论，这些应成为 insight 类型词条

来源标题：{source_title}

【用户现有知识库词条】
{existing_pages_context}

内容：
{content}

【输出要求】返回 JSON：
{{
  "analysis_text": "完整分析文本（保留所有细节）",
  "contradictions": [
    {{"entity": "相关词条名", "claim": "新来源的说法", "existing_claim": "现有知识库的说法", "severity": "minor 或 major"}}
  ],
  "suggestions": ["建议1", "建议2"],
  "relations": [
    {{"from": "实体A", "to": "实体B", "type": "related 或 extends 或 contradicts", "strength": 0.7}}
  ]
}}

【规则】
- analysis_text 必须包含完整分析，不要省略
- contradictions 只列出与现有知识库确实矛盾的内容，没有则为空数组
- relations 描述本次提取的实体之间的关系
- 直接返回 JSON，不要额外解释"""

ENTITY_EXTRACTION_PROMPT = """你是一个知识库编辑，负责将分析报告转化为结构化知识词条。

【分析报告】
{analysis}

【原始内容参考】
{content}

【输出要求】返回 JSON 数组，每个元素包含：
- title: 词条名称（简短规范，如"Transformer"、"李沐"、"强化学习"）
- type: 词条类型（必须是以下之一）
  - "concept": 抽象概念、理论、原理、框架
  - "entity": 具体实体，如人物、组织、产品、工具
  - "method": 方法论、算法、技术路线、操作流程
  - "source": 来源文献、论文、课程的核心摘要
  - "insight": 观点、论断、反直觉结论，标题必须是完整主张句（动词句），如"X 导致 Y"、"Z 是被高估的"
- summary: 开头定义段（100-150字），Wikipedia风格，直接定义是什么
- key_claims: 分章节的深度内容数组（3-5条），每条是一个完整段落（不少于50字），在正文中用 [[概念名]] 标注相关知识点
- tags: 关键词（3-5个）
- related_titles: 本次提取的其他词条中与之相关的名称

【规则】
- key_claims 每条必须是完整段落，不是短句
- 直接返回 JSON 数组，不要额外解释
- 只提取有实质内容支撑的词条"""

MERGE_PROMPT = """\
你是一个知识库维护专家。需要将新来源的信息合并到现有知识页面中。

【任务】更新知识页面，整合新内容，并检测矛盾。

【现有页面内容】
{existing_content}

【新来源信息】
来源：{source_title}
新增主张：
{new_claims}

【输出要求】返回 JSON：
{{
  "content": "更新后的完整 Markdown 页面内容（保留原有内容，整合新内容，话题切换用 ## 标题）",
  "has_contradiction": true/false,
  "contradiction_note": "如有矛盾，简述分歧（否则为空字符串）"
}}

【规则】
- 保留原有内容的所有主张，只追加或标注新信息
- 若新内容与现有内容明显矛盾，设 has_contradiction=true 并说明
- 不同来源的观点用 > 引用块 + 来源标注区分
- 在正文内容中，当提到其他知识概念时，请使用 [[概念名]] 语法来标注，格式与 Obsidian WikiLinks 一致。这些链接将用于建立知识图谱中的双向引用关系。
- 直接返回 JSON，不要额外解释
"""


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

async def _llm_call(prompt: str, model: str | None = None) -> str:
    """Call LLM and return response text."""
    m = model or settings.WIKI_COMPILER_MODEL
    api_base = settings.SUMMARY_API_BASE
    api_key = settings.OPENAI_API_KEY

    resp = await litellm.acompletion(
        model=m,
        messages=[{"role": "user", "content": prompt}],
        api_base=api_base,
        api_key=api_key,
        temperature=0.3,
    )
    return resp.choices[0].message.content or ""


def _parse_json(text: str) -> dict | list:
    """Extract JSON from LLM response (may be wrapped in markdown fences)."""
    # Strip ```json ... ``` if present
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last fence lines
        inner = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
        text = inner.strip()
    return json.loads(text)


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

async def extract_entities(
    content: str, source_title: str, existing_pages: list[dict] | None = None
) -> tuple[list[Entity], dict]:
    """Extract topic entities from source content using LLM (two-step: analyse then extract).

    Returns (entities, analysis_meta) where analysis_meta contains contradictions,
    suggestions, review_items, and relations from the analysis step.
    """
    analysis_meta: dict = {}
    try:
        # Build existing pages context
        if existing_pages:
            ctx_lines = [f"- {p['title']}: {(p.get('summary') or '')[:100]}" for p in existing_pages[:50]]
            existing_ctx = "\n".join(ctx_lines)
        else:
            existing_ctx = "（暂无已有词条）"

        # Step 1: deep analysis pass (now with structured JSON output)
        analysis_prompt = ANALYSIS_PROMPT.format(
            source_title=source_title,
            content=content[:12000],
            existing_pages_context=existing_ctx,
        )
        raw_analysis = await _llm_call(analysis_prompt)

        # Try to parse structured analysis
        analysis_text = raw_analysis
        try:
            parsed = _parse_json(raw_analysis)
            if isinstance(parsed, dict):
                analysis_meta = parsed
                analysis_text = parsed.get("analysis_text", raw_analysis)
        except (json.JSONDecodeError, ValueError):
            logger.warning("Analysis step returned non-JSON, using raw text")

        # Step 2: structured extraction based on analysis
        extraction_prompt = ENTITY_EXTRACTION_PROMPT.format(
            analysis=analysis_text,
            content=content[:3000],
        )
        raw = await _llm_call(extraction_prompt)
        data = _parse_json(raw)
        if isinstance(data, list):
            return data, analysis_meta  # type: ignore[return-value]
        logger.warning("Entity extraction returned non-list: %s", type(data))
        return [], analysis_meta
    except Exception as exc:
        logger.error("Entity extraction failed: %s", exc)
        return [], analysis_meta


def _slugify(title: str) -> str:
    """Convert a topic title to a URL-friendly slug.

    Delegates to the canonical make_slug in wiki_utils for consistency.
    """
    from app.services.wiki_utils import make_slug
    return make_slug(title)


async def find_similar_page(
    user_id: uuid.UUID,
    entity_title: str,
    db: AsyncSession,
    similarity_threshold: float = 0.85,
    kb_id: uuid.UUID | None = None,
) -> WikiPage | None:
    """Find an existing wiki page for this user that matches the entity title.

    First tries exact slug match, then falls back to embedding similarity.
    """
    slug = _slugify(entity_title)

    # 1. Exact slug match
    slug_filter = [WikiPage.user_id == user_id, WikiPage.slug == slug]
    if kb_id:
        slug_filter.append(WikiPage.kb_id == kb_id)
    result = await db.execute(
        select(WikiPage).where(*slug_filter)
    )
    page = result.scalar_one_or_none()
    if page:
        return page

    # 2. Semantic similarity via pgvector (if embeddings available)
    embeddings = await embed_texts([entity_title])
    if not embeddings:
        return None

    emb = embeddings[0]
    distance_threshold = 1.0 - similarity_threshold

    # Use raw SQL to avoid pgvector/SQLAlchemy type coercion issues with Python lists
    emb_str = "[" + ",".join(str(x) for x in emb) + "]"
    params: dict = {"emb": emb_str, "uid": str(user_id)}
    kb_clause = ""
    if kb_id:
        kb_clause = "AND kb_id = :kbid"
        params["kbid"] = str(kb_id)
    raw = await db.execute(
        sa.text(f"""
            SELECT id, (embedding <=> CAST(:emb AS vector)) AS dist
            FROM wiki_pages
            WHERE user_id = :uid {kb_clause} AND embedding IS NOT NULL
            ORDER BY dist
            LIMIT 1
        """),
        params,
    )
    row = raw.first()
    if row is None or row.dist is None or row.dist > distance_threshold:
        return None

    page_result = await db.execute(
        select(WikiPage).where(WikiPage.id == row.id)
    )
    return page_result.scalar_one_or_none()


async def _build_page_content(entity: Entity) -> str:
    """Build Wikipedia-style Markdown content for a new wiki page."""
    type_labels = {
        "concept": "概念",
        "entity": "实体",
        "method": "方法",
        "source": "来源",
        "insight": "洞察",
    }
    type_label = type_labels.get(entity.get("type", "concept"), "概念")

    lines = [
        f"# {entity['title']}",
        "",
        f"> **{type_label}** — {entity['summary']}",
        "",
    ]

    section_headers = {
        "concept": ["## 定义与原理", "## 核心特征", "## 应用场景", "## 局限性与争议"],
        "entity":  ["## 背景介绍", "## 主要贡献", "## 影响与评价", "## 相关人物与概念"],
        "method":  ["## 方法概述", "## 核心步骤", "## 适用场景", "## 优势与局限"],
        "source":  ["## 核心观点", "## 主要内容", "## 关键论证", "## 延伸阅读"],
        "insight": ["## 核心论断", "## 支撑论据", "## 反驳与局限", "## 相关洞察"],
    }
    headers = section_headers.get(entity.get("type", "concept"), section_headers["concept"])

    claims = entity.get("key_claims", [])
    for i, claim in enumerate(claims):
        if i < len(headers):
            lines.append(headers[i])
            lines.append("")
        lines.append(claim)
        lines.append("")

    return "\n".join(lines)


async def merge_entity_into_page(
    page: WikiPage,
    entity: Entity,
    source_title: str,
    db: AsyncSession,
) -> WikiPage:
    """Merge new entity info into an existing wiki page, detecting contradictions."""
    if not (page.content or "").strip():
        # Empty page: just set initial content
        page.content = await _build_page_content(entity)
        page.summary = entity["summary"]
        page.has_contradiction = False
        return page

    claims_text = "\n".join(f"- {c}" for c in entity.get("key_claims", []))
    prompt = MERGE_PROMPT.format(
        existing_content=(page.content or "")[:8000],
        source_title=source_title,
        new_claims=claims_text,
    )
    try:
        raw = await _llm_call(prompt)
        data = _parse_json(raw)
        if isinstance(data, dict):
            page.content = data.get("content", page.content)
            if data.get("has_contradiction"):
                page.has_contradiction = True
                note = data.get("contradiction_note", "")
                if note:
                    page.content += f"\n\n> ⚠️ **矛盾标注**：{note}\n"
    except Exception as exc:
        logger.error("Merge failed for page %s: %s", page.id, exc)
        # Append new claims without full merge on failure
        page.content += f"\n\n## 来自《{source_title}》的补充\n\n{claims_text}\n"

    return page


async def create_page_for_entity(
    user_id: uuid.UUID,
    entity: Entity,
    db: AsyncSession,
    kb_id: uuid.UUID | None = None,
) -> WikiPage:
    """Create a new wiki page for an entity that doesn't exist yet."""
    slug = _slugify(entity["title"])

    # Ensure slug uniqueness for this user by appending counter if needed
    base_slug = slug
    counter = 1
    while True:
        slug_filter = [WikiPage.user_id == user_id, WikiPage.slug == slug]
        if kb_id:
            slug_filter.append(WikiPage.kb_id == kb_id)
        existing = await db.execute(
            select(WikiPage).where(*slug_filter)
        )
        if existing.scalar_one_or_none() is None:
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    content = await _build_page_content(entity)

    # Embed title for similarity search
    embeddings = await embed_texts([entity["title"]])
    embedding = embeddings[0] if embeddings else None

    page = WikiPage(
        user_id=user_id,
        kb_id=kb_id,
        title=entity["title"],
        slug=slug,
        content=content,
        summary=entity["summary"],
        status="ready",
        source_count=1,
        tags=entity.get("tags", []),
        has_contradiction=False,
        embedding=embedding,
    )
    db.add(page)
    await db.flush()  # get page.id without committing
    return page
