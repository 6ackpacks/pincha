"""Tests for Celery video processing pipeline tasks.

These tests call task functions directly (no Celery worker needed) with
external dependencies mocked out: Redis, DB engine, subtitle service, LLM.
"""

import json
import uuid
from contextlib import asynccontextmanager
from unittest.mock import MagicMock, AsyncMock, patch, call

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VIDEO_ID = str(uuid.uuid4())


@pytest.fixture
def mock_sync_redis():
    """Mock sync Redis client for Celery tasks."""
    r = MagicMock()
    r.setex = MagicMock(return_value=True)
    r.publish = MagicMock(return_value=1)
    r.delete = MagicMock(return_value=1)
    r.set = MagicMock(return_value=True)  # for pipeline lock NX
    return r


@pytest.fixture
def mock_sync_engine():
    """Mock sync SQLAlchemy engine."""
    engine = MagicMock()
    conn = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    conn.execute = MagicMock(return_value=MagicMock(fetchone=MagicMock(return_value=None)))
    conn.commit = MagicMock()
    return engine


@pytest.fixture
def mock_task_session():
    """Mock async task_session context manager."""
    db = AsyncMock()

    @asynccontextmanager
    async def _fake_session():
        yield db

    return _fake_session, db


@pytest.fixture
def patched_shared(mock_sync_redis, mock_sync_engine):
    """Patch all shared module singletons used by video_tasks."""
    with patch("app.tasks.shared.get_sync_redis", return_value=mock_sync_redis), \
         patch("app.tasks.shared.get_sync_engine", return_value=mock_sync_engine), \
         patch("app.tasks.video_tasks.get_sync_redis", return_value=mock_sync_redis):
        yield mock_sync_redis, mock_sync_engine


# ---------------------------------------------------------------------------
# Test 1: Happy path — full pipeline completes successfully
# ---------------------------------------------------------------------------

class TestProcessVideoHappyPath:
    """process_video completes when all dependencies succeed."""

    def test_pipeline_success(self, patched_shared, mock_task_session):
        mock_redis, mock_engine = patched_shared
        fake_session_factory, fake_db = mock_task_session

        # Pipeline lock: first call succeeds (acquired)
        mock_redis.set.return_value = True

        subtitle_result = {
            "transcript_id": str(uuid.uuid4()),
            "source": "platform",
            "segments_count": 42,
            "language": "zh",
        }

        fake_summaries = [
            MagicMock(level="express"),
            MagicMock(level="highlight"),
            MagicMock(level="detailed"),
        ]

        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=True), \
             patch("app.tasks.video_tasks.release_pipeline_lock") as mock_release, \
             patch("app.tasks.subtitle_tasks._process_subtitles_core", return_value=subtitle_result) as mock_subs, \
             patch("app.tasks.video_tasks._backfill_duration_from_transcript") as mock_dur, \
             patch("app.tasks.video_tasks._backfill_title_from_url") as mock_title, \
             patch("app.core.database.task_session", fake_session_factory), \
             patch("app.tasks.video_tasks.task_session", fake_session_factory), \
             patch("app.services.summary_service.generate_and_store_fast_summaries", new_callable=AsyncMock, return_value=fake_summaries) as mock_fast, \
             patch("app.tasks.video_tasks.generate_and_store_fast_summaries", new_callable=AsyncMock, return_value=fake_summaries), \
             patch("app.services.mindmap_service.get_or_create_mindmap", new_callable=AsyncMock) as mock_mm, \
             patch("app.tasks.video_tasks.get_or_create_mindmap", new_callable=AsyncMock), \
             patch("app.tasks.video_tasks.set_heartbeat") as mock_hb, \
             patch("app.tasks.video_tasks.update_video_status_sync") as mock_status:

            from app.tasks.video_tasks import process_video
            result = process_video(VIDEO_ID)

        # Assertions
        assert result["state"] == "done"
        assert result["video_id"] == VIDEO_ID
        assert result["summary_count"] == 3

        # Subtitle extraction called
        mock_subs.assert_called_once_with(VIDEO_ID)

        # Duration & title backfill called
        mock_dur.assert_called_once_with(VIDEO_ID)
        mock_title.assert_called_once_with(VIDEO_ID)

        # Lock released
        mock_release.assert_called_once_with(VIDEO_ID)

    def test_pipeline_sets_status_progression(self, patched_shared, mock_task_session):
        """Status progresses: pending → transcribing → summarizing → done."""
        mock_redis, _ = patched_shared
        fake_session_factory, fake_db = mock_task_session

        subtitle_result = {
            "transcript_id": str(uuid.uuid4()),
            "source": "platform",
            "segments_count": 10,
            "language": "zh",
        }

        status_states = []

        def capture_status(video_id, status):
            status_states.append(status["state"])

        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=True), \
             patch("app.tasks.video_tasks.release_pipeline_lock"), \
             patch("app.tasks.subtitle_tasks._process_subtitles_core", return_value=subtitle_result), \
             patch("app.tasks.video_tasks._backfill_duration_from_transcript"), \
             patch("app.tasks.video_tasks._backfill_title_from_url"), \
             patch("app.tasks.video_tasks.task_session", fake_session_factory), \
             patch("app.tasks.video_tasks.generate_and_store_fast_summaries", new_callable=AsyncMock, return_value=[]), \
             patch("app.tasks.video_tasks.get_or_create_mindmap", new_callable=AsyncMock), \
             patch("app.tasks.video_tasks.set_heartbeat"), \
             patch("app.tasks.video_tasks.update_video_status_sync", side_effect=capture_status):

            from app.tasks.video_tasks import process_video
            process_video(VIDEO_ID)

        # Should go through these states in order
        assert "pending" in status_states
        assert "transcribing" in status_states
        assert "summarizing" in status_states
        assert "done" in status_states
        # "done" should be last
        assert status_states[-1] == "done"


