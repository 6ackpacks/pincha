import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Text, String, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Mindmap(Base):
    __tablename__ = "mindmaps"
    __table_args__ = (
        UniqueConstraint("video_id", name="uq_mindmaps_video"),
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
    markdown: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )  # Markdown source for markmap rendering
    model_used: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
