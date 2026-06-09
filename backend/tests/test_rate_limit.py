"""Tests for rate limiting middleware.

SlowAPI is configured with default_limits=["60/minute"] on the FastAPI app.
These tests verify that the rate limiter is active and returns 429 when
the threshold is exceeded.
"""
import pytest
from httpx import AsyncClient

from app.core.rate_limit import limiter


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset the in-memory rate limiter state between tests."""
    limiter.reset()
    yield
    limiter.reset()


class TestRateLimiting:
    """Rate limiting must be enforced on API endpoints."""

    @pytest.mark.asyncio
    async def test_rate_limit_returns_429_after_threshold(self, client: AsyncClient):
        """Rapid requests should eventually trigger 429.

        The global default limit is 60/minute. Sending 65 rapid requests
        should cause at least some to receive 429 Too Many Requests.
        """
        responses = []
        for _ in range(65):
            resp = await client.get("/health")
            responses.append(resp.status_code)

        status_codes = set(responses)
        # At least one should be 429 (rate limited)
        assert 429 in status_codes, (
            f"Expected 429 in responses but got only: {status_codes}. "
            f"Rate limiting may not be active or threshold is higher than expected."
        )

    @pytest.mark.asyncio
    async def test_rate_limit_429_body_contains_error(self, client: AsyncClient):
        """Once rate limited, the 429 response body should indicate the error."""
        # Exhaust the limit
        for _ in range(65):
            resp = await client.get("/health")
            if resp.status_code == 429:
                # SlowAPI returns a JSON or text error body
                body = resp.text
                assert "rate limit" in body.lower() or "ratelimit" in body.lower() or "exceeded" in body.lower(), (
                    f"429 response body should mention rate limit, got: {body}"
                )
                return

        pytest.fail("Rate limit was not triggered within 65 requests")

    @pytest.mark.asyncio
    async def test_normal_requests_under_limit_succeed(self, client: AsyncClient):
        """A small number of requests should all succeed (not rate limited)."""
        responses = []
        for _ in range(5):
            resp = await client.get("/health")
            responses.append(resp.status_code)

        # All should be 200
        assert all(s == 200 for s in responses), (
            f"Expected all 200 but got: {responses}"
        )

    @pytest.mark.asyncio
    async def test_rate_limiter_is_attached_to_app(self, client: AsyncClient):
        """The app.state.limiter must be set (SlowAPI integration)."""
        from app.main import app
        assert hasattr(app.state, "limiter"), "app.state.limiter not set"
        assert app.state.limiter is limiter
