"""Redis cache module tests.

Tests cache_get, cache_set, cache_delete, cache_delete_pattern
with a mocked Redis client.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture
def mock_redis_client():
    """A mock Redis client for cache tests."""
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock(return_value=True)
    redis.delete = AsyncMock(return_value=1)
    redis.keys = AsyncMock(return_value=[])
    redis.scan = AsyncMock(return_value=(0, []))
    return redis


class TestCacheGet:
    @pytest.mark.asyncio
    async def test_cache_miss_returns_none(self, mock_redis_client):
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_get
            result = await cache_get("nonexistent:key")
        assert result is None

    @pytest.mark.asyncio
    async def test_cache_hit_returns_deserialized(self, mock_redis_client):
        data = {"id": "123", "title": "Test"}
        mock_redis_client.get = AsyncMock(return_value=json.dumps(data))
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_get
            result = await cache_get("video:123")
        assert result == data

    @pytest.mark.asyncio
    async def test_cache_error_returns_none(self, mock_redis_client):
        mock_redis_client.get = AsyncMock(side_effect=ConnectionError("Redis down"))
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_get
            result = await cache_get("video:123")
        assert result is None


class TestCacheSet:
    @pytest.mark.asyncio
    async def test_cache_set_calls_setex(self, mock_redis_client):
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_set
            await cache_set("key", {"data": 1}, 60)
        mock_redis_client.setex.assert_called_once_with("key", 60, json.dumps({"data": 1}))

    @pytest.mark.asyncio
    async def test_cache_set_error_does_not_raise(self, mock_redis_client):
        mock_redis_client.setex = AsyncMock(side_effect=ConnectionError("Redis down"))
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_set
            await cache_set("key", {"data": 1}, 60)


class TestCacheDelete:
    @pytest.mark.asyncio
    async def test_cache_delete_calls_redis_delete(self, mock_redis_client):
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_delete
            await cache_delete("key1", "key2")
        mock_redis_client.delete.assert_called_once_with("key1", "key2")

    @pytest.mark.asyncio
    async def test_cache_delete_empty_keys_noop(self, mock_redis_client):
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_delete
            await cache_delete()
        mock_redis_client.delete.assert_not_called()


class TestCacheDeletePattern:
    @pytest.mark.asyncio
    async def test_delete_pattern_uses_scan_command(self, mock_redis_client):
        """Implementation uses SCAN for non-blocking key iteration."""
        mock_redis_client.scan = AsyncMock(
            return_value=(0, [b"wiki:pages:abc", b"wiki:pages:def"])
        )
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_delete_pattern
            await cache_delete_pattern("wiki:pages:*")
        mock_redis_client.scan.assert_called_once_with(0, match="wiki:pages:*", count=100)
        mock_redis_client.delete.assert_called_once_with(b"wiki:pages:abc", b"wiki:pages:def")

    @pytest.mark.asyncio
    async def test_delete_pattern_no_matches_skips_delete(self, mock_redis_client):
        mock_redis_client.scan = AsyncMock(return_value=(0, []))
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_delete_pattern
            await cache_delete_pattern("nonexistent:*")
        mock_redis_client.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_pattern_error_does_not_raise(self, mock_redis_client):
        mock_redis_client.scan = AsyncMock(side_effect=ConnectionError("Redis down"))
        with patch("app.core.cache.get_redis", return_value=mock_redis_client):
            from app.core.cache import cache_delete_pattern
            await cache_delete_pattern("wiki:*")
