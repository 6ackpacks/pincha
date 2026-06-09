"""Shared utilities for Celery task modules (sync context)."""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.config import settings
from app.core.logger import logger

# --- Sync DB engine (singleton) ---

_sync_engine: Engine | None = None


def _resolve_database_url() -> str:
    """Resolve sync database URL from environment (supports Zeabur readonly vars)."""
    # Priority: DATABASE_URL > POSTGRES_URI > settings default
    db_url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URI") or settings.DATABASE_URL
    # Convert async driver to sync
    return db_url.replace("+asyncpg", "").replace("asyncpg://", "postgresql://")


def get_sync_engine() -> Engine:
    """Return a module-level sync SQLAlchemy engine, created once."""
    global _sync_engine
    if _sync_engine is None:
        url = _resolve_database_url()
        _sync_engine = create_engine(
            url,
            pool_size=5,
            max_overflow=3,
            pool_pre_ping=True,
            pool_recycle=300,
        )
    return _sync_engine


# --- Async DB engine (singleton) ---

_async_engine = None
_AsyncSessionLocal = None


def get_async_engine():
    """Module-level async engine singleton for Celery tasks.

    Returns (engine, sessionmaker) tuple. The engine lives for the process
    lifetime — do NOT call dispose() on it.
    """
    global _async_engine, _AsyncSessionLocal
    if _async_engine is None:
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
        from sqlalchemy.orm import sessionmaker

        _async_engine = create_async_engine(
            settings.DATABASE_URL, echo=False, pool_pre_ping=True
        )
        _AsyncSessionLocal = sessionmaker(
            _async_engine, class_=AsyncSession, expire_on_commit=False
        )
    return _async_engine, _AsyncSessionLocal


@asynccontextmanager
async def get_async_session():
    """Async session context manager for Celery tasks."""
    _, SessionLocal = get_async_engine()
    async with SessionLocal() as session:
        yield session


# --- Sync Redis client (singleton) ---

_sync_redis: redis.Redis | None = None


def _resolve_redis_url() -> str:
    """Resolve Redis URL from environment (supports Zeabur readonly vars)."""
    url = os.getenv("REDIS_URL") or os.getenv("REDIS_URI") or os.getenv("REDIS_CONNECTION_STRING")
    return url if url else settings.REDIS_URL


def get_sync_redis() -> redis.Redis:
    """Return a module-level sync Redis client, created once."""
    global _sync_redis
    if _sync_redis is None:
        _sync_redis = redis.from_url(
            _resolve_redis_url(),
            decode_responses=True,
            max_connections=20,
        )
    return _sync_redis


# --- Heartbeat constants ---

HEARTBEAT_TTL = 3600  # match pipeline time_limit

from app.core.progress import heartbeat_key  # re-export for task layer


def set_heartbeat(video_id: str, state: str, progress: int, message: str = "") -> None:
    """Write heartbeat to Redis with standard payload format, and publish to SSE channel."""
    r = get_sync_redis()
    payload = json.dumps({"state": state, "progress": progress, "message": message})
    # 1. 保持原有 heartbeat key（供 REST fallback 使用）
    r.setex(heartbeat_key(video_id), HEARTBEAT_TTL, payload)
    # 2. Publish 到 Pub/Sub channel（供 SSE 端点订阅）
    r.publish(f"video:{video_id}:progress", payload)


# --- Sync video status update ---

def update_video_status_sync(video_id: str, status: dict) -> None:
    """Update videos.status JSONB and updated_at in a sync context."""
    engine = get_sync_engine()
    with engine.connect() as conn:
        conn.execute(
            text("UPDATE videos SET status = CAST(:status AS jsonb), updated_at = NOW() WHERE id = :vid"),
            {"status": json.dumps(status), "vid": video_id},
        )
        conn.commit()


# --- Pipeline deduplication lock (Redis SET NX) ---
# Prevents the same video from being processed concurrently by multiple workers.
# Inspired by DOVideo-AI's Redisson distributed lock pattern.

PIPELINE_LOCK_PREFIX = "video:pipeline_lock:"
PIPELINE_LOCK_TTL = 3600  # 1 hour — max expected pipeline duration


