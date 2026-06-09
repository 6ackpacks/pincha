"""add wiki tables and articles table

Revision ID: 009
Revises: 008
Create Date: 2026-04-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- articles table -------------------------------------------------
    op.create_table(
        "articles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.Text, nullable=False),   # 'url' | 'text'
        sa.Column("source_url", sa.Text, nullable=True),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("status", JSONB, server_default=sa.text("'{\"state\": \"pending\", \"progress\": 0, \"message\": \"\"}'")),
        sa.Column("in_wiki", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("articles_user_id_idx", "articles", ["user_id"])

    # --- videos: add in_wiki column -------------------------------------
    op.add_column(
        "videos",
        sa.Column("in_wiki", sa.Boolean, server_default=sa.text("false"), nullable=False),
    )

    # --- wiki_pages table -----------------------------------------------
    op.create_table(
        "wiki_pages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("slug", sa.Text, nullable=False),
        sa.Column("content", sa.Text, server_default=sa.text("''")),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("status", sa.Text, server_default=sa.text("'draft'"), nullable=False),
        sa.Column("source_count", sa.Integer, server_default=sa.text("0"), nullable=False),
        sa.Column("tags", JSONB, server_default=sa.text("'[]'")),
        sa.Column("has_contradiction", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("embedding", sa.Text, nullable=True),  # placeholder, altered below
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "slug", name="uq_wiki_pages_user_slug"),
    )
    from sqlalchemy import text
    conn = op.get_bind()
    try:
        conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
        has_pgvector = conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).fetchone() is not None
    except Exception:
        has_pgvector = False

    if has_pgvector:
        op.execute(
            "ALTER TABLE wiki_pages ALTER COLUMN embedding TYPE vector(1024) USING NULL::vector(1024)"
        )
    op.create_index("wiki_pages_user_id_idx", "wiki_pages", ["user_id"])
    if has_pgvector:
        op.execute(
            "CREATE INDEX wiki_pages_embedding_idx ON wiki_pages "
            "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)"
        )

    # --- wiki_sources table ---------------------------------------------
    op.create_table(
        "wiki_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "wiki_page_id",
            UUID(as_uuid=True),
            sa.ForeignKey("wiki_pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_type", sa.Text, nullable=False),   # 'video' | 'article'
        sa.Column("source_id", UUID(as_uuid=True), nullable=False),
        sa.Column("contribution", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("wiki_page_id", "source_id", name="uq_wiki_sources_page_source"),
    )
    op.create_index("wiki_sources_page_id_idx", "wiki_sources", ["wiki_page_id"])

    # --- wiki_relations table -------------------------------------------
    op.create_table(
        "wiki_relations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "from_page_id",
            UUID(as_uuid=True),
            sa.ForeignKey("wiki_pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "to_page_id",
            UUID(as_uuid=True),
            sa.ForeignKey("wiki_pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relation_type", sa.Text, nullable=False),  # related | contradicts | extends
        sa.Column("strength", sa.Float, server_default=sa.text("0.5"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("from_page_id", "to_page_id", name="uq_wiki_relations_pair"),
    )
    op.create_index("wiki_relations_from_page_idx", "wiki_relations", ["from_page_id"])


def downgrade() -> None:
    op.drop_index("wiki_relations_from_page_idx", table_name="wiki_relations")
    op.drop_table("wiki_relations")
    op.drop_index("wiki_sources_page_id_idx", table_name="wiki_sources")
    op.drop_table("wiki_sources")
    op.drop_index("wiki_pages_embedding_idx", table_name="wiki_pages")
    op.drop_index("wiki_pages_user_id_idx", table_name="wiki_pages")
    op.drop_table("wiki_pages")
    op.drop_column("videos", "in_wiki")
    op.drop_index("articles_user_id_idx", table_name="articles")
    op.drop_table("articles")
