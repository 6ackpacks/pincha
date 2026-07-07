"""Security tests for single-user local mode."""

import uuid

import pytest


class TestSingleUserAccess:
    @pytest.mark.asyncio
    async def test_videos_list_without_cookie_uses_local_owner(self, raw_client):
        resp = await raw_client.get("/api/v1/videos")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_session_cookie_is_ignored(self, raw_client):
        resp = await raw_client.get(
            "/api/v1/auth/me",
            cookies={"session": "not.a.valid.token"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True


class TestResourceOwnership:
    @pytest.mark.asyncio
    async def test_non_owner_video_returns_404(self, raw_client, db_session):
        """Business data remains scoped by user_id even without login sessions."""
        from app.models.user import User
        from app.models.user_video import UserVideo
        from app.models.video import Video

        other_user = User(
            id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            local_identity=None,
            nickname="Other",
            avatar_url="",
        )
        db_session.add(other_user)
        await db_session.flush()

        video = Video(
            id=uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            url="https://www.youtube.com/watch?v=test123",
            platform="youtube",
            title="Other user's video",
            status={"state": "done", "progress": 100, "message": ""},
        )
        db_session.add(video)
        await db_session.flush()

        db_session.add(UserVideo(user_id=other_user.id, video_id=video.id, source="manual"))
        await db_session.commit()

        resp = await raw_client.get(f"/api/v1/videos/{video.id}")
        assert resp.status_code == 404


class TestInputValidation:
    @pytest.mark.asyncio
    async def test_overlong_url_returns_422(self, raw_client):
        long_url = "https://www.youtube.com/watch?v=" + "A" * 10000
        resp = await raw_client.post(
            "/api/v1/videos",
            json={"url": long_url, "platform": "youtube"},
            headers={"Origin": "http://localhost:3000"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_sql_injection_in_query_param_no_500(self, raw_client):
        sqli_payload = "'; DROP TABLE videos; --"
        resp = await raw_client.get("/api/v1/videos", params={"q": sqli_payload})
        assert resp.status_code != 500
        assert resp.status_code in (200, 422)
