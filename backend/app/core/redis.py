import redis.asyncio as aioredis

from app.config import settings

redis_client = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True,
    max_connections=50,
)

# Binary-safe client for storing raw bytes (e.g. image cache)
redis_client_bytes = aioredis.from_url(
    settings.REDIS_URL,
    decode_responses=False,
    max_connections=20,
)


async def get_redis() -> aioredis.Redis:
    """Dependency that returns the async Redis client."""
    return redis_client


async def get_redis_bytes() -> aioredis.Redis:
    """Return binary-safe Redis client (no decode)."""
    return redis_client_bytes