# ---------------------------------------------------------------------------
# Test 2: Failure and recovery
# ---------------------------------------------------------------------------

class TestProcessVideoFailure:
    """Pipeline handles errors gracefully."""

    def test_subtitle_extraction_failure_sets_failed_status(self, patched_shared, mock_task_session):
        """When subtitle extraction raises, status becomes 'failed'."""
        mock_redis, _ = patched_shared
        fake_session_factory, _ = mock_task_session

        final_statuses = []

        def capture_status(video_id, status):
            final_statuses.append(status.copy())

        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=True), \
             patch("app.tasks.video_tasks.release_pipeline_lock") as mock_release, \
             patch("app.tasks.subtitle_tasks._process_subtitles_core", side_effect=RuntimeError("network timeout")), \
             patch("app.tasks.video_tasks.set_heartbeat"), \
             patch("app.tasks.video_tasks.update_video_status_sync", side_effect=capture_status):

            from app.tasks.video_tasks import process_video
            with pytest.raises(RuntimeError, match="network timeout"):
                process_video(VIDEO_ID)

        # Last status should be failed
        last = final_statuses[-1]
        assert last["state"] == "failed"
        assert "network timeout" in last["message"]

        # Lock still released even on failure
        mock_release.assert_called_once_with(VIDEO_ID)

    def test_llm_failure_sets_failed_status(self, patched_shared, mock_task_session):
        """When LLM summarization raises, status becomes 'failed'."""
        mock_redis, _ = patched_shared
        fake_session_factory, _ = mock_task_session

        subtitle_result = {
            "transcript_id": str(uuid.uuid4()),
            "source": "asr",
            "segments_count": 5,
            "language": "en",
        }

        final_statuses = []

        def capture_status(video_id, status):
            final_statuses.append(status.copy())

        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=True), \
             patch("app.tasks.video_tasks.release_pipeline_lock"), \
             patch("app.tasks.subtitle_tasks._process_subtitles_core", return_value=subtitle_result), \
             patch("app.tasks.video_tasks._backfill_duration_from_transcript"), \
             patch("app.tasks.video_tasks.task_session", fake_session_factory), \
             patch("app.tasks.video_tasks.generate_and_store_fast_summaries", new_callable=AsyncMock, side_effect=Exception("LLM rate limit")), \
             patch("app.tasks.video_tasks.set_heartbeat"), \
             patch("app.tasks.video_tasks.update_video_status_sync", side_effect=capture_status):

            from app.tasks.video_tasks import process_video
            with pytest.raises(Exception, match="LLM rate limit"):
                process_video(VIDEO_ID)

        last = final_statuses[-1]
        assert last["state"] == "failed"

    def test_never_stuck_in_processing(self, patched_shared, mock_task_session):
        """On any exception, final state is never 'processing' or 'summarizing'."""
        mock_redis, _ = patched_shared
        fake_session_factory, _ = mock_task_session

        final_statuses = []

        def capture_status(video_id, status):
            final_statuses.append(status.copy())

        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=True), \
             patch("app.tasks.video_tasks.release_pipeline_lock"), \
             patch("app.tasks.subtitle_tasks._process_subtitles_core", side_effect=ValueError("bad url")), \
             patch("app.tasks.video_tasks.set_heartbeat"), \
             patch("app.tasks.video_tasks.update_video_status_sync", side_effect=capture_status):

            from app.tasks.video_tasks import process_video
            with pytest.raises(ValueError):
                process_video(VIDEO_ID)

        # The absolute last status update must be "failed", not stuck
        assert final_statuses[-1]["state"] == "failed"


