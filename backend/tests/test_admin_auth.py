"""Admin API tests for the single-user Local Owner mode."""

import uuid

import pytest
from httpx import AsyncClient


API_PREFIX = "/api/v1/admin"


class TestAdminLocalOwner:
    @pytest.mark.asyncio
    async def test_admin_videos_uses_local_owner(self, raw_client: AsyncClient):
        resp = await raw_client.get(f"{API_PREFIX}/videos")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_admin_user_management_is_removed(self, raw_client: AsyncClient):
        resp = await raw_client.get(f"{API_PREFIX}/users")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_missing_video_still_reaches_admin_handler(self, raw_client: AsyncClient):
        vid = str(uuid.uuid4())
        resp = await raw_client.delete(
            f"{API_PREFIX}/videos/{vid}",
            headers={"Origin": "http://localhost:3000"},
        )
        assert resp.status_code == 404
