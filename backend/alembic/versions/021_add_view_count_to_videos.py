"""add view_count to videos for popularity ranking

Revision ID: 021
Revises: 020
Create Date: 2026-05-07

"""
from alembic import op
import sqlalchemy as sa

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("videos", "view_count")
