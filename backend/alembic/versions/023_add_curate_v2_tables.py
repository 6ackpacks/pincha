"""Add curate v2 tables: channels, sources, subscriptions, daily_picks, notifications

Revision ID: 023
Revises: 022
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # curate_channels
    op.create_table(
        "curate_channels",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("pick_count", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )

    # curate_channel_sources
    op.create_table(
        "curate_channel_sources",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("channel_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("platform", sa.String(30), nullable=False),
        sa.Column("external_user_id", sa.String(50), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("fetch_config", JSONB(), nullable=False, server_default="{}"),
        sa.Column("is_official", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["curate_channels.id"], ondelete="CASCADE"
        ),
    )

    # curate_subscriptions
    op.create_table(
        "curate_subscriptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", sa.Integer(), nullable=False),
        sa.Column("email_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("email_address", sa.String(255), nullable=True),
        sa.Column("site_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "subscribed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["curate_channels.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("user_id", "channel_id", name="uq_curate_sub_user_channel"),
    )
    op.create_index("ix_curate_subscriptions_user_id", "curate_subscriptions", ["user_id"])

    # curate_daily_picks
    op.create_table(
        "curate_daily_picks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("channel_id", sa.Integer(), nullable=False),
        sa.Column("pick_date", sa.Date(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_type", sa.String(20), nullable=False, server_default="'post'"),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("author_name", sa.String(100), nullable=True),
        sa.Column("author_avatar", sa.Text(), nullable=True),
        sa.Column("original_url", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("score_detail", JSONB(), nullable=True),
        sa.Column("is_official", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("raw_content", sa.Text(), nullable=True),
        sa.Column("article_id", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["curate_channels.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["article_id"], ["articles.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint(
            "channel_id", "pick_date", "source_id",
            name="uq_curate_pick_channel_date_source",
        ),
    )
    op.create_index("ix_curate_daily_picks_channel_id", "curate_daily_picks", ["channel_id"])
    op.create_index("ix_curate_daily_picks_pick_date", "curate_daily_picks", ["pick_date"])

    # curate_notifications
    op.create_table(
        "curate_notifications",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("pick_id", sa.Integer(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["pick_id"], ["curate_daily_picks.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("user_id", "pick_id", name="uq_curate_notif_user_pick"),
    )
    op.create_index("ix_curate_notifications_user_id", "curate_notifications", ["user_id"])

    # --- Seed data: 5 channels ---
    op.execute("""
        INSERT INTO curate_channels (id, name, slug, description, icon, pick_count, is_active, sort_order)
        VALUES
            (1, 'AI 产品上新', 'ai-product-launch', '新产品发布、新功能更新、版本升级', 'rocket', 5, TRUE, 1),
            (2, 'AI 使用教程', 'ai-tutorial', '使用教程、入门指南、工具实操', 'graduation-cap', 5, TRUE, 2),
            (3, 'AI 产品洞察', 'ai-product-insight', '深度测评、产品对比、使用体验', 'search', 5, TRUE, 3),
            (4, 'AI 深度阅读', 'ai-deep-read', '行业分析、技术解读、深度观点', 'book', 5, TRUE, 4),
            (5, 'AI 每日简报', 'ai-daily-brief', '每日 AI 行业要闻速览（系统自动生成）', 'newspaper', 5, TRUE, 5)
        ON CONFLICT (slug) DO NOTHING;
    """)

    # --- Seed data: channel_sources (watcha.cn official accounts) ---
    op.execute("""
        INSERT INTO curate_channel_sources (channel_id, name, platform, external_user_id, is_official, is_active)
        VALUES
            (1, '观猹官方-产品', 'watcha', '10010174', TRUE, TRUE),
            (2, '观猹官方-教程', 'watcha', '10010182', TRUE, TRUE),
            (3, '观猹官方-洞察', 'watcha', '10031720', TRUE, TRUE),
            (4, '观猹社区-深度', 'watcha', NULL, FALSE, TRUE),
            (5, '观猹官方-简报', 'watcha', '10010174', TRUE, TRUE);
    """)

    # Reset sequence to avoid conflicts with future inserts
    op.execute("SELECT setval('curate_channels_id_seq', (SELECT MAX(id) FROM curate_channels));")


def downgrade() -> None:
    op.drop_table("curate_notifications")
    op.drop_table("curate_daily_picks")
    op.drop_table("curate_subscriptions")
    op.drop_table("curate_channel_sources")
    op.drop_table("curate_channels")
