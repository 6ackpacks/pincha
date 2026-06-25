"""统一 LLM Client — 使用 OpenAI SDK 替代 litellm。

使用 openai.AsyncOpenAI 直接调用 OpenAI-compatible 网关（支持 DashScope 等）。
"""
from __future__ import annotations

import logging
import time
from typing import Any, AsyncGenerator

import httpx
from openai import AsyncOpenAI
from openai._exceptions import APIStatusError

from app.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class LLMError(Exception):
    """Base exception for all LLM errors."""
    pass


class LLMConnectionError(LLMError):
    """Failed to connect to LLM gateway."""
    pass


class LLMRateLimitError(LLMError):
    """Rate limit hit on LLM gateway."""
    pass


class LLMStreamInterruptedError(LLMError):
    """Streaming interrupted (connection drop, timeout, etc)."""
    pass


class LLMValidationError(LLMError):
    """Invalid request parameters."""
    pass


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

def _map_exception(exc: BaseException) -> LLMError:
    """Map upstream exceptions to LLMClient exception hierarchy."""
    if isinstance(exc, httpx.TimeoutException):
        return LLMConnectionError(f"LLM gateway timeout: {exc}")
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code == 429:
            return LLMRateLimitError(f"Rate limited: {exc}")
        return LLMConnectionError(f"HTTP {exc.response.status_code}: {exc}")
    if isinstance(exc, APIStatusError):
        if exc.status_code == 429:
            return LLMRateLimitError(f"Rate limited: {exc}")
        return LLMError(f"OpenAI API error {exc.status_code}: {exc}")
    if isinstance(exc, (LLMError, LLMConnectionError, LLMRateLimitError,
                         LLMStreamInterruptedError, LLMValidationError)):
        return exc
    return LLMError(str(exc))


class LLMClient:
    """Thin LLM client using openai.AsyncOpenAI.

    Wraps the OpenAI-compatible gateway (DashScope, Tokendance, etc.)
    with unified exception handling and streaming support.
    """

    def __init__(
        self,
        model: str | None = None,
        api_base: str | None = None,
        api_key: str | None = None,
        timeout: int = 180,
        max_retries: int = 2,
    ):
        self.model = model or settings.SUMMARY_MODEL
        self.api_base = api_base or settings.SUMMARY_API_BASE or None
        self.api_key = api_key or settings.OPENAI_API_KEY or None
        self.timeout = timeout
        self.max_retries = max_retries
        self._client: AsyncOpenAI | None = None

    @property
    def client(self) -> AsyncOpenAI:
        if self._client is None:
            kwargs: dict[str, Any] = {
                "api_key": self.api_key,
                "timeout": self.timeout,
                "max_retries": self.max_retries,
            }
            if self.api_base:
                kwargs["base_url"] = self.api_base
            self._client = AsyncOpenAI(**kwargs)
        return self._client

    @staticmethod
    def _strip_model_prefix(model: str) -> str:
        """Strip 'openai/' prefix from model name for OpenAI-compatible gateways."""
        if model.startswith("openai/"):
            return model[len("openai/"):]
        return model

    async def complete(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> str:
        """Call LLM and return the complete text response.

        Args:
            messages: [{"role": "system|user|assistant", "content": "..."}]
            model: Override default model.
            temperature: Sampling temperature.
            max_tokens: Max output tokens.
            response_format: e.g. {"type": "json_object"}
            **kwargs: Extra args passed to chat.completions.create.
        """
        try:
            create_kwargs: dict[str, Any] = {
                "model": self._strip_model_prefix(model or self.model),
                "messages": messages,
                **kwargs,
            }
            if temperature is not None:
                create_kwargs["temperature"] = temperature
            if max_tokens is not None:
                create_kwargs["max_tokens"] = max_tokens
            if response_format is not None:
                create_kwargs["response_format"] = response_format

            response = await self.client.chat.completions.create(**create_kwargs)

            if not response.choices:
                raise LLMError("LLM returned empty choices")

            content = response.choices[0].message.content
            return content or ""

        except BaseException as exc:
            raise _map_exception(exc) from exc

    async def stream(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream LLM response, yielding each delta content.

        Args:
            messages: [{"role": "system|user|assistant", "content": "..."}]
            model: Override default model.
            temperature: Sampling temperature.
            max_tokens: Max output tokens.
            **kwargs: Extra args passed to chat.completions.create.
        """
        try:
            create_kwargs: dict[str, Any] = {
                "model": self._strip_model_prefix(model or self.model),
                "messages": messages,
                "stream": True,
                **kwargs,
            }
            if temperature is not None:
                create_kwargs["temperature"] = temperature
            if max_tokens is not None:
                create_kwargs["max_tokens"] = max_tokens

            response = await self.client.chat.completions.create(**create_kwargs)

            async for chunk in response:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                content = getattr(delta, "content", None)
                if content:
                    yield content

        except BaseException as exc:
            raise _map_exception(exc) from exc


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_client: LLMClient | None = None


def llm_client() -> LLMClient:
    """Return the module-level LLM client singleton."""
    global _client
    if _client is None:
        _client = LLMClient(
            model=settings.SUMMARY_MODEL,
            api_base=settings.SUMMARY_API_BASE,
            api_key=settings.OPENAI_API_KEY,
            timeout=180,
            max_retries=2,
        )
    return _client
