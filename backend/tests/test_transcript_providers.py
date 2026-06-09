"""第三方字幕 API 提供商容错测试.

验证 Supadata 和 TranscriptAPI 在各种异常条件下的容错行为：
- 超时 / 连接失败 / 无效 JSON
- 未配置 API key
- 5xx 错误码
- 熔断器打开时跳过请求
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest


class TestSupadataTranscript:
    """Supadata API 调用容错测试."""

    @patch("app.services.subtitle_providers.settings")
    @patch("httpx.get")
    def test_supadata_timeout(self, mock_get, mock_settings):
        """Supadata API 超时 → 返回 None."""
        mock_settings.SUPADATA_API_KEY = "test-key"
        mock_get.side_effect = httpx.TimeoutException("Connection timed out")

        from app.services.subtitle_service import fetch_supadata_transcript

        result = fetch_supadata_transcript(
            "https://www.youtube.com/watch?v=abc123"
        )
        assert result is None

    @patch("app.services.subtitle_providers.settings")
    @patch("httpx.get")
    def test_supadata_connect_error(self, mock_get, mock_settings):
        """Supadata API 连接失败 → 返回 None."""
        mock_settings.SUPADATA_API_KEY = "test-key"
        mock_get.side_effect = httpx.ConnectError("Connection refused")

        from app.services.subtitle_service import fetch_supadata_transcript

        result = fetch_supadata_transcript(
            "https://www.youtube.com/watch?v=abc123"
        )
        assert result is None

    @patch("app.services.subtitle_providers.settings")
    @patch("httpx.get")
    def test_supadata_invalid_json(self, mock_get, mock_settings):
        """Supadata API 返回无效 JSON → 返回 None."""
        mock_settings.SUPADATA_API_KEY = "test-key"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.side_effect = ValueError("Invalid JSON")
        mock_get.return_value = mock_resp

        from app.services.subtitle_service import fetch_supadata_transcript

        result = fetch_supadata_transcript(
            "https://www.youtube.com/watch?v=abc123"
        )
        assert result is None

    @patch("app.services.subtitle_providers.settings")
    def test_supadata_no_api_key(self, mock_settings):
        """未配置 API key → 直接返回 None."""
        mock_settings.SUPADATA_API_KEY = ""

        from app.services.subtitle_service import fetch_supadata_transcript

        result = fetch_supadata_transcript(
            "https://www.youtube.com/watch?v=abc123"
        )
        assert result is None


class TestTranscriptAPIFallback:
    """TranscriptAPI 调用容错测试."""

    @patch("app.services.subtitle_providers.settings")
    @patch("app.services.subtitle_providers._breaker")
    @patch("httpx.get")
    def test_transcriptapi_5xx(self, mock_get, mock_breaker, mock_settings):
        """TranscriptAPI 返回 5xx → 记录失败，返回 None."""
        mock_settings.TRANSCRIPTAPI_API_KEY = "test-key"
        mock_breaker.is_open.return_value = False
        mock_breaker.record_failure = MagicMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_get.return_value = mock_resp

        from app.services.subtitle_service import fetch_transcriptapi_transcript

        result = fetch_transcriptapi_transcript(
            "https://www.youtube.com/watch?v=abc123"
        )
        assert result is None
        mock_breaker.record_failure.assert_called_with("transcriptapi")

    @patch("app.services.subtitle_providers.settings")
    @patch("app.services.subtitle_providers._breaker")
    def test_transcriptapi_circuit_open(self, mock_breaker, mock_settings):
        """TranscriptAPI 熔断器打开 → 跳过请求."""
        mock_settings.TRANSCRIPTAPI_API_KEY = "test-key"
        mock_breaker.is_open.return_value = True

        from app.services.subtitle_service import fetch_transcriptapi_transcript

        result = fetch_transcriptapi_transcript(
            "https://www.youtube.com/watch?v=abc123"
        )
        assert result is None
