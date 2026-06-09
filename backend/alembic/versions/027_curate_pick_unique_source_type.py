"""include source_type in curate pick uniqueness

Revision ID: 027
Revises: 026
"""
from alembic import op


revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_curate_pick_channel_date_source",
        "curate_daily_picks",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_curate_pick_channel_date_source_type_source",
        "curate_daily_picks",
        ["channel_id", "pick_date", "source_type", "source_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_curate_pick_channel_date_source_type_source",
        "curate_daily_picks",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_curate_pick_channel_date_source",
        "curate_daily_picks",
        ["channel_id", "pick_date", "source_id"],
    )
