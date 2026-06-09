"""add podcast fields (show_name, host, description) to videos

Revision ID: 020
Revises: 019
Create Date: 2026-05-06

"""
from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("show_name", sa.String(500), nullable=True))
    op.add_column("videos", sa.Column("host", sa.String(200), nullable=True))
    op.add_column("videos", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "description")
    op.drop_column("videos", "host")
    op.drop_column("videos", "show_name")
