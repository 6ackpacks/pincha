/**
 * PR2 unit tests for useVideoPageData: backend-authoritative generation_id
 * filtering + snapshot/reset handling.
 *
 * Strategy mirrors the PR1 test: mock `@/lib/api/videos` so `subscribeVideoSSE`
 * captures the callback bag, then drive onDelta/onSnapshot/onReset/onDone by
 * hand and assert on the queryClient spy + telemetry buffer.
 *
 * Covers PR2 acceptance: 2 (snapshot replaces), 3 (reset clears then rebuilds),
 * 4 (mismatched generation_id delta dropped), 5 (regenerate → new gen, old
 * deltas excluded).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

process.env.NEXT_PUBLIC_STREAMING_DEBUG = "true";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

const VIDEO_ID = "vid-pr2";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

function detailedInjects(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter(
    (c) => Array.isArray(c[0]) && c[0][0] === "summary" && c[0][2] === "detailed",
  );
}

beforeEach(() => {
  capturedCallbacks = null;
  sseCleanup.mockClear();
  pushMock.mockClear();
  subscribeVideoSSEMock.mockClear();
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

describe("useVideoPageData PR2: snapshot replaces content (acceptance 2)", () => {
  it("injects snapshot content into the summary cache as a whole (not appended)", () => {
    const { queryClient, wrapper } = makeWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    act(() => {
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "partial ", seq: 1, generation_id: "g1" });
      cb.onSnapshot?.({
        type: "snapshot",
        event_type: "snapshot",
        content: "FULL FINAL CONTENT",
        seq: 2,
        generation_id: "g1",
        is_replay: true,
      });
    });

    const injects = detailedInjects(setQueryDataSpy);
    expect(injects.length).toBeGreaterThanOrEqual(1);
    const factory = injects[injects.length - 1][1] as (
      old: Record<string, unknown> | undefined,
    ) => Record<string, unknown>;
    // Whole replacement — equals the snapshot content, NOT "partial FULL...".
    expect(factory(undefined).content).toBe("FULL FINAL CONTENT");

    const applied = T.getStreamingTelemetryBuffer({ event_type: "stream_snapshot_applied" });
    expect(applied).toHaveLength(1);
  });
});

describe("useVideoPageData PR2: reset clears then rebuilds (acceptance 3)", () => {
  it("records a reset_applied event when a reset arrives", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    act(() => {
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "OLD-A", seq: 1, generation_id: "g1" });
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "OLD-B", seq: 2, generation_id: "g1" });
      cb.onReset?.({ type: "reset", event_type: "reset", seq: 3, generation_id: "g1", reason: "fallback", attempt: 1 });
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "NEW-A", seq: 4, generation_id: "g1" });
    });

    const resetApplied = T.getStreamingTelemetryBuffer({ event_type: "stream_reset_applied" });
    expect(resetApplied).toHaveLength(1);
    expect(resetApplied[0].reason).toContain("fallback");
  });

  it("injected detailed content after reset excludes pre-reset deltas", () => {
    const { queryClient, wrapper } = makeWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    act(() => {
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "OLD", seq: 1, generation_id: "g1" });
      cb.onReset?.({ type: "reset", event_type: "reset", seq: 2, generation_id: "g1", reason: "fallback" });
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "NEW", seq: 3, generation_id: "g1" });
      cb.onProgress?.({ state: "done", progress: 100, message: "" });
      cb.onDone?.();
    });

    const injects = detailedInjects(setQueryDataSpy);
    expect(injects).toHaveLength(1);
    const factory = injects[0][1] as (old: Record<string, unknown> | undefined) => Record<string, unknown>;
    expect(factory(undefined).content).toBe("NEW"); // not "OLDNEW"
  });
});

describe("useVideoPageData PR2: stale generation_id deltas dropped (acceptance 4)", () => {
  it("drops a delta carrying a different generation_id than the active round", () => {
    const { queryClient, wrapper } = makeWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    act(() => {
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "good-1", seq: 1, generation_id: "g1" });
      // Stale residue from a previous round — must be discarded.
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "STALE", seq: 2, generation_id: "g0" });
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "good-2", seq: 3, generation_id: "g1" });
      cb.onProgress?.({ state: "done", progress: 100, message: "" });
      cb.onDone?.();
    });

    const dropped = T.getStreamingTelemetryBuffer({
      event_type: "stream_delta_dropped_stale_generation",
    });
    expect(dropped).toHaveLength(1);

    const injects = detailedInjects(setQueryDataSpy);
    expect(injects).toHaveLength(1);
    const factory = injects[0][1] as (old: Record<string, unknown> | undefined) => Record<string, unknown>;
    expect(factory(undefined).content).toBe("good-1good-2"); // STALE excluded
  });
});

describe("useVideoPageData PR2: regenerate adopts new generation_id (acceptance 5)", () => {
  it("after reprocess, deltas from the old generation_id are dropped", async () => {
    reprocessVideoMock.mockResolvedValue({ id: VIDEO_ID });
    const { queryClient, wrapper } = makeWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    const { result } = renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    // Round 1 establishes g1 and finishes.
    act(() => {
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "r1", seq: 1, generation_id: "g1" });
      cb.onDone?.();
    });
    setQueryDataSpy.mockClear();

    // Reprocess clears the backend generation id ref.
    await act(async () => {
      await result.current.reprocessMutation.mutateAsync();
    });
    await waitFor(() => expect(reprocessVideoMock).toHaveBeenCalled());

    // Round 2 establishes g2; a late g1 delta must be dropped.
    act(() => {
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "r2", seq: 10, generation_id: "g2" });
      cb.onDelta?.({ type: "delta", event_type: "delta", delta: "LATE-g1", seq: 11, generation_id: "g1" });
      cb.onProgress?.({ state: "done", progress: 100, message: "" });
      cb.onDone?.();
    });

    const injects = detailedInjects(setQueryDataSpy);
    expect(injects).toHaveLength(1);
    const factory = injects[0][1] as (old: Record<string, unknown> | undefined) => Record<string, unknown>;
    expect(factory(undefined).content).toBe("r2"); // old-round residue excluded
  });
});

describe("useVideoPageData PR2: id-less deltas keep PR1 behaviour", () => {
  it("accepts deltas with no generation_id (legacy / PR1 path)", () => {
    const { queryClient, wrapper } = makeWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    renderHook(() => useVideoPageData(VIDEO_ID), { wrapper });
    const cb = capturedCallbacks!;

    act(() => {
      cb.onDelta?.({ type: "delta", delta: "Hello " });
      cb.onDelta?.({ type: "delta", delta: "world" });
      cb.onDone?.();
    });

    const injects = detailedInjects(setQueryDataSpy);
    expect(injects).toHaveLength(1);
    const factory = injects[0][1] as (old: Record<string, unknown> | undefined) => Record<string, unknown>;
    expect(factory(undefined).content).toBe("Hello world");
  });
});
