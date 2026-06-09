"""ASR 转写服务降级测试.

验证字幕/ASR 服务在各种异常条件下的容错行为：
- Whisper API 不可达 / 超时 / 返回空结果
- 火山引擎 ASR 返回错误码
- 平台字幕优先于 ASR
- 所有方法全部失败时正确抛出 RuntimeError
- 超长音频处理
"""

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest


class TestASRFallback:
    """ASR 转写服务降级测试."""

    @patch("app.services.audio_asr.settings")
    @patch("openai.OpenAI")
    def test_whisper_endpoint_unreachable(self, mock_openai_cls, mock_settings):
        """Whisper API 不可达 → 错误正确传播."""
        import tempfile

        mock_settings.WHISPER_API_BASE = "http://unreachable:9999/v1"
        mock_settings.WHISPER_API_KEY = "test-key"
        mock_settings.OPENAI_API_KEY = "test-key"

        # Simulate connection error during transcription
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.audio.transcriptions.create.side_effect = Exception(
            "Connection refused"
        )

        from app.services.subtitle_service import transcribe_with_asr

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"\x00" * 100)
            audio_path = f.name

        try:
            with pytest.raises(Exception, match="Connection refused"):
                transcribe_with_asr(audio_path)
        finally:
            os.unlink(audio_path)

    @patch("app.services.audio_asr.settings")
    @patch("openai.OpenAI")
    def test_whisper_timeout(self, mock_openai_cls, mock_settings):
        """Whisper 请求超时."""
        import tempfile

        mock_settings.WHISPER_API_BASE = "http://slow-server:9999/v1"
        mock_settings.WHISPER_API_KEY = "test-key"
        mock_settings.OPENAI_API_KEY = "test-key"

        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.audio.transcriptions.create.side_effect = TimeoutError(
            "Request timed out"
        )

        from app.services.subtitle_service import transcribe_with_asr

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"\x00" * 100)
            audio_path = f.name

        try:
            with pytest.raises(TimeoutError, match="timed out"):
                transcribe_with_asr(audio_path)
        finally:
            os.unlink(audio_path)

    @patch("app.services.audio_asr.settings")
    @patch("openai.OpenAI")
    def test_whisper_returns_empty_transcript(self, mock_openai_cls, mock_settings):
        """Whisper 返回空转写结果 → 返回空列表."""
        import tempfile

        mock_settings.WHISPER_API_BASE = "http://whisper:9999/v1"
        mock_settings.WHISPER_API_KEY = "test-key"
        mock_settings.OPENAI_API_KEY = "test-key"

        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        # Simulate empty response (no segments, no text)
        mock_response = MagicMock()
        mock_response.segments = []
        mock_response.text = ""
        mock_client.audio.transcriptions.create.return_value = mock_response

        from app.services.subtitle_service import transcribe_with_asr

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"\x00" * 100)
            audio_path = f.name

        try:
            result = transcribe_with_asr(audio_path)
            # Empty segments and empty text → returns empty list
            assert result == []
        finally:
            os.unlink(audio_path)

    @patch("app.services.audio_asr.settings")
    @patch("httpx.post")
    def test_volcengine_asr_api_error(self, mock_post, mock_settings):
        """火山引擎 ASR 返回错误码 → 抛出 RuntimeError."""
        mock_settings.VOLC_ASR_APP_ID = "test-app-id"
        mock_settings.VOLC_ASR_ACCESS_TOKEN = "test-token"

        # Simulate 500 response from Volcengine
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal Server Error"
        mock_post.return_value = mock_resp

        from app.services.subtitle_service import transcribe_with_volc_asr

        # Create a tiny fake audio file for base64 encoding
        fake_audio = b"\x00" * 100
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(fake_audio)
            audio_path = f.name

        try:
            with pytest.raises(RuntimeError, match="火山引擎 ASR 请求失败"):
                transcribe_with_volc_asr(audio_path)
        finally:
            os.unlink(audio_path)

    @patch("app.services.audio_asr.settings")
    @patch("httpx.post")
    def test_volcengine_asr_empty_result(self, mock_post, mock_settings):
        """火山引擎 ASR 返回空结果 → 抛出 RuntimeError."""
        mock_settings.VOLC_ASR_APP_ID = "test-app-id"
        mock_settings.VOLC_ASR_ACCESS_TOKEN = "test-token"

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"result": {"utterances": [], "text": ""}}
        mock_post.return_value = mock_resp

        from app.services.subtitle_service import transcribe_with_volc_asr

        fake_audio = b"\x00" * 100
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(fake_audio)
            audio_path = f.name

        try:
            with pytest.raises(RuntimeError, match="火山引擎 ASR 返回空结果"):
                transcribe_with_volc_asr(audio_path)
        finally:
            os.unlink(audio_path)

    @patch("app.services.subtitle_service.fetch_platform_subtitles")
    @patch("app.services.subtitle_service.fetch_transcripthq_transcript")
    @patch("app.services.subtitle_service.fetch_transcriptapi_transcript")
    @patch("app.services.subtitle_service.fetch_supadata_transcript")
    @patch("app.services.subtitle_service.fetch_youtube_transcript_api")
    @patch("app.services.subtitle_providers._breaker")
    def test_platform_subtitles_preferred_over_asr(
        self,
        mock_breaker,
        mock_yt_api,
        mock_supadata,
        mock_transcriptapi,
        mock_transcripthq,
        mock_platform,
    ):
        """平台字幕（YouTube CC）优先于 ASR — Supadata 成功则直接返回."""
        mock_breaker.is_open.return_value = False
        mock_breaker.record_success = MagicMock()
        mock_breaker.record_failure = MagicMock()

        expected_segments = [
            {"start": 0.0, "end": 5.0, "text": "Hello world"},
            {"start": 5.0, "end": 10.0, "text": "你好世界"},
        ]
        mock_supadata.return_value = expected_segments

        from app.services.subtitle_service import get_transcript_segments

        segments, source = get_transcript_segments(
            "https://www.youtube.com/watch?v=test123", "youtube"
        )

        assert source == "platform"
        assert segments == expected_segments
        # ASR should NOT be called when platform subtitles succeed
        mock_yt_api.assert_not_called()

    @patch("app.services.subtitle_service.settings")
    @patch("app.services.subtitle_service.fetch_platform_subtitles")
    @patch("app.services.subtitle_service.fetch_transcripthq_transcript")
    @patch("app.services.subtitle_service.fetch_transcriptapi_transcript")
    @patch("app.services.subtitle_service.fetch_supadata_transcript")
    @patch("app.services.subtitle_service.fetch_youtube_transcript_api")
    @patch("app.services.subtitle_providers._breaker")
    def test_subtitle_extraction_all_methods_fail(
        self,
        mock_breaker,
        mock_yt_api,
        mock_supadata,
        mock_transcriptapi,
        mock_transcripthq,
        mock_platform,
        mock_settings,
    ):
        """所有字幕获取方式都失败 + 无 ASR 配置 → RuntimeError."""
        mock_breaker.is_open.return_value = False
        mock_breaker.record_success = MagicMock()
        mock_breaker.record_failure = MagicMock()

        mock_supadata.return_value = None
        mock_transcriptapi.return_value = None
        mock_transcripthq.return_value = None
        mock_yt_api.return_value = None
        mock_platform.return_value = None

        # No ASR configured
        mock_settings.VOLC_ASR_APP_ID = ""
        mock_settings.VOLC_ASR_ACCESS_TOKEN = ""
        mock_settings.WHISPER_API_BASE = ""

        from app.services.subtitle_service import get_transcript_segments

        with pytest.raises(RuntimeError, match="ASR 语音识别但未配置"):
            get_transcript_segments(
                "https://www.youtube.com/watch?v=test123", "youtube"
            )

    @patch("app.services.audio_asr.settings")
    @patch("httpx.post")
    def test_very_long_audio_handling(self, mock_post, mock_settings):
        """超长音频（>100MB）的处理 → 火山引擎拒绝文件过大."""
        mock_settings.VOLC_ASR_APP_ID = "test-app-id"
        mock_settings.VOLC_ASR_ACCESS_TOKEN = "test-token"

        from app.services.subtitle_service import transcribe_with_volc_asr

        # Create a fake audio file path and mock os.path.getsize
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"\x00" * 100)
            audio_path = f.name

        try:
            # Mock getsize to return > 100MB
            with patch("os.path.getsize", return_value=150 * 1024 * 1024):
                with pytest.raises(RuntimeError, match="音频文件过大"):
                    transcribe_with_volc_asr(audio_path)
        finally:
            os.unlink(audio_path)

        # httpx.post should never be called for oversized files
        mock_post.assert_not_called()