def try_acquire_pipeline_lock(video_id: str) -> bool:
    """Attempt to acquire an exclusive processing lock for video_id.

    Uses Redis SET NX (set-if-not-exists) so only one worker succeeds.
    Returns True if the lock was acquired, False if already held.
    """
    r = get_sync_redis()
    key = f"{PIPELINE_LOCK_PREFIX}{video_id}"
    return bool(r.set(key, "1", ex=PIPELINE_LOCK_TTL, nx=True))


def release_pipeline_lock(video_id: str) -> None:
    """Release the pipeline lock for video_id."""
    get_sync_redis().delete(f"{PIPELINE_LOCK_PREFIX}{video_id}")


# ---------------------------------------------------------------------------
# Generic pipeline helpers (entity_type = "video" | "article")
# ---------------------------------------------------------------------------

# 实体类型白名单（防止 SQL 注入）
_ENTITY_TABLE_MAP = {"video": "videos", "article": "articles"}


def entity_heartbeat_key(entity_type: str, entity_id: str) -> str:
    """Return the Redis heartbeat key for any entity type."""
    return f"{entity_type}:{entity_id}:heartbeat"


def set_entity_heartbeat(entity_type: str, entity_id: str, state: str, progress: int, message: str = "") -> None:
    """Write heartbeat to Redis and publish progress for any entity type."""
    r = get_sync_redis()
    payload = json.dumps({"state": state, "progress": progress, "message": message})
    r.setex(entity_heartbeat_key(entity_type, entity_id), HEARTBEAT_TTL, payload)
    r.publish(f"{entity_type}:{entity_id}:progress", payload)


def update_entity_status_sync(entity_type: str, entity_id: str, status: dict) -> None:
    """Update <entity>.status JSONB and updated_at in a sync context."""
    # 白名单校验防止 SQL 注入
    if entity_type not in _ENTITY_TABLE_MAP:
        logger.error(f"Invalid entity_type: {entity_type}")
        return

    table = _ENTITY_TABLE_MAP[entity_type]
    engine = get_sync_engine()
    with engine.connect() as conn:
        conn.execute(
            text(f"UPDATE {table} SET status = CAST(:status AS jsonb), updated_at = NOW() WHERE id = :eid"),
            {"status": json.dumps(status), "eid": entity_id},
        )
        conn.commit()


def pipeline_step(entity_type: str, entity_id: str, state: str, progress: int, message: str = "") -> None:
    """Update both heartbeat and DB status in one call (generic version)."""
    set_entity_heartbeat(entity_type, entity_id, state, progress, message)
    update_entity_status_sync(entity_type, entity_id, {"state": state, "progress": progress, "message": message})


def delete_entity_heartbeat(entity_type: str, entity_id: str) -> None:
    """Remove heartbeat key on completion."""
    get_sync_redis().delete(entity_heartbeat_key(entity_type, entity_id))


def try_acquire_entity_lock(entity_type: str, entity_id: str) -> bool:
    """Acquire exclusive processing lock for any entity type."""
    r = get_sync_redis()
    key = f"{entity_type}:pipeline_lock:{entity_id}"
    return bool(r.set(key, "1", ex=PIPELINE_LOCK_TTL, nx=True))


def release_entity_lock(entity_type: str, entity_id: str) -> None:
    """Release the pipeline lock for any entity type."""
    get_sync_redis().delete(f"{entity_type}:pipeline_lock:{entity_id}")


# ---------------------------------------------------------------------------
# Event publishing for SSE
# ---------------------------------------------------------------------------

def _publish_event(video_id: str, event_type: str, data: dict) -> None:
    """Publish event to Redis for SSE endpoint subscription.

    Args:
        video_id: Video UUID as string
        event_type: Event type identifier (e.g., "subtitle_ready", "level_ready", "mindmap_ready")
        data: Additional event data to include in the payload

    Example:
        _publish_event(video_id, "level_ready", {"level": "detailed"})
    """
    import time
    redis = get_sync_redis()
    channel = f"video:{video_id}:events"
    event = {
        "type": event_type,
        "timestamp": time.time(),
        **data
    }
    redis.publish(channel, json.dumps(event))
    logger.info("[events:%s] Published %s", video_id, event_type)
