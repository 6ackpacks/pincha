"""add segments_en JSONB column to transcripts for cached translations

Revision ID: 018
Revises: 017
Create Date: 2026-04-17

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transcripts", sa.Column("segments_en", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("transcripts", "segments_en")
