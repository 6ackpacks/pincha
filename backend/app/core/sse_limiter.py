"""
SSE 并发连接限制器

基于 Redis INCR/DECR 实现每用户 SSE 连接数跟踪。
防止单用户通过大量 SSE 连接耗尽 Redis 连接池。

使用方式：
    from app.core.sse_limiter import sse_concurrency_guard

    @router.get("/stream")
    async def my_sse_endpoint(
        ...,
        _sse_guard=Depends(sse_concurrency_guard),
    ):
        ...

注意：对于 SSE 生成器内部需要手动调用 release，请使用 SSEConnectionGuard 上下文管理器。
"""

import logging
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, HTTPException

from app.core.auth import get_current_user
from app.core.redis import get_redis
from app.models.user import User

logger = logging.getLogger(__name__)

# 每用户最大 SSE 并发连接数
MAX_SSE_CONNECTIONS_PER_USER = 5
# Redis key TTL（秒），防止异常断开后计数器永远不归零
SSE_KEY_TTL = 600


def _sse_key(user_id: uuid.UUID) -> str:
    return f"sse:connections:{user_id}"


class SSEConnectionGuard:
    """SSE 连接计数器的上下文管理器。

    进入时 INCR，退出时 DECR。适用于需要在生成器内部管理生命周期的场景。
    """

    def __init__(self, user_id: uuid.UUID, redis):
        self.user_id = user_id
        self.redis = redis
        self.key = _sse_key(user_id)
        self._acquired = False

    async def acquire(self) -> None:
        """递增计数器，超限则抛出 429。"""
        count = await self.redis.incr(self.key)
        # 首次创建时设置 TTL，后续刷新 TTL
        await self.redis.expire(self.key, SSE_KEY_TTL)

        if count > MAX_SSE_CONNECTIONS_PER_USER:
            # 超限，回退计数器
            await self.redis.decr(self.key)
            logger.warning(
                "SSE connection limit exceeded for user=%s (count=%d)",
                self.user_id, count,
            )
            raise HTTPException(
                status_code=429,
                detail=f"SSE 并发连接数超限（最多 {MAX_SSE_CONNECTIONS_PER_USER} 个）",
            )
        self._acquired = True
        logger.debug(
            "SSE connection acquired for user=%s (count=%d)", self.user_id, count
        )

    async def release(self) -> None:
        """递减计数器。"""
        if not self._acquired:
            return
        self._acquired = False
        current = await self.redis.decr(self.key)
        # 防止计数器变为负数（异常情况）
        if current < 0:
            await self.redis.set(self.key, 0, ex=SSE_KEY_TTL)
        else:
            # 刷新 TTL
            await self.redis.expire(self.key, SSE_KEY_TTL)
        logger.debug(
            "SSE connection released for user=%s (count=%d)",
            self.user_id, max(0, current),
        )

    async def __aenter__(self):
        await self.acquire()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.release()
        return False


async def sse_concurrency_guard(
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> AsyncGenerator[SSEConnectionGuard, None]:
    """FastAPI Depends 用法：在请求级别获取 SSE 连接槽。

    用作依赖时会自动在请求结束后释放连接槽。
    对于 StreamingResponse，需要在生成器的 finally 块中手动调用 release()。

    推荐用法：将 guard 传入 streaming generator，在 finally 中释放。
    """
    guard = SSEConnectionGuard(current_user.id, redis)
    await guard.acquire()
    try:
        yield guard
    finally:
        await guard.release()
