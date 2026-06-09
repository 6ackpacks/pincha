import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

DEFAULT_STATUS = {"state": "pending", "progress": 0, "message": ""}


class Video(Base):
    __tablename__ = "videos"
    __table_args__ = (UniqueConstraint("url", name="uq_videos_url"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=lambda: DEFAULT_STATUS.copy()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    in_wiki: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # 热门管理
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    admin_score: Mapped[float | None] = mapped_column(nullable=True)

    # 播客字段
    show_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    host: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
