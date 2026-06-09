import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Transcript(Base):
    __tablename__ = "transcripts"
    __table_args__ = (
        UniqueConstraint("video_id", name="uq_transcripts_video_id"),
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
    language: Mapped[str] = mapped_column(
        String(10),
        default="zh",
    )
    source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )  # "platform" | "asr"
    segments: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
    )  # [{start: float, end: float, text: str}]
    full_text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    segments_en: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )  # [{start: float, end: float, text: str}] — English translations, index-aligned with segments
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
