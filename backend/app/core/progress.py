"""Progress tracking utilities — public interface for reading video/article progress."""

from __future__ import annotations

import json
import logging
import time
from typing import AsyncGenerator, Optional

from typing import Awaitable, Callable

from app.core.redis import get_redis
from app.core.monitoring import has_sentry, capture_exception
from app.services.summary_stream import format_sse, get_buffered_events

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
        logger.warning("[progress] Redis connection failed for get_current_progress(%s): %s", video_id, exc)
    return None


async def sse_progress_stream(
    entity_type: str,
    entity_id: str,
    redis=None,
    resume_seq: int = 0,
    snapshot_loader: Callable[[], Awaitable[Optional[dict]]] | None = None,
) -> AsyncGenerator[str, None]:
    """Enhanced SSE progress stream generator supporting multiple event types.

    Subscribes to multiple Redis channels:
    - {entity_type}:{entity_id}:progress -> progress heartbeat
    - {entity_type}:{entity_id}:events -> subtitle_ready, mindmap_ready, level_ready
    - {entity_type}:{entity_id}:summary_stream -> detailed summary delta streaming
            (dual-written to a Redis buffer list with a monotonic seq, so late /
            reconnecting clients can replay missed deltas)

    Ordering guarantees (fixes the "late subscriber loses deltas" race):
      1. subscribe() to all channels FIRST, so no live event can slip through
         the gap between reading the buffer and subscribing;
      2. replay buffered summary events with seq > resume_seq;
      3. dedup live summary events against a per-seq high-water mark so a buffered
         event and its live duplicate are never sent twice;
      4. emit strictly in seq order for the summary stream.

    Even when the heartbeat already shows a terminal state on connect, buffered
    summary deltas are replayed before closing — a freshly-connecting client must
    not get a blank page. If the buffer has expired but the DB already holds the
    final summary, `snapshot_loader` provides a `snapshot` event so the client
    still receives the final content.

    Args:
        entity_type: "video" or "article"
        entity_id: UUID string of the entity
        redis: An existing async Redis connection (optional; fetched if None)
        resume_seq: replay summary events with seq greater than this (from the
            `after_seq` query param or the `Last-Event-ID` reconnect header,
            whichever is larger)
        snapshot_loader: optional async callable returning the persisted final
            summary as an event dict, used only when the buffer is empty/expired

    Yields:
        SSE-formatted strings. Summary-stream events use the unified protocol
        (id/event/data lines); heartbeat/other events keep their legacy shape.
    """
    if redis is None:
        try:
            redis = await get_redis()
        except Exception as exc:
            logger.warning(
                "[sse:%s:%s] Redis connection failed on stream init: %s",
                entity_type, entity_id, exc,
            )
            if has_sentry():
                capture_exception(exc)
            yield f"data: {json.dumps({'state': 'failed', 'message': 'Redis unavailable'})}\n\n"
            return

    hb_key = f"{entity_type}:{entity_id}:heartbeat"

    # Define all channels to subscribe to
    heartbeat_channel = f"{entity_type}:{entity_id}:progress"
    events_channel = f"{entity_type}:{entity_id}:events"
    summary_channel = f"{entity_type}:{entity_id}:summary_stream"

    # High-water mark for summary-stream dedup (buffer replay <-> live events).
    max_summary_seq = resume_seq

    # 1. Subscribe FIRST so live events published during buffer replay are not
    #    lost in the gap between reading the buffer and subscribing.
    pubsub = redis.pubsub()
    try:
        await pubsub.subscribe(heartbeat_channel, events_channel, summary_channel)
    except Exception as exc:
        logger.warning(
            "[sse:%s:%s] Redis Pub/Sub subscribe failed: %s",
            entity_type, entity_id, exc,
        )
        if has_sentry():
            capture_exception(exc)
        yield f"data: {json.dumps({'state': 'failed', 'message': 'Redis subscribe failed'})}\n\n"
        return

    try:
        # 2. Send the current heartbeat snapshot so the client sees state at once.
        try:
            current = await redis.get(hb_key)
        except Exception as exc:
            logger.warning("[sse:%s:%s] Redis GET failed: %s", entity_type, entity_id, exc)
            current = None

        terminal_state_reached = False
        if current:
            yield f"data: {current}\n\n"
            try:
                hb_data = json.loads(current)
            except (json.JSONDecodeError, TypeError):
                hb_data = {}
            if hb_data.get("state") in ("done", "failed"):
                terminal_state_reached = True

        # 3. Replay buffered summary events (seq > resume_seq), in seq order.
        replayed_any = False
        try:
            buffered = await get_buffered_events(
                entity_id, after_seq=resume_seq, redis=redis
            )
        except Exception as exc:
            logger.warning(
                "[sse:%s:%s] buffer replay failed: %s", entity_type, entity_id, exc
            )
            buffered = []

        for ev in sorted(buffered, key=lambda e: e.get("seq", 0)):
            seq = ev.get("seq", 0)
            if seq <= max_summary_seq:
                continue
            max_summary_seq = seq
            replayed_any = True
            yield format_sse(ev, is_replay=True)

        # 4. Buffer empty/expired but heartbeat already terminal: fall back to
        #    the persisted final summary so the client never sees a blank page.
        if not replayed_any and terminal_state_reached and snapshot_loader is not None:
            try:
                snapshot = await snapshot_loader()
            except Exception as exc:
                logger.warning(
                    "[sse:%s:%s] snapshot load failed: %s",
                    entity_type, entity_id, exc,
                )
                snapshot = None
            if snapshot:
                yield format_sse(snapshot, is_replay=True)

        # If the heartbeat was already terminal, the run is over — close after
        # having replayed history (and/or the snapshot) above.
        if terminal_state_reached:
            return

        # 5. Listen for live messages with a 10-minute deadline.
        deadline = time.monotonic() + 600

        while time.monotonic() < deadline:
            # Use get_message with a short timeout so the deadline is enforced
            # even when no messages arrive (prevents hanging forever).
            message = await pubsub.get_message(
                ignore_subscribe_messages=False, timeout=5.0
            )
            if message is None:
                # No message within 5s — send keepalive comment to detect
                # broken connections and re-check the deadline.
                yield ": keepalive\n\n"
                continue

            if message["type"] == "message":
                try:
                    payload = message["data"]
                    data = json.loads(payload)
                except (json.JSONDecodeError, TypeError, KeyError) as exc:
                    logger.warning("Invalid SSE message for %s:%s: %s", entity_type, entity_id, exc)
                    continue

                # Summary-stream events carry a seq: dedup against replay and
                # emit using the unified protocol (id/event/data).
                if "seq" in data:
                    seq = data.get("seq", 0)
                    if seq <= max_summary_seq:
                        continue  # already replayed from buffer
                    max_summary_seq = seq
                    yield format_sse(data, is_replay=False)
                    if data.get("_terminal") or data.get("event_type") == "done":
                        terminal_state_reached = True
                        break
                    continue

                # Non-summary events (heartbeat / level_ready / etc.) keep their
                # legacy SSE shape.
                event_type = data.get("type", "message")
                yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                if data.get("state") in ("done", "failed"):
                    terminal_state_reached = True
                    break

            elif message["type"] == "subscribe":
                # Send keepalive comment on subscription confirmation
                yield ": keepalive\n\n"

        if not terminal_state_reached:
            logger.debug("SSE stream timeout for %s:%s", entity_type, entity_id)
        else:
            logger.debug("SSE stream ended for %s:%s (terminal state)", entity_type, entity_id)

    except Exception as exc:
        logger.error("SSE stream error for %s:%s: %s", entity_type, entity_id, exc)
        if has_sentry():
            capture_exception(exc)
        raise
    finally:
        await pubsub.unsubscribe(heartbeat_channel, events_channel, summary_channel)
        await pubsub.close()
