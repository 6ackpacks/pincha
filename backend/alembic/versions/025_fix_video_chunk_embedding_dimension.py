"""fix video chunk embedding dimension

Revision ID: 025
Revises: 024
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ensure_pgvector() -> bool:
    conn = op.get_bind()
    available = conn.execute(
        text("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'")
    ).fetchone()
    if not available:
        return False

    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    return (
        conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).fetchone()
        is not None
    )


def upgrade() -> None:
    if not _ensure_pgvector():
        return

    op.execute("DROP INDEX IF EXISTS video_chunks_embedding_idx")
    op.execute(
        """
        ALTER TABLE video_chunks
        ALTER COLUMN embedding TYPE vector(1024)
        USING CASE
            WHEN embedding IS NULL THEN NULL::vector(1024)
            WHEN array_length(string_to_array(trim(both '[]' from embedding::text), ','), 1) = 1024
                THEN (embedding::text)::vector(1024)
            ELSE NULL::vector(1024)
        END
        """
    )
    op.execute(
        "CREATE INDEX video_chunks_embedding_idx ON video_chunks "
        "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )


def downgrade() -> None:
    if not _ensure_pgvector():
        return

    op.execute("DROP INDEX IF EXISTS video_chunks_embedding_idx")
    op.execute(
        """
        ALTER TABLE video_chunks
        ALTER COLUMN embedding TYPE vector(1536)
        USING NULL::vector(1536)
        """
    )
    op.execute(
        "CREATE INDEX video_chunks_embedding_idx ON video_chunks "
        "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )
