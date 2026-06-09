"""Progress tracking utilities — public interface for reading video/article progress."""

from __future__ import annotations

import json
import logging
import time
from typing import AsyncGenerator, Optional

from app.core.redis import get_redis

logger = logging.getLogger(__name__)

HEARTBEAT_KEY_PREFIX = "video:"
HEARTBEAT_KEY_SUFFIX = ":heartbeat"


def heartbeat_key(video_id: str) -> str:
    return f"{HEARTBEAT_KEY_PREFIX}{video_id}{HEARTBEAT_KEY_SUFFIX}"


async def get_current_progress(video_id: str) -> Optional[dict]:
    """Read current heartbeat progress from Redis. Returns None if not found."""
    try:
        redis = await get_redis()
        raw = await redis.get(heartbeat_key(video_id))
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.debug("get_current_progress failed for %s: %s", video_id, exc)
    return None


async def sse_progress_stream(
    entity_type: str, entity_id: str, redis=None
) -> AsyncGenerator[str, None]:
    """Enhanced SSE progress stream generator supporting multiple event types.

    Subscribes to multiple Redis channels:
    - {entity_type}:{entity_id}:heartbeat → progress heartbeat
    - {entity_type}:{entity_id}:events → subtitle_ready, mindmap_ready, level_ready
    - {entity_type}:{entity_id}:summary:detailed → detailed summary delta streaming

    Reads the current heartbeat, then subscribes to all Pub/Sub channels and
    yields SSE-formatted strings until a terminal state (done/failed) is
    reached or a 10-minute timeout expires.

    Args:
        entity_type: "video" or "article"
        entity_id: UUID string of the entity
        redis: An existing async Redis connection (optional; fetched if None)

    Yields:
        SSE-formatted strings with event type and data:
        - event: {type}
        - data: {json_payload}
    """
    if redis is None:
        redis = await get_redis()

    hb_key = f"{entity_type}:{entity_id}:heartbeat"

    # Define all channels to subscribe to
    heartbeat_channel = f"{entity_type}:{entity_id}:progress"
    events_channel = f"{entity_type}:{entity_id}:events"
    summary_channel = f"{entity_type}:{entity_id}:summary:detailed"

    # 1. Send current state immediately so the client doesn't wait for the first publish
    current = await redis.get(hb_key)
    if current:
        yield f"data: {current}\n\n"
        data = json.loads(current)
        if data.get("state") in ("done", "failed"):
            return

    # 2. Subscribe to all Pub/Sub channels
    pubsub = redis.pubsub()
    await pubsub.subscribe(heartbeat_channel, events_channel, summary_channel)

    try:
        # 3. Listen for messages with a 10-minute deadline
        deadline = time.monotonic() + 600
        terminal_state_reached = False

        async for message in pubsub.listen():
            if time.monotonic() > deadline:
                logger.debug("SSE stream timeout for %s:%s", entity_type, entity_id)
                break

            if message["type"] == "message":
                try:
                    payload = message["data"]
                    data = json.loads(payload)

                    # Extract event type from payload, default to "message"
                    event_type = data.get("type", "message")

                    # Format as SSE with event type
                    yield f"event: {event_type}\n"
                    yield f"data: {json.dumps(data)}\n\n"

                    # Check for terminal state in heartbeat messages
                    if data.get("state") in ("done", "failed"):
                        terminal_state_reached = True
                        break

                except (json.JSONDecodeError, KeyError) as exc:
                    logger.warning("Invalid SSE message for %s:%s: %s", entity_type, entity_id, exc)
                    continue

            elif message["type"] == "subscribe":
                # Send keepalive comment on subscription confirmation
                yield ": keepalive\n\n"

        if terminal_state_reached:
            logger.debug("SSE stream ended for %s:%s (terminal state)", entity_type, entity_id)

    except Exception as exc:
        logger.error("SSE stream error for %s:%s: %s", entity_type, entity_id, exc)
        raise
    finally:
        await pubsub.unsubscribe(heartbeat_channel, events_channel, summary_channel)
        await pubsub.close()