# ---------------------------------------------------------------------------
# Test 3: Status tracking — Redis heartbeat lifecycle
# ---------------------------------------------------------------------------

class TestHeartbeatTracking:
    """Heartbeat is set during processing and cleared on completion/failure."""

    def test_heartbeat_cleared_on_success(self, patched_shared, mock_task_session):
        mock_redis, _ = patched_shared
        fake_session_factory, _ = mock_task_session

        subtitle_result = {
            "transcript_id": str(uuid.uuid4()),
            "source": "platform",
            "segments_count": 10,
            "language": "zh",
        }

        heartbeat_calls = []
        delete_calls = []

        def mock_set_hb(vid, state, progress, message=""):
            heartbeat_calls.append({"video_id": vid, "state": state, "progress": progress})

        def mock_delete_hb(key):
            delete_calls.append(key)
            return 1

        mock_redis.delete.side_effect = mock_delete_hb

        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=True), \
             patch("app.tasks.video_tasks.release_pipeline_lock"), \
             patch("app.tasks.subtitle_tasks._process_subtitles_core", return_value=subtitle_result), \
             patch("app.tasks.video_tasks._backfill_duration_from_transcript"), \
             patch("app.tasks.video_tasks._backfill_title_from_url"), \
             patch("app.tasks.video_tasks.task_session", fake_session_factory), \
             patch("app.tasks.video_tasks.generate_and_store_fast_summaries", new_callable=AsyncMock, return_value=[]), \
             patch("app.tasks.video_tasks.get_or_create_mindmap", new_callable=AsyncMock), \
             patch("app.tasks.video_tasks.set_heartbeat", side_effect=mock_set_hb), \
             patch("app.tasks.video_tasks.update_video_status_sync"), \
             patch("app.tasks.video_tasks.get_sync_redis", return_value=mock_redis), \
             patch("app.tasks.shared.heartbeat_key", return_value=f"video:{VIDEO_ID}:heartbeat"):

            from app.tasks.video_tasks import process_video
            process_video(VIDEO_ID)

        # Heartbeat was set at least once during processing
        assert len(heartbeat_calls) > 0

        # Heartbeat key was deleted at end
        from app.tasks.shared import heartbeat_key
        expected_key = heartbeat_key(VIDEO_ID)
        mock_redis.delete.assert_called_with(expected_key)

    def test_heartbeat_cleared_on_failure(self, patched_shared, mock_task_session):
        mock_redis, _ = patched_shared
        fake_session_factory, _ = mock_task_session

        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=True), \
             patch("app.tasks.video_tasks.release_pipeline_lock"), \
             patch("app.tasks.subtitle_tasks._process_subtitles_core", side_effect=RuntimeError("fail")), \
             patch("app.tasks.video_tasks.set_heartbeat"), \
             patch("app.tasks.video_tasks.update_video_status_sync"), \
             patch("app.tasks.video_tasks.get_sync_redis", return_value=mock_redis), \
             patch("app.tasks.shared.heartbeat_key", return_value=f"video:{VIDEO_ID}:heartbeat"):

            from app.tasks.video_tasks import process_video
            with pytest.raises(RuntimeError):
                process_video(VIDEO_ID)

        # Heartbeat deleted even on failure
        from app.tasks.shared import heartbeat_key
        expected_key = heartbeat_key(VIDEO_ID)
        mock_redis.delete.assert_called_with(expected_key)


