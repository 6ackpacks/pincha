"""add phone and watcha oauth tokens to users

Revision ID: 015
Revises: 014
Create Date: 2026-04-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("watcha_access_token", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("watcha_refresh_token", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column("watcha_token_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "watcha_token_expires_at")
    op.drop_column("users", "watcha_refresh_token")
    op.drop_column("users", "watcha_access_token")
    op.drop_column("users", "phone")
