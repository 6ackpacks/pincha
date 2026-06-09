"""add knowledge_bases and kb_id to wiki/articles

Revision ID: 024
Revises: 023
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create knowledge_bases table
    op.create_table(
        "knowledge_bases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False, server_default="默认知识库"),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_knowledge_bases_user_id", "knowledge_bases", ["user_id"])
    op.create_unique_constraint("uq_knowledge_bases_user_name", "knowledge_bases", ["user_id", "name"])

    # 2. Create kb_conversations table
    op.create_table(
        "kb_conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("kb_id", UUID(as_uuid=True), sa.ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default="新对话"),
        sa.Column("messages", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_kb_conversations_kb_id", "kb_conversations", ["kb_id"])

    # 3. For each existing user, create a default knowledge base
    op.execute("""
        INSERT INTO knowledge_bases (id, user_id, name, is_default, created_at, updated_at)
        SELECT gen_random_uuid(), id, '默认知识库', true, now(), now()
        FROM users
    """)

    # 4. Add kb_id to wiki_pages (nullable first)
    op.add_column("wiki_pages", sa.Column("kb_id", UUID(as_uuid=True), nullable=True))

    # 5. Backfill wiki_pages.kb_id from user's default KB
    op.execute("""
        UPDATE wiki_pages
        SET kb_id = kb.id
        FROM knowledge_bases kb
        WHERE kb.user_id = wiki_pages.user_id AND kb.is_default = true
    """)

    # 6. Set NOT NULL and add FK + index
    op.alter_column("wiki_pages", "kb_id", nullable=False)
    op.create_foreign_key("fk_wiki_pages_kb_id", "wiki_pages", "knowledge_bases", ["kb_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_wiki_pages_kb_id", "wiki_pages", ["kb_id"])

    # 7. Replace unique constraint: (user_id, slug) -> (kb_id, slug)
    op.drop_constraint("uq_wiki_pages_user_slug", "wiki_pages", type_="unique")
    op.create_unique_constraint("uq_wiki_pages_kb_slug", "wiki_pages", ["kb_id", "slug"])

    # 8. Add kb_id to articles (nullable first)
    op.add_column("articles", sa.Column("kb_id", UUID(as_uuid=True), nullable=True))

    # 9. Backfill articles.kb_id
    op.execute("""
        UPDATE articles
        SET kb_id = kb.id
        FROM knowledge_bases kb
        WHERE kb.user_id = articles.user_id AND kb.is_default = true
    """)

    # 10. Set NOT NULL and add FK + index
    op.alter_column("articles", "kb_id", nullable=False)
    op.create_foreign_key("fk_articles_kb_id", "articles", "knowledge_bases", ["kb_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_articles_kb_id", "articles", ["kb_id"])


def downgrade() -> None:
    # Reverse: remove kb_id from articles
    op.drop_index("ix_articles_kb_id", "articles")
    op.drop_constraint("fk_articles_kb_id", "articles", type_="foreignkey")
    op.drop_column("articles", "kb_id")

    # Reverse: restore wiki_pages unique constraint
    op.drop_constraint("uq_wiki_pages_kb_slug", "wiki_pages", type_="unique")
    op.create_unique_constraint("uq_wiki_pages_user_slug", "wiki_pages", ["user_id", "slug"])

    # Reverse: remove kb_id from wiki_pages
    op.drop_index("ix_wiki_pages_kb_id", "wiki_pages")
    op.drop_constraint("fk_wiki_pages_kb_id", "wiki_pages", type_="foreignkey")
    op.drop_column("wiki_pages", "kb_id")

    # Drop tables
    op.drop_table("kb_conversations")
    op.drop_table("knowledge_bases")
