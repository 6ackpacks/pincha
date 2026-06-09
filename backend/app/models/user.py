import uuid

from sqlalchemy import BigInteger, Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func as sql_func
from datetime import datetime

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    # 观猹 OAuth identity
    watcha_user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        unique=True,
        nullable=True,
        index=True,
    )
    nickname: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # email is optional — Watcha users may not have one
    email: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
    )
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )
    # 观猹 OAuth tokens (for future API calls / refresh)
    # SECURITY WARNING: OAuth tokens currently stored in plaintext
    # TODO: Implement encryption using Fernet or AES-256-GCM before production deployment
    # Encryption key should be managed via environment variable OAUTH_ENCRYPTION_KEY
    watcha_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    watcha_refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    watcha_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        server_default=sql_func.now(),
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
