"""Service-layer LLM integration tests.

Tests for SummaryService, MindmapService, and VideoService with mocked LLM calls.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from litellm.exceptions import RateLimitError, APIConnectionError

from app.services.summary_service import (
    generate_summary,
    _summarize_single,
    LEVEL_PROMPTS,
    CASCADE_PROMPTS,
)
from app.services.mindmap_service import (
    MINDMAP_PROMPT,
)
from app.services.mindmap_engine import generate_mindmap_markdown as _generate_mindmap_markdown
from app.services.video_service import validate_url


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_litellm_summary():
    """Mock litellm.acompletion in summary_service module."""
    with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
        mock.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="这是一段测试摘要内容"))],
            usage=MagicMock(prompt_tokens=100, completion_tokens=50),
        )
        yield mock


@pytest.fixture
def mock_litellm_mindmap():
    """Mock litellm.acompletion in mindmap_engine module."""
    with patch("app.services.mindmap_engine.litellm.acompletion", new_callable=AsyncMock) as mock:
        mock.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="# 视频主题\n## 分支一\n- 细节"))],
            usage=MagicMock(prompt_tokens=80, completion_tokens=60),
        )
        yield mock


# ===========================================================================
# 1. SummaryService Tests
# ===========================================================================


class TestSummaryService:
    """Tests for summary generation via LLM."""

    async def test_generate_summary_calls_llm_with_correct_model(self, mock_litellm_summary):
        """Verify acompletion is called with the configured model."""
        transcript = "这是一段测试字幕内容，讲述了人工智能的发展历程。"
        await generate_summary(transcript, "express")

        mock_litellm_summary.assert_called_once()
        call_kwargs = mock_litellm_summary.call_args.kwargs
        assert "model" in call_kwargs
        # Model should be a non-empty string from settings
        assert call_kwargs["model"]

    async def test_generate_summary_messages_contain_transcript(self, mock_litellm_summary):
        """Verify the user message contains the transcript text."""
        transcript = "深度学习在自然语言处理中的应用非常广泛。"
        await generate_summary(transcript, "highlight")

        call_kwargs = mock_litellm_summary.call_args.kwargs
        messages = call_kwargs["messages"]
        # Should have system + user messages
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        # User message should contain the transcript
        assert transcript in messages[1]["content"]

    async def test_generate_summary_uses_correct_prompt_per_level(self, mock_litellm_summary):
        """Each summary level should use its corresponding system prompt."""
        transcript = "测试内容"

        for level in ("express", "highlight", "detailed", "full"):
            mock_litellm_summary.reset_mock()
            await generate_summary(transcript, level)

            call_kwargs = mock_litellm_summary.call_args.kwargs
            system_msg = call_kwargs["messages"][0]["content"]
            assert system_msg == LEVEL_PROMPTS[level]

    async def test_generate_summary_returns_content(self, mock_litellm_summary):
        """Verify the function returns the LLM response content."""
        result = await generate_summary("测试字幕", "express")
        assert result == "这是一段测试摘要内容"

    async def test_generate_summary_llm_returns_empty_content(self):
        """LLM returning empty content should not crash."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=""))],
            )
            result = await generate_summary("测试字幕", "express")
            # Should return empty string, not crash
            assert result == ""

    async def test_generate_summary_llm_returns_no_choices(self):
        """LLM returning empty choices list should raise RuntimeError."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.return_value = MagicMock(choices=[])
            with pytest.raises(RuntimeError, match="empty choices"):
                await generate_summary("测试字幕", "express")

    async def test_generate_summary_rate_limit_error(self):
        """RateLimitError from LLM should propagate (litellm handles retries internally)."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = RateLimitError(
                message="Rate limit exceeded",
                llm_provider="openai",
                model="test-model",
            )
            with pytest.raises(RateLimitError):
                await generate_summary("测试字幕", "express")

    async def test_generate_summary_api_connection_error(self):
        """APIConnectionError from LLM should propagate gracefully."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = APIConnectionError(
                message="Connection failed",
                llm_provider="openai",
                model="test-model",
            )
            with pytest.raises(APIConnectionError):
                await generate_summary("测试字幕", "express")

    async def test_summarize_single_respects_semaphore(self, mock_litellm_summary):
        """_summarize_single should call acompletion with timeout and retries."""
        await _summarize_single("内容", "系统提示")

        call_kwargs = mock_litellm_summary.call_args.kwargs
        assert call_kwargs["timeout"] == 180
        assert call_kwargs["num_retries"] == 2


# ===========================================================================
# 2. MindmapService Tests
# ===========================================================================


class TestMindmapService:
    """Tests for mindmap Markdown generation via LLM."""

    async def test_generate_mindmap_calls_llm(self, mock_litellm_mindmap):
        """Verify acompletion is called for mindmap generation."""
        text = "[00:00] 今天我们来讨论人工智能\n[01:30] 首先看深度学习"
        result = await _generate_mindmap_markdown(text)

        mock_litellm_mindmap.assert_called_once()
        assert result == "# 视频主题\n## 分支一\n- 细节"

    async def test_generate_mindmap_uses_correct_prompt(self, mock_litellm_mindmap):
        """System prompt should be the MINDMAP_PROMPT constant."""
        await _generate_mindmap_markdown("测试内容", system_prompt=MINDMAP_PROMPT)

        call_kwargs = mock_litellm_mindmap.call_args.kwargs
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == MINDMAP_PROMPT

    async def test_generate_mindmap_strips_code_fences(self):
        """If LLM wraps output in code fences, they should be stripped."""
        fenced_output = "```markdown\n# 主题\n## 分支\n- 细节\n```"
        with patch("app.services.mindmap_engine.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=fenced_output))],
            )
            result = await _generate_mindmap_markdown("测试")
            # Code fences should be removed
            assert not result.startswith("```")
            assert "# 主题" in result
            assert "## 分支" in result

    async def test_generate_mindmap_valid_markdown_structure(self):
        """Valid mindmap Markdown should have heading hierarchy."""
        valid_md = "# AI 技术概览\n## 深度学习 [00:30]\n### CNN [01:00]\n- 图像识别 [01:15]"
        with patch("app.services.mindmap_engine.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=valid_md))],
            )
            result = await _generate_mindmap_markdown("测试")
            assert result.startswith("# ")
            assert "## " in result

    async def test_generate_mindmap_llm_returns_empty(self):
        """LLM returning empty content should not crash."""
        with patch("app.services.mindmap_engine.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=""))],
            )
            result = await _generate_mindmap_markdown("测试")
            assert result == ""

    async def test_generate_mindmap_llm_error_propagates(self):
        """LLM errors should propagate without being swallowed."""
        with patch("app.services.mindmap_engine.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = APIConnectionError(
                message="Timeout",
                llm_provider="openai",
                model="test-model",
            )
            with pytest.raises(APIConnectionError):
                await _generate_mindmap_markdown("测试")


# ===========================================================================
# 3. VideoService Tests
# ===========================================================================


class TestVideoService:
    """Tests for video URL validation and metadata extraction."""

    def test_validate_url_youtube_standard(self):
        """Standard YouTube URL should be parsed successfully."""
        with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.return_value = {
                "title": "测试视频标题",
                "thumbnail": "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
                "duration": 3661,  # 1:01:01
            }

            result = validate_url("https://www.youtube.com/watch?v=abc123")

            assert result["title"] == "测试视频标题"
            assert result["thumbnail_url"] == "https://i.ytimg.com/vi/abc123/hqdefault.jpg"
            assert result["duration"] == "01:01:01"

    def test_validate_url_youtube_short_duration(self):
        """Short video duration should format correctly."""
        with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.return_value = {
                "title": "短视频",
                "thumbnail": None,
                "duration": 90,  # 1:30
            }

            result = validate_url("https://youtu.be/xyz789")

            assert result["duration"] == "00:01:30"

    def test_validate_url_no_duration(self):
        """Video without duration info should return None for duration."""
        with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.return_value = {
                "title": "直播回放",
                "thumbnail": None,
                "duration": None,
            }

            result = validate_url("https://www.bilibili.com/video/BV1xx411c7mD")

            assert result["title"] == "直播回放"
            assert result["duration"] is None

    def test_validate_url_invalid_raises_value_error(self):
        """Invalid URL should raise ValueError."""
        import yt_dlp as _yt_dlp

        with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.side_effect = _yt_dlp.utils.DownloadError(
                "Unsupported URL"
            )

            with pytest.raises(ValueError, match="Invalid or unsupported"):
                validate_url("https://not-a-video-site.com/page")

    def test_validate_url_returns_none_info_raises(self):
        """If extract_info returns None, should raise ValueError."""
        with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl_cls.return_value.__enter__ = MagicMock(return_value=mock_ydl)
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            mock_ydl.extract_info.return_value = None

            with pytest.raises(ValueError, match="Could not extract"):
                validate_url("https://example.com/video")
