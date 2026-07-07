"""Single-user identity shim for local deployments."""
import logging
import uuid

from cachetools import TTLCache
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.models.user import User

logger = logging.getLogger(__name__)

LOCAL_OWNER_IDENTITY = "local-owner"
_LOCAL_OWNER_CACHE_KEY = LOCAL_OWNER_IDENTITY
_USER_ID_CACHE: TTLCache = TTLCache(maxsize=1, ttl=300)


async def invalidate_user_cache(user_id: str | None = None) -> None:
    """Clear the in-process Local Owner cache."""
    _USER_ID_CACHE.pop(_LOCAL_OWNER_CACHE_KEY, None)


async def get_or_create_local_owner(db: AsyncSession) -> User:
    """Return the unique Local Owner, creating it idempotently when absent."""
    cached_id = _USER_ID_CACHE.get(_LOCAL_OWNER_CACHE_KEY)
    if cached_id is not None:
        cached_user = await db.get(User, cached_id)
        if cached_user is not None:
            if not cached_user.is_admin:
                cached_user.is_admin = True
                await db.commit()
                await db.refresh(cached_user)
            return cached_user
        _USER_ID_CACHE.pop(_LOCAL_OWNER_CACHE_KEY, None)

    result = await db.execute(select(User).where(User.local_identity == LOCAL_OWNER_IDENTITY))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            local_identity=LOCAL_OWNER_IDENTITY,
            nickname="本地用户",
            name="本地用户",
            avatar_url="",
            is_admin=True,
        )
        db.add(user)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            result = await db.execute(select(User).where(User.local_identity == LOCAL_OWNER_IDENTITY))
            user = result.scalar_one()
        else:
            await db.refresh(user)
    elif not user.is_admin:
        user.is_admin = True
        await db.commit()
        await db.refresh(user)

    _USER_ID_CACHE[_LOCAL_OWNER_CACHE_KEY] = user.id
    return user


async def get_current_user(
    db: AsyncSession = Depends(get_session),
) -> User:
    """Return the instance-local owner without cookies, tokens, or sessions."""
    return await get_or_create_local_owner(db)


async def get_optional_user(
    db: AsyncSession = Depends(get_session),
) -> User:
    """Compatibility dependency for public endpoints that can personalize output."""
    return await get_or_create_local_owner(db)


async def require_admin_user(
    user: User = Depends(get_current_user),
) -> User:
    """Keep the admin dependency surface while using the Local Owner."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


async def get_current_kb_id(
    user: User = Depends(get_current_user),
    x_kb_id: str | None = Header(default=None, alias="X-KB-ID"),
    db: AsyncSession = Depends(get_session),
) -> uuid.UUID:
    """Resolve active knowledge base ID from X-KB-ID header or the default KB."""
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

    result = await db.execute(
        select(KnowledgeBase.id)
        .where(KnowledgeBase.user_id == user.id, KnowledgeBase.is_default == True)
    )
    kb_id = result.scalar_one_or_none()
    if not kb_id:
        new_kb = KnowledgeBase(user_id=user.id, name="默认知识库", is_default=True)
        db.add(new_kb)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            result = await db.execute(
                select(KnowledgeBase.id)
                .where(KnowledgeBase.user_id == user.id, KnowledgeBase.is_default == True)
            )
            kb_id = result.scalar_one()
        else:
            await db.refresh(new_kb)
            kb_id = new_kb.id
    return kb_id
