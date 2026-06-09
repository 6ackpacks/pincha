"""Tests for the /health endpoint and root-level routes."""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok(client: AsyncClient):
    """GET /health should return 200 with status ok."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data == {"status": "ok"}


@pytest.mark.asyncio
async def test_api_v1_root(client: AsyncClient):
    """GET /api/v1/ should return the v1 welcome message."""
    resp = await client.get("/api/v1/")
    assert resp.status_code == 200
    data = resp.json()
    assert "message" in data
    assert "PinCha" in data["message"]


@pytest.mark.asyncio
async def test_nonexistent_route_returns_404(client: AsyncClient):
    """A request to an undefined path should return 404."""
    resp = await client.get("/api/v1/nonexistent")
    assert resp.status_code == 404