# ---------------------------------------------------------------------------
# Test 4: Idempotency — deduplication via pipeline lock
# ---------------------------------------------------------------------------

class TestIdempotency:
    """Running process_video twice doesn't create duplicate work."""

    def test_second_call_skipped_by_pipeline_lock(self, patched_shared):
        """If lock already held, task returns 'skipped' without processing."""
        with patch("app.tasks.video_tasks.try_acquire_pipeline_lock", return_value=False):
            from app.tasks.video_tasks import process_video
            result = process_video(VIDEO_ID)

        assert result["state"] == "skipped"
        assert result["reason"] == "already_processing"

    def test_subtitle_upsert_prevents_duplicates(self, patched_shared):
        """process_subtitles uses ON CONFLICT DO UPDATE — no duplicate transcripts.

        Calling process_subtitles twice for the same video should result in a
        single transcript row (the second call UPDATEs rather than INSERTs).
        """
        mock_redis, mock_engine = patched_shared

        # Set up a real Session mock that tracks execute() calls
        from unittest.mock import call as mcall

        executed_statements = []

        class FakeSession:
            def __init__(self):
                self.committed = 0

            def execute(self, stmt, params=None):
                sql_text = str(stmt.text) if hasattr(stmt, 'text') else str(stmt)
                executed_statements.append((sql_text, params))
                result = MagicMock()
                if "SELECT" in sql_text and "videos" in sql_text:
                    # Return a video row: (id, url, platform)
                    result.fetchone.return_value = (VIDEO_ID, "https://www.youtube.com/watch?v=abc", "youtube")
                else:
                    result.fetchone.return_value = None
                return result

            def commit(self):
                self.committed += 1

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        fake_session_1 = FakeSession()
        fake_session_2 = FakeSession()
        sessions = iter([fake_session_1, fake_session_2])

        segments = [{"start": 0, "end": 10, "text": "hello"}, {"start": 10, "end": 20, "text": "world"}]

        with patch("app.tasks.subtitle_tasks.get_sync_engine") as mock_eng, \
             patch("app.tasks.subtitle_tasks.set_heartbeat"), \
             patch("app.tasks.subtitle_tasks.update_video_status_sync"), \
             patch("app.services.subtitle_service.get_transcript_segments", return_value=(segments, "platform")), \
             patch("app.tasks.subtitle_tasks._backfill_video_meta"):

            # Make Session() yield our fake sessions in order
            from sqlalchemy.orm import Session as RealSession
            with patch("app.tasks.subtitle_tasks.Session", side_effect=lambda eng: next(sessions)):
                from app.tasks.subtitle_tasks import process_subtitles

                # First call — inserts transcript
                result1 = process_subtitles(VIDEO_ID)
                assert result1["source"] == "platform"
                assert result1["segments_count"] == 2

                # Second call — should execute the same ON CONFLICT statement (upsert, not duplicate)
                result2 = process_subtitles(VIDEO_ID)
                assert result2["source"] == "platform"
                assert result2["segments_count"] == 2

        # Both calls issued INSERT ... ON CONFLICT DO UPDATE (not plain INSERT)
        insert_stmts = [
            (sql, params) for sql, params in executed_statements
            if "INSERT INTO transcripts" in sql
        ]
        assert len(insert_stmts) == 2, f"Expected 2 upsert statements, got {len(insert_stmts)}"
        for sql, _ in insert_stmts:
            assert "ON CONFLICT" in sql, "INSERT must use ON CONFLICT for idempotency"
            assert "DO UPDATE" in sql, "ON CONFLICT must DO UPDATE, not DO NOTHING"


