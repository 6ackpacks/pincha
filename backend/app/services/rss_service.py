"""RSS feed parser for podcast episode extraction."""
import logging
from urllib.parse import urlparse

import feedparser
import httpx

from app.core.url_validator import SSRFError, validate_and_resolve, safe_async_client

logger = logging.getLogger(__name__)


async def parse_rss_feed(url: str) -> dict:
    """解析 RSS feed，提取最新一集的元数据和音频 URL。

    Returns:
        {
            "title": str | None,        # 单集标题
            "show_name": str | None,     # 节目名
            "host": str | None,          # 主播（from itunes:author）
            "description": str | None,   # 单集描述
            "audio_url": str | None,     # 音频文件 URL（from enclosure）
            "thumbnail_url": str | None, # 封面图
            "duration": str | None,      # 时长
            "success": bool,
        }
    """
    result = {
        "title": None,
        "show_name": None,
        "host": None,
        "description": None,
        "audio_url": None,
        "thumbnail_url": None,
        "duration": None,
        "success": False,
    }

    try:
        # 0. SSRF 防护：校验 URL + DNS 绑定防止 rebinding
        _validated_url, resolved_ips = await validate_and_resolve(url)
        parsed_host = urlparse(url).hostname

        # 1. 用 httpx 异步下载 RSS XML（feedparser 不支持 async）
        async with safe_async_client(
            resolved_ips=resolved_ips,
            _pinned_hostname=parsed_host,
            timeout=15.0,
            follow_redirects=True,
        ) as client:
            resp = await client.get(url, headers={
                "User-Agent": "Pingcha/1.0 (podcast parser)",
            })
            resp.raise_for_status()
            raw_xml = resp.text

        # 2. 用 feedparser 解析 XML 内容
        feed = feedparser.parse(raw_xml)

        if feed.bozo and not feed.entries:
            logger.warning("RSS 解析异常: %s", feed.bozo_exception)
            return result

        # 3. 从 feed.feed 提取节目级信息
        feed_info = feed.feed
        result["show_name"] = feed_info.get("title")

        # 主播：优先 itunes:author，回退到 feed 级 author
        result["host"] = (
            feed_info.get("author")
            or feed_info.get("itunes_author")
            or feed_info.get("publisher")
        )

        # 节目封面图：feed.feed.image.href 或 itunes:image
        try:
            result["thumbnail_url"] = feed_info.image.href
        except (AttributeError, KeyError):
            itunes_image = feed_info.get("itunes_image")
            if itunes_image and isinstance(itunes_image, dict):
                result["thumbnail_url"] = itunes_image.get("href")

        # 4. 从最新一集（entries[0]）提取单集信息
        if not feed.entries:
            logger.warning("RSS feed 无 entries: %s", url)
            result["success"] = True  # feed 解析成功但无集数
            return result

        entry = feed.entries[0]
        result["title"] = entry.get("title")

        # 单集描述：优先 summary，回退到 content
        result["description"] = entry.get("summary") or ""
        if not result["description"] and entry.get("content"):
            result["description"] = entry["content"][0].get("value", "")

        # 音频 URL：从 enclosures 获取 type 含 "audio" 的
        for enc in entry.get("enclosures", []):
            enc_type = enc.get("type", "")
            if "audio" in enc_type:
                result["audio_url"] = enc.get("href") or enc.get("url")
                break
        # 如果 enclosures 没找到，回退到 links
        if not result["audio_url"]:
            for link in entry.get("links", []):
                link_type = link.get("type", "")
                if "audio" in link_type:
                    result["audio_url"] = link.get("href")
                    break

        # 时长：itunes:duration
        result["duration"] = entry.get("itunes_duration")

        # 单集封面（覆盖节目封面）
        entry_image = entry.get("itunes_image")
        if entry_image and isinstance(entry_image, dict) and entry_image.get("href"):
            result["thumbnail_url"] = entry_image["href"]
        elif entry.get("image") and isinstance(entry["image"], dict):
            result["thumbnail_url"] = entry["image"].get("href", result["thumbnail_url"])

        result["success"] = True

    except SSRFError as exc:
        logger.warning("RSS feed URL 被 SSRF 校验拦截: %s — %s", url, exc)
    except httpx.HTTPError as exc:
        logger.error("下载 RSS feed 失败: %s — %s", url, exc)
    except Exception as exc:
        logger.error("解析 RSS feed 异常: %s — %s", url, exc, exc_info=True)

    return result
