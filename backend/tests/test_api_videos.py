"""Tests for the video API endpoints (POST/GET/DELETE /api/v1/videos)."""

import uuid
from datetime import datetime, timezone
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
    """Insert a completed video linked to the test user."""
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=test123",
        platform="youtube",
        title="Test Video",
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
async def other_user_video(db_session):
    """Insert a video owned by a different user."""
    other_user_id = uuid.UUID("00000000-0000-0000-0000-000000000088")
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=other456",
        platform="youtube",
        title="Other User Video",
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
    await db_session.commit()
    await db_session.refresh(video)
    return video


# ---------------------------------------------------------------------------
# POST /api/v1/videos — Submit
# ---------------------------------------------------------------------------


class TestSubmitVideo:
    """Video submission endpoint tests."""

    @patch("app.api.v1.videos.dispatch_video_processing")
    async def test_submit_valid_youtube_url(self, mock_dispatch, client: AsyncClient):
        """POST with a valid YouTube URL creates a new video (201)."""
        mock_dispatch.return_value = "fake-task-id"

        with patch("app.api.v1.videos.video_service.validate_url", return_value={
            "title": "New Video",
            "thumbnail_url": "https://i.ytimg.com/vi/abc/default.jpg",
            "duration": "00:10:30",
        }):
            resp = await client.post(API_PREFIX, json={
                "url": "https://www.youtube.com/watch?v=newvideo1",
                "platform": "youtube",
            })

        assert resp.status_code == 201
        data = resp.json()
        assert data["url"] == "https://www.youtube.com/watch?v=newvideo1"
        assert data["platform"] == "youtube"
        mock_dispatch.assert_called_once()

    @patch("app.api.v1.videos.dispatch_video_processing")
    async def test_submit_duplicate_url_returns_existing(
        self, mock_dispatch, client: AsyncClient, sample_video
    ):
        """POST with an already-existing URL returns 200 (idempotent)."""
        mock_dispatch.return_value = "fake-task-id"

        resp = await client.post(API_PREFIX, json={
            "url": sample_video.url,
            "platform": "youtube",
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(sample_video.id)
        # Should NOT dispatch a new task
        mock_dispatch.assert_not_called()

    async def test_submit_invalid_url_returns_422(self, client: AsyncClient):
        """POST with an invalid URL returns 422 validation error."""
        resp = await client.post(API_PREFIX, json={
            "url": "not-a-valid-url",
            "platform": "youtube",
        })
        assert resp.status_code == 422

    async def test_submit_missing_url_field_returns_422(self, client: AsyncClient):
        """POST without url field returns 422."""
        resp = await client.post(API_PREFIX, json={
            "platform": "youtube",
        })
        assert resp.status_code == 422

    async def test_submit_missing_platform_returns_422(self, client: AsyncClient):
        """POST without platform field returns 422."""
        resp = await client.post(API_PREFIX, json={
            "url": "https://www.youtube.com/watch?v=abc",
        })
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/v1/videos — List
# ---------------------------------------------------------------------------


class TestListVideos:
    """Video listing endpoint tests."""

    async def test_list_returns_200(self, client: AsyncClient, sample_video):
        """GET returns 200 with a list of videos."""
        resp = await client.get(API_PREFIX)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["id"] == str(sample_video.id)

    async def test_list_only_current_user_videos(
        self, client: AsyncClient, sample_video, other_user_video
    ):
        """GET only returns videos belonging to the authenticated user."""
        resp = await client.get(API_PREFIX)
        assert resp.status_code == 200
        data = resp.json()
        video_ids = [v["id"] for v in data]
        assert str(sample_video.id) in video_ids
        assert str(other_user_video.id) not in video_ids

    async def test_list_empty_returns_empty_list(self, client: AsyncClient):
        """GET returns [] when user has no videos."""
        resp = await client.get(API_PREFIX)
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# GET /api/v1/videos/{id} — Detail
# ---------------------------------------------------------------------------


class TestGetVideo:
    """Video detail endpoint tests."""

    async def test_get_existing_video(self, client: AsyncClient, sample_video):
        """GET with a valid owned video_id returns 200."""
        resp = await client.get(f"{API_PREFIX}/{sample_video.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(sample_video.id)
        assert data["title"] == "Test Video"

    async def test_get_nonexistent_video_returns_404(self, client: AsyncClient):
        """GET with a random UUID returns 404."""
        fake_id = uuid.uuid4()
        resp = await client.get(f"{API_PREFIX}/{fake_id}")
        assert resp.status_code == 404

    async def test_get_other_users_video_returns_404(
        self, client: AsyncClient, other_user_video
    ):
        """GET another user's video returns 404 (IDOR protection)."""
        resp = await client.get(f"{API_PREFIX}/{other_user_video.id}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/v1/videos/{id}
# ---------------------------------------------------------------------------


class TestDeleteVideo:
    """Video deletion endpoint tests."""

    async def test_delete_own_video(self, client: AsyncClient, sample_video):
        """DELETE own video returns 204."""
        resp = await client.delete(f"{API_PREFIX}/{sample_video.id}")
        assert resp.status_code == 204

        # Confirm it's gone from the list
        resp2 = await client.get(API_PREFIX)
        video_ids = [v["id"] for v in resp2.json()]
        assert str(sample_video.id) not in video_ids

    async def test_delete_nonexistent_video_returns_404(self, client: AsyncClient):
        """DELETE a non-existent video returns 404."""
        fake_id = uuid.uuid4()
        resp = await client.delete(f"{API_PREFIX}/{fake_id}")
        assert resp.status_code == 404

    async def test_delete_other_users_video_returns_404(
        self, client: AsyncClient, other_user_video
    ):
        """DELETE another user's video returns 404."""
        resp = await client.delete(f"{API_PREFIX}/{other_user_video.id}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/v1/videos/popular
# ---------------------------------------------------------------------------


class TestPopularVideos:
    """Popular videos endpoint tests."""

    async def test_popular_returns_200(self, client: AsyncClient, sample_video):
        """GET /popular returns 200 with a list."""
        resp = await client.get(f"{API_PREFIX}/popular")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_popular_includes_other_users_videos(
        self, client: AsyncClient, sample_video, other_user_video
    ):
        """Popular endpoint returns globally popular videos across all users."""
        resp = await client.get(f"{API_PREFIX}/popular")
        assert resp.status_code == 200
        video_ids = [v["id"] for v in resp.json()]
        assert str(other_user_video.id) in video_ids
