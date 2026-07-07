"""Single-user auth endpoint tests."""

import pytest
from httpx import AsyncClient


class TestLocalOwnerAuth:
    @pytest.mark.asyncio
    async def test_me_without_cookie_returns_local_owner(self, raw_client: AsyncClient):
        resp = await raw_client.get("/api/v1/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nickname"] == "本地用户"
        assert data["is_admin"] is True
        assert set(data.keys()) == {"id", "nickname", "avatar_url", "email", "phone", "is_admin"}

    @pytest.mark.asyncio
    async def test_old_auth_routes_are_not_registered(self, raw_client: AsyncClient):
        base = "/api/v1/auth"
        routes = {
            "GET": ["login", "callback", "dev-login", "sessions"],
            "POST": ["logout", "refresh"],
            "DELETE": ["sessions/example-jti"],
        }
        for method, suffixes in routes.items():
            for suffix in suffixes:
                resp = await raw_client.request(method, f"{base}/{suffix}")
                assert resp.status_code == 404
