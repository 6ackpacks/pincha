"""LLM-based content classifier for curate v2.

Classifies content into channels and generates title/summary using LiteLLM.
Designed to run in sync Celery task context.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import litellm

from app.config import settings

logger = logging.getLogger(__name__)

VALID_CHANNEL_SLUGS = {
    "ai-product-launch",
    "ai-tutorial",
    "ai-product-insight",
    "ai-deep-read",
}

# Channels that LLM should not assign — only populated via official account mapping
SYSTEM_ONLY_CHANNELS = {"ai-daily-brief"}


def classify_and_summarize(title: str | None, content_text: str, source_type: str) -> dict:
    """
    Call LLM to classify content into channels and generate title/summary.

    Returns:
        {
            "channels": ["ai-product-launch", ...],  # 1-2 channel slugs
            "title": "Generated title" or None,
            "summary": "One-line summary <= 80 chars"
        }
    """
    if not content_text.strip():
        return {
            "channels": ["ai-deep-read"],
            "title": title,
            "summary": title[:80] if title else "无内容",
        }

    truncated_content = content_text[:500]

    prompt = f"""你是一个内容分类助手。请将以下内容归类到最匹配的频道（最多选 2 个）：

频道列表：
1. ai-tutorial — 使用教程、入门指南、工具实操
2. ai-product-insight — 深度测评、产品对比、使用体验
3. ai-deep-read — 行业分析、技术解读、深度观点
4. ai-product-launch — 不要选这个，由系统自动处理
5. ai-daily-brief — 不要选这个，由系统自动处理

内容类型：{source_type}
内容标题：{title or '无标题'}
内容正文：{truncated_content}

请返回 JSON（不要包含其他文字）：
{{"channels": ["slug1"], "title": "生成的标题（如原文已有标题则为null）", "summary": "一句话摘要（≤80字）"}}"""

    try:
        response = litellm.completion(
            model=settings.SUMMARY_MODEL,
            messages=[{"role": "user", "content": prompt}],
            api_base=settings.SUMMARY_API_BASE,
            api_key=settings.OPENAI_API_KEY,
            temperature=0.1,
            max_tokens=256,
            timeout=60,
        )

        raw = response.choices[0].message.content.strip()
        result = _parse_json_response(raw)

        channels = result.get("channels", [])
        channels = [c for c in channels if c in VALID_CHANNEL_SLUGS]
        if not channels:
            channels = ["ai-deep-read"]

        summary = result.get("summary", "")
        if not summary:
            summary = (title or content_text[:80]).strip()
        if len(summary) > 80:
            summary = summary[:77] + "..."

        generated_title = result.get("title")
        if title:
            generated_title = None

        return {
            "channels": channels[:2],
            "title": generated_title,
            "summary": summary,
        }

    except Exception as e:
        logger.warning("LLM classification failed: %s", e)
        return _fallback_classification(title, content_text)


def extract_daily_brief_items(content_text: str) -> list[dict]:
    """
    Extract individual news items from the official daily brief post.

    Returns: [{"title": "...", "summary": "...", "url": "..." or None}]
    """
    if not content_text.strip():
        return []

    prompt = f"""你是一个新闻提取助手。请从以下每日 AI 简报中提取每一条独立的新闻/快讯。

要求：
- 每条新闻必须是一个独立的事件或信息点
- 不要合并多条新闻为一条
- 尽量提取所有新闻条目（通常有 5-10 条）
- 每条新闻提取以下字段：
  - title: 简短新闻标题（≤30字）
  - summary: 一句话摘要，说明具体内容（≤60字）
  - url: 相关链接（如果有的话，否则为null）

内容：
{content_text[:3000]}

请返回 JSON 数组（不要包含其他文字）：
[{{"title": "...", "summary": "...", "url": null}}]"""

    try:
        response = litellm.completion(
            model=settings.SUMMARY_MODEL,
            messages=[{"role": "user", "content": prompt}],
            api_base=settings.SUMMARY_API_BASE,
            api_key=settings.OPENAI_API_KEY,
            temperature=0.1,
            max_tokens=2048,
            timeout=90,
        )

        raw = response.choices[0].message.content.strip()
        items = _parse_json_response(raw)

        if not isinstance(items, list):
            return []

        valid_items = []
        for item in items:
            if isinstance(item, dict) and item.get("title"):
                valid_items.append({
                    "title": str(item["title"])[:200],
                    "summary": str(item.get("summary", ""))[:60],
                    "url": item.get("url"),
                })

        return valid_items

    except Exception as e:
        logger.warning("Daily brief extraction failed: %s", e)
        return []


def _parse_json_response(raw: str) -> Any:
    """Parse JSON from LLM response, handling markdown code fences."""
    if raw.startswith("```"):
        lines = raw.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines)
    elif raw.startswith("`") and raw.endswith("`"):
        raw = raw.strip("`")

    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError:
        pass

    json_match = re.search(r'[\[{].*[\]}]', raw, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from LLM response: {raw[:200]}")


def _fallback_classification(title: str | None, content_text: str) -> dict:
    """Fallback classification when LLM fails."""
    summary = (title or content_text[:80]).strip()
    if len(summary) > 80:
        summary = summary[:77] + "..."

    return {
        "channels": ["ai-deep-read"],
        "title": None if title else "无标题内容",
        "summary": summary,
    }
