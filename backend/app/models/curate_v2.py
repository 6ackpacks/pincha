"""Curate v2 models: channels, sources, subscriptions, daily picks, notifications."""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class CurateChannel(Base):
    """A curated content channel (e.g. ai-product-launch, ai-tutorial)."""
    __tablename__ = "curate_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pick_count: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    sources: Mapped[list["CurateChannelSource"]] = relationship(
        "CurateChannelSource", back_populates="channel", cascade="all, delete-orphan"
    )
    subscriptions: Mapped[list["CurateSubscription"]] = relationship(
        "CurateSubscription", back_populates="channel", cascade="all, delete-orphan"
    )
    daily_picks: Mapped[list["CurateDailyPick"]] = relationship(
        "CurateDailyPick", back_populates="channel", cascade="all, delete-orphan"
    )


class CurateChannelSource(Base):
    """A content source linked to a channel (e.g. a watcha.cn user feed)."""
    __tablename__ = "curate_channel_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("curate_channels.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    platform: Mapped[str] = mapped_column(String(30), nullable=False)
    external_user_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetch_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_official: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    channel: Mapped["CurateChannel"] = relationship("CurateChannel", back_populates="sources")


class CurateSubscription(Base):
    """A user's subscription to a channel."""
    __tablename__ = "curate_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "channel_id", name="uq_curate_sub_user_channel"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("curate_channels.id", ondelete="CASCADE"),
        nullable=False,
    )
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    subscribed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    channel: Mapped["CurateChannel"] = relationship("CurateChannel", back_populates="subscriptions")


class CurateDailyPick(Base):
    """A picked content item for a channel on a specific date."""
    __tablename__ = "curate_daily_picks"
    __table_args__ = (
        UniqueConstraint(
            "channel_id",
            "pick_date",
            "source_type",
            "source_id",
            name="uq_curate_pick_channel_date_source_type_source",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("curate_channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pick_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default="post")
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    author_avatar: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_url: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_official: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    raw_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    article_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("articles.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    channel: Mapped["CurateChannel"] = relationship("CurateChannel", back_populates="daily_picks")


class CurateNotification(Base):
    """A notification record for a user about daily picks."""
    __tablename__ = "curate_notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "pick_id", name="uq_curate_notif_user_pick"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pick_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("curate_daily_picks.id", ondelete="CASCADE"),
        nullable=False,
    )
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    pick: Mapped["CurateDailyPick"] = relationship(lazy="select")
