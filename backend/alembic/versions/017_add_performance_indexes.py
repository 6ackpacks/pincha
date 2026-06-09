"""add performance indexes for high-frequency queries

Revision ID: 017
Revises: 016
Create Date: 2026-04-16

"""
from alembic import op

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. videos.status->>'state' 表达式索引
    # 用于 list_videos 的状态过滤和 all_settled 检查
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_videos_status_state
        ON videos ((status->>'state'))
    """)

    # 2. user_videos(user_id) 单列索引
    # UniqueConstraint 已创建 (user_id, video_id) 复合索引，但单独的 user_id 索引
    # 对 list_videos JOIN 查询更高效
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_videos_user_id
        ON user_videos (user_id)
    """)

    # 3. user_videos(video_id) 单列索引
    # 用于按 video_id 查找所有关联用户
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_videos_video_id
        ON user_videos (video_id)
    """)

    # 4. wiki_pages(user_id, status) 复合索引
    # 用于健康检查和按状态过滤的列表查询
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_wiki_pages_user_status
        ON wiki_pages (user_id, status)
    """)

    # 5. wiki_pages(user_id, updated_at DESC) 复合索引
    # 用于列表查询的排序（ORDER BY updated_at DESC）
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_wiki_pages_user_updated
        ON wiki_pages (user_id, updated_at DESC)
    """)

    # 6. wiki_relations(to_page_id) 索引
    # 用于 backlinks 查询（WHERE to_page_id = ?）
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_wiki_relations_to_page
        ON wiki_relations (to_page_id)
    """)

    # 7. wiki_relations(from_page_id) 索引（如果不存在）
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_wiki_relations_from_page
        ON wiki_relations (from_page_id)
    """)

    # 8. videos(created_at DESC) 索引
    # 用于 list_videos ORDER BY created_at DESC
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_videos_created_at
        ON videos (created_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_videos_status_state")
    op.execute("DROP INDEX IF EXISTS idx_user_videos_user_id")
    op.execute("DROP INDEX IF EXISTS idx_user_videos_video_id")
    op.execute("DROP INDEX IF EXISTS idx_wiki_pages_user_status")
    op.execute("DROP INDEX IF EXISTS idx_wiki_pages_user_updated")
    op.execute("DROP INDEX IF EXISTS idx_wiki_relations_to_page")
    op.execute("DROP INDEX IF EXISTS idx_wiki_relations_from_page")
    op.execute("DROP INDEX IF EXISTS idx_videos_created_at")
