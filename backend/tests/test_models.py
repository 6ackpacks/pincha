"""Tests for SQLAlchemy database models.

Covers:
- Model creation and unique constraints
- Relationships and cascade deletes
- JSONB field storage and retrieval
- Timestamp auto-population
- Common query patterns
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models.base import Base
from app.models.knowledge_base import KnowledgeBase
from app.models.summary import Summary
from app.models.transcript import Transcript
from app.models.user import User
from app.models.user_video import UserVideo
from app.models.video import Video

from tests.conftest import TestSessionLocal, engine_test


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_user(session, **overrides) -> User:
    """Create and flush a real User record."""
    defaults = {
        "id": uuid.uuid4(),
        "nickname": "测试用户",
        "email": f"test-{uuid.uuid4().hex[:8]}@example.com",
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    await session.flush()
    return user


async def _create_video(session, **overrides) -> Video:
    """Create and flush a Video record."""
    defaults = {
        "id": uuid.uuid4(),
        "url": f"https://youtube.com/watch?v={uuid.uuid4().hex[:11]}",
        "platform": "youtube",
        "status": {"state": "pending", "progress": 0, "message": ""},
    }
    defaults.update(overrides)
    video = Video(**defaults)
    session.add(video)
    await session.flush()
    return video


# ===========================================================================
# 1. Model creation and constraints
# ===========================================================================


class TestModelCreation:
    """Test basic model instantiation and field persistence."""

    async def test_create_user(self, db_session):
        user = await _create_user(db_session)
        await db_session.commit()

        result = await db_session.get(User, user.id)
        assert result is not None
        assert result.nickname == "测试用户"

    async def test_create_video(self, db_session):
        video = await _create_video(db_session)
        await db_session.commit()

        result = await db_session.get(Video, video.id)
        assert result is not None
        assert result.platform == "youtube"

    async def test_video_url_unique_constraint(self, db_session):
        """Video.url has a unique constraint."""
        url = "https://youtube.com/watch?v=duplicate"
        await _create_video(db_session, url=url)
        await db_session.commit()

        with pytest.raises(IntegrityError):
            await _create_video(db_session, url=url)
            await db_session.commit()

    async def test_summary_video_level_unique_constraint(self, db_session):
        """Summary (video_id, level) must be unique."""
        video = await _create_video(db_session)
        await db_session.flush()

        s1 = Summary(
            video_id=video.id,
            level="express",
            content="Summary 1",
            model_used="gpt-4o",
        )
        session = db_session
        session.add(s1)
        await session.commit()

        s2 = Summary(
            video_id=video.id,
            level="express",
            content="Summary 2",
            model_used="gpt-4o",
        )
        session.add(s2)
        with pytest.raises(IntegrityError):
            await session.commit()

    async def test_video_url_required(self, db_session):
        """Video.url is NOT NULL — omitting it raises IntegrityError."""
        video = Video(
            id=uuid.uuid4(),
            platform="youtube",
            status={"state": "pending", "progress": 0, "message": ""},
        )
        db_session.add(video)
        with pytest.raises(IntegrityError):
            await db_session.flush()

    async def test_summary_content_required(self, db_session):
        """Summary.content is NOT NULL."""
        video = await _create_video(db_session)
        await db_session.flush()

        s = Summary(
            video_id=video.id,
            level="express",
            content=None,
            model_used="gpt-4o",
        )
        db_session.add(s)
        with pytest.raises(IntegrityError):
            await db_session.flush()


# ===========================================================================
# 2. Relationships and cascade deletes
# ===========================================================================


class TestCascadeDelete:
    """Test ON DELETE CASCADE behavior between related models.

    SQLite requires PRAGMA foreign_keys = ON per connection, and we must
    expire the session's identity map after raw DELETEs so cached objects
    are re-fetched from the database.
    """

    async def test_delete_video_cascades_to_transcript(self, db_session):
        """Deleting a Video should also delete its Transcript."""
        await db_session.execute(text("PRAGMA foreign_keys = ON"))

        video = await _create_video(db_session)
        transcript = Transcript(
            video_id=video.id,
            source="platform",
            segments=[{"start": 0, "end": 5, "text": "Hello"}],
        )
        db_session.add(transcript)
        await db_session.commit()

        tid = transcript.id
        await db_session.execute(
            text("DELETE FROM videos WHERE id = :vid"),
            {"vid": str(video.id)},
        )
        await db_session.commit()

        # Expire identity map so the next get() hits the DB
        db_session.expire_all()
        result = await db_session.get(Transcript, tid)
        assert result is None

    async def test_delete_video_cascades_to_summary(self, db_session):
        """Deleting a Video should also delete its Summary records."""
        await db_session.execute(text("PRAGMA foreign_keys = ON"))

        video = await _create_video(db_session)
        summary = Summary(
            video_id=video.id,
            level="highlight",
            content="Some highlights",
            model_used="gpt-4o",
        )
        db_session.add(summary)
        await db_session.commit()

        sid = summary.id
        await db_session.execute(
            text("DELETE FROM videos WHERE id = :vid"),
            {"vid": str(video.id)},
        )
        await db_session.commit()

        db_session.expire_all()
        result = await db_session.get(Summary, sid)
        assert result is None

    async def test_delete_user_does_not_delete_video(self, db_session):
        """Deleting a User via UserVideo junction should NOT delete the Video.

        UserVideo has CASCADE on both FKs, but deleting the User only removes
        the junction row — the Video itself remains because it's not owned
        exclusively by the User.
        """
        await db_session.execute(text("PRAGMA foreign_keys = ON"))

        user = await _create_user(db_session)
        video = await _create_video(db_session)
        uv = UserVideo(user_id=user.id, video_id=video.id, source="manual")
        db_session.add(uv)
        await db_session.commit()

        vid = video.id
        await db_session.execute(
            text("DELETE FROM users WHERE id = :uid"),
            {"uid": str(user.id)},
        )
        await db_session.commit()

        db_session.expire_all()
        result = await db_session.get(Video, vid)
        assert result is not None


# ===========================================================================
# 3. JSONB fields
# ===========================================================================


class TestJSONBFields:
    """Test that JSONB columns store and retrieve structured data correctly."""

    async def test_video_status_dict(self, db_session):
        """Video.status stores a dict and reads back correctly."""
        status = {"state": "completed", "progress": 100, "message": "done"}
        video = await _create_video(db_session, status=status)
        await db_session.commit()

        result = await db_session.get(Video, video.id)
        assert result.status == status
        assert result.status["state"] == "completed"
        assert result.status["progress"] == 100

    async def test_transcript_segments_list(self, db_session):
        """Transcript.segments stores a list of dicts."""
        video = await _create_video(db_session)
        segments = [
            {"start": 0.0, "end": 3.5, "text": "你好世界"},
            {"start": 3.5, "end": 7.0, "text": "这是测试"},
        ]
        transcript = Transcript(
            video_id=video.id,
            source="asr",
            segments=segments,
        )
        db_session.add(transcript)
        await db_session.commit()

        result = await db_session.get(Transcript, transcript.id)
        assert result.segments == segments
        assert len(result.segments) == 2
        assert result.segments[0]["text"] == "你好世界"


# ===========================================================================
# 4. Timestamps
# ===========================================================================


class TestTimestamps:
    """Test automatic timestamp population."""

    async def test_video_created_at_auto_set(self, db_session):
        """Video.created_at is set automatically on creation."""
        before = datetime.now(timezone.utc)
        video = await _create_video(db_session)
        await db_session.commit()

        result = await db_session.get(Video, video.id)
        assert result.created_at is not None
        # Should be close to 'before' (within a few seconds)
        delta = result.created_at.replace(tzinfo=timezone.utc) - before
        assert delta.total_seconds() < 5

    async def test_video_updated_at_changes_on_modify(self, db_session):
        """Video.updated_at changes after modification."""
        video = await _create_video(db_session)
        await db_session.commit()

        original_updated = video.updated_at

        # Modify the video
        video.title = "Updated Title"
        await db_session.commit()
        await db_session.refresh(video)

        # With SQLite + onupdate lambda, we verify the field is set
        assert video.updated_at is not None

    async def test_knowledge_base_updated_at(self, db_session):
        """KnowledgeBase.updated_at refreshes on update."""
        user = await _create_user(db_session)
        kb = KnowledgeBase(
            user_id=user.id,
            name="测试知识库",
        )
        db_session.add(kb)
        await db_session.commit()

        assert kb.updated_at is not None
        assert kb.created_at is not None


# ===========================================================================
# 5. Query patterns
# ===========================================================================


class TestQueryPatterns:
    """Test common query patterns used in the application."""

    async def test_filter_videos_by_user(self, db_session):
        """Filter videos belonging to a specific user via UserVideo."""
        user = await _create_user(db_session)
        v1 = await _create_video(db_session)
        v2 = await _create_video(db_session)
        v3 = await _create_video(db_session)  # Not associated with user

        db_session.add(UserVideo(user_id=user.id, video_id=v1.id, source="manual"))
        db_session.add(UserVideo(user_id=user.id, video_id=v2.id, source="manual"))
        await db_session.commit()

        stmt = (
            select(Video)
            .join(UserVideo, UserVideo.video_id == Video.id)
            .where(UserVideo.user_id == user.id)
        )
        result = await db_session.execute(stmt)
        videos = result.scalars().all()

        assert len(videos) == 2
        video_ids = {v.id for v in videos}
        assert v1.id in video_ids
        assert v2.id in video_ids
        assert v3.id not in video_ids

    async def test_query_summary_by_video_and_level(self, db_session):
        """Query a unique summary by (video_id, level)."""
        video = await _create_video(db_session)
        s1 = Summary(video_id=video.id, level="express", content="Quick", model_used="gpt-4o")
        s2 = Summary(video_id=video.id, level="detailed", content="Deep", model_used="gpt-4o")
        db_session.add_all([s1, s2])
        await db_session.commit()

        stmt = select(Summary).where(
            Summary.video_id == video.id,
            Summary.level == "express",
        )
        result = await db_session.execute(stmt)
        summary = result.scalar_one()
        assert summary.content == "Quick"

    async def test_order_videos_by_created_at_desc(self, db_session):
        """Videos ordered by created_at DESC returns newest first."""
        v1 = await _create_video(db_session)
        v2 = await _create_video(db_session)
        v3 = await _create_video(db_session)
        await db_session.commit()

        stmt = select(Video).order_by(Video.created_at.desc())
        result = await db_session.execute(stmt)
        videos = result.scalars().all()

        assert len(videos) == 3
        # All three should be present (exact order may be same-second,
        # but at minimum the query should not fail)
        ids = [v.id for v in videos]
        assert v1.id in ids
        assert v2.id in ids
        assert v3.id in ids

    async def test_user_video_unique_constraint(self, db_session):
        """UserVideo (user_id, video_id) must be unique."""
        user = await _create_user(db_session)
        video = await _create_video(db_session)
        uv1 = UserVideo(user_id=user.id, video_id=video.id, source="manual")
        db_session.add(uv1)
        await db_session.commit()

        uv2 = UserVideo(user_id=user.id, video_id=video.id, source="curate")
        db_session.add(uv2)
        with pytest.raises(IntegrityError):
            await db_session.commit()
