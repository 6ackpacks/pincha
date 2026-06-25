/**
 * Unit tests for useVideoPageData finalize / idempotency behavior (PR1).
 *
 * Strategy: mock `@/lib/api/videos` so `subscribeVideoSSE` captures the callback
 * bag instead of opening a real EventSource. The test then drives the SSE event
 * sequence by hand (onProgress / onDelta / onDone / onConnectionStateChange) and
 * asserts on telemetry buffer + queryClient spies.
 *
 * Telemetry: NEXT_PUBLIC_STREAMING_DEBUG="true" is set before importing the
 * telemetry module so every event lands in the ring buffer (no info sampling).
 *
 * Covers verifications: 2, 3, 7, 9, 12 (and supports 1/4/6 via the hook side).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

process.env.NEXT_PUBLIC_STREAMING_DEBUG = "true";

// --- Mock next/navigation (useRouter) -------------------------------------
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// --- Mock the videos API module -------------------------------------------
// subscribeVideoSSE captures the callback bag for manual driving.
import type { VideoSSECallbacks } from "@/lib/api/videos";

let capturedCallbacks: VideoSSECallbacks | null = null;
const sseCleanup = vi.fn();
const getVideoMock = vi.fn();
const getVideoProgressMock = vi.fn();
const getTranscriptMock = vi.fn();
const getMindmapMock = vi.fn();
const reprocessVideoMock = vi.fn();
const deleteVideoMock = vi.fn();
const subscribeVideoSSEMock = vi.fn((_videoId: string, callbacks: VideoSSECallbacks) => {
  capturedCallbacks = callbacks;
  return sseCleanup;
});

vi.mock("@/lib/api/videos", () => ({
  subscribeVideoSSE: (videoId: string, callbacks: VideoSSECallbacks) =>
    subscribeVideoSSEMock(videoId, callbacks),
  getVideo: (id: string) => getVideoMock(id),
  getVideoProgress: (id: string) => getVideoProgressMock(id),
  getTranscript: (id: string) => getTranscriptMock(id),
  getMindmap: (id: string) => getMindmapMock(id),
  reprocessVideo: (id: string) => reprocessVideoMock(id),
  deleteVideo: (id: string) => deleteVideoMock(id),
}));

type Telemetry = typeof import("@/lib/streaming-telemetry");
let T: Telemetry;
let useVideoPageData: typeof import("@/hooks/use-video-page-data").useVideoPageData;

beforeAll(async () => {
  T = await import("@/lib/streaming-telemetry");
  ({ useVideoPageData } = await import("@/hooks/use-video-page-data"));
});

const VIDEO_ID = "vid-123";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  capturedCallbacks = null;
  sseCleanup.mockClear();
  pushMock.mockClear();
  subscribeVideoSSEMock.mockClear();
  // Resolve queries with benign data so the hook's own useQuery calls settle.
  getVideoMock.mockResolvedValue({
    id: VIDEO_ID,
    url: "https://youtube.com/watch?v=x",
    platform: "youtube",
    title: "T",
    thumbnail_url: null,
    duration: null,
    status: { state: "summarizing", progress: 50, message: "" },
    in_wiki: false,
    created_at: "2024-01-01",
    show_name: null,
    host: null,
    description: null,
  });
  getVideoProgressMock.mockResolvedValue({ state: "summarizing", progress: 50, message: "" });
  getTranscriptMock.mockResolvedValue({ segments: [], segments_en: null });
  getMindmapMock.mockResolvedValue({ markdown: "" });
  T.clearStreamingTelemetryBuffer();
  T.clearStreamingMetrics();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("useVideoPageData: SSE subscription wiring", () => {
  it("subscribes on mount and exposes a generationId", () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    expect(subscribeVideoSSEMock).toHaveBeenCalledWith(VIDEO_ID, expect.any(Object));
    expect(capturedCallbacks).not.toBeNull();
    expect(typeof result.current.generationId).toBe("string");
    expect(result.current.generationId.length).toBeGreaterThan(0);
  });
});

describe("useVideoPageData: onDone idempotency (verifications 2, 7)", () => {
  it("finalizes exactly once across two onDone calls (explicit done + onClose)", async () => {
    const { queryClient, wrapper } = makeWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });

    const cb = capturedCallbacks!;

    // Stream some delta content, then fire onDone twice.
    act(() => {
      cb.onProgress?.({ state: "summarizing", progress: 60, message: "" });
      cb.onDelta?.({ type: "delta", delta: "Hello ", level: "detailed" });
      cb.onDelta?.({ type: "delta", delta: "world", level: "detailed" });
    });

    act(() => {
      cb.onDone?.(); // explicit done message
    });
    act(() => {
      cb.onDone?.(); // natural onClose → must be skipped
    });

    // Telemetry: started exactly once, skipped at least once.
    const started = T.getStreamingTelemetryBuffer({ event_type: "stream_finalize_started" });
    const skipped = T.getStreamingTelemetryBuffer({ event_type: "stream_finalize_skipped_duplicate" });
    expect(started).toHaveLength(1);
    expect(skipped.length).toBeGreaterThanOrEqual(1);

    // setQueryData injecting the detailed summary cache fires exactly once.
    const detailedInjects = setQueryDataSpy.mock.calls.filter(
      (c) => Array.isArray(c[0]) && c[0][0] === "summary" && c[0][2] === "detailed",
    );
    expect(detailedInjects).toHaveLength(1);

    // Injected content equals the concatenated streamed deltas.
    const injectedFactory = detailedInjects[0][1] as (
      old: Record<string, unknown> | undefined,
    ) => Record<string, unknown>;
    expect(injectedFactory(undefined).content).toBe("Hello world");
  });

  it("proactively closes the SSE connection on first finalize", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;
    act(() => {
      cb.onDelta?.({ type: "delta", delta: "abc", level: "detailed" });
      cb.onDone?.();
    });
    // sseCleanupRef.current?.() invoked inside onDone.
    expect(sseCleanup).toHaveBeenCalled();
  });
});

describe("useVideoPageData: failed run skips injection (verification — runFailedRef)", () => {
  it("does not inject streamed content as detailed summary when the run failed", () => {
    const { queryClient, wrapper } = makeWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    act(() => {
      cb.onDelta?.({ type: "delta", delta: "partial...", level: "detailed" });
      // Terminal failed state sets runFailedRef = true; the SSE transport then
      // fires onDone (as it does for done/failed). Finalize must skip injection.
      cb.onProgress?.({ state: "failed", progress: 0, message: "boom" });
      cb.onDone?.();
    });

    const detailedInjects = setQueryDataSpy.mock.calls.filter(
      (c) => Array.isArray(c[0]) && c[0][0] === "summary" && c[0][2] === "detailed",
    );
    expect(detailedInjects).toHaveLength(0);

    // finalize still ran once (started event present) but with the failed reason.
    const started = T.getStreamingTelemetryBuffer({ event_type: "stream_finalize_started" });
    expect(started).toHaveLength(1);
    expect(started[0].reason).toBe("failed-run");
  });
});

describe("useVideoPageData: no wildcard summary invalidate on finalize (verification 3/9)", () => {
  it("finalize refetches video + summaryAvailable but never invalidates ['summary', videoId]", () => {
    const { queryClient, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const refetchSpy = vi.spyOn(queryClient, "refetchQueries");
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    act(() => {
      cb.onDelta?.({ type: "delta", delta: "done content", level: "detailed" });
      cb.onProgress?.({ state: "done", progress: 100, message: "" });
      cb.onDone?.();
    });

    // No wildcard ['summary', videoId] invalidate (that would empty the injected
    // detailed cache and flicker back to the streaming placeholder).
    const summaryWildcardInvalidate = invalidateSpy.mock.calls.filter((c) => {
      const key = (c[0] as { queryKey?: unknown[] })?.queryKey;
      return Array.isArray(key) && key[0] === "summary" && key.length === 2 && key[1] === VIDEO_ID;
    });
    expect(summaryWildcardInvalidate).toHaveLength(0);

    // It DOES refetch video + summaryAvailable.
    const refetchKeys = refetchSpy.mock.calls.map(
      (c) => (c[0] as { queryKey?: unknown[] })?.queryKey,
    );
    const hasVideoRefetch = refetchKeys.some((k) => Array.isArray(k) && k[0] === "video");
    const hasSummaryAvailRefetch = refetchKeys.some(
      (k) => Array.isArray(k) && k[0] === "summaryAvailable",
    );
    expect(hasVideoRefetch).toBe(true);
    expect(hasSummaryAvailRefetch).toBe(true);
  });
});

describe("useVideoPageData: reconnect (verification 12)", () => {
  it("records sse_reconnect and increments the reconnect metric without an extra finalize", () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;
    const gid = result.current.generationId;

    act(() => {
      cb.onDelta?.({ type: "delta", delta: "streamed", level: "detailed" });
      cb.onDone?.(); // first + only finalize
    });
    act(() => {
      cb.onConnectionStateChange?.("reconnecting"); // drop + reconnect
    });
    act(() => {
      cb.onDone?.(); // post-reconnect onClose → must be skipped
    });

    const reconnectEvents = T.getStreamingTelemetryBuffer({ event_type: "sse_reconnect" });
    expect(reconnectEvents.length).toBeGreaterThanOrEqual(1);
    expect(T.getStreamingMetrics(gid)?.sse_reconnect_count).toBeGreaterThanOrEqual(1);

    // Finalize still exactly once despite the reconnect cycle.
    expect(T.getStreamingTelemetryBuffer({ event_type: "stream_finalize_started" })).toHaveLength(1);
  });
});

describe("useVideoPageData: reprocess resets the finalize guard", () => {
  it("allows finalize to run again after reprocess (new generation)", async () => {
    reprocessVideoMock.mockResolvedValue({ id: VIDEO_ID });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;
    const firstGen = result.current.generationId;

    act(() => {
      cb.onDelta?.({ type: "delta", delta: "round1", level: "detailed" });
      cb.onDone?.();
    });
    expect(T.getStreamingTelemetryBuffer({ event_type: "stream_finalize_started" })).toHaveLength(1);

    // Trigger reprocess → resets finalizedRef + new generation id.
    await act(async () => {
      await result.current.reprocessMutation.mutateAsync();
    });
    await waitFor(() => {
      expect(result.current.generationId).not.toBe(firstGen);
    });

    const secondGen = result.current.generationId;

    // Second generation can finalize once more.
    act(() => {
      cb.onDelta?.({ type: "delta", delta: "round2", level: "detailed" });
      cb.onDone?.();
    });
    expect(
      T.getStreamingTelemetryBuffer({
        event_type: "stream_finalize_started",
        generation_id: secondGen,
      }),
    ).toHaveLength(1);
  });
});

describe("useVideoPageData: UI timeline export (verification 13)", () => {
  it("derives a complete UI timeline table from real buffer events", () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;
    const gid = result.current.generationId;

    // Drive a realistic, ordered SSE sequence for one generation.
    act(() => {
      cb.onConnectionStateChange?.("reconnecting"); // a transient blip first
      cb.onProgress?.({ state: "summarizing", progress: 40, message: "" }); // sse_open
      cb.onDelta?.({ type: "delta", delta: "Hello ", level: "detailed" });
      cb.onDelta?.({ type: "delta", delta: "world", level: "detailed" });
      cb.onProgress?.({ state: "done", progress: 100, message: "" }); // refresh + onDone
      cb.onDone?.(); // explicit done
      cb.onDone?.(); // duplicate (skipped)
    });

    // Pull THIS generation's events in chronological (buffer) order.
    const events = T.getStreamingTelemetryBuffer({ generation_id: gid });
    expect(events.length).toBeGreaterThan(0);

    const t0 = events[0].timestamp;
    const rows = events.map((e) => ({
      t: `+${e.timestamp - t0}ms`,
      video_id: e.video_id,
      generation_id: e.generation_id.slice(0, 8),
      event: e.event_type,
      note: e.reason ?? e.source ?? "",
    }));

    // Build a markdown table and print it so the report can quote the real run.
    const header =
      "| 时间 | video_id | generation_id | UI事件 | 说明 |\n" +
      "|------|----------|---------------|--------|------|";
    const body = rows
      .map((r) => `| ${r.t} | ${r.video_id} | ${r.generation_id} | ${r.event} | ${r.note} |`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.log("\n===UI_TIMELINE_TABLE_START===\n" + header + "\n" + body + "\n===UI_TIMELINE_TABLE_END===\n");

    // Sanity: the timeline contains the key milestones in the right shape.
    const types = events.map((e) => e.event_type);
    expect(types).toContain("sse_reconnect");
    expect(types).toContain("sse_open");
    expect(types).toContain("stream_delta_received");
    expect(types).toContain("stream_done_received");
    expect(types).toContain("stream_finalize_started");
    expect(types).toContain("stream_finalize_skipped_duplicate");
    // finalize milestone appears exactly once.
    expect(types.filter((t) => t === "stream_finalize_started")).toHaveLength(1);
  });
});
