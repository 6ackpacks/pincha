import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WikiPage(Base):
    __tablename__ = "wiki_pages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    kb_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="draft"
    )  # draft | ready | needs_update
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="concept", server_default="concept")  # concept | entity | method | source | insight
    has_contradiction: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    community_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    contradiction_details: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=sa.text("'[]'::jsonb"))
    review_items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=sa.text("'[]'::jsonb"))
    # 1024-dim DashScope text-embedding-v3
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (UniqueConstraint("kb_id", "slug", name="uq_wiki_pages_kb_slug"),)


class WikiSource(Base):
    """Maps a wiki page to its contributing video or article sources."""

    __tablename__ = "wiki_sources"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    wiki_page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(Text, nullable=False)  # 'video' | 'article'
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # Excerpt from this source that informed the wiki page content
    contribution: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint("wiki_page_id", "source_id", name="uq_wiki_sources_page_source"),
    )


class WikiRelation(Base):
    """Directed relationship between two wiki pages."""

    __tablename__ = "wiki_relations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    from_page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    relation_type: Mapped[str] = mapped_column(Text, nullable=False)  # related | contradicts | extends
    strength: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint("from_page_id", "to_page_id", name="uq_wiki_relations_pair"),
    )
