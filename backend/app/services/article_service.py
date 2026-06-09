"""Article fulltext extraction service using trafilatura."""

import asyncio
import logging
import re

import httpx
import trafilatura
from trafilatura import bare_extraction

from app.core.url_validator import SSRFError, validate_url_async, safe_async_client

logger = logging.getLogger(__name__)

_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

_MIN_CONTENT_LENGTH = 100


async def extract_article(url: str, timeout: float = 20.0) -> dict:
    """Fetch and extract article content from a URL.

    Returns:
        {
            "title": str | None,
            "author": str | None,
            "content": str | None,
            "thumbnail_url": str | None,
            "language": str | None,
            "word_count": int | None,
            "success": bool,
        }
    """
    result = {
        "title": None,
        "author": None,
        "content": None,
        "thumbnail_url": None,
        "language": None,
        "word_count": None,
        "success": False,
    }

    html = None
    try:
        # SSRF 防护：校验 URL 不指向内网
        await validate_url_async(url)

        async with safe_async_client(
            timeout=timeout,
            follow_redirects=True,
            headers=_HTTP_HEADERS,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
    except SSRFError as e:
        logger.warning("Article URL blocked by SSRF validator: %s — %s", url, e)
    except httpx.TimeoutException:
        logger.warning("Article fetch timeout: %s", url)
    except httpx.HTTPStatusError as e:
        logger.warning("Article fetch HTTP %d: %s", e.response.status_code, url)
    except Exception as e:
        logger.warning("Article fetch error: %s — %s", url, e)

    if not html:
        return result

    text = None

    # 策略 1: trafilatura favor_precision (高精度模式)
    try:
        text = await asyncio.to_thread(
            trafilatura.extract,
            html,
            include_comments=False,
            include_tables=True,
            favor_precision=True,
        )
    except Exception as e:
        logger.warning("trafilatura precision extract failed: %s — %s", url, e)

    # 策略 2: trafilatura favor_recall (宽松模式)
    if not text or len(text.strip()) <= _MIN_CONTENT_LENGTH:
        logger.debug("Falling back to favor_recall for: %s", url)
        try:
            text = await asyncio.to_thread(
                trafilatura.extract,
                html,
                include_comments=False,
                include_tables=True,
                favor_precision=False,
                favor_recall=True,
            )
        except Exception as e:
            logger.warning("trafilatura recall extract failed: %s — %s", url, e)

    # 策略 3: bare_extraction 直接提取文本字段
    if not text or len(text.strip()) <= _MIN_CONTENT_LENGTH:
        logger.debug("Falling back to bare_extraction for: %s", url)
        try:
            extracted = await asyncio.to_thread(
                bare_extraction,
                html,
                include_tables=True,
                favor_recall=True,
            )
            if extracted and extracted.get("text"):
                text = extracted["text"]
        except Exception as e:
            logger.warning("trafilatura bare_extraction failed: %s — %s", url, e)

    if text and len(text.strip()) > _MIN_CONTENT_LENGTH:
        result["content"] = text.strip()
        result["word_count"] = len(text.strip())
        result["success"] = True

    # 提取元数据
    try:
        meta_extracted = await asyncio.to_thread(
            bare_extraction,
            html,
            include_tables=False,
        )
        if meta_extracted:
            result["title"] = meta_extracted.get("title") or _extract_title(html)
            result["author"] = meta_extracted.get("author")
            result["language"] = meta_extracted.get("language")
    except Exception as exc:
        logger.debug("trafilatura metadata extraction failed: %s", exc)

    if not result["title"]:
        result["title"] = _extract_title(html)

    result["thumbnail_url"] = _extract_og_image(html)

    return result


def _extract_title(html: str) -> str | None:
    patterns = [
        r"<title[^>]*>([^<]+)</title>",
        r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']',
        r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:title["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def dispatch_article_processing(article_id: str) -> str:
    """Dispatch article processing to Celery. Returns task ID."""
    from app.tasks.article_tasks import process_article
    task = process_article.delay(str(article_id))
    return task.id


def _extract_og_image(html: str) -> str | None:
    patterns = [
        r'<meta\s+property=["\']og:image["\']\s+content=["\']([^"\']+)["\']',
        r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:image["\']',
        r'<meta\s+name=["\']twitter:image["\']\s+content=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            url = match.group(1).strip()
            if url.startswith("http"):
                return url
    return None
