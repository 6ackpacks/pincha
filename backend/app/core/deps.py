"""Reusable dependency shortcuts for common route patterns.

Usage in routes:
    from app.core.deps import AuthDeps

    @router.get("/items")
    async def list_items(deps: AuthDeps = Depends()):
        # deps.user, deps.db, deps.kb_id all available
        ...
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_kb_id, get_current_user
from app.core.database import get_session
from app.models.article import Article
from app.models.user import User
from app.models.user_video import UserVideo
from app.models.video import Video


@dataclass
class AuthDeps:
    """Bundle of authenticated user + DB session."""

    user: User
    db: AsyncSession

    def __init__(
        self,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_session),
    ):
        self.user = user
        self.db = db


@dataclass
class AuthKBDeps:
    """Bundle of authenticated user + DB session + resolved KB ID."""

    user: User
    db: AsyncSession
    kb_id: uuid.UUID

    def __init__(
        self,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_session),
        kb_id: uuid.UUID = Depends(get_current_kb_id),
    ):
        self.user = user
        self.db = db
        self.kb_id = kb_id


async def require_user_video(
    db: AsyncSession,
    user: User,
    video_id: uuid.UUID,
) -> Video:
    """Return a video only if it belongs to the current user's library."""
    result = await db.execute(
        select(Video)
        .join(UserVideo, UserVideo.video_id == Video.id)
        .where(Video.id == video_id, UserVideo.user_id == user.id)
    )
    video = result.scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found in your library")
    return video


async def require_user_article(
    db: AsyncSession,
    user: User,
    kb_id: uuid.UUID,
    article_id: uuid.UUID,
) -> Article:
    """Return an article only if it belongs to the current user and KB."""
    result = await db.execute(
        select(Article).where(
            Article.id == article_id,
            Article.user_id == user.id,
            Article.kb_id == kb_id,
        )
    )
    article = result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status_code=404, detail="文章不存在")
    return article
