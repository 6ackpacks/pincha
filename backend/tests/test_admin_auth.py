"""Admin API authentication tests.

Verifies that Admin endpoints require an authenticated admin user
(session cookie + is_admin=True) and reject non-admin or unauthenticated requests.
"""

import uuid
from unittest.mock import patch, MagicMock

import pytest
from httpx import AsyncClient

from app.config import settings


API_PREFIX = "/api/v1/admin"


class TestAdminAuthRequired:
    """Admin endpoints must require authenticated admin user."""

    @pytest.mark.asyncio
    async def test_no_session_returns_401(self, raw_client: AsyncClient):
        """Request without session cookie is rejected."""
        resp = await raw_client.get(f"{API_PREFIX}/videos")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_non_admin_user_returns_403(self, client: AsyncClient):
        """Authenticated non-admin user is rejected with 403."""
        resp = await client.get(f"{API_PREFIX}/videos")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_user_grants_access(self, client: AsyncClient, test_user):
        """Authenticated admin user can access admin endpoints."""
        test_user.is_admin = True
        resp = await client.get(f"{API_PREFIX}/videos")
        assert resp.status_code == 200


class TestAdminEndpointsCoverage:
    """Verify multiple admin endpoints all enforce admin auth."""

    @pytest.mark.asyncio
    async def test_videos_list_requires_admin(self, client: AsyncClient):
        resp = await client.get(f"{API_PREFIX}/videos")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_trigger_curate_requires_admin(self, client: AsyncClient):
        resp = await client.post(f"{API_PREFIX}/curate-v2/trigger")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_video_requires_admin(self, client: AsyncClient):
        vid = str(uuid.uuid4())
        resp = await client.delete(f"{API_PREFIX}/videos/{vid}")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_can_list_videos(self, client: AsyncClient, test_user):
        test_user.is_admin = True
        resp = await client.get(f"{API_PREFIX}/videos")
        assert resp.status_code == 200
