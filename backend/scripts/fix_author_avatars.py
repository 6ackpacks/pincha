"""One-time script to backfill author_avatar for existing curate_daily_picks.

Usage:
    docker-compose exec backend python -m scripts.fix_author_avatars

Or run directly:
    cd backend && python scripts/fix_author_avatars.py
"""

import time

import httpx
from sqlalchemy import create_engine, text

# Use the same DB URL as the app, but force psycopg2 sync driver
import os
_raw_url = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/pingcha"
)
# Replace async driver with sync psycopg2
DATABASE_URL = _raw_url.replace("postgresql+asyncpg://", "postgresql://")


BASE_URL = "https://watcha.cn/api/v2"


def main():
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Get all picks with missing author_avatar
        result = conn.execute(text("""
            SELECT DISTINCT source_id, source_type
            FROM curate_daily_picks
            WHERE source_type != 'product'
              AND (author_avatar IS NULL OR author_avatar = '')
        """))
        rows = result.fetchall()

    print(f"Found {len(rows)} unique source_ids to fix")

    updates = {}  # source_id -> avatar_url

    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        for row in rows:
            source_id = row.source_id
            source_type = row.source_type

            # Try to fetch the post/review from watcha API
            if source_id > 100000:
                # These are virtual IDs from daily brief extraction (source_id * 100 + idx)
                # The real post ID is source_id // 100
                real_id = source_id // 100
            else:
                real_id = source_id

            try:
                path = f"/discuss/posts/{real_id}"
                resp = client.get(path)
                if resp.status_code == 200:
                    data = resp.json()
                    post = data.get("data", data)
                    author = post.get("author") or post.get("user") or {}
                    avatar_url = author.get("avatar_url") or author.get("avatar")
                    if avatar_url:
                        updates[source_id] = avatar_url
                        print(f"  [OK] source_id={source_id} -> {avatar_url[:60]}...")
                    else:
                        print(f"  [NO AVATAR] source_id={source_id}")
                else:
                    print(f"  [HTTP {resp.status_code}] source_id={source_id}")
            except Exception as e:
                print(f"  [ERROR] source_id={source_id}: {e}")

            time.sleep(0.5)  # Be polite

    if not updates:
        print("No avatars found to update.")
        return

    print(f"\nUpdating {len(updates)} records in database...")

    with engine.connect() as conn:
        for source_id, avatar_url in updates.items():
            conn.execute(
                text("""
                    UPDATE curate_daily_picks
                    SET author_avatar = :avatar_url
                    WHERE source_id = :source_id
                      AND (author_avatar IS NULL OR author_avatar = '')
                """),
                {"source_id": source_id, "avatar_url": avatar_url},
            )
        conn.commit()

    print("Done!")


if __name__ == "__main__":
    main()
