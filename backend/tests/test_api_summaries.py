"""Tests for the summary API endpoints (/api/v1/videos/{id}/summary/...)."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.models.summary import Summary
from app.models.video import Video
from app.models.user_video import UserVideo
from tests.conftest import TEST_USER_ID

API_PREFIX = "/api/v1/videos"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def sample_video(db_session):
    """Insert a completed video linked to the test user."""
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=summary_test",
        platform="youtube",
        title="Summary Test Video",
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
async def sample_summary(db_session, sample_video):
    """Insert an express-level summary for the sample video."""
    summary = Summary(
        id=uuid.uuid4(),
        video_id=sample_video.id,
        level="express",
        content="- **测试要点1**\n- **测试要点2**",
        model_used="test-model",
    )
    db_session.add(summary)
    await db_session.commit()
    await db_session.refresh(summary)
    return summary


@pytest.fixture
async def full_summary(db_session, sample_video):
    """Insert a full-level summary for the sample video."""
    summary = Summary(
        id=uuid.uuid4(),
        video_id=sample_video.id,
        level="full",
        content="# 完整总结\n\n这是一段完整的视频总结内容。",
        model_used="test-model",
    )
    db_session.add(summary)
    await db_session.commit()
    await db_session.refresh(summary)
    return summary


# ---------------------------------------------------------------------------
# GET /api/v1/videos/{id}/summary/available
# ---------------------------------------------------------------------------


class TestAvailableSummaryLevels:
    """Tests for the available summary levels endpoint."""

    async def test_available_with_summaries(
        self, client: AsyncClient, sample_video, sample_summary
    ):
        """Returns the list of generated summary levels."""
        resp = await client.get(
            f"{API_PREFIX}/{sample_video.id}/summary/available"
        )
        assert resp.status_code == 200
        levels = resp.json()
        assert isinstance(levels, list)
        assert "express" in levels

    async def test_available_empty(self, client: AsyncClient, sample_video):
        """Returns empty list when no summaries exist."""
        resp = await client.get(
            f"{API_PREFIX}/{sample_video.id}/summary/available"
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_available_nonexistent_video_returns_404(self, client: AsyncClient):
        """Returns 404 for a video not in the user's library."""
        fake_id = uuid.uuid4()
        resp = await client.get(f"{API_PREFIX}/{fake_id}/summary/available")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/v1/videos/{id}/summary/{level}
# ---------------------------------------------------------------------------


class TestGetSummary:
    """Tests for getting a summary at a specific level."""

    async def test_get_existing_express_summary(
        self, client: AsyncClient, sample_video, sample_summary
    ):
        """GET /summary/express returns 200 when summary exists."""
        resp = await client.get(
            f"{API_PREFIX}/{sample_video.id}/summary/express"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "express"
        assert "测试要点" in data["content"]
        assert data["video_id"] == str(sample_video.id)

    async def test_get_full_summary_exists(
        self, client: AsyncClient, sample_video, full_summary
    ):
        """GET /summary/full returns 200 when full summary already exists."""
        resp = await client.get(
            f"{API_PREFIX}/{sample_video.id}/summary/full"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "full"

    @patch("app.tasks.video_tasks.generate_full_summary")
    async def test_get_full_summary_not_exists_returns_202(
        self, mock_gen_task, client: AsyncClient, sample_video
    ):
        """GET /summary/full returns 202 when not yet generated."""
        mock_gen_task.delay = MagicMock()

        resp = await client.get(
            f"{API_PREFIX}/{sample_video.id}/summary/full"
        )
        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "generating"
        mock_gen_task.delay.assert_called_once()

    @patch("app.api.v1.summaries.get_or_create_summary")
    async def test_get_express_generates_if_missing(
        self, mock_get_or_create, client: AsyncClient, sample_video
    ):
        """GET /summary/express triggers generation when not in DB."""
        mock_summary = MagicMock()
        mock_summary.id = uuid.uuid4()
        mock_summary.video_id = sample_video.id
        mock_summary.level = "express"
        mock_summary.content = "生成的内容"
        mock_summary.model_used = "test-model"
        mock_summary.created_at = datetime.now(timezone.utc)
        mock_get_or_create.return_value = (mock_summary, False)

        resp = await client.get(
            f"{API_PREFIX}/{sample_video.id}/summary/express"
        )
        assert resp.status_code == 200
        mock_get_or_create.assert_called_once()

    async def test_get_summary_nonexistent_video_returns_404(
        self, client: AsyncClient
    ):
        """GET /summary/express for non-existent video returns 404."""
        fake_id = uuid.uuid4()
        resp = await client.get(f"{API_PREFIX}/{fake_id}/summary/express")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/v1/videos/{id}/summary/{level}/regenerate
# ---------------------------------------------------------------------------


class TestRegenerateSummary:
    """Tests for the summary regeneration endpoint."""

    @patch("app.api.v1.summaries.regenerate_summary")
    async def test_regenerate_express(
        self, mock_regen, client: AsyncClient, sample_video, sample_summary
    ):
        """POST /regenerate returns 200 with newly generated summary."""
        mock_result = MagicMock()
        mock_result.id = uuid.uuid4()
        mock_result.video_id = sample_video.id
        mock_result.level = "express"
        mock_result.content = "重新生成的内容"
        mock_result.model_used = "test-model"
        mock_result.created_at = datetime.now(timezone.utc)
        mock_regen.return_value = mock_result

        resp = await client.post(
            f"{API_PREFIX}/{sample_video.id}/summary/express/regenerate"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "express"
        assert data["content"] == "重新生成的内容"
        mock_regen.assert_called_once()

    async def test_regenerate_nonexistent_video_returns_404(
        self, client: AsyncClient
    ):
        """POST /regenerate for non-existent video returns 404."""
        fake_id = uuid.uuid4()
        resp = await client.post(
            f"{API_PREFIX}/{fake_id}/summary/express/regenerate"
        )
        assert resp.status_code == 404
