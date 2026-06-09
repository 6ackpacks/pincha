"""
速率限制配置

使用 Redis 作为后端存储以支持多实例部署。
如果 Redis 不可用，swallow_errors=True 会降级为无限流（避免服务中断）。
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["60/minute"],
    storage_uri=settings.REDIS_URL,  # 使用 Redis 作为分布式存储
    swallow_errors=True,
)
