"""Shared mindmap generation engine — core LLM call for markdown mindmap output."""

import logging

import litellm

from app.config import settings

logger = logging.getLogger(__name__)

MINDMAP_SYSTEM_PROMPT = (
    "你是一位专业的知识结构化专家。请将以下内容转化为思维导图的 Markdown 格式。\n\n"
    "要求：\n"
    "- 使用 # 作为主题（根节点）\n"
    "- 使用 ## 作为 3-6 个核心主题分支\n"
    "- 使用 ### 作为每个主题下的 2-4 个子观点\n"
    "- 使用无序列表（-）列出关键细节，每条不超过15个字\n"
    "- 整体不超过4层深度\n"
    "- 节点文字要简洁精炼，避免长句\n"
    "- 【重要】直接输出 Markdown 内容，禁止用代码块（```）包裹，不要任何解释或说明\n"
    "- 【重要】无论输入是什么语言，输出必须全程使用中文"
)


async def generate_mindmap_markdown(
    source_text: str,
    *,
    system_prompt: str = MINDMAP_SYSTEM_PROMPT,
    model: str | None = None,
) -> str:
    """Call LLM to generate mindmap Markdown from source text.

    Args:
        source_text: The text content to convert into a mindmap.
        system_prompt: The system prompt guiding the LLM output format.
        model: Override model name; defaults to settings.SUMMARY_MODEL.

    Returns:
        Markdown string suitable for markmap rendering.
    """
    effective_model = model or settings.SUMMARY_MODEL
    response = await litellm.acompletion(
        model=effective_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": source_text},
        ],
        api_base=settings.SUMMARY_API_BASE or None,
        api_key=settings.OPENAI_API_KEY or None,
    )
    content = response.choices[0].message.content.strip()
    # Strip code fences if LLM wraps output (e.g. ```markdown ... ```)
    if content.startswith("```"):
        lines = content.splitlines()
        start = 1
        end = len(lines)
        if lines[-1].strip() == "```":
            end = len(lines) - 1
        content = "\n".join(lines[start:end]).strip()
    return content
