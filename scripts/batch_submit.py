"""Batch submit videos and podcasts for concurrent processing test.

Usage:
    python3 scripts/batch_submit.py

Generates a JWT session cookie for ADMIN_USER_ID and submits videos concurrently.
"""
import asyncio
import time
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt

# --- Config ---
API_BASE = "http://localhost:8000/api/v1"
# WARNING: JWT_SECRET must match backend JWT_SECRET_KEY in .env
JWT_SECRET = "changeme-use-a-long-random-secret"
# Test user ID (replace with actual user ID from your database)
ADMIN_USER_ID = "00000000-0000-0000-0000-000000000001"
CONCURRENCY = 10  # max parallel submissions

# --- Generate session token ---
def make_token() -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode({"sub": ADMIN_USER_ID, "exp": expire}, JWT_SECRET, algorithm="HS256")


# --- Video list: 30+ trending YouTube videos (2025-2026 popular content) ---
YOUTUBE_VIDEOS = [
    # AI & Tech
    "https://www.youtube.com/watch?v=jvqFAi7vkBc",  # Sam Altman on AGI
    "https://www.youtube.com/watch?v=aircAruvnKk",  # 3Blue1Brown neural networks
    "https://www.youtube.com/watch?v=zjkBMFhNj_g",  # Andrej Karpathy - Intro to LLMs
    "https://www.youtube.com/watch?v=7xTGNNLPyMI",  # Lex Fridman - Elon Musk
    "https://www.youtube.com/watch?v=e-gwvmhyU7A",  # Two Minute Papers - AI
    "https://www.youtube.com/watch?v=kCc8FmEb1nY",  # Karpathy - GPT from scratch
    "https://www.youtube.com/watch?v=VMj-3S1tku0",  # CS50 - Intro to AI
    "https://www.youtube.com/watch?v=flXrLGPY3SU",  # Fireship - 100 seconds of AI
    "https://www.youtube.com/watch?v=WXuK6gekU1Y",  # DeepMind AlphaFold
    "https://www.youtube.com/watch?v=SjhIlw3Iffs",  # Y Combinator - How to start a startup
    # Business & Entrepreneurship
    "https://www.youtube.com/watch?v=uvHpaVqDMwM",  # Naval Ravikant - How to Get Rich
    "https://www.youtube.com/watch?v=PkXELH6Y2lM",  # Patrick Bet-David - Valuetainment
    "https://www.youtube.com/watch?v=ZoqgAy3h4OM",  # Y Combinator - Startup School
    "https://www.youtube.com/watch?v=ID-M21i3-Uw",  # Ali Abdaal - Productivity
    "https://www.youtube.com/watch?v=Unzc731iCUY",  # TED - How great leaders inspire
    "https://www.youtube.com/watch?v=UF8uR6Z6KLc",  # Steve Jobs Stanford speech
    "https://www.youtube.com/watch?v=rStL7niR7gs",  # Marques Brownlee - tech review
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",  # Popular viral video
    "https://www.youtube.com/watch?v=rfscVS0vtbw",  # freeCodeCamp Python tutorial
    "https://www.youtube.com/watch?v=8jLOx1hD3_o",  # CS50 2024
    # Science & Education
    "https://www.youtube.com/watch?v=MBRqu0YOH14",  # Veritasium - Math
    "https://www.youtube.com/watch?v=HEfHFsfGXjs",  # Kurzgesagt - AI
    "https://www.youtube.com/watch?v=JTxsNm9IdYU",  # Huberman Lab - Focus
    "https://www.youtube.com/watch?v=arj7oStGLkU",  # TED - Inside the mind of a procrastinator
    "https://www.youtube.com/watch?v=DLzxrzFCyOs",  # Popular trending
    "https://www.youtube.com/watch?v=W6NZfCO5SIk",  # JavaScript tutorial
    "https://www.youtube.com/watch?v=pTB0EiLXUC8",  # Data Science full course
    "https://www.youtube.com/watch?v=x7X9w_GIm1s",  # Python Machine Learning
    "https://www.youtube.com/watch?v=GwIo3gDZCVQ",  # MIT OpenCourseWare
    "https://www.youtube.com/watch?v=fNk_zzaMoSs",  # Traversy Media - Web Dev
    "https://www.youtube.com/watch?v=bMknfKXIFA8",  # React Course 2024
    "https://www.youtube.com/watch?v=CvBiEuB9wYg",  # Google I/O AI keynote
]

# --- Podcasts: AI & Business (RSS feeds) ---
PODCASTS = [
    "https://lexfridman.com/feed/podcast/",  # Lex Fridman Podcast
    "https://feeds.megaphone.fm/hubermanlab",  # Huberman Lab
    "https://feeds.simplecast.com/54nAGcIl",  # All-In Podcast
    "https://anchor.fm/s/1e4a0eac/podcast/rss",  # My First Million
    "https://feeds.pacific-content.com/a]16podcast",  # a]16z Podcast
]

# --- Submit logic ---
async def submit_one(client: httpx.AsyncClient, url: str, platform: str, sem: asyncio.Semaphore) -> dict:
    async with sem:
        try:
            resp = await client.post(
                f"{API_BASE}/videos",
                json={"url": url, "platform": platform},
                timeout=30,
            )
            status = resp.status_code
            data = resp.json() if resp.status_code < 500 else {}
            title = data.get("title") or data.get("url", url)[:50]
            print(f"  [{status}] {platform:8s} | {title}")
            return {"url": url, "status": status, "data": data}
        except Exception as e:
            print(f"  [ERR] {platform:8s} | {url[:50]} | {e}")
            return {"url": url, "status": 0, "error": str(e)}


async def main():
    token = make_token()
    print(f"Generated JWT token for user {ADMIN_USER_ID}")
    print(f"Submitting {len(YOUTUBE_VIDEOS)} YouTube videos + {len(PODCASTS)} podcasts")
    print(f"Concurrency limit: {CONCURRENCY}")
    print("-" * 60)

    sem = asyncio.Semaphore(CONCURRENCY)
    cookies = {"session": token}

    async with httpx.AsyncClient(cookies=cookies) as client:
        # Submit all videos and podcasts concurrently
        tasks = []
        for url in YOUTUBE_VIDEOS:
            tasks.append(submit_one(client, url, "youtube", sem))
        for url in PODCASTS:
            tasks.append(submit_one(client, url, "podcast", sem))

        t0 = time.monotonic()
        results = await asyncio.gather(*tasks)
        elapsed = time.monotonic() - t0

    # Summary
    print("-" * 60)
    created = sum(1 for r in results if r["status"] == 201)
    existing = sum(1 for r in results if r["status"] == 200)
    failed = sum(1 for r in results if r["status"] not in (200, 201))
    print(f"Done in {elapsed:.1f}s")
    print(f"  Created: {created}")
    print(f"  Already existed: {existing}")
    print(f"  Failed: {failed}")

    if failed:
        print("\nFailed submissions:")
        for r in results:
            if r["status"] not in (200, 201):
                print(f"  {r['url'][:60]} -> {r.get('error') or r.get('data')}")


if __name__ == "__main__":
    asyncio.run(main())
