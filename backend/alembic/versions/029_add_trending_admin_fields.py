"""add trending admin fields to videos

Revision ID: 029
Revises: 028
"""
from alembic import op
import sqlalchemy as sa

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("videos", sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("videos", sa.Column("admin_score", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "admin_score")
    op.drop_column("videos", "is_hidden")
    op.drop_column("videos", "is_pinned")
