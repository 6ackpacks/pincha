"""Tests for CSRF middleware at app/core/csrf.py.

Verifies that the middleware correctly blocks cross-origin state-changing
requests while allowing legitimate API calls and safe HTTP methods.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI, Request
from starlette.responses import JSONResponse

from app.core.csrf import CSRFMiddleware


# ---------------------------------------------------------------------------
# Minimal test app with CSRF middleware
# ---------------------------------------------------------------------------

def _make_app(allowed_origins: set[str] | None = None) -> FastAPI:
    """Create a minimal FastAPI app with CSRF middleware for testing."""
    test_app = FastAPI()

    origins = allowed_origins or {"http://localhost:3000", "http://127.0.0.1:3000"}
    test_app.add_middleware(CSRFMiddleware, allowed_origins=origins)

    @test_app.get("/test")
    async def get_endpoint():
        return {"ok": True}

    @test_app.post("/test")
    async def post_endpoint():
        return {"ok": True}

    return test_app


@pytest.fixture
def csrf_app():
    return _make_app()


@pytest.fixture
async def csrf_client(csrf_app):
    transport = ASGITransport(app=csrf_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ===========================================================================
# Tests
# ===========================================================================


class TestCSRFMiddleware:
    """CSRF middleware validation tests."""

    @pytest.mark.asyncio
    async def test_post_with_valid_origin_passes(self, csrf_client):
        """POST with a valid Origin header should pass through."""
        resp = await csrf_client.post(
            "/test",
            headers={"Origin": "http://localhost:3000"},
            content="{}",
        )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    @pytest.mark.asyncio
    async def test_post_with_invalid_origin_returns_403(self, csrf_client):
        """POST with an invalid Origin header should be rejected with 403."""
        resp = await csrf_client.post(
            "/test",
            headers={"Origin": "http://evil.com"},
            content="{}",
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_post_with_valid_referer_passes(self, csrf_client):
        """POST without Origin but with a valid Referer should pass."""
        resp = await csrf_client.post(
            "/test",
            headers={"Referer": "http://localhost:3000/some/page"},
            content="{}",
        )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    @pytest.mark.asyncio
    async def test_post_with_bearer_token_passes(self, csrf_client):
        """POST without Origin/Referer but with Bearer token should pass (API auth)."""
        resp = await csrf_client.post(
            "/test",
            headers={"Authorization": "Bearer some-jwt-token"},
            content="{}",
        )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    @pytest.mark.asyncio
    async def test_post_with_json_content_type_no_origin_returns_403(self, csrf_client):
        """POST without Origin/Referer is rejected even with application/json content-type.

        application/json must not be treated as a CSRF exemption — it does not
        reliably trigger a CORS preflight (e.g. sendBeacon / some clients), so
        trusting it would degrade protection to SameSite cookies alone.
        """
        resp = await csrf_client.post(
            "/test",
            headers={"Content-Type": "application/json"},
            content="{}",
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_post_without_origin_referer_bearer_returns_403(self, csrf_client):
        """POST without Origin/Referer and no Bearer token should be 403 (cookie auth)."""
        resp = await csrf_client.post(
            "/test",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            content="key=value",
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_get_request_without_headers_passes(self, csrf_client):
        """GET request (safe method) should pass without any origin headers."""
        resp = await csrf_client.get("/test")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    @pytest.mark.asyncio
    async def test_post_with_invalid_referer_returns_403(self, csrf_client):
        """POST with an invalid Referer (no Origin) should be rejected."""
        resp = await csrf_client.post(
            "/test",
            headers={"Referer": "http://evil.com/attack"},
            content="{}",
        )
        assert resp.status_code == 403
