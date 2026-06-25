"""Reusable async utilities for bounded concurrency."""
from __future__ import annotations

import asyncio
from typing import AsyncIterator, Callable, TypeVar

T = TypeVar("T")
R = TypeVar("R")


async def bounded_ordered_map(
    iterator: AsyncIterator[T] | list[T],
    worker: Callable[[T], R],
    *,
    concurrency: int,
) -> AsyncIterator[R]:
    """Process items from an iterator with a maximum concurrency bound.

    Maintains input order in output regardless of completion order.
    Consumes one item at a time from the iterator (no full materialization).
    Only holds `concurrency` pending tasks at any time.

    Args:
        iterator: Async or sync iterator yielding items to process.
        worker: Async callable that processes one item.
        concurrency: Max number of concurrent tasks.

    Yields:
        Results in the same order as the input iterator.
    """
    if concurrency < 1:
        concurrency = 1

    queue: asyncio.Queue[tuple[int, T | None]] = asyncio.Queue()
    results: dict[int, R] = {}
    next_index = 0
    done = False

    async def _producer():
        nonlocal done
        idx = 0
        async for item in _ensure_async(iterator):
            await queue.put((idx, item))
            idx += 1
        for _ in range(concurrency):
            await queue.put((None, None))
        done = True

    async def _worker():
        while True:
            idx, item = await queue.get()
            if item is None:
                queue.task_done()
                break
            try:
                result = await worker(item)
                results[idx] = result
            except Exception as e:
                results[idx] = e
            queue.task_done()

    producers = [asyncio.create_task(_producer())]
    workers = [asyncio.create_task(_worker()) for _ in range(concurrency)]
    await asyncio.gather(*producers)
    await queue.join()
    for w in workers:
        w.cancel()

    while next_index in results:
        yield results.pop(next_index)
        next_index += 1


def _ensure_async(iterable):
    """Wrap a sync iterable as async."""
    if hasattr(iterable, "__anext__"):
        return iterable
    async def _sync_wrapper():
        for item in iterable:
            yield item
    return _sync_wrapper()
