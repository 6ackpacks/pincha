"""One-time script: backfill missing video titles from express summaries.

Usage:
    docker-compose exec backend python -m scripts.backfill_titles
    # or directly:
    cd backend && python ../scripts/backfill_titles.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://pingcha:pingcha@localhost:5432/pingcha",
)

engine = create_engine(DATABASE_URL)


def main():
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT v.id, s.content
                FROM videos v
                JOIN summaries s ON s.video_id = v.id AND s.level = 'express'
                WHERE (v.title IS NULL OR v.title = '')
                  AND v.status->>'state' = 'done'
            """)
        ).fetchall()

        if not rows:
            print("No videos with missing titles found.")
            return

        print(f"Found {len(rows)} videos with missing titles. Backfilling...")

        for video_id, content in rows:
            if not content:
                continue
            first_line = content.strip().split("\n")[0].strip()
            title = first_line.lstrip("#").strip()
            if not title:
                title = content.strip()[:60]
            if len(title) > 80:
                title = title[:77] + "..."

            conn.execute(
                text("UPDATE videos SET title = :title WHERE id = :id"),
                {"id": video_id, "title": title},
            )
            print(f"  [{video_id}] -> {title}")

        conn.commit()
        print("Done.")


if __name__ == "__main__":
    main()
