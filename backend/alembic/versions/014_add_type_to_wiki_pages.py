"""add type column to wiki_pages

Revision ID: 014
Revises: 013
Create Date: 2026-04-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wiki_pages",
        sa.Column(
            "type",
            sa.String(20),
            nullable=False,
            server_default="concept",
        ),
    )
    op.create_index(
        "ix_wiki_pages_user_type",
        "wiki_pages",
        ["user_id", "type"],
    )


def downgrade() -> None:
    op.drop_index("ix_wiki_pages_user_type", table_name="wiki_pages")
    op.drop_column("wiki_pages", "type")
