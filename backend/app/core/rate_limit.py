"""
速率限制配置

使用 Redis 作为后端存储以支持多实例部署。
如果 Redis 不可用，swallow_errors=True 会降级为无限流（避免服务中断）。
"""

from fastapi import Request
from slowapi import Limiter

from app.config import settings


def _get_real_ip(request: Request) -> str:
    """Extract the client IP as forwarded by the trusted reverse proxy."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(
    key_func=_get_real_ip,
    default_limits=["60/minute"],
    storage_uri=settings.REDIS_URL,  # 使用 Redis 作为分布式存储
    swallow_errors=True,
)
