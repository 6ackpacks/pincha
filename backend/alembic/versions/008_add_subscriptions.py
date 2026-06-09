"""add subscriptions and feed_items tables

Revision ID: 008
Revises: 006
Create Date: 2026-04-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("thumbnail_url", sa.Text, nullable=True),
        sa.Column("auto_process", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_interval_hours", sa.Integer, server_default=sa.text("6"), nullable=False),
        sa.Column("status", sa.String(20), server_default=sa.text("'active'"), nullable=False),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("subscriptions_status_idx", "subscriptions", ["status"])

    op.create_table(
        "feed_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "video_id",
            UUID(as_uuid=True),
            sa.ForeignKey("videos.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("video_url", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("thumbnail_url", sa.Text, nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seen", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("processed", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("subscription_id", "video_url", name="uq_feed_items_sub_url"),
    )
    op.create_index("feed_items_subscription_id_idx", "feed_items", ["subscription_id"])


def downgrade() -> None:
    op.drop_index("feed_items_subscription_id_idx", table_name="feed_items")
    op.drop_table("feed_items")
    op.drop_index("subscriptions_status_idx", table_name="subscriptions")
    op.drop_table("subscriptions")
