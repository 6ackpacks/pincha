import { EventSourceParserStream } from "eventsource-parser/stream";
import { getActiveKbHeaders } from "./api/client";

export interface SSEEvent {
  type: string;
  /** SSE `id:` line, when present. For the video progress stream this is the
   *  backend's per-video monotonic `seq`. */
  id?: string;
  data: Record<string, unknown>;
}

export interface SSEClientOptions {
  url: string;
  method?: "GET" | "POST";
  body?: object;
  onEvent: (event: SSEEvent) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  /** Called right before a reconnection attempt (after a transient failure).
   *  `afterSeq` is the highest `id:`/seq seen so far (the resume point). */
  onReconnect?: (attempt: number, afterSeq: number) => void;
  signal?: AbortSignal;
  maxRetries?: number;
  /**
   * When true, the client tracks the highest numeric `id:` (= backend seq) it
   * has seen and, on every reconnect, resumes from there: it appends
   * `?after_seq=<seq>` to the URL and sends a `Last-Event-ID: <seq>` header
   * (the backend takes the larger of the two). It also drops any event whose
   * `id` is <= the high-water mark, so replayed frames after a reconnect are
   * never appended twice. Defaults to false (other consumers unaffected).
   */
  resumeOnReconnect?: boolean;
}

/** Append (or replace) an `after_seq` query param. Base URLs here never carry
 *  one, and each reconnect rebuilds from the original URL, so a plain append
 *  is safe and avoids accumulation. */
function withAfterSeq(url: string, seq: number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}after_seq=${seq}`;
}

export function createSSEConnection(options: SSEClientOptions): () => void {
  const {
    url,
    method = "GET",
    body,
    onEvent,
    onError,
    onClose,
    onReconnect,
    signal: externalSignal,
    maxRetries = 2,
    resumeOnReconnect = false,
  } = options;

  const controller = new AbortController();
  let stopped = false;
  // Highest numeric SSE id (= backend seq) seen across the whole connection
  // lifetime, including reconnects. Drives both resume (?after_seq / Last-Event-ID)
  // and per-event dedup so replayed frames are never delivered twice.
  let maxSeq = 0;

  if (externalSignal) {
    externalSignal.addEventListener("abort", () => {
      stopped = true;
      controller.abort();
    });
  }

  async function connect(retries = 0) {
    if (stopped) return;

    // On a resume-enabled reconnect, rebuild the URL from the original base
    // with the current high-water mark and send Last-Event-ID too (backend
    // takes the larger of after_seq query vs header).
    const connectUrl =
      resumeOnReconnect && maxSeq > 0 ? withAfterSeq(url, maxSeq) : url;

    try {
      const res = await fetch(connectUrl, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(resumeOnReconnect && maxSeq > 0
            ? { "Last-Event-ID": String(maxSeq) }
            : {}),
          ...getActiveKbHeaders(),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const stream = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream());

      const reader = stream.getReader();

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;

        const eventType = value.event || "message";
        // The parser surfaces the `id:` line as `value.id`. For the progress
        // stream this is the backend's monotonic seq. Track the high-water
        // mark and drop any frame at-or-below it (replayed-after-reconnect
        // duplicate) when resume is enabled.
        const rawId = value.id;
        let seq: number | undefined;
        if (rawId !== undefined && rawId !== "") {
          const parsed = Number(rawId);
          if (Number.isFinite(parsed)) {
            seq = parsed;
            if (resumeOnReconnect && seq <= maxSeq) {
              continue; // duplicate replay frame — already delivered
            }
            if (seq > maxSeq) maxSeq = seq;
          }
        }

        try {
          const data = JSON.parse(value.data);
          onEvent({ type: eventType, id: rawId, data });
        } catch {
          onEvent({ type: eventType, id: rawId, data: { raw: value.data } });
        }
      }

      onClose?.();
    } catch (err) {
      if (stopped || controller.signal.aborted) return;

      if (retries < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries), 8000);
        await new Promise((r) => setTimeout(r, delay));
        if (!stopped) {
          onReconnect?.(retries + 1, maxSeq);
          return connect(retries + 1);
        }
      }

      onError?.(err as Error);
    }
  }

  connect();

  return () => {
    stopped = true;
    controller.abort();
  };
}
