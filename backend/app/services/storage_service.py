"""火山引擎 TOS 对象存储封装。

品猹的图片/静态资源走 TOS + CDN 加速。本模块提供一个进程级单例客户端
和上传/构造 URL 的同步接口（Celery 任务直接用），以及一个供 FastAPI 路由
在线程池里调用的薄封装。

设计要点：
- 凭证缺失时优雅降级：is_enabled() 返回 False，上传函数返回 None，调用方
  回退到原有逻辑（缩略图走 /img-proxy，静态资源走本地 public）。绝不 crash。
- 同步实现：火山 tos SDK 是同步的。Celery 任务直接调用；FastAPI 路由若要用，
  必须 run_in_executor 包一层，避免阻塞事件循环（见护栏 1）。
- key 一律不带前导斜杠；CDN URL 由 _public_base() 拼接。
"""

from __future__ import annotations

import logging
import threading

from app.config import settings

logger = logging.getLogger(__name__)

# 进程级单例 + 构造锁（tos SDK 客户端线程安全，可跨线程复用）
_client = None
_client_lock = threading.Lock()
_init_failed = False


def is_enabled() -> bool:
    """TOS 是否配置完整。任一必填项缺失即视为未启用。"""
    return bool(
        settings.TOS_ACCESS_KEY
        and settings.TOS_SECRET_KEY
        and settings.TOS_ENDPOINT
        and settings.TOS_REGION
        and settings.TOS_BUCKET
    )


def _get_client():
    """返回进程级 TosClientV2 单例，未配置或初始化失败时返回 None。"""
    global _client, _init_failed
    if not is_enabled() or _init_failed:
        return None
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        try:
            import tos

            _client = tos.TosClientV2(
                settings.TOS_ACCESS_KEY,
                settings.TOS_SECRET_KEY,
                settings.TOS_ENDPOINT,
                settings.TOS_REGION,
            )
            logger.info("TOS client initialized (bucket=%s)", settings.TOS_BUCKET)
        except Exception:
            # SDK 未安装或参数非法：标记失败，后续直接降级，不反复重试
            _init_failed = True
            logger.exception("TOS client init failed — storage disabled")
            return None
    return _client


def _public_base() -> str:
    """对象访问基址（无尾斜杠）。优先 CDN 域名，否则用 TOS 直链。"""
    if settings.TOS_CDN_BASE:
        return settings.TOS_CDN_BASE.rstrip("/")
    # bucket.endpoint 直链（endpoint 不带协议）
    return f"https://{settings.TOS_BUCKET}.{settings.TOS_ENDPOINT}"


def public_url(key: str) -> str:
    """由对象 key 构造对外可访问 URL。"""
    return f"{_public_base()}/{key.lstrip('/')}"


# 不可变资源（缩略图、静态图）缓存 1 年；浏览器/CDN 长期持有
_IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


def upload_bytes(
    key: str,
    data: bytes,
    content_type: str = "application/octet-stream",
    cache_control: str = _IMMUTABLE_CACHE,
) -> str | None:
    """上传字节到 TOS，成功返回对外 URL，未启用/失败返回 None（调用方降级）。

    同步函数。Celery 任务可直接调用；FastAPI 路由须 run_in_executor 包裹。
    """
    client = _get_client()
    if client is None:
        return None
    key = key.lstrip("/")
    try:
        client.put_object(
            settings.TOS_BUCKET,
            key,
            content=data,
            content_type=content_type,
            cache_control=cache_control,
        )
        return public_url(key)
    except Exception:
        logger.exception("TOS upload failed (key=%s)", key)
        return None


def object_exists(key: str) -> bool:
    """对象是否已存在（用于上传前去重）。出错时保守返回 False。"""
    client = _get_client()
    if client is None:
        return False
    try:
        client.head_object(settings.TOS_BUCKET, key.lstrip("/"))
        return True
    except Exception:
        return False
