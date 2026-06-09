"""add video_chunks and chat_sessions tables with pgvector

Revision ID: 007
Revises: 006
Create Date: 2026-04-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import text

    conn = op.get_bind()
    result = conn.execute(text(
        "SELECT 1 FROM pg_available_extensions WHERE name = 'vector' AND installed_version IS NOT NULL"
    )).fetchone()
    if not result:
        result = conn.execute(text(
            "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'"
        )).fetchone()
        if result:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    has_pgvector = conn.execute(text(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
    )).fetchone() is not None

    op.create_table(
        "video_chunks",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "video_id",
            UUID(as_uuid=True),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", sa.Text, nullable=True),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("start_time", sa.Float, nullable=True),
        sa.Column("end_time", sa.Float, nullable=True),
        sa.Column("metadata_", JSONB, server_default=sa.text("'{}'")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    if has_pgvector:
        op.execute("ALTER TABLE video_chunks ALTER COLUMN embedding TYPE vector(1536) USING NULL")
        op.execute(
            "CREATE INDEX video_chunks_embedding_idx ON video_chunks "
            "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
        )

    op.create_index("video_chunks_video_id_idx", "video_chunks", ["video_id"])

    op.create_table(
        "chat_sessions",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "video_id",
            UUID(as_uuid=True),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("messages", JSONB, server_default=sa.text("'[]'")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    op.create_index("chat_sessions_video_id_idx", "chat_sessions", ["video_id"])


def downgrade() -> None:
    op.drop_table("chat_sessions")
    op.drop_table("video_chunks")
    # Note: we do not drop the vector extension as other tables may depend on it
