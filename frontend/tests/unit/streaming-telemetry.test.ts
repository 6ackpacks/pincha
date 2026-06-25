/**
 * Unit tests for the streaming UI telemetry module (PR1).
 *
 * Covers the public API surface used by SummaryPanel / useVideoPageData:
 *   trackStreamingUIEvent / getStreamingTelemetryBuffer / clearStreamingTelemetryBuffer
 *   recordStreamingMetric / getStreamingMetrics / clearStreamingMetrics
 *   setStreamingTelemetrySink / resetStreamingTelemetrySink
 *   getUiSessionId / createGenerationId / nowMs / STREAMING_THRESHOLDS
 *   startLongTaskObserver (jsdom safe-degrade)
 *
 * Sampling note: info-severity events are sampled per-generation in production.
 * We force `NEXT_PUBLIC_STREAMING_DEBUG="true"` (set BEFORE the dynamic import so
 * the module-level DEBUG_ENABLED const captures it) → all events land in the ring
 * buffer, making assertions deterministic. Warning events always record regardless.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// Must be set before the module is first loaded (DEBUG_ENABLED is a load-time const).
process.env.NEXT_PUBLIC_STREAMING_DEBUG = "true";

type Telemetry = typeof import("@/lib/streaming-telemetry");
let T: Telemetry;

beforeAll(async () => {
  T = await import("@/lib/streaming-telemetry");
});

beforeEach(() => {
  T.clearStreamingTelemetryBuffer();
  T.clearStreamingMetrics();
  T.resetStreamingTelemetrySink();
});

describe("streaming-telemetry: ring buffer", () => {
  it("records an event and reads it back via the buffer", () => {
    T.trackStreamingUIEvent({
      event_type: "stream_delta_received",
      video_id: "v1",
      generation_id: "g1",
      content_length: 5,
    });
    const all = T.getStreamingTelemetryBuffer();
    expect(all).toHaveLength(1);
    expect(all[0].event_type).toBe("stream_delta_received");
    // ui_session_id auto-filled from module session, timestamp + severity added.
    expect(all[0].ui_session_id).toBe(T.getUiSessionId());
    expect(typeof all[0].timestamp).toBe("number");
    expect(all[0].severity).toBe("info");
  });

  it("filters the buffer by video_id / generation_id / event_type / severity", () => {
    T.trackStreamingUIEvent({ event_type: "sse_open", video_id: "v1", generation_id: "gA" });
    T.trackStreamingUIEvent({ event_type: "sse_open", video_id: "v2", generation_id: "gB" });
    T.trackStreamingUIEvent({ event_type: "summary_content_became_empty", video_id: "v1", generation_id: "gA" });

    expect(T.getStreamingTelemetryBuffer({ video_id: "v1" })).toHaveLength(2);
    expect(T.getStreamingTelemetryBuffer({ generation_id: "gB" })).toHaveLength(1);
    expect(T.getStreamingTelemetryBuffer({ event_type: "sse_open" })).toHaveLength(2);
    expect(T.getStreamingTelemetryBuffer({ severity: "warning" })).toHaveLength(1);
  });

  it("clearStreamingTelemetryBuffer empties the buffer", () => {
    T.trackStreamingUIEvent({ event_type: "sse_open", video_id: "v1", generation_id: "g1" });
    expect(T.getStreamingTelemetryBuffer()).toHaveLength(1);
    T.clearStreamingTelemetryBuffer();
    expect(T.getStreamingTelemetryBuffer()).toHaveLength(0);
  });

  it("getStreamingTelemetryBuffer returns a copy (mutating it does not corrupt internal state)", () => {
    T.trackStreamingUIEvent({ event_type: "sse_open", video_id: "v1", generation_id: "g1" });
    const snap = T.getStreamingTelemetryBuffer();
    snap.pop();
    expect(T.getStreamingTelemetryBuffer()).toHaveLength(1);
  });
});

describe("streaming-telemetry: severity resolution", () => {
  it("auto-classifies flicker/anomaly events as warning", () => {
    const warnTypes = [
      "summary_content_became_empty",
      "delta_to_paint_slow",
      "ui_long_task",
      "stream_finalize_skipped_duplicate",
    ] as const;
    for (const t of warnTypes) {
      T.trackStreamingUIEvent({ event_type: t, video_id: "v1", generation_id: "g1" });
    }
    const warnings = T.getStreamingTelemetryBuffer({ severity: "warning" });
    expect(warnings).toHaveLength(warnTypes.length);
  });

  it("keeps normal lifecycle events as info", () => {
    T.trackStreamingUIEvent({ event_type: "stream_finalize_started", video_id: "v1", generation_id: "g1" });
    expect(T.getStreamingTelemetryBuffer({ severity: "info" })).toHaveLength(1);
  });
});

describe("streaming-telemetry: pluggable sink", () => {
  it("forwards events to a custom sink while still writing the ring buffer", () => {
    const sink = vi.fn();
    T.setStreamingTelemetrySink(sink);
    T.trackStreamingUIEvent({ event_type: "sse_open", video_id: "v1", generation_id: "g1" });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].event_type).toBe("sse_open");
    // Ring buffer is independent of the sink.
    expect(T.getStreamingTelemetryBuffer()).toHaveLength(1);
  });

  it("a throwing sink does not break the main flow nor the buffer write", () => {
    T.setStreamingTelemetrySink(() => {
      throw new Error("sink boom");
    });
    expect(() =>
      T.trackStreamingUIEvent({ event_type: "sse_open", video_id: "v1", generation_id: "g1" }),
    ).not.toThrow();
    expect(T.getStreamingTelemetryBuffer()).toHaveLength(1);
  });

  it("resetStreamingTelemetrySink detaches the custom sink", () => {
    const sink = vi.fn();
    T.setStreamingTelemetrySink(sink);
    T.resetStreamingTelemetrySink();
    T.trackStreamingUIEvent({ event_type: "sse_open", video_id: "v1", generation_id: "g1" });
    expect(sink).not.toHaveBeenCalled();
  });
});

describe("streaming-telemetry: per-generation metrics", () => {
  it("returns undefined for an unknown generation", () => {
    expect(T.getStreamingMetrics("missing")).toBeUndefined();
  });

  it("first_delta_latency_ms / finalize_to_stable_ms keep only the first value", () => {
    T.recordStreamingMetric("g1", "first_delta_latency_ms", 120);
    T.recordStreamingMetric("g1", "first_delta_latency_ms", 999);
    T.recordStreamingMetric("g1", "finalize_to_stable_ms", 30);
    T.recordStreamingMetric("g1", "finalize_to_stable_ms", 88);
    const m = T.getStreamingMetrics("g1")!;
    expect(m.first_delta_latency_ms).toBe(120);
    expect(m.finalize_to_stable_ms).toBe(30);
  });

  it("delta_to_paint_ms tracks latest value and maintains the peak", () => {
    T.recordStreamingMetric("g1", "delta_to_paint_ms", 40);
    T.recordStreamingMetric("g1", "delta_to_paint_ms", 220);
    T.recordStreamingMetric("g1", "delta_to_paint_ms", 90);
    const m = T.getStreamingMetrics("g1")!;
    expect(m.delta_to_paint_ms).toBe(90);
    expect(m.delta_to_paint_ms_max).toBe(220);
  });

  it("render_count_during_stream and sse_reconnect_count accumulate", () => {
    for (let i = 0; i < 5; i++) T.recordStreamingMetric("g1", "render_count_during_stream", 1);
    T.recordStreamingMetric("g1", "sse_reconnect_count", 1);
    T.recordStreamingMetric("g1", "sse_reconnect_count", 1);
    const m = T.getStreamingMetrics("g1")!;
    expect(m.render_count_during_stream).toBe(5);
    expect(m.sse_reconnect_count).toBe(2);
  });

  it("long_task_duration_ms accumulates total and maintains the peak", () => {
    T.recordStreamingMetric("g1", "long_task_duration_ms", 150);
    T.recordStreamingMetric("g1", "long_task_duration_ms", 110);
    const m = T.getStreamingMetrics("g1")!;
    expect(m.long_task_duration_ms_total).toBe(260);
    expect(m.long_task_duration_ms_max).toBe(150);
  });

  it("getStreamingMetrics returns a copy (cannot mutate internal state)", () => {
    T.recordStreamingMetric("g1", "render_count_during_stream", 1);
    const m = T.getStreamingMetrics("g1")!;
    m.render_count_during_stream = 999;
    expect(T.getStreamingMetrics("g1")!.render_count_during_stream).toBe(1);
  });

  it("clearStreamingMetrics removes all generations", () => {
    T.recordStreamingMetric("g1", "render_count_during_stream", 1);
    T.clearStreamingMetrics();
    expect(T.getStreamingMetrics("g1")).toBeUndefined();
  });
});

describe("streaming-telemetry: ids, clock, thresholds", () => {
  it("getUiSessionId is stable across calls", () => {
    expect(T.getUiSessionId()).toBe(T.getUiSessionId());
  });

  it("createGenerationId produces unique ids", () => {
    const a = T.createGenerationId();
    const b = T.createGenerationId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("nowMs returns a monotonic-ish number", () => {
    const a = T.nowMs();
    const b = T.nowMs();
    expect(typeof a).toBe("number");
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it("exposes the documented thresholds", () => {
    expect(T.STREAMING_THRESHOLDS.DELTA_TO_PAINT_MS).toBe(200);
    expect(T.STREAMING_THRESHOLDS.LONG_TASK_MS).toBe(100);
  });
});

describe("streaming-telemetry: long task observer (jsdom degrade)", () => {
  // jsdom has no PerformanceObserver 'longtask' entryType. The observer is a
  // documented safe no-op there; we assert it returns a callable cleanup that
  // never throws. The ui_long_task EVENT PATH itself is exercised below by
  // driving the same code the observer would run (recordMetric + trackEvent).
  it("startLongTaskObserver degrades to a no-op cleanup under jsdom", () => {
    const cleanup = T.startLongTaskObserver(() => ({
      video_id: "v1",
      generation_id: "g1",
      ui_session_id: T.getUiSessionId(),
      active_level: "detailed",
    }));
    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
  });

  it("ui_long_task event path: track event (warning) + accumulate duration metric", () => {
    // Simulates exactly what startLongTaskObserver does on a >100ms longtask
    // entry, since jsdom cannot emit a real longtask PerformanceEntry.
    const duration = 150;
    T.recordStreamingMetric("g1", "long_task_duration_ms", duration);
    T.trackStreamingUIEvent({
      event_type: "ui_long_task",
      video_id: "v1",
      generation_id: "g1",
      active_level: "detailed",
      reason: `long_task ${duration}ms`,
    });
    const events = T.getStreamingTelemetryBuffer({ event_type: "ui_long_task" });
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe("warning");
    expect(T.getStreamingMetrics("g1")!.long_task_duration_ms_max).toBe(150);
  });
});
