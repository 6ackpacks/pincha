"""JWT session utilities and FastAPI auth dependency."""
import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from cachetools import TTLCache
from fastapi import Cookie, Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.database import get_session
from app.core.redis import get_redis
from app.models.user import User

logger = logging.getLogger(__name__)

_ALGORITHM = "HS256"
_TOKEN_EXPIRE_DAYS = 7
# L1: in-process cache (per worker, bounded TTLCache to prevent unbounded growth)
_USER_CACHE: TTLCache = TTLCache(maxsize=200, ttl=300)
# L2: Redis cache TTL
_USER_REDIS_TTL = 300  # 5 min

_ANON_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

# Token blacklist key prefix
_BLACKLIST_PREFIX = "token:blacklist:"
# Whitelisted fields for L2 Redis cache restoration (is_admin intentionally excluded)
_L2_ALLOWED_FIELDS = {"id", "email", "is_active", "nickname", "avatar_url", "name", "watcha_user_id"}


def _token_hash(token: str) -> str:
    """SHA256 hash of token for blacklist key (avoid storing full token)."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_session_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "jti": uuid.uuid4().hex},
        settings.JWT_SECRET_KEY,
        algorithm=_ALGORITHM,
    )


async def blacklist_token(token: str) -> None:
    """Add a token to the Redis blacklist with TTL matching its remaining lifetime."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[_ALGORITHM])
    except JWTError:
        # Token already invalid, no need to blacklist
        return

    exp = payload.get("exp")
    if exp is None:
        return

    # Calculate remaining TTL
    remaining = int(exp - datetime.now(timezone.utc).timestamp())
    if remaining <= 0:
        # Already expired, no need to blacklist
        return

    try:
        redis = await get_redis()
        key = f"{_BLACKLIST_PREFIX}{_token_hash(token)}"
        await redis.setex(key, remaining, "1")
    except Exception:
        logger.warning("Failed to blacklist token in Redis, token may remain valid until expiry")


async def invalidate_user_cache(user_id: str) -> None:
    """Clear L1 in-process cache and L2 Redis cache for a user."""
    # L1: remove from in-process cache
    _USER_CACHE.pop(user_id, None)

    # L2: remove from Redis
    try:
        redis = await get_redis()
        await redis.delete(f"user:auth:{user_id}")
    except Exception as exc:
        logger.debug("Redis operation failed (degraded): %s", exc)


async def _get_or_create_anon_user(db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.id == _ANON_USER_ID))
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(id=_ANON_USER_ID, watcha_user_id=0, nickname="访客", name="访客", avatar_url="")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def get_current_user(
    session: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_session),
) -> User:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    if not session:
        raise exc
    try:
        payload = jwt.decode(session, settings.JWT_SECRET_KEY, algorithms=[_ALGORITHM])
        user_id_str: str | None = payload.get("sub")
        if not user_id_str:
            raise exc
    except JWTError:
        raise exc

    # Check token blacklist (Redis failure degrades gracefully — allows through)
    try:
        redis = await get_redis()
        blacklisted = await redis.get(f"{_BLACKLIST_PREFIX}{_token_hash(session)}")
        if blacklisted:
            raise exc
    except HTTPException:
        raise
    except Exception as exc:
        # Redis unavailable — degrade gracefully, don't block login
        logger.debug("Redis operation failed (degraded): %s", exc)

    # L1: in-process cache (TTLCache handles expiry automatically)
    cached = _USER_CACHE.get(user_id_str)
    if cached:
        return cached

    # L2: Redis cache — reconstruct User from whitelisted fields only
    redis_key = f"user:auth:{user_id_str}"
    try:
        redis = await get_redis()
        raw = await redis.get(redis_key)
        if raw:
            data = json.loads(raw)
            # Verify cached user ID matches the JWT subject to prevent cross-user pollution
            cached_id = data.get("id")
            if cached_id and str(cached_id) != user_id_str:
                await redis.delete(redis_key)
            else:
                user = User()
                for k, v in data.items():
                    if k in _L2_ALLOWED_FIELDS:
                        setattr(user, k, v)
                # Restore UUID type for id field
                if isinstance(user.id, str):
                    user.id = uuid.UUID(user.id)
                # is_admin is NEVER trusted from cache — always False until DB confirms
                user.is_admin = False
                # Do NOT populate L1 cache here: is_admin is forced False, so caching
                # this user in L1 would block legitimate admins for up to 5 min.
                # The next request will hit L2 again (fast) or go to DB.
                return user
    except Exception as exc:
        logger.debug("Redis operation failed (degraded): %s", exc)

    # DB query (cache miss)
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
    user = result.scalar_one_or_none()
    if user is None:
        raise exc

    # Populate L1
    _USER_CACHE[user_id_str] = user

    # Populate L2 Redis (never cache is_admin — must always come from DB)
    try:
        redis = await get_redis()
        user_data = {
            "id": str(user.id),
            "email": user.email,
            "is_active": getattr(user, "is_active", True),
            "nickname": user.nickname,
            "avatar_url": user.avatar_url,
            "name": user.name,
            "watcha_user_id": user.watcha_user_id,
        }
        await redis.setex(redis_key, _USER_REDIS_TTL, json.dumps(user_data, default=str))
    except Exception as exc:
        logger.debug("Redis operation failed (degraded): %s", exc)

    return user


async def require_admin_user(
    user: User = Depends(get_current_user),
) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


async def get_current_kb_id(
    user: User = Depends(get_current_user),
    x_kb_id: str | None = Header(default=None, alias="X-KB-ID"),
    db: AsyncSession = Depends(get_session),
) -> uuid.UUID:
    """Resolve active knowledge base ID from X-KB-ID header or default KB."""
    from app.models.knowledge_base import KnowledgeBase

    if x_kb_id:
        try:
            kb_uuid = uuid.UUID(x_kb_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的知识库 ID")
        kb = await db.get(KnowledgeBase, kb_uuid)
        if not kb or kb.user_id != user.id:
            raise HTTPException(status_code=404, detail="知识库不存在")
        return kb.id

    # Fallback: user's default KB
    result = await db.execute(
        select(KnowledgeBase.id)
        .where(KnowledgeBase.user_id == user.id, KnowledgeBase.is_default == True)
    )
    kb_id = result.scalar_one_or_none()
    if not kb_id:
        new_kb = KnowledgeBase(user_id=user.id, name="默认知识库", is_default=True)
        db.add(new_kb)
        await db.flush()
        kb_id = new_kb.id
    return kb_id
