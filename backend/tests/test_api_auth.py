"""Auth endpoint tests: /auth/login, /auth/logout, /auth/me, /auth/callback.

Tests the actual HTTP behavior of auth routes, complementing test_security.py
which focuses on JWT middleware validation.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.core.auth import create_session_token
from tests.conftest import TestSessionLocal

# The /auth/login and /auth/callback endpoints call get_redis() directly
# (not via Depends), so we need to patch it at the module level.
_AUTH_GET_REDIS = "app.api.v1.auth.get_redis"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture
async def real_user(db_session):
    """Insert a real User row and return (user, token) tuple."""
    from app.models.user import User

    user = User(
        id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        watcha_user_id=99999,
        nickname="AuthTestUser",
        avatar_url="https://example.com/avatar.png",
        email="auth@test.com",
    )
    db_session.add(user)
    await db_session.commit()

    token = create_session_token(user.id)
    return user, token


@pytest.fixture
async def authed_raw_client(raw_client, real_user):
    """raw_client with a valid session cookie pre-set."""
    _, token = real_user
    raw_client.cookies.set("session", token)
    return raw_client


# ===========================================================================
# 1. /auth/me
# ===========================================================================


class TestAuthMe:
    """Tests for GET /api/v1/auth/me."""

    @pytest.mark.asyncio
    async def test_me_with_valid_session(self, authed_raw_client, real_user):
        """已认证用户访问 /auth/me 返回用户信息."""
        user, _ = real_user
        resp = await authed_raw_client.get("/api/v1/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(user.id)
        assert data["nickname"] == "AuthTestUser"

    @pytest.mark.asyncio
    async def test_me_without_session(self, raw_client):
        """未认证访问 /auth/me 返回 401."""
        resp = await raw_client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_me_response_format(self, authed_raw_client, real_user):
        """/auth/me 返回正确的字段（id, nickname, avatar_url, email, phone）."""
        resp = await authed_raw_client.get("/api/v1/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        expected_keys = {"id", "nickname", "avatar_url", "email", "phone", "is_admin"}
        assert set(data.keys()) == expected_keys

    @pytest.mark.asyncio
    async def test_me_returns_correct_avatar(self, authed_raw_client, real_user):
        """/auth/me 返回正确的 avatar_url."""
        resp = await authed_raw_client.get("/api/v1/auth/me")
        data = resp.json()
        assert data["avatar_url"] == "https://example.com/avatar.png"
        assert data["email"] == "auth@test.com"


# ===========================================================================
# 2. /auth/logout
# ===========================================================================


class TestAuthLogout:
    """Tests for POST /api/v1/auth/logout."""

    @pytest.mark.asyncio
    async def test_logout_clears_cookie(self, authed_raw_client):
        """POST /auth/logout 返回 set-cookie 清除 session."""
        resp = await authed_raw_client.post("/api/v1/auth/logout")
        assert resp.status_code == 200
        # Check that the response clears the session cookie
        set_cookie = resp.headers.get("set-cookie", "")
        assert "session" in set_cookie
        # Cleared cookies have max-age=0 or expires in the past
        assert 'max-age=0' in set_cookie.lower() or "expires=" in set_cookie.lower()

    @pytest.mark.asyncio
    async def test_logout_response_message(self, authed_raw_client):
        """logout 返回成功消息."""
        resp = await authed_raw_client.post("/api/v1/auth/logout")
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "已退出登录"

    @pytest.mark.asyncio
    async def test_logout_without_session(self, raw_client):
        """未登录时 logout 也不报错（幂等）."""
        resp = await raw_client.post("/api/v1/auth/logout")
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "已退出登录"

    @pytest.mark.asyncio
    async def test_logout_blacklists_token(self, authed_raw_client, real_user, mock_redis):
        """logout 后 token 被加入黑名单（调用了 blacklist_token）."""
        with patch("app.api.v1.auth.blacklist_token", new_callable=AsyncMock) as mock_bl:
            resp = await authed_raw_client.post("/api/v1/auth/logout")
            assert resp.status_code == 200
            mock_bl.assert_called_once()


# ===========================================================================
# 3. /auth/login (OAuth redirect)
# ===========================================================================


class TestAuthLogin:
    """Tests for GET /api/v1/auth/login."""

    @pytest.mark.asyncio
    async def test_login_redirects_to_oauth(self, raw_client, mock_redis):
        """GET /auth/login 重定向到 OAuth provider."""
        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis):
            resp = await raw_client.get(
                "/api/v1/auth/login", follow_redirects=False
            )
        assert resp.status_code in (302, 307)
        location = resp.headers["location"]
        assert "watcha.cn/oauth/authorize" in location

    @pytest.mark.asyncio
    async def test_login_redirect_contains_state(self, raw_client, mock_redis):
        """重定向 URL 包含 state 参数（CSRF 防护）."""
        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis):
            resp = await raw_client.get(
                "/api/v1/auth/login", follow_redirects=False
            )
        location = resp.headers["location"]
        assert "state=" in location

    @pytest.mark.asyncio
    async def test_login_redirect_contains_client_id(self, raw_client, mock_redis):
        """重定向 URL 包含 client_id."""
        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis):
            resp = await raw_client.get(
                "/api/v1/auth/login", follow_redirects=False
            )
        location = resp.headers["location"]
        assert "client_id=" in location

    @pytest.mark.asyncio
    async def test_login_redirect_contains_redirect_uri(self, raw_client, mock_redis):
        """重定向 URL 包含 redirect_uri."""
        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis):
            resp = await raw_client.get(
                "/api/v1/auth/login", follow_redirects=False
            )
        location = resp.headers["location"]
        assert "redirect_uri=" in location

    @pytest.mark.asyncio
    async def test_login_stores_state_in_redis(self, raw_client, mock_redis):
        """login 将 state 存入 Redis（TTL 600s）."""
        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis):
            resp = await raw_client.get(
                "/api/v1/auth/login", follow_redirects=False
            )
        assert resp.status_code in (302, 307)
        # Redis.set should have been called with oauth:state:xxx key
        mock_redis.set.assert_called_once()
        call_args = mock_redis.set.call_args
        key = call_args[0][0] if call_args[0] else call_args.kwargs.get("name", "")
        assert key.startswith("oauth:state:")


# ===========================================================================
# 4. /auth/callback (OAuth callback)
# ===========================================================================


class TestAuthCallback:
    """Tests for GET /api/v1/auth/callback."""

    @pytest.mark.asyncio
    async def test_callback_without_code_returns_422(self, raw_client):
        """callback 缺少 code 参数返回 422（FastAPI 验证）."""
        resp = await raw_client.get("/api/v1/auth/callback")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_callback_with_invalid_state(self, raw_client, mock_redis):
        """callback state 不匹配返回重定向到错误页."""
        # mock_redis.get returns None by default → state validation fails
        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis):
            resp = await raw_client.get(
                "/api/v1/auth/callback",
                params={"code": "fake_code", "state": "invalid_state"},
                follow_redirects=False,
            )
        # Should redirect to login page with error
        assert resp.status_code == 302
        location = resp.headers["location"]
        assert "/login?error=" in location

    @pytest.mark.asyncio
    async def test_callback_with_empty_state(self, raw_client, mock_redis):
        """callback state 为空返回重定向到错误页."""
        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis):
            resp = await raw_client.get(
                "/api/v1/auth/callback",
                params={"code": "fake_code", "state": ""},
                follow_redirects=False,
            )
        assert resp.status_code == 302
        location = resp.headers["location"]
        assert "/login?error=" in location

    @pytest.mark.asyncio
    async def test_callback_success_sets_cookie(self, raw_client, mock_redis, db_session):
        """成功的 OAuth callback 设置 session cookie."""
        # Make state validation pass
        async def redis_get_side_effect(key):
            if key.startswith("oauth:state:"):
                return "1"
            return None

        mock_redis.get = AsyncMock(side_effect=redis_get_side_effect)

        # Mock httpx calls to watcha.cn (httpx responses are sync objects)
        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {
            "access_token": "watcha_access_token_123",
            "refresh_token": "watcha_refresh_token_456",
            "expires_in": 1800,
        }

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {
            "user_id": 88888,
            "nickname": "OAuthUser",
            "avatar_url": "https://example.com/oauth_avatar.png",
            "email": "oauth@test.com",
        }

        mock_httpx_client = AsyncMock()
        mock_httpx_client.post.return_value = mock_token_response
        mock_httpx_client.get.return_value = mock_userinfo_response
        mock_httpx_client.__aenter__ = AsyncMock(return_value=mock_httpx_client)
        mock_httpx_client.__aexit__ = AsyncMock(return_value=False)

        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.v1.auth.httpx.AsyncClient", return_value=mock_httpx_client):
            resp = await raw_client.get(
                "/api/v1/auth/callback",
                params={"code": "valid_code", "state": "valid_state"},
                follow_redirects=False,
            )

        # Should redirect to frontend with session cookie
        assert resp.status_code == 302
        location = resp.headers["location"]
        assert settings.FRONTEND_URL in location
        # Session cookie should be set
        set_cookie = resp.headers.get("set-cookie", "")
        assert "session=" in set_cookie

    @pytest.mark.asyncio
    async def test_callback_userinfo_uses_query_param(self, raw_client, mock_redis, db_session):
        """userinfo 请求通过 query param 传递 access_token（观猹不接受 Bearer header）."""
        async def redis_get_side_effect(key):
            if key.startswith("oauth:state:"):
                return "1"
            return None

        mock_redis.get = AsyncMock(side_effect=redis_get_side_effect)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {
            "access_token": "watcha_access_token_secret",
            "refresh_token": "watcha_refresh_token_456",
            "expires_in": 1800,
        }

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {
            "user_id": 77777,
            "nickname": "HeaderTestUser",
            "avatar_url": "https://example.com/avatar.png",
            "email": "header@test.com",
        }

        mock_httpx_client = AsyncMock()
        mock_httpx_client.post.return_value = mock_token_response
        mock_httpx_client.get.return_value = mock_userinfo_response
        mock_httpx_client.__aenter__ = AsyncMock(return_value=mock_httpx_client)
        mock_httpx_client.__aexit__ = AsyncMock(return_value=False)

        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.v1.auth.httpx.AsyncClient", return_value=mock_httpx_client):
            resp = await raw_client.get(
                "/api/v1/auth/callback",
                params={"code": "valid_code", "state": "valid_state"},
                follow_redirects=False,
            )

        assert resp.status_code == 302

        # Verify the GET call used query params (观猹要求 access_token 作为 query param)
        mock_httpx_client.get.assert_called_once()
        call_kwargs = mock_httpx_client.get.call_args
        params = call_kwargs.kwargs.get("params") or (call_kwargs[1].get("params") if len(call_kwargs) > 1 else None)
        assert params is not None, "userinfo request must include params"
        assert "access_token" in params
        assert params["access_token"] == "watcha_access_token_secret"

    @pytest.mark.asyncio
    async def test_callback_token_exchange_failure(self, raw_client, mock_redis):
        """OAuth token 交换失败时重定向到错误页."""
        async def redis_get_side_effect(key):
            if key.startswith("oauth:state:"):
                return "1"
            return None

        mock_redis.get = AsyncMock(side_effect=redis_get_side_effect)

        # Mock httpx: token exchange returns error (sync response object)
        mock_token_response = MagicMock()
        mock_token_response.status_code = 400
        mock_token_response.text = "Bad Request"

        mock_httpx_client = AsyncMock()
        mock_httpx_client.post.return_value = mock_token_response
        mock_httpx_client.__aenter__ = AsyncMock(return_value=mock_httpx_client)
        mock_httpx_client.__aexit__ = AsyncMock(return_value=False)

        with patch(_AUTH_GET_REDIS, new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.v1.auth.httpx.AsyncClient", return_value=mock_httpx_client):
            resp = await raw_client.get(
                "/api/v1/auth/callback",
                params={"code": "bad_code", "state": "valid_state"},
                follow_redirects=False,
            )

        assert resp.status_code == 302
        location = resp.headers["location"]
        assert "/login?error=" in location
