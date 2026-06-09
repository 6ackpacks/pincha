"""yt-dlp 下载失败场景测试.

验证字幕/音频下载在各种失败场景下的行为：
- 视频不可用（删除/私密）
- 网络超时
- 年龄限制
- URL 验证
- extract_info 超时
"""

import pytest
from unittest.mock import patch, MagicMock

import yt_dlp

from app.services.subtitle_service import (
    fetch_platform_subtitles,
    download_audio,
    get_transcript_segments,
    _extract_youtube_video_id,
)


class TestDownloadFallback:
    """yt-dlp 下载失败场景测试."""

    async def test_video_unavailable_permanent_failure(self):
        """视频删除/私密 -> fetch_platform_subtitles 返回 None（不崩溃）."""
        with patch("app.services.subtitle_parsers.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.side_effect = yt_dlp.utils.DownloadError(
                "Video unavailable. This video has been removed by the uploader."
            )

            result = fetch_platform_subtitles(
                "https://www.youtube.com/watch?v=deleted123", "youtube"
            )
            assert result is None

    async def test_network_timeout_returns_none(self):
        """网络超时 -> fetch_platform_subtitles 返回 None."""
        with patch("app.services.subtitle_parsers.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.side_effect = yt_dlp.utils.DownloadError(
                "Unable to download webpage: <urlopen error timed out>"
            )

            result = fetch_platform_subtitles(
                "https://www.youtube.com/watch?v=abc123", "youtube"
            )
            assert result is None

    async def test_age_restricted_video(self):
        """年龄限制视频 -> DownloadError 被捕获，返回 None."""
        with patch("app.services.subtitle_parsers.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.side_effect = yt_dlp.utils.DownloadError(
                "Sign in to confirm your age. This video may be inappropriate for some users."
            )

            result = fetch_platform_subtitles(
                "https://www.youtube.com/watch?v=agerestricted", "youtube"
            )
            assert result is None

    async def test_url_validation_extracts_video_id(self):
        """有效 URL 正确提取 video ID."""
        # Standard watch URL
        assert _extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
        # Short URL
        assert _extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
        # Shorts URL
        assert _extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
        # Invalid URL returns None
        assert _extract_youtube_video_id("https://example.com/not-a-video") is None
        assert _extract_youtube_video_id("not-even-a-url") is None

    async def test_extract_info_timeout(self):
        """yt-dlp extract_info 超时 -> OSError 被捕获，返回 None."""
        with patch("app.services.subtitle_parsers.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.side_effect = TimeoutError(
                "Connection timed out after 30 seconds"
            )

            result = fetch_platform_subtitles(
                "https://www.youtube.com/watch?v=timeout123", "youtube"
            )
            assert result is None

    async def test_download_audio_raises_on_all_methods_fail(self):
        """所有下载方式都失败时 -> 抛出 RuntimeError."""
        with patch("app.services.subtitle_parsers.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.download.side_effect = yt_dlp.utils.DownloadError(
                "HTTP Error 403: Forbidden"
            )

            # Also mock the RapidAPI fallback to fail
            with patch(
                "app.services.subtitle_service._download_audio_via_rapidapi",
                return_value=None,
            ):
                with pytest.raises(RuntimeError):
                    download_audio(
                        "https://www.youtube.com/watch?v=blocked123",
                        "/tmp/test_output",
                    )

    async def test_extractor_error_returns_none(self):
        """ExtractorError (格式不支持等) -> 返回 None."""
        with patch("app.services.subtitle_parsers.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.side_effect = yt_dlp.utils.ExtractorError(
                "Unsupported URL"
            )

            result = fetch_platform_subtitles(
                "https://www.youtube.com/watch?v=unsupported", "youtube"
            )
            assert result is None
