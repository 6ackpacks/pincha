import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Summary(Base):
    __tablename__ = "summaries"
    __table_args__ = (
        UniqueConstraint("video_id", "level", name="uq_summaries_video_level"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("videos.id", ondelete="CASCADE"),
        nullable=False,
    )
    level: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )  # "express" | "highlight" | "detailed" | "full"
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )  # Markdown content
    model_used: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # e.g. "gpt-4o"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
