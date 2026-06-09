"""add oauth fields to users table

Revision ID: 013
Revises: 012
Create Date: 2026-04-10

Add watcha_user_id, nickname, avatar_url; make email nullable.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add Watcha OAuth identity columns
    op.add_column("users", sa.Column("watcha_user_id", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("nickname", sa.String(100), nullable=True))
    op.add_column("users", sa.Column("avatar_url", sa.Text(), nullable=True))

    # Make email nullable (Watcha users may not have one)
    op.alter_column("users", "email", nullable=True)

    # Unique index on watcha_user_id
    op.create_index("users_watcha_user_id_idx", "users", ["watcha_user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("users_watcha_user_id_idx", table_name="users")
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "nickname")
    op.drop_column("users", "watcha_user_id")
    # Restore NOT NULL on email (may fail if nulls exist)
    op.alter_column("users", "email", nullable=False)
