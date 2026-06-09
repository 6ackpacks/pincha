"""Tests for the /img-proxy endpoint in app/main.py.

Verifies host allowlist, scheme validation, and SSRF protection.
"""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient

from tests.conftest import TestSessionLocal


@pytest.fixture
async def img_client(mock_redis):
    """Client for img-proxy tests — overrides DB and Redis deps."""
    from app.core.database import get_session
    from app.core.redis import get_redis
    from app.main import app

    async def override_get_session():
        async with TestSessionLocal() as session:
            yield session

    async def override_get_redis():
        return mock_redis

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_redis] = override_get_redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# ===========================================================================
# Tests
# ===========================================================================


class TestImgProxy:
    """Image proxy endpoint security tests."""

    @pytest.mark.asyncio
    async def test_allowed_host_attempts_fetch(self, img_client):
        """Request with allowed host (i.ytimg.com) should attempt to fetch the image."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "image/jpeg"}
        mock_response.content = b"\xff\xd8\xff\xe0fake-jpeg"

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_instance

            resp = await img_client.get(
                "/img-proxy",
                params={"url": "https://i.ytimg.com/vi/abc123/maxresdefault.jpg"},
            )

        assert resp.status_code == 200
        assert resp.content == b"\xff\xd8\xff\xe0fake-jpeg"

    @pytest.mark.asyncio
    async def test_disallowed_host_returns_403(self, img_client):
        """Request with a host not in the allowlist should return 403."""
        resp = await img_client.get(
            "/img-proxy",
            params={"url": "https://evil.com/malicious.jpg"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_non_http_protocol_returns_400(self, img_client):
        """Request with ftp:// or other non-http scheme should return 400."""
        resp = await img_client.get(
            "/img-proxy",
            params={"url": "ftp://i.ytimg.com/vi/abc/thumb.jpg"},
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_private_ip_returns_403(self, img_client):
        """Request with a private/metadata IP should return 403 (not in allowed hosts)."""
        resp = await img_client.get(
            "/img-proxy",
            params={"url": "http://169.254.169.254/latest/meta-data/"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_localhost_returns_403(self, img_client):
        """Request targeting localhost should return 403 (not in allowed hosts)."""
        resp = await img_client.get(
            "/img-proxy",
            params={"url": "http://127.0.0.1:6379/"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_allowed_bilibili_host(self, img_client):
        """Request with allowed Bilibili CDN host should attempt fetch."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "image/png"}
        mock_response.content = b"\x89PNGfake"

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_instance

            resp = await img_client.get(
                "/img-proxy",
                params={"url": "https://i0.hdslb.com/bfs/archive/cover.jpg"},
            )

        assert resp.status_code == 200
