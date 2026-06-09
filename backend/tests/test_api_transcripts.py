"""Tests for the Transcript API endpoint (GET /api/v1/videos/{id}/transcript)."""

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

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
    """Insert a completed video linked to the test user (no transcript)."""
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=transcript_test",
        platform="youtube",
        title="Transcript Test Video",
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
async def sample_video_with_transcript(db_session):
    """Insert a video with a transcript linked to the test user."""
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=transcript_full",
        platform="youtube",
        title="Video With Transcript",
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

    transcript = Transcript(
        id=uuid.uuid4(),
        video_id=video.id,
        language="zh",
        source="platform",
        segments=[
            {"start": 0.0, "end": 5.0, "text": "大家好"},
            {"start": 5.0, "end": 10.0, "text": "欢迎来到本期视频"},
            {"start": 10.0, "end": 15.0, "text": "今天我们来聊一聊"},
        ],
        full_text="大家好 欢迎来到本期视频 今天我们来聊一聊",
    )
    db_session.add(transcript)
    await db_session.commit()
    await db_session.refresh(video)
    return video


@pytest.fixture
async def other_user_video(db_session):
    """Insert a video with transcript owned by a different user."""
    other_user_id = uuid.UUID("00000000-0000-0000-0000-000000000088")
    video = Video(
        id=uuid.uuid4(),
        url="https://www.youtube.com/watch?v=other_transcript",
        platform="youtube",
        title="Other User Transcript Video",
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

    transcript = Transcript(
        id=uuid.uuid4(),
        video_id=video.id,
        language="zh",
        source="platform",
        segments=[{"start": 0.0, "end": 5.0, "text": "其他用户的字幕"}],
        full_text="其他用户的字幕",
    )
    db_session.add(transcript)
    await db_session.commit()
    await db_session.refresh(video)
    return video


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestTranscriptAPI:
    """Transcript endpoint tests."""

    async def test_get_transcript_exists(
        self, client: AsyncClient, sample_video_with_transcript
    ):
        """GET /videos/{id}/transcript with existing transcript returns 200 + segments."""
        video_id = sample_video_with_transcript.id
        resp = await client.get(f"{API_PREFIX}/{video_id}/transcript")
        assert resp.status_code == 200
        data = resp.json()
        assert data["video_id"] == str(video_id)
        assert data["language"] == "zh"
        assert data["source"] == "platform"
        assert len(data["segments"]) == 3

    async def test_get_transcript_not_exists(
        self, client: AsyncClient, sample_video
    ):
        """GET /videos/{id}/transcript without transcript returns 404."""
        resp = await client.get(f"{API_PREFIX}/{sample_video.id}/transcript")
        assert resp.status_code == 404

    async def test_get_transcript_other_users_video(
        self, client: AsyncClient, other_user_video
    ):
        """GET /videos/{id}/transcript for another user's video returns 404."""
        resp = await client.get(f"{API_PREFIX}/{other_user_video.id}/transcript")
        assert resp.status_code == 404

    async def test_transcript_segments_format(
        self, client: AsyncClient, sample_video_with_transcript
    ):
        """Each segment has start (float), end (float), and text (str) fields."""
        video_id = sample_video_with_transcript.id
        resp = await client.get(f"{API_PREFIX}/{video_id}/transcript")
        assert resp.status_code == 200
        data = resp.json()
        for segment in data["segments"]:
            assert "start" in segment
            assert "end" in segment
            assert "text" in segment
            assert isinstance(segment["start"], (int, float))
            assert isinstance(segment["end"], (int, float))
            assert isinstance(segment["text"], str)
            assert segment["end"] > segment["start"]
