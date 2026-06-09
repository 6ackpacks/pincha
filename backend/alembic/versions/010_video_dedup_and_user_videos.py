"""video dedup: add UNIQUE(url) to videos, create user_videos table

Revision ID: 010
Revises: 009
Create Date: 2026-04-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Deduplicate videos by url before adding the unique constraint.
    # Keep the oldest row (lowest created_at) for each url.
    op.execute("""
        DELETE FROM videos v1
        USING videos v2
        WHERE v1.url = v2.url
          AND v1.created_at > v2.created_at
    """)

    op.create_unique_constraint("videos_url_unique", "videos", ["url"])

    # user_videos: tracks which users have which videos in their library
    op.create_table(
        "user_videos",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "video_id",
            UUID(as_uuid=True),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.String(20),
            nullable=False,
            comment="manual | curate | kb",
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "video_id", name="uq_user_videos_user_video"),
    )
    op.create_index("user_videos_user_id_idx", "user_videos", ["user_id"])
    op.create_index("user_videos_video_id_idx", "user_videos", ["video_id"])


def downgrade() -> None:
    op.drop_index("user_videos_video_id_idx", table_name="user_videos")
    op.drop_index("user_videos_user_id_idx", table_name="user_videos")
    op.drop_table("user_videos")
    op.drop_constraint("videos_url_unique", "videos", type_="unique")
