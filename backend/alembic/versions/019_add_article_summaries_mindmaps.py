"""add article_summaries and article_mindmaps tables, extend articles

Revision ID: 019
Revises: 018
Create Date: 2026-05-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend articles table (in_wiki already exists from earlier migration)
    op.add_column("articles", sa.Column("author", sa.String(200), nullable=True))
    op.add_column("articles", sa.Column("thumbnail_url", sa.Text(), nullable=True))
    op.add_column("articles", sa.Column("word_count", sa.Integer(), nullable=True))
    op.add_column("articles", sa.Column("language", sa.String(10), nullable=True))
    op.create_unique_constraint("uq_articles_source_url", "articles", ["source_url"])

    # Article summaries (mirrors summaries table pattern)
    op.create_table(
        "article_summaries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("article_id", UUID(as_uuid=True), sa.ForeignKey("articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model_used", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("article_id", "level", name="uq_article_summaries_article_level"),
    )

    # Article mindmaps (mirrors mindmaps table pattern)
    op.create_table(
        "article_mindmaps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("article_id", UUID(as_uuid=True), sa.ForeignKey("articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("markdown", sa.Text(), nullable=False),
        sa.Column("model_used", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("article_id", name="uq_article_mindmaps_article"),
    )


def downgrade() -> None:
    op.drop_table("article_mindmaps")
    op.drop_table("article_summaries")
    op.drop_constraint("uq_articles_source_url", "articles", type_="unique")
    op.drop_column("articles", "language")
    op.drop_column("articles", "word_count")
    op.drop_column("articles", "thumbnail_url")
    op.drop_column("articles", "author")
