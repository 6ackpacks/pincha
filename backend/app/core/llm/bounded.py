"""Bounded-concurrency LLM helpers for chunked summary pipelines."""
from __future__ import annotations

import asyncio
from typing import AsyncIterator, Callable

from app.core.async_utils import bounded_ordered_map


async def bounded_chunk_summaries(
    chunks: list[tuple[int, str]],
    worker: Callable[[int, str], str],
    *,
    concurrency: int,
) -> AsyncIterator[tuple[int, str]]:
    """Summarize chunks with bounded concurrency, yielding results in order.

    Args:
        chunks: List of (index, chunk_text) tuples.
        worker: Async callable taking (index, chunk_text) returning summary text.
        concurrency: Max concurrent LLM calls.

    Yields:
        (index, summary_text) tuples in input order.
    """
    async def _wrap(idx_text: tuple[int, str]) -> tuple[int, str]:
        idx, text = idx_text
        result = await worker(idx, text)
        return (idx, result)

    async for result in bounded_ordered_map(
        chunks,
        _wrap,
        concurrency=concurrency,
    ):
        yield result
