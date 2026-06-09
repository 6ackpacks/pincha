"""Multi-user concurrent video submission test.

Creates 4 test users, each submits 3 videos simultaneously.
Tests true multi-user concurrency with Volcengine ASR fallback.

Usage:
    python3 scripts/multiuser_test.py
"""
import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt

API_BASE = "http://localhost:8000/api/v1"
# WARNING: JWT_SECRET must match backend JWT_SECRET_KEY in .env
JWT_SECRET = "changeme-use-a-long-random-secret"

# 4 test users — will be created in DB if not exist
TEST_USERS = [
    {"id": "11111111-1111-1111-1111-111111111111", "name": "TestUser_A"},
    {"id": "22222222-2222-2222-2222-222222222222", "name": "TestUser_B"},
    {"id": "33333333-3333-3333-3333-333333333333", "name": "TestUser_C"},
    {"id": "44444444-4444-4444-4444-444444444444", "name": "TestUser_D"},
]

# Each user gets 3 videos — mix of videos likely to have subtitles
# Using popular videos with known Chinese/English subtitles
USER_VIDEOS = {
    "TestUser_A": [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",   # Rick Astley (has subs)
        "https://www.youtube.com/watch?v=9bZkp7q19f0",   # Gangnam Style (has subs)
        "https://www.youtube.com/watch?v=kJQP7kiw5Fk",   # Despacito (has subs)
    ],
    "TestUser_B": [
        "https://www.youtube.com/watch?v=RgKAFK5djSk",   # See You Again (has subs)
        "https://www.youtube.com/watch?v=JGwWNGJdvx8",   # Shape of You (has subs)
        "https://www.youtube.com/watch?v=OPf0YbXqDm0",   # Uptown Funk (has subs)
    ],
    "TestUser_C": [
        "https://www.youtube.com/watch?v=60ItHLz5WEA",   # Alan Walker Faded (has subs)
        "https://www.youtube.com/watch?v=fRh_vgS2dFE",   # Sorry (has subs)
        "https://www.youtube.com/watch?v=CevxZvSJLk8",   # Roar (has subs)
    ],
    "TestUser_D": [
        "https://www.youtube.com/watch?v=hT_nvWreIhg",   # Counting Stars (has subs)
        "https://www.youtube.com/watch?v=YQHsXMglC9A",   # Hello Adele (has subs)
        "https://www.youtube.com/watch?v=450p7goxZqg",   # Believer (has subs)
    ],
}


def make_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode({"sub": user_id, "exp": expire}, JWT_SECRET, algorithm="HS256")


async def ensure_users_exist():
    """Create test users in DB via direct psql."""
    import subprocess
    for user in TEST_USERS:
        cmd = (
            f"docker exec ping_cha-db-1 psql -U postgres -d pingcha -c "
            f"\"INSERT INTO users (id, email, name) "
            f"VALUES ('{user['id']}', '{user['name'].lower()}@test.local', '{user['name']}') "
            f"ON CONFLICT (id) DO NOTHING;\""
        )
        subprocess.run(cmd, shell=True, capture_output=True)
    print(f"Ensured {len(TEST_USERS)} test users exist in DB")


async def submit_video(client: httpx.AsyncClient, url: str, user_name: str) -> dict:
    try:
        resp = await client.post(
            f"{API_BASE}/videos",
            json={"url": url, "platform": "youtube"},
            timeout=30,
        )
        status = resp.status_code
        data = resp.json() if status < 500 else {}
        title = data.get("title") or url.split("=")[-1]
        state = "NEW" if status == 201 else "EXISTS" if status == 200 else f"ERR:{status}"
        print(f"  [{state:6s}] {user_name} | {title}")
        return {"user": user_name, "url": url, "status": status}
    except Exception as e:
        print(f"  [ERROR ] {user_name} | {url.split('=')[-1]} | {e}")
        return {"user": user_name, "url": url, "status": 0, "error": str(e)}


async def user_session(user: dict, videos: list[str]):
    """Simulate one user submitting multiple videos concurrently."""
    token = make_token(user["id"])
    async with httpx.AsyncClient(cookies={"session": token}) as client:
        tasks = [submit_video(client, url, user["name"]) for url in videos]
        return await asyncio.gather(*tasks)


async def monitor_progress(duration: int = 300, interval: int = 15):
    """Monitor processing progress for a duration."""
    import subprocess
    print(f"\n{'='*60}")
    print("Monitoring processing progress...")
    print(f"{'='*60}")

    start = time.monotonic()
    while time.monotonic() - start < duration:
        await asyncio.sleep(interval)
        elapsed = int(time.monotonic() - start)
        result = subprocess.run(
            "docker exec ping_cha-db-1 psql -U postgres -d pingcha -t -c "
            "\"SELECT (status->>'state') as s, COUNT(*) FROM videos GROUP BY 1 ORDER BY 2 DESC;\"",
            shell=True, capture_output=True, text=True,
        )
        lines = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]
        status_str = " | ".join(lines)
        print(f"  [{elapsed:3d}s] {status_str}")

        # Check if all are done/failed
        if all("transcribing" not in l and "summarizing" not in l and "pending" not in l for l in lines):
            print("  All tasks settled!")
            break


async def main():
    print("=" * 60)
    print("Multi-User Concurrent Video Processing Test")
    print(f"Users: {len(TEST_USERS)} | Videos per user: 3 | Total: {len(TEST_USERS) * 3}")
    print("=" * 60)

    # Step 1: Ensure test users exist
    await ensure_users_exist()

    # Step 2: All users submit videos concurrently
    print(f"\nSubmitting videos (all users in parallel)...")
    print("-" * 60)

    t0 = time.monotonic()
    user_tasks = []
    for user in TEST_USERS:
        videos = USER_VIDEOS[user["name"]]
        user_tasks.append(user_session(user, videos))

    all_results = await asyncio.gather(*user_tasks)
    elapsed = time.monotonic() - t0

    # Flatten results
    results = [r for user_results in all_results for r in user_results]

    print("-" * 60)
    created = sum(1 for r in results if r["status"] == 201)
    existing = sum(1 for r in results if r["status"] == 200)
    failed = sum(1 for r in results if r["status"] not in (200, 201))
    print(f"Submission done in {elapsed:.1f}s")
    print(f"  Created: {created} | Already existed: {existing} | Failed: {failed}")

    # Step 3: Monitor processing
    if created > 0:
        await monitor_progress(duration=300, interval=15)

    # Final summary
    import subprocess
    result = subprocess.run(
        "docker exec ping_cha-db-1 psql -U postgres -d pingcha -c "
        "\"SELECT title, platform, (status->>'state') as state, (status->>'message') as msg "
        "FROM videos WHERE created_at > NOW() - INTERVAL '10 minutes' ORDER BY created_at DESC;\"",
        shell=True, capture_output=True, text=True,
    )
    print(f"\n{'='*60}")
    print("Final Results (last 10 min):")
    print(result.stdout)


if __name__ == "__main__":
    asyncio.run(main())
