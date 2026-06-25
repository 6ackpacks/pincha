/**
 * PR2 unit tests for the fetch-based SSE client resume / dedup behavior.
 *
 * The backend emits each summary-stream frame as
 *   id: <seq>\nevent: <event_type>\ndata: <json>\n\n
 * On (re)connect it replays buffered frames with seq > resume_seq, where
 * resume_seq = max(after_seq query, Last-Event-ID header). The client must:
 *   1. track the highest `id:` (= seq) it has delivered,
 *   2. on reconnect, resume from that seq via BOTH ?after_seq and Last-Event-ID,
 *   3. drop any frame whose id is <= the high-water mark (replayed duplicate).
 *
 * Covers PR2 acceptance: 1 (seq>5 only, no re-concat) and 6 (reconnect carries
 * after_seq / Last-Event-ID).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSSEConnection, type SSEEvent } from "@/lib/sse-client";

// getActiveKbHeaders reads from a module-level store; default {} is fine here.
vi.mock("@/lib/api/client", () => ({
  getActiveKbHeaders: () => ({}),
}));

function frame(seq: number, eventType: string, payload: Record<string, unknown>): string {
  const data = JSON.stringify({ seq, event_type: eventType, ...payload });
  return `id: ${seq}\nevent: ${eventType}\ndata: ${data}\n\n`;
}

/** A ReadableStream that emits the given SSE frame strings, then either closes
 *  cleanly or errors (to simulate a dropped connection that triggers reconnect).
 *  When erroring, frames are flushed on a later tick so the consumer drains them
 *  before the error propagates through the pipe. */
function sseBodyStream(frames: string[], opts: { error?: boolean } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  if (!opts.error) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
  }
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < frames.length) {
        controller.enqueue(enc.encode(frames[i]));
        i += 1;
        return;
      }
      // All frames drained → simulate a dropped connection.
      await new Promise((r) => setTimeout(r, 0));
      controller.error(new Error("connection dropped"));
    },
  });
}

function okResponse(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("sse-client resume/dedup (PR2 acceptance 1)", () => {
  it("delivers seq 1..5, then accepts only seq>5 and drops replayed duplicates", async () => {
    const received: SSEEvent[] = [];
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(
        sseBodyStream([
          frame(1, "delta", { content: "a" }),
          frame(2, "delta", { content: "b" }),
          frame(3, "delta", { content: "c" }),
          frame(4, "delta", { content: "d" }),
          frame(5, "delta", { content: "e" }),
          // Replayed duplicates after a (simulated) resume — must be dropped.
          frame(3, "delta", { content: "c" }),
          frame(4, "delta", { content: "d" }),
          frame(5, "delta", { content: "e" }),
          // New frame past the high-water mark — must be delivered.
          frame(6, "delta", { content: "f" }),
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await new Promise<void>((resolve) => {
      createSSEConnection({
        url: "/api/v1/videos/v1/progress/stream",
        resumeOnReconnect: true,
        onEvent: (e) => received.push(e),
        onClose: () => resolve(),
        onError: () => resolve(),
      });
    });

    const seqs = received.map((e) => Number(e.id));
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]); // no 3/4/5 re-concat
    // seq surfaced both as id and onto the data payload.
    expect(received[0].data.seq).toBe(1);
  });
});

describe("sse-client reconnect resume (PR2 acceptance 6)", () => {
  it("reconnects with after_seq=<maxSeq> query AND Last-Event-ID header", async () => {
    const received: SSEEvent[] = [];
    const calls: { url: string; headers: Record<string, string> }[] = [];

    const fetchMock = vi
      .fn()
      .mockImplementationOnce((url: string, init: RequestInit) => {
        calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
        // First connection: deliver 1..5 then drop → triggers reconnect.
        return Promise.resolve(
          okResponse(
            sseBodyStream(
              [
                frame(1, "delta", { content: "a" }),
                frame(2, "delta", { content: "b" }),
                frame(3, "delta", { content: "c" }),
                frame(4, "delta", { content: "d" }),
                frame(5, "delta", { content: "e" }),
              ],
              { error: true },
            ),
          ),
        );
      })
      .mockImplementationOnce((url: string, init: RequestInit) => {
        calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
        // Second connection: nothing new, close cleanly.
        return Promise.resolve(okResponse(sseBodyStream([])));
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await new Promise<void>((resolve) => {
      createSSEConnection({
        url: "/api/v1/videos/v1/progress/stream",
        resumeOnReconnect: true,
        maxRetries: 1,
        onEvent: (e) => received.push(e),
        onClose: () => resolve(),
        onError: () => resolve(),
      });
    });

    expect(calls).toHaveLength(2);
    // First connect: no resume params.
    expect(calls[0].url).not.toContain("after_seq");
    expect(calls[0].headers["Last-Event-ID"]).toBeUndefined();
    // Reconnect: resume from seq 5 via BOTH channels.
    expect(calls[1].url).toContain("after_seq=5");
    expect(calls[1].headers["Last-Event-ID"]).toBe("5");
  }, 10000);
});
