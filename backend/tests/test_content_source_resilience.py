"""外部 HTTP 服务调用的韧性测试.

测试后端调用外部 HTTP API 时的容错行为：
- article_service.extract_article 的网络错误处理
- OAuth (Watcha) 不可达时的行为
- 通用 HTTP 超时 / 5xx / 无效 JSON 处理
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


class TestArticleExtractionResilience:
    """文章提取服务 (article_service) 的韧性测试."""

    @pytest.mark.asyncio
    async def test_article_extraction_url_unreachable(self):
        """文章提取时 URL 不可达 → 返回 success=False."""
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(
                return_value=mock_client
            )
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get.side_effect = httpx.ConnectError(
                "Connection refused"
            )

            from app.services.article_service import extract_article

            result = await extract_article("http://unreachable.example.com/article")

        assert result["success"] is False
        assert result["content"] is None
        assert result["title"] is None

    @pytest.mark.asyncio
    async def test_article_extraction_timeout(self):
        """文章提取超时 → 返回 success=False，不崩溃."""
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(
                return_value=mock_client
            )
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get.side_effect = httpx.TimeoutException(
                "Request timed out"
            )

            from app.services.article_service import extract_article

            result = await extract_article("http://slow.example.com/article")

        assert result["success"] is False
        assert result["content"] is None

    @pytest.mark.asyncio
    async def test_article_extraction_5xx(self):
        """文章提取时服务器返回 5xx → 返回 success=False."""
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(
                return_value=mock_client
            )
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            mock_resp = MagicMock()
            mock_resp.status_code = 502
            mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
                "Bad Gateway",
                request=MagicMock(),
                response=mock_resp,
            )
            mock_client.get.return_value = mock_resp

            from app.services.article_service import extract_article

            result = await extract_article("http://broken.example.com/article")

        assert result["success"] is False
        assert result["content"] is None

    @pytest.mark.asyncio
    async def test_article_extraction_invalid_html(self):
        """文章提取时返回无效 HTML → trafilatura 提取失败但不崩溃."""
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(
                return_value=mock_client
            )
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.raise_for_status = MagicMock()
            # Return garbage that trafilatura can't extract meaningful content from
            mock_resp.text = "<html><body><p>x</p></body></html>"
            mock_client.get.return_value = mock_resp

            from app.services.article_service import extract_article

            result = await extract_article("http://example.com/empty")

        # Content too short (< 100 chars) → success=False
        assert result["success"] is False


class TestExternalAPIResilience:
    """通用外部 HTTP API 调用韧性测试 (curate_v2 fetcher)."""

    @patch("httpx.Client")
    def test_external_api_timeout_handling(self, mock_client_cls):
        """外部 API 超时 → _request_with_retry 返回 None."""
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.TimeoutException("timed out")

        from app.services.curate_v2.fetcher import _request_with_retry

        result = _request_with_retry(mock_client, "/test", {"q": "hello"})
        assert result is None

    @patch("httpx.Client")
    def test_external_api_5xx_handling(self, mock_client_cls):
        """外部 API 返回 5xx → 重试后返回 None."""
        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 500

        error = httpx.HTTPStatusError(
            "Server Error", request=MagicMock(), response=mock_resp
        )
        mock_resp.raise_for_status.side_effect = error
        mock_client.get.return_value = mock_resp

        from app.services.curate_v2.fetcher import _request_with_retry

        result = _request_with_retry(mock_client, "/test", {"q": "hello"})
        assert result is None

    @patch("httpx.Client")
    def test_external_api_invalid_json(self, mock_client_cls):
        """外部 API 返回无效 JSON → 异常被捕获."""
        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.side_effect = ValueError("Invalid JSON")
        mock_client.get.return_value = mock_resp

        from app.services.curate_v2.fetcher import _request_with_retry

        # json() raises ValueError which is not caught by _request_with_retry
        # so it propagates — this tests that the caller must handle it
        with pytest.raises(ValueError, match="Invalid JSON"):
            _request_with_retry(mock_client, "/test", {"q": "hello"})

    @patch("httpx.Client")
    def test_external_api_connect_error(self, mock_client_cls):
        """外部 API 连接失败 → 重试后返回 None."""
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.ConnectError("Connection refused")

        from app.services.curate_v2.fetcher import _request_with_retry

        result = _request_with_retry(mock_client, "/test", {"q": "hello"})
        assert result is None


class TestOAuthProviderResilience:
    """OAuth (Watcha) 服务不可达时的行为测试."""

    @pytest.mark.asyncio
    async def test_oauth_token_exchange_timeout(self, client, mock_redis):
        """OAuth token exchange 超时 → 重定向到错误页面."""
        # Setup: store a valid state in mock_redis
        mock_redis.get = AsyncMock(return_value=b"1")
        mock_redis.delete = AsyncMock(return_value=1)

        async def _fake_get_redis():
            return mock_redis

        with patch("app.api.v1.auth.get_redis", new=_fake_get_redis):
            with patch("app.api.v1.auth.httpx.AsyncClient") as mock_client_cls:
                mock_instance = AsyncMock()
                mock_client_cls.return_value.__aenter__ = AsyncMock(
                    return_value=mock_instance
                )
                mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_instance.post.side_effect = httpx.TimeoutException(
                    "Connection timed out"
                )

                resp = await client.get(
                    "/api/v1/auth/callback",
                    params={"code": "test_code", "state": "test_state"},
                    follow_redirects=False,
                )

        # Should redirect to login error page
        assert resp.status_code == 302
        assert "error=" in resp.headers.get("location", "")

    @pytest.mark.asyncio
    async def test_oauth_userinfo_5xx(self, client, mock_redis):
        """OAuth userinfo 返回 5xx → 重定向到错误页面."""
        mock_redis.get = AsyncMock(return_value=b"1")
        mock_redis.delete = AsyncMock(return_value=1)

        async def _fake_get_redis():
            return mock_redis

        with patch("app.api.v1.auth.get_redis", new=_fake_get_redis):
            with patch("app.api.v1.auth.httpx.AsyncClient") as mock_client_cls:
                mock_instance = AsyncMock()
                mock_client_cls.return_value.__aenter__ = AsyncMock(
                    return_value=mock_instance
                )
                mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

                # Token exchange succeeds
                token_resp = MagicMock()
                token_resp.status_code = 200
                token_resp.json.return_value = {
                    "access_token": "watcha_token",
                    "refresh_token": "watcha_refresh",
                    "expires_in": 1800,
                }
                mock_instance.post.return_value = token_resp

                # Userinfo fails with 500
                userinfo_resp = MagicMock()
                userinfo_resp.status_code = 500
                userinfo_resp.text = "Internal Server Error"
                mock_instance.get.return_value = userinfo_resp

                resp = await client.get(
                    "/api/v1/auth/callback",
                    params={"code": "test_code", "state": "test_state"},
                    follow_redirects=False,
                )

        assert resp.status_code == 302
        assert "error=" in resp.headers.get("location", "")

    @pytest.mark.asyncio
    async def test_oauth_invalid_state(self, client, mock_redis):
        """OAuth state 校验失败 → 重定向到错误页面."""
        # State not found in Redis
        mock_redis.get = AsyncMock(return_value=None)

        async def _fake_get_redis():
            return mock_redis

        with patch("app.api.v1.auth.get_redis", new=_fake_get_redis):
            resp = await client.get(
                "/api/v1/auth/callback",
                params={"code": "test_code", "state": "invalid_state"},
                follow_redirects=False,
            )

        assert resp.status_code == 302
        location = resp.headers.get("location", "")
        assert "error=" in location


class TestTranscriptHQResilience:
    """TranscriptHQ API 调用容错测试."""

    @patch("app.config.settings")
    @patch("app.services.subtitle_providers._breaker")
    @patch("app.services.subtitle_providers.httpx.post")
    def test_transcripthq_timeout(self, mock_post, mock_breaker, mock_settings):
        """TranscriptHQ 超时 → 记录失败，返回 None."""
        mock_settings.TRANSCRIPTHQ_API_KEY = "test-key"
        mock_breaker.is_open.return_value = False
        mock_breaker.record_failure = MagicMock()

        mock_post.side_effect = httpx.TimeoutException("timed out")

        from app.services.subtitle_service import fetch_transcripthq_transcript

        result = fetch_transcripthq_transcript(
            "https://www.youtube.com/watch?v=abc123", "youtube"
        )
        assert result is None
        mock_breaker.record_failure.assert_called_with("transcripthq")

    @patch("app.config.settings")
    @patch("app.services.subtitle_providers._breaker")
    @patch("app.services.subtitle_providers.httpx.post")
    def test_transcripthq_connect_error(self, mock_post, mock_breaker, mock_settings):
        """TranscriptHQ 连接失败 → 记录失败，返回 None."""
        mock_settings.TRANSCRIPTHQ_API_KEY = "test-key"
        mock_breaker.is_open.return_value = False
        mock_breaker.record_failure = MagicMock()

        mock_post.side_effect = httpx.ConnectError("Connection refused")

        from app.services.subtitle_service import fetch_transcripthq_transcript

        result = fetch_transcripthq_transcript(
            "https://www.bilibili.com/video/BV123", "bilibili"
        )
        assert result is None
        mock_breaker.record_failure.assert_called_with("transcripthq")

    @patch("app.config.settings")
    @patch("app.services.subtitle_service._breaker")
    def test_transcripthq_no_api_key(self, mock_breaker, mock_settings):
        """TranscriptHQ 未配置 API key → 直接返回 None."""
        mock_settings.TRANSCRIPTHQ_API_KEY = ""

        from app.services.subtitle_service import fetch_transcripthq_transcript

        result = fetch_transcripthq_transcript(
            "https://www.youtube.com/watch?v=abc123", "youtube"
        )
        assert result is None
