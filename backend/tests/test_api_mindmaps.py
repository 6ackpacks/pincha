"""Tests for the Mindmap API endpoint (GET /api/v1/videos/{id}/mindmap)."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.models.mindmap import Mindmap
from app.models.transcript import Transcript
from app.models.video import Video
from app.models.user_video import UserVideo
from tests.conftest import TEST_USER_ID

API_PREFIX = "/api/v1/videos"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def sample_video(db_session):
    """Insert a completed video linked to the test user (no mindmap, no transcript)."""
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=mindmap_test",
        platform="youtube",
        title="Mindmap Test Video",
        status={"state": "done", "progress": 100, "message": ""},
    )
    db_session.add(video)
    await db_session.flush()

    uv = UserVideo(
        user_id=TEST_USER_ID,
        video_id=video.id,
        source="manual",
    )
    db_session.add(uv)
    await db_session.commit()
    await db_session.refresh(video)
    return video


@pytest.fixture
async def sample_video_with_mindmap(db_session):
    """Insert a video with a pre-generated mindmap linked to the test user."""
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=mindmap_full",
        platform="youtube",
        title="Video With Mindmap",
        status={"state": "done", "progress": 100, "message": ""},
    )
    db_session.add(video)
    await db_session.flush()

    uv = UserVideo(
        user_id=TEST_USER_ID,
        video_id=video.id,
        source="manual",
    )
    db_session.add(uv)

    mindmap = Mindmap(
        id=uuid.uuid4(),
        video_id=video.id,
        markdown="# 视频主题\n## 核心观点一 [01:00]\n### 子观点 [01:30]\n- 细节 [01:45]",
        model_used="qwen-plus",
    )
    db_session.add(mindmap)
    await db_session.commit()
    await db_session.refresh(video)
    await db_session.refresh(mindmap)
    return video


@pytest.fixture
async def other_user_video(db_session):
    """Insert a video with mindmap owned by a different user."""
    other_user_id = uuid.UUID("00000000-0000-0000-0000-000000000088")
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=other_mindmap",
        platform="youtube",
        title="Other User Mindmap Video",
        status={"state": "done", "progress": 100, "message": ""},
    )
    db_session.add(video)
    await db_session.flush()

    uv = UserVideo(
        user_id=other_user_id,
        video_id=video.id,
        source="manual",
    )
    db_session.add(uv)

    mindmap = Mindmap(
        id=uuid.uuid4(),
        video_id=video.id,
        markdown="# Other User Mindmap",
        model_used="qwen-plus",
    )
    db_session.add(mindmap)
    await db_session.commit()
    await db_session.refresh(video)
    return video


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMindmapAPI:
    """Mindmap endpoint tests."""

    async def test_get_mindmap_exists(
        self, client: AsyncClient, sample_video_with_mindmap
    ):
        """GET /videos/{id}/mindmap with existing mindmap returns 200 + markdown."""
        video_id = sample_video_with_mindmap.id
        resp = await client.get(f"{API_PREFIX}/{video_id}/mindmap")
        assert resp.status_code == 200
        data = resp.json()
        assert data["video_id"] == str(video_id)
        assert "markdown" in data
        assert len(data["markdown"]) > 0
        assert data["model_used"] == "qwen-plus"

    async def test_get_mindmap_not_exists(
        self, client: AsyncClient, sample_video
    ):
        """GET /videos/{id}/mindmap without transcript/summary returns 404."""
        # No transcript or summary exists, so mindmap generation will fail with 404
        resp = await client.get(f"{API_PREFIX}/{sample_video.id}/mindmap")
        assert resp.status_code == 404

    async def test_get_mindmap_other_users_video(
        self, client: AsyncClient, other_user_video
    ):
        """GET /videos/{id}/mindmap for another user's video returns 404."""
        resp = await client.get(f"{API_PREFIX}/{other_user_video.id}/mindmap")
        assert resp.status_code == 404

    async def test_mindmap_structure(
        self, client: AsyncClient, sample_video_with_mindmap
    ):
        """Mindmap response contains valid markdown with heading structure."""
        video_id = sample_video_with_mindmap.id
        resp = await client.get(f"{API_PREFIX}/{video_id}/mindmap")
        assert resp.status_code == 200
        data = resp.json()
        markdown = data["markdown"]
        # Should have at least a root heading
        assert markdown.startswith("# ")
        # Should have sub-headings
        assert "## " in markdown
        # Should have an id and created_at
        assert "id" in data
        assert "created_at" in data
