/**
 * Unit tests for SummaryPanel finalize / flicker behavior (PR1).
 *
 * IMPORTANT FINDING (see report): the contract states the AnimatePresence
 * `motion.div` key was changed to `key={activeLevel}` (summary.id removed). The
 * actual source (summary-panel.tsx) still uses
 *   key={`${activeLevel}-${summary?.id ?? "streaming"}`}
 * PR1's real no-remount mechanism is therefore NOT the literal key change but
 * the *id-less cache injection* in useVideoPageData.onDone combined with NOT
 * wildcard-invalidating ["summary", videoId]: the injected detailed object has
 * no `id`, so `summary?.id` stays undefined and the key remains
 * `detailed-streaming` across the streaming→finalize transition (no remount).
 * These tests assert that NET EFFECT against the real source, and additionally
 * document what happens when a DB summary WITH an id is refetched.
 *
 * jsdom limits: framer-motion animation timing and requestAnimationFrame frame
 * scheduling are unreliable, so:
 *  - framer-motion is mocked to plain elements (React-key reconciliation is what
 *    actually drives mount/unmount; the telemetry key-change effect is in
 *    SummaryPanel itself, not in framer-motion).
 *  - For delta→paint we assert the render_count_during_stream metric (deterministic)
 *    and note rAF-dependent delta_to_paint_ms as best-effort.
 *
 * Telemetry assertions read the ring buffer; NEXT_PUBLIC_STREAMING_DEBUG="true"
 * is set before import so all events (incl. info) are captured.
 *
 * Covers verifications: 1, 4, 5, 6, 8, 9, 10.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

process.env.NEXT_PUBLIC_STREAMING_DEBUG = "true";

// --- Mock framer-motion: strip animation, keep children + React key ---------
vi.mock("framer-motion", () => {
  const passthrough = (tag: string) =>
    function MotionTag(props: Record<string, unknown>) {
      // Drop animation-only props so React doesn't warn about unknown DOM attrs.
      const { initial, animate, exit, transition, children, ...rest } = props as {
        initial?: unknown; animate?: unknown; exit?: unknown; transition?: unknown;
        children?: React.ReactNode;
      };
      void initial; void animate; void exit; void transition;
      return React.createElement(tag, rest, children);
    };
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
  };
});

// --- Mock react-markdown: render content as plain text ----------------------
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "md" }, children),
}));

// --- Mock card export (pulls in modern-screenshot ESM) ----------------------
vi.mock("@/components/video/summary-card-export", () => ({
  SummaryCardExport: () => React.createElement("div", { "data-testid": "card-export" }),
}));

// --- Mock the videos API ----------------------------------------------------
const getSummaryMock = vi.fn();
const getAvailableSummaryLevelsMock = vi.fn();
const regenerateSummaryStreamMock = vi.fn();
const triggerFullSummaryMock = vi.fn();

vi.mock("@/lib/api/videos", () => ({
  getSummary: (id: string, level: string) => getSummaryMock(id, level),
  getAvailableSummaryLevels: (id: string) => getAvailableSummaryLevelsMock(id),
  regenerateSummaryStream: (id: string, level: string, opts: unknown) =>
    regenerateSummaryStreamMock(id, level, opts),
  triggerFullSummary: (id: string) => triggerFullSummaryMock(id),
}));

type Telemetry = typeof import("@/lib/streaming-telemetry");
let T: Telemetry;
let SummaryPanel: typeof import("@/components/video/summary-panel").default;

beforeAll(async () => {
  T = await import("@/lib/streaming-telemetry");
  SummaryPanel = (await import("@/components/video/summary-panel")).default;
});

const VIDEO_ID = "vid-1";
const GID = "gen-comp";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderPanel(client: QueryClient, props: Record<string, unknown>) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(SummaryPanel, {
        videoId: VIDEO_ID,
        generationId: GID,
        ...props,
      } as never),
    ),
  );
}

beforeEach(() => {
  getSummaryMock.mockReset();
  getAvailableSummaryLevelsMock.mockReset();
  regenerateSummaryStreamMock.mockReset();
  triggerFullSummaryMock.mockReset();
  // Default: no levels available yet (force-load applyLevels is a no-op).
  getAvailableSummaryLevelsMock.mockResolvedValue([]);
  T.clearStreamingTelemetryBuffer();
  T.clearStreamingMetrics();
});

afterEach(() => {
  cleanup();
});

describe("SummaryPanel: streaming → id-less finalize (verifications 1, 4, 6)", () => {
  it("keeps the panel mounted with a stable key when finalized content has no id", async () => {
    const client = makeClient();

    // Phase 1: streaming. activeLevel auto-selects "detailed" (streamingSummary
    // present + detailed not yet available). Key = `detailed-streaming`.
    const { rerender } = renderPanel(client, {
      streamingSummary: "Hello",
      currentState: "summarizing",
      isDone: false,
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Snapshot the buffer AFTER initial streaming setup. Note: activeLevel
    // resolves null → "detailed" on mount, which legitimately produces ONE
    // key change (`null-streaming` → `detailed-streaming`) before any finalize.
    // The finalize-regression concern is that NO further remount/key change
    // happens across the streaming→finalize transition.
    const keyChangesBeforeFinalize = T.getStreamingTelemetryBuffer({
      generation_id: GID,
      event_type: "summary_panel_key_changed",
    }).length;

    // Phase 2: finalize like useVideoPageData.onDone — inject id-less detailed
    // content into cache and flip isDone. No ["summary"] wildcard invalidate.
    act(() => {
      client.setQueryData(["summary", VIDEO_ID, "detailed"], {
        video_id: VIDEO_ID,
        level: "detailed",
        content: "Hello world",
        cached: false,
        // NOTE: deliberately no `id` — mirrors the onDone injection.
      });
    });

    rerender(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(SummaryPanel, {
          videoId: VIDEO_ID,
          generationId: GID,
          streamingSummary: "Hello world",
          currentState: "done",
          isDone: true,
        } as never),
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const gidQuery = { generation_id: GID };
    // No unmount of the panel within this generation.
    expect(
      T.getStreamingTelemetryBuffer({ ...gidQuery, event_type: "summary_panel_unmount" }),
    ).toHaveLength(0);
    // No NEW key change across the streaming→finalize transition. The key is
    // now derived from activeLevel ONLY (not summary.id), so the arrival of the
    // final summary does not change it — the node stays mounted, no remount.
    const keyChangesAfterFinalize = T.getStreamingTelemetryBuffer({
      ...gidQuery,
      event_type: "summary_panel_key_changed",
    }).length;
    expect(keyChangesAfterFinalize).toBe(keyChangesBeforeFinalize);
    // Every recorded key is the stable activeLevel-only form ("detailed"),
    // never the unstable `detailed-<uuid>` that would force a remount.
    for (const e of T.getStreamingTelemetryBuffer({ ...gidQuery, event_type: "summary_panel_key_changed" })) {
      expect(e.component_key).toBe("detailed");
    }
    // Content never went non-empty → empty.
    expect(
      T.getStreamingTelemetryBuffer({ ...gidQuery, event_type: "summary_content_became_empty" }),
    ).toHaveLength(0);

    // Final content is visible.
    expect(screen.getAllByTestId("md").map((n) => n.textContent).join("")).toContain(
      "Hello world",
    );
  });
});

describe("SummaryPanel: level switch (verification 5)", () => {
  it("changes the AnimatePresence key and swaps content when switching level", async () => {
    const client = makeClient();
    getAvailableSummaryLevelsMock.mockResolvedValue(["express", "highlight", "detailed"]);
    getSummaryMock.mockImplementation((_id: string, level: string) =>
      Promise.resolve({
        video_id: VIDEO_ID,
        level,
        content: `content-${level}`,
        cached: true,
        id: `id-${level}`,
        model_used: "test-model",
        created_at: "2024-01-01T00:00:00Z",
      }),
    );

    renderPanel(client, { isDone: true, currentState: "done" });

    // Wait for levels + initial (detailed) summary to settle.
    await vi.waitFor(() => {
      expect(
        screen.getAllByTestId("md").map((n) => n.textContent).join(""),
      ).toContain("content-detailed");
    });

    // Switch to the "精华" (highlight) tab.
    const highlightTab = await screen.findByText("精华");
    act(() => {
      fireEvent.click(highlightTab.closest("button")!);
    });

    // Wait for highlight content to load and render.
    await vi.waitFor(() => {
      expect(
        screen.getAllByTestId("md").map((n) => n.textContent).join(""),
      ).toContain("content-highlight");
    });

    // activeLevel changed → currentKey changed → key_changed event recorded.
    const keyChanges = T.getStreamingTelemetryBuffer({
      generation_id: GID,
      event_type: "summary_panel_key_changed",
    });
    expect(keyChanges.length).toBeGreaterThanOrEqual(1);
    // A key change referencing the highlight level was recorded.
    expect(
      keyChanges.some((e) => (e.component_key ?? "").includes("highlight")),
    ).toBe(true);

    // Highlight content shown.
    expect(
      screen.getAllByTestId("md").map((n) => n.textContent).join(""),
    ).toContain("content-highlight");
  });
});

describe("SummaryPanel: slow DB does not blank content (verifications 3, 8, 9)", () => {
  it("keeps injected content visible while a slow background refetch (~500ms) is in flight", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      // Pre-inject id-less detailed content exactly like useVideoPageData.onDone.
      // This is the PR1 mechanism: cache is populated synchronously so isLoading
      // never becomes true, even if the subsequent DB read lags.
      client.setQueryData(["summary", VIDEO_ID, "detailed"], {
        video_id: VIDEO_ID,
        level: "detailed",
        content: "injected body that must remain visible",
        cached: false,
      });

      // Any background refetch is slow (500ms). With cached data present the
      // query is in `fetching` (not `loading`) state, so content stays shown.
      let resolveSummary: (v: unknown) => void = () => {};
      const slow = new Promise((res) => {
        resolveSummary = res;
      });
      getSummaryMock.mockReturnValue(slow);
      getAvailableSummaryLevelsMock.mockResolvedValue(["detailed"]);

      renderPanel(client, {
        streamingSummary: "injected body that must remain visible",
        currentState: "done",
        isDone: true,
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Advance ~500ms while the background refetch is still pending.
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      // Injected content stays visible the whole time (no white-screen).
      expect(
        screen.getAllByTestId("md").map((n) => n.textContent).join(""),
      ).toContain("injected body that must remain visible");

      // No "content became empty" flicker event during the delay.
      expect(
        T.getStreamingTelemetryBuffer({
          generation_id: GID,
          event_type: "summary_content_became_empty",
        }),
      ).toHaveLength(0);

      // Resolve the slow refetch with the persisted DB row (now WITH an id).
      await act(async () => {
        resolveSummary({
          video_id: VIDEO_ID,
          level: "detailed",
          content: "injected body that must remain visible",
          cached: true,
          id: "db-row-1",
        });
        await Promise.resolve();
      });

      // Still no empty flicker after the swap to the persisted row.
      expect(
        T.getStreamingTelemetryBuffer({
          generation_id: GID,
          event_type: "summary_content_became_empty",
        }),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SummaryPanel: render metrics during streaming (verification 10)", () => {
  it("accumulates render_count_during_stream as streamed content grows", async () => {
    const client = makeClient();
    const base = {
      videoId: VIDEO_ID,
      generationId: GID,
      currentState: "summarizing",
      isDone: false,
    };
    const { rerender } = renderPanel(client, { ...base, streamingSummary: "a" });

    // Several streaming updates → multiple renders while isStreamingNow is true.
    for (const chunk of ["ab", "abc", "abcd", "abcde"]) {
      rerender(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(SummaryPanel, { ...base, streamingSummary: chunk } as never),
        ),
      );
      await act(async () => {
        await Promise.resolve();
      });
    }

    const metrics = T.getStreamingMetrics(GID);
    expect(metrics).toBeDefined();
    // render_count_during_stream increments once per render while streaming.
    expect(metrics!.render_count_during_stream).toBeGreaterThan(0);
    // delta_to_paint_ms is rAF-dependent; jsdom DOES provide rAF so it usually
    // records, but we don't hard-assert its presence (frame timing is flaky).
    // When present it must be a non-negative number.
    if (metrics!.delta_to_paint_ms !== undefined) {
      expect(metrics!.delta_to_paint_ms).toBeGreaterThanOrEqual(0);
    }
  });
});
