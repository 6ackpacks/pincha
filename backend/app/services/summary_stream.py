"""Summary streaming helpers — publish + buffer for reliable SSE delivery.

Core concept: every event is dual-written to both Redis Pub/Sub (for
real-time subscribers) and a Redis List (for late-connecting clients
to replay missed events). A monotonic sequence number enables dedup.
"""

import json
import logging

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

STREAM_BUFFER_TTL = 600  # 10 minutes


def _get_stream_redis() -> aioredis.Redis:
    pool = aioredis.ConnectionPool.from_url(
        settings.REDIS_URL, decode_responses=True, max_connections=5,
    )
    return aioredis.Redis(connection_pool=pool)


def _channel_key(video_id: str) -> str:
    return f"video:{video_id}:summary_stream"


def _buffer_key(video_id: str) -> str:
    return f"video:{video_id}:summary_buffer"


def _seq_key(video_id: str) -> str:
    return f"video:{video_id}:summary_seq"


# Event types that participate in the streaming summary protocol.
STREAMING_EVENT_TYPES = {"delta", "snapshot", "reset", "done", "failed"}


def _normalize_event(
    video_id: str, event: dict, generation_id: str | None,
) -> dict:
    """Augment an event in place with the unified summary-stream protocol fields.

    Legacy fields (type / level / delta) are preserved for backward
    compatibility with the existing /summary/stream consumer; the new fields
    (event_type / summary_level / content / generation_id / video_id) are
    derived from them when not explicitly provided.
    """
    event.setdefault("video_id", str(video_id))
    if generation_id is not None:
        event.setdefault("generation_id", generation_id)
    else:
        event.setdefault("generation_id", None)
    if "event_type" not in event:
        # Map the legacy "type" field; default to "message" for unknown events.
        event["event_type"] = event.get("type", "message")
    if "summary_level" not in event and "level" in event:
        event["summary_level"] = event["level"]
    if "content" not in event and "delta" in event:
        event["content"] = event["delta"]

    # Backfill legacy aliases so the existing /summary/stream consumer (which
    # reads `type` / `level` / `delta` off the same channel + buffer) keeps
    # working while new consumers use event_type / summary_level / content.
    if "type" not in event:
        event["type"] = event["event_type"]
    if "level" not in event and "summary_level" in event:
        event["level"] = event["summary_level"]
    if "delta" not in event and event.get("event_type") == "delta" and "content" in event:
        event["delta"] = event["content"]
    return event


def format_sse(event: dict, *, is_replay: bool = False) -> str:
    """Format a single event as an SSE frame: id / event / data lines.

    Emitting an `id:` line lets native EventSource resend it as the
    `Last-Event-ID` header on automatic reconnect. `is_replay` is stamped at
    emit time (not stored) so the same buffered payload can be sent as either
    a replayed or a live event.
    """
    event["is_replay"] = is_replay
    event_type = event.get("event_type") or event.get("type") or "message"
    seq = event.get("seq")
    lines: list[str] = []
    if seq is not None:
        lines.append(f"id: {seq}")
    lines.append(f"event: {event_type}")
    lines.append(f"data: {json.dumps(event, ensure_ascii=False)}")
    return "\n".join(lines) + "\n\n"


async def publish_summary_event(
    redis: aioredis.Redis,
    video_id: str,
    event: dict,
    generation_id: str | None = None,
) -> None:
    """Dual-write event to Pub/Sub + buffer list with monotonic seq.

    NOTE on seq/generation_id key design (minimal-change tradeoff):
    the seq counter, buffer list and channel remain keyed by `video_id`
    only (not video_id+generation_id). Each event instead carries a
    `generation_id` field so consumers can filter out deltas from a stale
    generation (e.g. after regenerate). This avoids touching the channel
    name (which the SSE subscribers hard-code) while still preventing one
    round's content from being rendered into the next. seq stays globally
    monotonic per video, which keeps replay dedup trivial.
    """
    channel = _channel_key(video_id)
    buffer_key = _buffer_key(video_id)
    seq_key = _seq_key(video_id)

    seq = await redis.incr(seq_key)
    event["seq"] = seq
    _normalize_event(video_id, event, generation_id)

    payload = json.dumps(event, ensure_ascii=False)

    pipe = redis.pipeline(transaction=False)
    pipe.publish(channel, payload)
    pipe.rpush(buffer_key, payload)
    pipe.expire(buffer_key, STREAM_BUFFER_TTL)
    pipe.expire(seq_key, STREAM_BUFFER_TTL)
    await pipe.execute()


async def publish_terminal_event(
    redis: aioredis.Redis,
    video_id: str,
    event: dict,
    generation_id: str | None = None,
) -> None:
    """Publish a terminal event (done/failed) and mark buffer as complete."""
    event["_terminal"] = True
    await publish_summary_event(redis, video_id, event, generation_id)


async def get_buffered_events(
    video_id: str,
    after_seq: int = 0,
    redis: aioredis.Redis | None = None,
) -> list[dict]:
    """Read all buffered events with seq > after_seq for replay."""
    own_redis = redis is None
    if own_redis:
        redis = _get_stream_redis()

    try:
        buffer_key = _buffer_key(video_id)
        raw_list = await redis.lrange(buffer_key, 0, -1)

        events = []
        for raw in raw_list:
            try:
                ev = json.loads(raw)
                if ev.get("seq", 0) > after_seq:
                    events.append(ev)
            except (json.JSONDecodeError, TypeError):
                continue
        return events
    finally:
        if own_redis:
            await redis.close()


async def clear_buffer(video_id: str) -> None:
    """Clean up buffer after stream is fully consumed."""
    redis = _get_stream_redis()
    try:
        pipe = redis.pipeline(transaction=False)
        pipe.delete(_buffer_key(video_id))
        pipe.delete(_seq_key(video_id))
        await pipe.execute()
    finally:
        await redis.close()
