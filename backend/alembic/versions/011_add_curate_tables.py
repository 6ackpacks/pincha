"""add curate tables: categories, sources, subscriptions, daily feed

Revision ID: 011
Revises: 010
Create Date: 2026-04-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- curate_categories ------------------------------------------------
    op.create_table(
        "curate_categories",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("slug", sa.String(50), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("sort_order", sa.Integer, server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("slug", name="uq_curate_categories_slug"),
    )

    # --- curate_sources ---------------------------------------------------
    op.create_table(
        "curate_sources",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("curate_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        # youtube | github | hn | arxiv | reddit | producthunt | bilibili | wechat
        sa.Column("fetch_config", JSONB, server_default=sa.text("'{}'"), nullable=False),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("curate_sources_category_id_idx", "curate_sources", ["category_id"])

    # --- user_category_subscriptions -------------------------------------
    op.create_table(
        "user_category_subscriptions",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("curate_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email_enabled", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("site_enabled", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("subscribed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "category_id", name="pk_user_category_subscriptions"),
    )
    op.create_index(
        "user_category_subs_user_id_idx", "user_category_subscriptions", ["user_id"]
    )

    # --- daily_feed_items ------------------------------------------------
    op.create_table(
        "daily_feed_items",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("curate_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_id",
            UUID(as_uuid=True),
            sa.ForeignKey("curate_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("feed_date", sa.Date, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("thumbnail_url", sa.Text, nullable=True),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("external_id", sa.Text, nullable=True),
        sa.Column(
            "video_id",
            UUID(as_uuid=True),
            sa.ForeignKey("videos.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "article_id",
            UUID(as_uuid=True),
            sa.ForeignKey("articles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rank", sa.Integer, nullable=True),
        sa.Column("raw_score", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("source_id", "external_id", name="uq_daily_feed_source_external"),
    )
    op.create_index("daily_feed_items_category_date_idx", "daily_feed_items", ["category_id", "feed_date"])
    op.create_index("daily_feed_items_feed_date_idx", "daily_feed_items", ["feed_date"])


def downgrade() -> None:
    op.drop_index("daily_feed_items_feed_date_idx", table_name="daily_feed_items")
    op.drop_index("daily_feed_items_category_date_idx", table_name="daily_feed_items")
    op.drop_table("daily_feed_items")
    op.drop_index("user_category_subs_user_id_idx", table_name="user_category_subscriptions")
    op.drop_table("user_category_subscriptions")
    op.drop_index("curate_sources_category_id_idx", table_name="curate_sources")
    op.drop_table("curate_sources")
    op.drop_table("curate_categories")
