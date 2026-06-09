"""wiki phase2: community detection and contradiction details

Revision ID: 016
Revises: 015
Create Date: 2026-04-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("wiki_pages", sa.Column("community_id", sa.Integer(), nullable=True))
    op.add_column(
        "wiki_pages",
        sa.Column(
            "contradiction_details",
            JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "wiki_pages",
        sa.Column(
            "review_items",
            JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.create_index("wiki_pages_community_id_idx", "wiki_pages", ["community_id"])


def downgrade() -> None:
    op.drop_index("wiki_pages_community_id_idx", table_name="wiki_pages")
    op.drop_column("wiki_pages", "review_items")
    op.drop_column("wiki_pages", "contradiction_details")
    op.drop_column("wiki_pages", "community_id")
