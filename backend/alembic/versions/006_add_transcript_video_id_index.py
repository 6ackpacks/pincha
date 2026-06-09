"""add index on transcripts.video_id for fast lookup

Revision ID: 006
Revises: 005
Create Date: 2026-04-03

"""
from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("idx_transcripts_video_id", "transcripts", ["video_id"])


def downgrade() -> None:
    op.drop_index("idx_transcripts_video_id", table_name="transcripts")
