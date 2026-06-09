#!/usr/bin/env python3
"""Seed curate v2 channels into the database.

This script ensures the 5 curate v2 channels exist in the database.
It's idempotent — safe to run multiple times.

Run from backend/ directory:
    python -m app.scripts.seed_curate_v2

Or inside Docker:
    docker-compose exec backend python -m app.scripts.seed_curate_v2
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

CHANNELS = [
    {
        "id": 1,
        "name": "AI 产品上新",
        "slug": "ai-product-launch",
        "description": "新产品发布、新功能更新、版本升级",
        "icon": "rocket",
        "pick_count": 5,
        "sort_order": 1,
    },
    {
        "id": 2,
        "name": "AI 使用教程",
        "slug": "ai-tutorial",
        "description": "使用教程、入门指南、工具实操",
        "icon": "graduation-cap",
        "pick_count": 5,
        "sort_order": 2,
    },
    {
        "id": 3,
        "name": "AI 产品洞察",
        "slug": "ai-product-insight",
        "description": "深度测评、产品对比、使用体验",
        "icon": "search",
        "pick_count": 5,
        "sort_order": 3,
    },
    {
        "id": 4,
        "name": "AI 深度阅读",
        "slug": "ai-deep-read",
        "description": "行业分析、技术解读、深度观点",
        "icon": "book",
        "pick_count": 5,
        "sort_order": 4,
    },
    {
        "id": 5,
        "name": "AI 每日简报",
        "slug": "ai-daily-brief",
        "description": "每日 AI 行业要闻速览（系统自动生成）",
        "icon": "newspaper",
        "pick_count": 5,
        "sort_order": 5,
    },
]

SOURCES = [
    {"channel_id": 1, "name": "观猹官方-产品", "platform": "watcha", "external_user_id": "10010174", "is_official": True},
    {"channel_id": 2, "name": "观猹官方-教程", "platform": "watcha", "external_user_id": "10010182", "is_official": True},
    {"channel_id": 3, "name": "观猹官方-洞察", "platform": "watcha", "external_user_id": "10031720", "is_official": True},
    {"channel_id": 4, "name": "观猹社区-深度", "platform": "watcha", "external_user_id": None, "is_official": False},
    {"channel_id": 5, "name": "观猹官方-简报", "platform": "watcha", "external_user_id": "10010174", "is_official": True},
]


async def seed():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from sqlalchemy.orm import sessionmaker

    from app.config import settings

    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        for ch in CHANNELS:
            result = await db.execute(
                text("SELECT id FROM curate_channels WHERE slug = :slug"),
                {"slug": ch["slug"]},
            )
            if result.scalar_one_or_none():
                print(f"  [skip] Channel exists: {ch['slug']}")
            else:
                await db.execute(
                    text("""
                        INSERT INTO curate_channels (id, name, slug, description, icon, pick_count, is_active, sort_order)
                        VALUES (:id, :name, :slug, :description, :icon, :pick_count, TRUE, :sort_order)
                    """),
                    ch,
                )
                print(f"  [+] Created channel: {ch['slug']}")

        for src in SOURCES:
            result = await db.execute(
                text("SELECT id FROM curate_channel_sources WHERE channel_id = :channel_id AND name = :name"),
                {"channel_id": src["channel_id"], "name": src["name"]},
            )
            if result.scalar_one_or_none():
                print(f"  [skip] Source exists: {src['name']}")
            else:
                await db.execute(
                    text("""
                        INSERT INTO curate_channel_sources (channel_id, name, platform, external_user_id, is_official, is_active)
                        VALUES (:channel_id, :name, :platform, :external_user_id, :is_official, TRUE)
                    """),
                    src,
                )
                print(f"  [+] Created source: {src['name']}")

        await db.execute(text("SELECT setval('curate_channels_id_seq', (SELECT COALESCE(MAX(id), 1) FROM curate_channels));"))
        await db.commit()

    await engine.dispose()
    print("\nCurate v2 seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
