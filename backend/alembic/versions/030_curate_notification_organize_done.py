"""make curate notification pick_id nullable and add organize_done fields

Revision ID: 030
Revises: 029
"""
from alembic import op
import sqlalchemy as sa


revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. pick_id 改为可空（organize_done 类通知无关联 pick）
    op.alter_column(
        "curate_notifications",
        "pick_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # 2. 新增通用通知字段（不 DROP 任何已有列）
    op.add_column(
        "curate_notifications",
        sa.Column("notif_type", sa.String(length=32), nullable=False, server_default="pick"),
    )
    op.add_column(
        "curate_notifications",
        sa.Column("title", sa.Text(), nullable=True),
    )
    op.add_column(
        "curate_notifications",
        sa.Column("body", sa.Text(), nullable=True),
    )
    op.add_column(
        "curate_notifications",
        sa.Column("action_url", sa.Text(), nullable=True),
    )

    # 3. organize_done 类通知的幂等去重（partial unique index）
    # Postgres 中 uq_curate_notif_user_pick 对 pick_id IS NULL 的行视为不冲突，
    # 因此为 organize_done 单独建按 user_id + action_url 的部分唯一索引。
    op.create_index(
        "uq_curate_notif_organize_done",
        "curate_notifications",
        ["user_id", "action_url"],
        unique=True,
        postgresql_where=sa.text("pick_id IS NULL AND notif_type = 'organize_done'"),
    )


def downgrade() -> None:
    op.drop_index("uq_curate_notif_organize_done", table_name="curate_notifications")
    op.drop_column("curate_notifications", "action_url")
    op.drop_column("curate_notifications", "body")
    op.drop_column("curate_notifications", "title")
    op.drop_column("curate_notifications", "notif_type")
    op.alter_column(
        "curate_notifications",
        "pick_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
