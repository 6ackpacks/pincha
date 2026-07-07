"""single user local owner

Revision ID: 031
Revises: 030
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCAL_OWNER_IDENTITY = "local-owner"
LEGACY_IDENTITY_PREFIX = "watcha"
USER_ID_TABLES = (
    "user_videos",
    "articles",
    "wiki_pages",
    "knowledge_bases",
    "kb_conversations",
    "chat_messages",
    "curate_subscriptions",
    "curate_notifications",
    "user_category_subscriptions",
)


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    columns = sa.inspect(bind).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def _constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    inspector = sa.inspect(bind)
    constraints = inspector.get_unique_constraints(table_name)
    indexes = inspector.get_indexes(table_name)
    return any(item["name"] == constraint_name for item in constraints + indexes)


def _owner_id(bind):
    row = bind.execute(sa.text("""
        SELECT id
        FROM users
        WHERE is_admin = true
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 1
    """)).first()
    if row:
        return row[0]
    row = bind.execute(sa.text("""
        SELECT id
        FROM users
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 1
    """)).first()
    return row[0] if row else None


def _dedupe_before_owner_merge(bind, owner_id) -> None:
    if _table_exists(bind, "user_videos"):
        result = bind.execute(sa.text("""
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY video_id
                        ORDER BY
                            CASE WHEN user_id = :owner_id THEN 0 ELSE 1 END,
                            added_at ASC NULLS LAST,
                            id ASC
                    ) AS rn
                FROM user_videos
            )
            DELETE FROM user_videos uv
            USING ranked
            WHERE uv.id = ranked.id
              AND ranked.rn > 1
        """), {"owner_id": owner_id})
        print(f"[031] user_videos duplicate associations removed: {result.rowcount}")

    if _table_exists(bind, "curate_subscriptions"):
        result = bind.execute(sa.text("""
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY channel_id
                        ORDER BY
                            CASE WHEN user_id = :owner_id THEN 0 ELSE 1 END,
                            subscribed_at ASC NULLS LAST,
                            id ASC
                    ) AS rn
                FROM curate_subscriptions
            )
            DELETE FROM curate_subscriptions cs
            USING ranked
            WHERE cs.id = ranked.id
              AND ranked.rn > 1
        """), {"owner_id": owner_id})
        print(f"[031] curate_subscriptions duplicates removed: {result.rowcount}")

    if _table_exists(bind, "user_category_subscriptions"):
        result = bind.execute(sa.text("""
            WITH ranked AS (
                SELECT
                    ctid,
                    row_number() OVER (
                        PARTITION BY category_id
                        ORDER BY
                            CASE WHEN user_id = :owner_id THEN 0 ELSE 1 END,
                            subscribed_at ASC NULLS LAST,
                            ctid ASC
                    ) AS rn
                FROM user_category_subscriptions
            )
            DELETE FROM user_category_subscriptions ucs
            USING ranked
            WHERE ucs.ctid = ranked.ctid
              AND ranked.rn > 1
        """), {"owner_id": owner_id})
        print(f"[031] user_category_subscriptions duplicates removed: {result.rowcount}")

    if _table_exists(bind, "curate_notifications"):
        result = bind.execute(sa.text("""
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY pick_id
                        ORDER BY
                            CASE WHEN user_id = :owner_id THEN 0 ELSE 1 END,
                            created_at ASC NULLS LAST,
                            id ASC
                    ) AS rn
                FROM curate_notifications
                WHERE pick_id IS NOT NULL
            )
            DELETE FROM curate_notifications cn
            USING ranked
            WHERE cn.id = ranked.id
              AND ranked.rn > 1
        """), {"owner_id": owner_id})
        print(f"[031] curate_notifications pick duplicates removed: {result.rowcount}")
        result = bind.execute(sa.text("""
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY action_url
                        ORDER BY
                            CASE WHEN user_id = :owner_id THEN 0 ELSE 1 END,
                            created_at ASC NULLS LAST,
                            id ASC
                    ) AS rn
                FROM curate_notifications
                WHERE pick_id IS NULL
                  AND notif_type = 'organize_done'
                  AND action_url IS NOT NULL
            )
            DELETE FROM curate_notifications cn
            USING ranked
            WHERE cn.id = ranked.id
              AND ranked.rn > 1
        """), {"owner_id": owner_id})
        print(f"[031] curate_notifications organize_done duplicates removed: {result.rowcount}")

    if _table_exists(bind, "articles"):
        result = bind.execute(sa.text("""
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY kb_id, source_url
                        ORDER BY
                            CASE WHEN user_id = :owner_id THEN 0 ELSE 1 END,
                            created_at ASC NULLS LAST,
                            id ASC
                    ) AS rn
                FROM articles
                WHERE source_url IS NOT NULL
            )
            DELETE FROM articles a
            USING ranked
            WHERE a.id = ranked.id
              AND ranked.rn > 1
        """), {"owner_id": owner_id})
        print(f"[031] articles duplicate source URLs removed: {result.rowcount}")

    if _table_exists(bind, "knowledge_bases"):
        result = bind.execute(sa.text("""
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY name
                        ORDER BY
                            CASE WHEN user_id = :owner_id THEN 0 ELSE 1 END,
                            created_at ASC NULLS LAST,
                            id ASC
                    ) AS rn
                FROM knowledge_bases
            )
            UPDATE knowledge_bases kb
            SET name = left(kb.name, 76) || ' (imported-' || left(kb.id::text, 8) || ')'
            FROM ranked
            WHERE kb.id = ranked.id
              AND ranked.rn > 1
        """), {"owner_id": owner_id})
        print(f"[031] knowledge_bases renamed before owner merge: {result.rowcount}")


def upgrade() -> None:
    bind = op.get_bind()

    if not _column_exists(bind, "users", "local_identity"):
        op.add_column("users", sa.Column("local_identity", sa.String(length=64), nullable=True))

    if not _constraint_exists(bind, "users", "users_local_identity_idx"):
        op.create_index("users_local_identity_idx", "users", ["local_identity"], unique=True)

    owner_id = _owner_id(bind)
    if owner_id is not None:
        print(f"[031] selected Local Owner: {owner_id}")
        _dedupe_before_owner_merge(bind, owner_id)
        result = bind.execute(sa.text("""
            UPDATE users
            SET local_identity = CASE WHEN id = :owner_id THEN :local_identity ELSE NULL END,
                is_admin = CASE WHEN id = :owner_id THEN true ELSE is_admin END,
                nickname = CASE
                    WHEN id = :owner_id AND nickname IS NULL THEN '本地用户'
                    ELSE nickname
                END,
                name = CASE
                    WHEN id = :owner_id AND name IS NULL THEN '本地用户'
                    ELSE name
                END
        """), {"owner_id": owner_id, "local_identity": LOCAL_OWNER_IDENTITY})
        print(f"[031] users marked with Local Owner identity: {result.rowcount}")

        for table_name in USER_ID_TABLES:
            if _column_exists(bind, table_name, "user_id"):
                result = bind.execute(
                    sa.text(f"UPDATE {table_name} SET user_id = :owner_id WHERE user_id <> :owner_id"),
                    {"owner_id": owner_id},
                )
                print(f"[031] {table_name} rows reassigned to Local Owner: {result.rowcount}")
    else:
        print("[031] users table is empty; Local Owner will be created at runtime")

    bind.execute(sa.text(f"DROP INDEX IF EXISTS users_{LEGACY_IDENTITY_PREFIX}_user_id_idx"))
    print("[031] legacy identity index dropped when present")
    for column_name in (
        f"{LEGACY_IDENTITY_PREFIX}_token_expires_at",
        f"{LEGACY_IDENTITY_PREFIX}_refresh_token",
        f"{LEGACY_IDENTITY_PREFIX}_access_token",
        f"{LEGACY_IDENTITY_PREFIX}_user_id",
    ):
        if _column_exists(bind, "users", column_name):
            op.drop_column("users", column_name)
            print(f"[031] legacy identity column dropped: {column_name}")


def downgrade() -> None:
    bind = op.get_bind()

    if _constraint_exists(bind, "users", "users_local_identity_idx"):
        op.drop_index("users_local_identity_idx", table_name="users")
    if _column_exists(bind, "users", "local_identity"):
        op.drop_column("users", "local_identity")
