"""Tests for unified LLM client (app/core/llm/) and litellm-free import guarantee."""
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestLLMClientModule:
    def test_llm_client_importable(self):
        """LLM client module must be importable without litellm."""
        from app.core.llm import llm_client, LLMClient, LLMError
        assert callable(llm_client)
        assert LLMClient is not None

    def test_llm_client_exception_hierarchy(self):
        """Exceptions must form correct hierarchy."""
        from app.core.llm import (
            LLMError, LLMConnectionError, LLMRateLimitError,
            LLMStreamInterruptedError, LLMValidationError,
        )
        assert issubclass(LLMConnectionError, LLMError)
        assert issubclass(LLMRateLimitError, LLMError)
        assert issubclass(LLMStreamInterruptedError, LLMError)
        assert issubclass(LLMValidationError, LLMError)

    @pytest.mark.asyncio
    async def test_complete_returns_str(self):
        """LLMClient.complete must return string."""
        from app.core.llm import LLMClient

        mock_choice = MagicMock()
        mock_choice.message.content = "test summary"
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]

        with patch("app.core.llm.client.AsyncOpenAI") as MockOpenAI:
            instance = MockOpenAI.return_value
            instance.chat.completions.create = AsyncMock(return_value=mock_response)

            client = LLMClient(model="test", api_base="http://test", api_key="test")
            result = await client.complete(messages=[{"role": "user", "content": "hi"}])
            assert isinstance(result, str)
            assert result == "test summary"

    @pytest.mark.asyncio
    async def test_stream_yields_str(self):
        """LLMClient.stream must yield strings."""
        from app.core.llm import LLMClient

        async def mock_stream():
            for word in ["hello", " world"]:
                chunk = MagicMock()
                choice = MagicMock()
                choice.delta.content = word
                chunk.choices = [choice]
                yield chunk

        with patch("app.core.llm.client.AsyncOpenAI") as MockOpenAI:
            instance = MockOpenAI.return_value
            instance.chat.completions.create = AsyncMock(return_value=mock_stream())

            client = LLMClient(model="test", api_base="http://test", api_key="test")
            deltas = []
            async for delta in client.stream(messages=[{"role": "user", "content": "hi"}]):
                deltas.append(delta)
            assert deltas == ["hello", " world"]

    @pytest.mark.asyncio
    async def test_timeout_exception_mapped(self):
        """httpx.TimeoutException must map to LLMConnectionError."""
        import httpx
        from app.core.llm import LLMClient, LLMConnectionError

        with patch("app.core.llm.client.AsyncOpenAI") as MockOpenAI:
            instance = MockOpenAI.return_value
            instance.chat.completions.create = AsyncMock(
                side_effect=httpx.TimeoutException("timeout")
            )

            client = LLMClient(model="test", api_base="http://test", api_key="test")
            with pytest.raises(LLMConnectionError):
                await client.complete(messages=[{"role": "user", "content": "hi"}])

    @pytest.mark.asyncio
    async def test_rate_limit_mapped(self):
        """HTTP 429 must map to LLMRateLimitError."""
        import httpx
        from app.core.llm import LLMClient, LLMRateLimitError

        response = MagicMock()
        response.status_code = 429
        exc = httpx.HTTPStatusError("rate limited", request=MagicMock(), response=response)

        with patch("app.core.llm.client.AsyncOpenAI") as MockOpenAI:
            instance = MockOpenAI.return_value
            instance.chat.completions.create = AsyncMock(side_effect=exc)

            client = LLMClient(model="test", api_base="http://test", api_key="test")
            with pytest.raises(LLMRateLimitError):
                await client.complete(messages=[{"role": "user", "content": "hi"}])

    @pytest.mark.asyncio
    async def test_empty_choices_returns_empty_str(self):
        """Empty choices must return empty string."""
        from app.core.llm import LLMClient, LLMError

        mock_response = MagicMock()
        mock_response.choices = []

        with patch("app.core.llm.client.AsyncOpenAI") as MockOpenAI:
            instance = MockOpenAI.return_value
            instance.chat.completions.create = AsyncMock(return_value=mock_response)

            client = LLMClient(model="test", api_base="http://test", api_key="test")
            result = await client.complete(messages=[{"role": "user", "content": "hi"}])
            assert result == ""


class TestNoLitellmResidual:
    def test_no_litellm_in_core_llm(self):
        """core/llm module must not transitively import litellm."""
        # Clear cached imports
        mods_to_remove = [k for k in list(sys.modules.keys())
                         if 'litellm' in k or (k.startswith('app.') and 'core.llm' not in k)]
        for m in mods_to_remove:
            del sys.modules[m]

        from app.core import llm as llm_module
        litellm_mods = [k for k in sys.modules if 'litellm' in k]
        assert not litellm_mods, f"litellm loaded in core/llm: {litellm_mods}"


class TestLLMConcurrencyPreserved:
    def test_entrypoint_llm_concurrency_not_changed(self):
        """entrypoint.sh llm worker must NOT be hardcoded to -c 1 without env var."""
        import os
        import re

        entrypoint = os.path.join(
            os.path.dirname(__file__),
            "..", "..",
            "backend", "entrypoint.sh"
        )
        entrypoint = os.path.normpath(entrypoint)

        if os.path.exists(entrypoint):
            with open(entrypoint) as f:
                content = f.read()

            llm_lines = [
                line for line in content.split('\n')
                if 'WORKER_ROLE=llm' in line and 'celery' in line and 'worker' in line
            ]

            for line in llm_lines:
                if re.search(r'-c\s+1\b', line) and 'LLM_WORKER_CONCURRENCY' not in line:
                    pytest.fail(f"llm worker hardcoded to -c 1 without env var: {line.strip()}")