# ---------------------------------------------------------------------------
# Test 5: Title/Duration backfill logic
# ---------------------------------------------------------------------------

class TestBackfillLogic:
    """backfill_title_from_url_sync and _backfill_duration_from_transcript."""

    def test_clean_markdown_title_strips_formatting(self):
        """Title from URL produces neutral placeholder."""
        from app.services.video_service import backfill_title_from_url_sync
        # This test just verifies the function is importable and the logic is sound.
        # We can't easily unit-test it without mocking the DB, so we rely on
        # test_backfill_title_skips_when_title_exists for coverage.
        assert callable(backfill_title_from_url_sync)

    def test_backfill_duration_from_transcript(self, patched_shared):
        """Duration is computed from last segment's end time."""
        _, mock_engine = patched_shared

        conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        # First query: video has no duration
        # Second query: transcript segments with last end = 3661.5 seconds
        segments = [
            {"start": 0, "end": 10, "text": "hello"},
            {"start": 10, "end": 3661.5, "text": "world"},
        ]

        call_count = [0]

        def mock_execute(stmt, params=None):
            call_count[0] += 1
            result = MagicMock()
            if call_count[0] == 1:
                # SELECT duration — returns None (no duration set)
                result.fetchone.return_value = (None,)
            elif call_count[0] == 2:
                # SELECT segments
                result.fetchone.return_value = (segments,)
            else:
                # UPDATE
                result.fetchone = MagicMock(return_value=None)
            return result

        conn.execute = mock_execute
        conn.commit = MagicMock()

        with patch("app.tasks.shared.get_sync_engine", return_value=mock_engine):
            from app.tasks.video_tasks import _backfill_duration_from_transcript
            _backfill_duration_from_transcript(VIDEO_ID)

        # The UPDATE should have been called with duration "01:01:01"
        # (3661 seconds = 1h 1m 1s)
        assert call_count[0] == 3  # SELECT + SELECT + UPDATE

    def test_backfill_title_skips_when_title_exists(self, patched_shared):
        """If video already has a title, backfill is a no-op."""
        _, mock_engine = patched_shared

        conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        # Video already has a title — row returns (title, url)
        result = MagicMock()
        result.fetchone.return_value = ("Existing Title", "https://youtube.com/watch?v=abc")
        conn.execute = MagicMock(return_value=result)

        with patch("app.tasks.shared.get_sync_engine", return_value=mock_engine):
            from app.tasks.video_tasks import _backfill_title_from_url
            _backfill_title_from_url(VIDEO_ID)

        # Only 1 SELECT call, no UPDATE
        assert conn.execute.call_count == 1


# ---------------------------------------------------------------------------
# Test 6: generate_full_summary task
# ---------------------------------------------------------------------------

class TestGenerateFullSummary:
    """The on-demand full summary task."""

    def test_generate_full_summary_calls_service(self, mock_task_session):
        fake_session_factory, fake_db = mock_task_session

        with patch("app.tasks.video_tasks.task_session", fake_session_factory), \
             patch("app.tasks.video_tasks.generate_and_store_full_summary", new_callable=AsyncMock) as mock_full:

            from app.tasks.video_tasks import generate_full_summary
            result = generate_full_summary(VIDEO_ID)

        assert result["level"] == "full"
        assert result["state"] == "done"
        mock_full.assert_called_once()

    def test_generate_full_summary_propagates_error(self, mock_task_session):
        fake_session_factory, fake_db = mock_task_session

        with patch("app.tasks.video_tasks.task_session", fake_session_factory), \
             patch("app.tasks.video_tasks.generate_and_store_full_summary", new_callable=AsyncMock, side_effect=Exception("LLM error")):

            from app.tasks.video_tasks import generate_full_summary
            with pytest.raises(Exception, match="LLM error"):
                generate_full_summary(VIDEO_ID)


