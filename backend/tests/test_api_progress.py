"""Tests for the SSE progress stream endpoint (GET /api/v1/videos/{id}/progress/stream)."""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.models.video import Video
from app.models.user_video import UserVideo
from tests.conftest import TEST_USER_ID

API_PREFIX = "/api/v1/videos"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def sample_video(db_session):
    """Insert a processing video linked to the test user."""
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=progress_test",
        platform="youtube",
        title="Progress Test Video",
        status={"state": "processing", "progress": 50, "message": "提取字幕中..."},
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
async def other_user_video(db_session):
    """Insert a video owned by a different user."""
    other_user_id = uuid.UUID("00000000-0000-0000-0000-000000000088")
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=other_progress",
        platform="youtube",
        title="Other User Progress Video",
        status={"state": "processing", "progress": 30, "message": ""},
    )
    db_session.add(video)
    await db_session.flush()

    uv = UserVideo(
        user_id=other_user_id,
        video_id=video.id,
        source="manual",
    )
    db_session.add(uv)
    await db_session.commit()
    await db_session.refresh(video)
    return video


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestVideoProgress:
    """SSE progress stream endpoint tests."""

    async def test_progress_stream_returns_event_stream(
        self, client: AsyncClient, sample_video, mock_redis
    ):
        """GET /videos/{id}/progress/stream returns text/event-stream content type."""
        # Mock Redis to return a done heartbeat so the stream terminates quickly
        heartbeat = json.dumps({"state": "done", "progress": 100, "message": "完成"})
        mock_redis.get = AsyncMock(return_value=heartbeat)

        resp = await client.get(f"{API_PREFIX}/{sample_video.id}/progress/stream")
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

    async def test_progress_stream_sends_initial_state(
        self, client: AsyncClient, sample_video, mock_redis
    ):
        """Stream immediately sends current heartbeat data as first SSE event."""
        heartbeat = json.dumps({"state": "done", "progress": 100, "message": "完成"})
        mock_redis.get = AsyncMock(return_value=heartbeat)

        resp = await client.get(f"{API_PREFIX}/{sample_video.id}/progress/stream")
        assert resp.status_code == 200
        # The body should contain the heartbeat data as an SSE event
        body = resp.text
        assert "data:" in body
        assert '"state"' in body

    async def test_progress_stream_nonexistent_video(self, client: AsyncClient):
        """GET /videos/{id}/progress/stream with non-existent video returns 404."""
        fake_id = uuid.uuid4()
        resp = await client.get(f"{API_PREFIX}/{fake_id}/progress/stream")
        assert resp.status_code == 404

    async def test_progress_stream_other_users_video(
        self, client: AsyncClient, other_user_video
    ):
        """GET /videos/{id}/progress/stream for another user's video returns 404."""
        resp = await client.get(f"{API_PREFIX}/{other_user_video.id}/progress/stream")
        assert resp.status_code == 404
