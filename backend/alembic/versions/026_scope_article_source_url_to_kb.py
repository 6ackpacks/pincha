"""scope article source_url uniqueness to user KB

Revision ID: 026
Revises: 025
"""
from alembic import op


revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_articles_source_url", "articles", type_="unique")
    op.create_unique_constraint(
        "uq_articles_user_kb_source_url",
        "articles",
        ["user_id", "kb_id", "source_url"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_articles_user_kb_source_url", "articles", type_="unique")
    op.create_unique_constraint("uq_articles_source_url", "articles", ["source_url"])
