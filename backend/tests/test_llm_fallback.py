"""LLM 服务降级与错误处理测试.

验证 litellm 调用在各种失败场景下的行为：
- 异常正确传播（由上层 Celery 重试机制处理）
- 空响应/畸形响应的防御处理
- 流式响应中断
"""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

import litellm

from app.services.summary_service import (
    _summarize_single,
    generate_summary,
    stream_generate_summary,
)


class TestLLMFallback:
    """LLM 服务降级与错误处理."""

    async def test_rate_limit_raises_cleanly(self):
        """429 RateLimitError 正确传播（由 Celery 重试处理）."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = litellm.RateLimitError(
                message="Rate limit exceeded",
                model="deepseek-chat",
                llm_provider="deepseek",
            )
            with pytest.raises(litellm.RateLimitError, match="Rate limit exceeded"):
                await _summarize_single("test transcript", "test prompt")

    async def test_api_connection_error_propagates(self):
        """APIConnectionError 正确传播."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = litellm.APIConnectionError(
                message="Connection refused",
                model="deepseek-chat",
                llm_provider="deepseek",
            )
            with pytest.raises(litellm.APIConnectionError, match="Connection refused"):
                await _summarize_single("test transcript", "test prompt")

    async def test_timeout_error_propagates(self):
        """Timeout 超时正确传播."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = litellm.Timeout(
                message="Request timed out",
                model="deepseek-chat",
                llm_provider="deepseek",
            )
            with pytest.raises(litellm.Timeout, match="Request timed out"):
                await _summarize_single("test transcript", "test prompt")

    async def test_empty_response_raises_runtime_error(self):
        """LLM 返回空 choices -> RuntimeError."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            # Simulate response with empty choices list
            mock_response = MagicMock()
            mock_response.choices = []
            mock.return_value = mock_response

            with pytest.raises(RuntimeError, match="empty choices"):
                await _summarize_single("test transcript", "test prompt")

    async def test_malformed_content_still_returns(self):
        """LLM 返回非预期格式内容 -> 仍然返回（不崩溃）."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            # Simulate response with unexpected content (random garbage)
            mock_response = MagicMock()
            mock_choice = MagicMock()
            mock_choice.message.content = "!@#$%^&*() random garbage 乱码"
            mock_response.choices = [mock_choice]
            mock.return_value = mock_response

            result = await _summarize_single("test transcript", "test prompt")
            # Should return the content as-is without crashing
            assert result == "!@#$%^&*() random garbage 乱码"

    async def test_stream_interruption_handling(self):
        """流式响应中断的处理."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            # Create an async generator that yields some chunks then raises
            async def _interrupted_stream():
                # Yield a few valid chunks
                for text in ["Hello", " world"]:
                    chunk = MagicMock()
                    chunk.choices = [MagicMock()]
                    chunk.choices[0].delta.content = text
                    yield chunk
                # Then simulate a connection drop
                raise litellm.APIConnectionError(
                    message="Stream interrupted",
                    model="deepseek-chat",
                    llm_provider="deepseek",
                )

            mock.return_value = _interrupted_stream()

            # stream_generate_summary is an async generator
            collected = []
            with pytest.raises(litellm.APIConnectionError, match="Stream interrupted"):
                async for delta in stream_generate_summary("short text", "express"):
                    collected.append(delta)

            # Should have received partial content before the error
            assert collected == ["Hello", " world"]

    async def test_multiple_consecutive_failures(self):
        """连续多次失败的行为 - 每次调用都独立传播异常."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = litellm.RateLimitError(
                message="Rate limit exceeded",
                model="deepseek-chat",
                llm_provider="deepseek",
            )

            # Each call should independently raise
            for _ in range(3):
                with pytest.raises(litellm.RateLimitError):
                    await _summarize_single("test transcript", "test prompt")

            assert mock.call_count == 3

    async def test_generate_summary_propagates_llm_errors(self):
        """generate_summary 高层函数也正确传播 LLM 错误."""
        with patch("app.services.summary_service.litellm.acompletion", new_callable=AsyncMock) as mock:
            mock.side_effect = litellm.RateLimitError(
                message="Rate limit exceeded",
                model="deepseek-chat",
                llm_provider="deepseek",
            )
            with pytest.raises(litellm.RateLimitError):
                await generate_summary("some transcript text", "express")