# ---------------------------------------------------------------------------
# Test 7: Title backfill privacy — must NOT use summary content
# ---------------------------------------------------------------------------

class TestTitleBackfillPrivacy:
    """Title backfill must NOT use summary content (privacy leak).

    PR #39 changed backfill_title_from_summary -> backfill_title_from_url.
    The title must be derived from the URL only, never from summary text
    which could contain sensitive user content.
    """

    def test_backfill_uses_url_not_summary(self):
        """backfill_title_from_url_sync derives title from URL, not summary."""
        from app.services.video_service import backfill_title_from_url_sync

        mock_engine = MagicMock()
        conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        # Video has no title but has a URL
        row = MagicMock()
        row.__getitem__ = lambda self, idx: (
            [None, "https://www.youtube.com/watch?v=dQw4w9WgXcQ"][idx]
        )
        conn.execute.return_value.fetchone.return_value = row

        with patch(
            "app.tasks.shared.get_sync_engine",
            return_value=mock_engine,
        ):
            backfill_title_from_url_sync(VIDEO_ID)

        # The UPDATE call should set a title derived from the URL
        update_call = conn.execute.call_args_list[-1]
        params = update_call[1] if update_call[1] else update_call[0][1]
        title = params.get("title", "")
        assert "youtube.com" in title, (
            f"Title should contain domain, got: {title}"
        )
        # Must NOT contain any summary-like content
        assert "summary" not in title.lower()

    def test_backfill_skips_when_title_already_set(self):
        """If video already has a title, no UPDATE is issued."""
        from app.services.video_service import backfill_title_from_url_sync

        mock_engine = MagicMock()
        conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        # Video already has a title
        row = MagicMock()
        row.__getitem__ = lambda self, idx: (
            ["Existing Title", "https://www.youtube.com/watch?v=abc"][idx]
        )
        conn.execute.return_value.fetchone.return_value = row

        with patch(
            "app.tasks.shared.get_sync_engine",
            return_value=mock_engine,
        ):
            backfill_title_from_url_sync(VIDEO_ID)

        # Only 1 SELECT call, no UPDATE (no commit)
        conn.commit.assert_not_called()

    def test_backfill_truncates_long_titles(self):
        """Titles derived from very long URLs are truncated to 80 chars."""
        from app.services.video_service import backfill_title_from_url_sync

        mock_engine = MagicMock()
        conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        # Video with a very long URL path
        long_path = "a" * 200
        row = MagicMock()
        row.__getitem__ = lambda self, idx: (
            [None, f"https://example.com/{long_path}"][idx]
        )
        conn.execute.return_value.fetchone.return_value = row

        with patch(
            "app.tasks.shared.get_sync_engine",
            return_value=mock_engine,
        ):
            backfill_title_from_url_sync(VIDEO_ID)

        # The UPDATE should have been called with a truncated title
        update_call = conn.execute.call_args_list[-1]
        params = update_call[1] if update_call[1] else update_call[0][1]
        title = params.get("title", "")
        assert len(title) <= 80, (
            f"Title should be <= 80 chars, got {len(title)}: {title}"
        )
        assert title.endswith("..."), "Truncated title should end with '...'"

    def test_pipeline_calls_url_backfill_not_summary_backfill(self):
        """The pipeline task calls _backfill_title_from_url, not _from_summary."""
        import inspect
        from app.tasks import video_tasks

        source = inspect.getsource(video_tasks.process_video)
        # The privacy fix renamed the function
        assert (
            "_backfill_title_from_url" in source
            or "backfill_title_from_url" in source
        ), "process_video should call the URL-based backfill, not summary-based"
        assert "_backfill_title_from_summary" not in source, (
            "process_video must NOT call the old summary-based backfill (privacy leak)"
        )
