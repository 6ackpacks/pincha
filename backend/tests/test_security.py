"""Authentication and authorization security tests.

Tests real JWT validation, token blacklist, resource ownership isolation,
and input validation — using a raw_client that does NOT bypass auth.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.config import settings
from tests.conftest import TestSessionLocal

_ALGORITHM = "HS256"
_BLACKLIST_PREFIX = "token:blacklist:"


def _make_token(
    user_id: str | None = None,
    secret: str | None = None,
    expire_delta: timedelta | None = None,
    include_sub: bool = True,
) -> str:
    """Helper to craft JWT tokens with various configurations."""
    payload: dict = {"jti": uuid.uuid4().hex}
    if include_sub and user_id is not None:
        payload["sub"] = user_id
    if expire_delta is not None:
        payload["exp"] = datetime.now(timezone.utc) + expire_delta
    else:
        payload["exp"] = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode(payload, secret or settings.JWT_SECRET_KEY, algorithm=_ALGORITHM)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# raw_client fixture is now shared from conftest.py


# ---------------------------------------------------------------------------
# Fixture: create a real user in the test DB
# ---------------------------------------------------------------------------


@pytest.fixture
async def real_user(db_session):
    """Insert a real User row and return (user, token) tuple."""
    from app.models.user import User

    user = User(
        id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        watcha_user_id=12345,
        nickname="RealTestUser",
        avatar_url="",
        email="real@test.com",
    )
    db_session.add(user)
    await db_session.commit()

    token = _make_token(user_id=str(user.id))
    return user, token


# ===========================================================================
# 1. JWT Token Validation
# ===========================================================================


class TestJWTValidation:
    """Verify that the auth layer correctly validates JWT tokens in cookies."""

    @pytest.mark.asyncio
    async def test_valid_token_grants_access(self, raw_client, real_user):
        """A properly signed, unexpired token with valid sub should work."""
        user, token = real_user
        resp = await raw_client.get(
            "/api/v1/videos",
            cookies={"session": token},
        )
        # Should not be 401 — user is authenticated
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_expired_token_returns_401(self, raw_client, real_user):
        """An expired token must be rejected."""
        user, _ = real_user
        expired_token = _make_token(
            user_id=str(user.id),
            expire_delta=timedelta(seconds=-10),
        )
        resp = await raw_client.get(
            "/api/v1/videos",
            cookies={"session": expired_token},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_secret_returns_401(self, raw_client, real_user):
        """A token signed with a different secret must be rejected."""
        user, _ = real_user
        bad_token = _make_token(
            user_id=str(user.id),
            secret="totally-wrong-secret-key",
        )
        resp = await raw_client.get(
            "/api/v1/videos",
            cookies={"session": bad_token},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_malformed_token_returns_401(self, raw_client):
        """Garbage strings in the session cookie must be rejected."""
        resp = await raw_client.get(
            "/api/v1/videos",
            cookies={"session": "not.a.valid.jwt.token"},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_sub_claim_returns_401(self, raw_client):
        """A token without 'sub' claim must be rejected."""
        token_no_sub = _make_token(user_id=None, include_sub=False)
        resp = await raw_client.get(
            "/api/v1/videos",
            cookies={"session": token_no_sub},
        )
        assert resp.status_code == 401


# ===========================================================================
# 2. Protected Endpoints Without Cookie
# ===========================================================================


class TestUnauthenticatedAccess:
    """Endpoints requiring auth must return 401 when no session cookie is present."""

    @pytest.mark.asyncio
    async def test_videos_list_no_cookie(self, raw_client):
        resp = await raw_client.get("/api/v1/videos")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_videos_popular_no_cookie(self, raw_client):
        """Popular endpoint is public (global recommendations feed)."""
        resp = await raw_client.get("/api/v1/videos/popular")
        assert resp.status_code == 200


# ===========================================================================
# 3. Token Blacklist
# ===========================================================================


class TestTokenBlacklist:
    """After logout, a blacklisted token must no longer grant access."""

    @pytest.mark.asyncio
    async def test_blacklisted_token_returns_401(self, raw_client, real_user, mock_redis):
        """Simulate logout: blacklist the token, then verify it's rejected."""
        user, token = real_user

        # First, confirm the token works
        resp = await raw_client.get(
            "/api/v1/videos",
            cookies={"session": token},
        )
        assert resp.status_code == 200

        # Now simulate blacklisting (what logout does)
        blacklist_key = f"{_BLACKLIST_PREFIX}{_token_hash(token)}"
        # Make mock_redis.get return "1" for the blacklist key
        original_get = mock_redis.get

        async def blacklist_aware_get(key):
            if key == blacklist_key:
                return "1"
            return await original_get(key)

        mock_redis.get = blacklist_aware_get

        # Token should now be rejected
        resp = await raw_client.get(
            "/api/v1/videos",
            cookies={"session": token},
        )
        assert resp.status_code == 401


# ===========================================================================
# 4. Resource Ownership (IDOR Protection)
# ===========================================================================


class TestResourceOwnership:
    """Users must not access other users' videos — returns 404 to prevent enumeration."""

    @pytest.mark.asyncio
    async def test_other_users_video_returns_404(self, raw_client, db_session):
        """User B cannot access User A's video — gets 404 not 403."""
        from app.models.user import User
        from app.models.video import Video
        from app.models.user_video import UserVideo

        # Create User A and their video
        user_a = User(
            id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            watcha_user_id=11111,
            nickname="UserA",
            avatar_url="",
        )
        db_session.add(user_a)
        await db_session.flush()

        video = Video(
            id=uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            url="https://www.youtube.com/watch?v=test123",
            platform="youtube",
            title="User A's Video",
            status={"state": "done", "progress": 100, "message": ""},
        )
        db_session.add(video)
        await db_session.flush()

        user_video = UserVideo(user_id=user_a.id, video_id=video.id, source="manual")
        db_session.add(user_video)
        await db_session.commit()

        # Create User B
        user_b = User(
            id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            watcha_user_id=22222,
            nickname="UserB",
            avatar_url="",
        )
        db_session.add(user_b)
        await db_session.commit()

        # User B tries to access User A's video
        token_b = _make_token(user_id=str(user_b.id))
        resp = await raw_client.get(
            f"/api/v1/videos/{video.id}",
            cookies={"session": token_b},
        )
        # Should be 404 (not 403) to prevent IDOR enumeration
        assert resp.status_code == 404


# ===========================================================================
# 5. Input Validation
# ===========================================================================


class TestInputValidation:
    """Ensure malicious or malformed input is handled safely."""

    @pytest.mark.asyncio
    async def test_overlong_url_returns_422(self, raw_client, real_user):
        """Extremely long URL strings should be rejected by Pydantic validation."""
        user, token = real_user
        long_url = "https://www.youtube.com/watch?v=" + "A" * 10000
        resp = await raw_client.post(
            "/api/v1/videos",
            json={"url": long_url, "platform": "youtube"},
            cookies={"session": token},
        )
        # Pydantic HttpUrl validation or server-side length check
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_sql_injection_in_query_param_no_500(self, raw_client, real_user):
        """SQL injection attempts in query params must not cause server errors."""
        user, token = real_user
        sqli_payload = "'; DROP TABLE videos; --"
        resp = await raw_client.get(
            "/api/v1/videos",
            params={"q": sqli_payload},
            cookies={"session": token},
        )
        # Should return 200 (empty results) or 422, but never 500
        assert resp.status_code != 500
        assert resp.status_code in (200, 422)
