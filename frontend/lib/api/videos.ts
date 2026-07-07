import { request, getActiveKbHeaders, subscribeProgress } from "./client";
import type { ProgressData } from "./client";
import { createSSEConnection } from "../sse-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface VideoStatus {
  state: string;
  progress: number;
  message: string;
}

export interface VideoResponse {
  id: string;
  url: string;
  platform: string;
  title: string | null;
  thumbnail_url: string | null;
  duration: string | null;
  status: VideoStatus;
  in_wiki: boolean;
  in_library: boolean;
  created_at: string;
  show_name: string | null;
  host: string | null;
  description: string | null;
}

export function getVideos(q?: string) {
  const url = q ? `/api/v1/videos?q=${encodeURIComponent(q)}` : "/api/v1/videos";
  return request<VideoResponse[]>(url);
}

export function getTrendingVideos(limit = 20) {
  return request<VideoResponse[]>(`/api/v1/videos/trending?limit=${limit}`);
}

export function getPopularVideos(limit = 20) {
  return request<VideoResponse[]>(`/api/v1/videos/popular?limit=${limit}`);
}

export interface PublicVideoFullResponse {
  video: VideoResponse;
  transcript: TranscriptResponse | null;
  summaries: SummaryResponse[];
  mindmap: MindmapResponse | null;
}

export function getPublicVideoFull(id: string) {
  return request<PublicVideoFullResponse>(`/api/v1/videos/public/${id}/full`);
}

export function addVideoToLibrary(id: string) {
  return request<VideoResponse>(`/api/v1/videos/${id}/add-to-library`, {
    method: "POST",
  });
}

export function submitVideo(url: string, platform: "youtube" | "podcast") {
  return request<VideoResponse>("/api/v1/videos", {
    method: "POST",
    body: JSON.stringify({ url, platform }),
  });
}

export function getVideo(id: string) {
  return request<VideoResponse>(`/api/v1/videos/${id}`);
}

export function getVideoProgress(id: string) {
  return request<VideoStatus>(`/api/v1/videos/${id}/progress`);
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResponse {
  id: string;
  video_id: string;
  language: string;
  source: string;
  segments: TranscriptSegment[];
  segments_en: (TranscriptSegment | null)[] | null;
  full_text: string;
  created_at: string;
}

export function getTranscript(videoId: string) {
  return request<TranscriptResponse>(`/api/v1/videos/${videoId}/transcript`);
}

export interface TranslateRequest {
  segment_indices: number[];
  target_lang?: string;  // defaults to "auto" on backend
}

export interface TranslateResponse {
  video_id: string;
  translations: Record<number, string>;
  from_cache: number[];
}

export function translateTranscript(videoId: string, body: TranslateRequest) {
  return request<TranslateResponse>(`/api/v1/videos/${videoId}/transcript/translate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type SummaryLevel = "express" | "highlight" | "detailed" | "full";

export interface SummaryResponse {
  id: string;
  video_id: string;
  level: SummaryLevel;
  content: string;
  model_used: string;
  created_at: string;
  cached: boolean;
}

export function getAvailableSummaryLevels(videoId: string) {
  return request<string[]>(`/api/v1/videos/${videoId}/summary/available`);
}

export function getSummary(videoId: string, level: SummaryLevel) {
  return request<SummaryResponse>(`/api/v1/videos/${videoId}/summary/${level}`);
}

export function regenerateSummary(videoId: string, level: SummaryLevel) {
  return request<SummaryResponse>(`/api/v1/videos/${videoId}/summary/${level}/regenerate`, {
    method: "POST",
  });
}

export function regenerateSummaryStream(videoId: string, level: SummaryLevel, options?: { signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getActiveKbHeaders(),
  };
  return fetch(`${API_BASE}/api/v1/videos/${videoId}/summary/${level}/regenerate/stream`, {
    method: "POST",
    headers,
    signal: options?.signal,
  }).then((res) => {
    if (!res.ok) {
      return res.json().catch(() => ({})).then((body) => {
        throw new Error(body.detail || `Regenerate stream failed: ${res.status}`);
      });
    }
    return res.body!;
  });
}

export function triggerFullSummary(videoId: string) {
  return request<{ status: string; task_id?: string }>(
    `/api/v1/videos/${videoId}/summary/full/generate`,
    { method: "POST" }
  );
}

/**
 * Subscribe to real-time summary generation stream via SSE (fetch-based).
 * Returns a cleanup function to close the connection.
 *
 * Events:
 *   - {type: "delta", level: "detailed", delta: "..."} — streaming token
 *   - {type: "level_ready", level: "highlight"} — a level just became available
 *   - {type: "done", levels: [...]} — all fast summaries complete
 */
export function subscribeSummaryStream(
  videoId: string,
  onDelta: (level: string, delta: string) => void,
  onLevelReady: (level: string) => void,
  onDone: () => void,
): () => void {
  const url = `${API_BASE}/api/v1/videos/${videoId}/summary/stream`;

  return createSSEConnection({
    url,
    onEvent: (event) => {
      const { data } = event;
      const type = (data.type as string) || event.type;

      if (type === "delta") {
        onDelta((data.level as string) || "detailed", (data.delta as string) || "");
      } else if (type === "level_ready") {
        onLevelReady(data.level as string);
      } else if (type === "done") {
        onDone();
      }
    },
    onError: () => onDone(),
    onClose: () => onDone(),
    maxRetries: 2,
  });
}

export interface MindmapResponse {
  id: string;
  video_id: string;
  markdown: string;
  model_used: string;
  created_at: string;
  cached: boolean;
}

export function getMindmap(videoId: string) {
  return request<MindmapResponse>(`/api/v1/videos/${videoId}/mindmap`);
}

export function regenerateMindmap(videoId: string) {
  return request<MindmapResponse>(`/api/v1/videos/${videoId}/mindmap/regenerate`, {
    method: "POST",
  });
}

export async function deleteVideo(id: string) {
  try {
    await request<void>(`/api/v1/videos/${id}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) return;
    throw err;
  }
}

export function reprocessVideo(id: string) {
  return request<VideoResponse>(`/api/v1/videos/${id}/reprocess`, { method: "POST" });
}

// RAG / Knowledge Base (single-video chat)
export async function getIngestStatus(videoId: string): Promise<{ ingested: boolean; chunks_count: number }> {
  const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/ingest/status`);
  if (!res.ok) throw new Error("Failed to get ingest status");
  return res.json();
}

export async function ingestVideo(videoId: string): Promise<{ chunks_count: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/ingest`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to ingest video");
  return res.json();
}

export function streamChat(videoId: string, question: string): Promise<ReadableStream<Uint8Array>> {
  return fetch(`${API_BASE}/api/v1/videos/${videoId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  }).then((res) => {
    if (!res.ok) throw new Error("Chat failed");
    return res.body!;
  });
}

export function streamVideoAsk(videoId: string, question: string, options?: { signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
  return fetch(`${API_BASE}/api/v1/videos/${videoId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal: options?.signal,
  }).then((res) => {
    if (!res.ok) return res.json().catch(() => ({})).then((body) => { throw new Error(body.detail || `Video ask failed: ${res.status}`); });
    return res.body!;
  });
}

// ---------------------------------------------------------------------------
// Chat History
// ---------------------------------------------------------------------------

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function getChatHistory(videoId: string) {
  return request<ChatHistoryMessage[]>(`/api/v1/videos/${videoId}/chat/history`);
}

export function saveChatMessages(videoId: string, messages: { role: string; content: string }[]) {
  return request<{ saved: number }>(`/api/v1/videos/${videoId}/chat/history`, {
    method: "POST",
    body: JSON.stringify(messages),
  });
}

export function clearChatHistory(videoId: string) {
  return request<{ cleared: boolean }>(`/api/v1/videos/${videoId}/chat/history`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Wiki integration (video-specific)
// ---------------------------------------------------------------------------

export function addVideoToWiki(videoId: string, kbId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (kbId) headers["X-KB-ID"] = kbId;
  return request<{ message: string; already_ingested: boolean }>(
    `/api/v1/wiki/videos/${videoId}/ingest`,
    { method: "POST", headers }
  );
}

export function removeVideoFromWiki(videoId: string) {
  return request<{ message: string }>(`/api/v1/wiki/videos/${videoId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Video Progress SSE
// ---------------------------------------------------------------------------

/**
 * Subscribe to video processing progress via SSE with polling fallback.
 * Returns a cleanup function to close the connection / stop polling.
 */
export function subscribeVideoProgress(
  videoId: string,
  onProgress: (data: ProgressData) => void,
  onDone?: () => void,
  onError?: (err: Event) => void,
): () => void {
  return subscribeProgress(
    `/api/v1/videos/${videoId}/progress/stream`,
    `/api/v1/videos/${videoId}/progress`,
    onProgress,
    onDone,
    onError,
  );
}

/**
 * Subscribe to the enhanced video SSE stream that emits named events:
 * - message: progress heartbeat {state, progress, message}
 * - subtitle_ready: subtitle generation complete
 * - delta: streaming summary content {content, level}
 * - level_ready: summary level complete {level}
 * - mindmap_ready: mindmap generation complete
 *
 * Includes automatic reconnection with exponential backoff (up to 3 retries).
 * When retries are exhausted, calls onFallbackToPolling so the consumer can
 * switch to a REST polling strategy.
 *
 * Returns a cleanup function to close the EventSource and cancel pending retries.
 */
export interface VideoSSECallbacks {
  onProgress?: (data: ProgressData) => void;
  onSubtitleReady?: (data: { video_id: string; segment_count: number }) => void;
  onDelta?: (data: SummaryStreamEvent) => void;
  onLevelReady?: (data: { type: string; level: string }) => void;
  onMindmapReady?: (data: { type: string; node_count: number }) => void;
  /** Full content replacement (buffer-expired snapshot or non-streamed L2 result). */
  onSnapshot?: (data: SummaryStreamEvent) => void;
  /** Discard the current round's accumulated streamed content (fallback retry). */
  onReset?: (data: SummaryStreamEvent) => void;
  onDone?: () => void;
  onError?: (err: Event) => void;
  /** Called when SSE retries are exhausted; consumer should start polling */
  onFallbackToPolling?: () => void;
  /** Called with current connection status changes */
  onConnectionStateChange?: (state: "connected" | "reconnecting" | "disconnected") => void;
}

/**
 * A single summary-stream event as published by the backend PR2 protocol.
 * `event_type` is authoritative; `type`/`level`/`delta` are legacy aliases kept
 * for the older /summary/stream consumer. `seq` is the per-video monotonic
 * sequence; `generation_id` identifies the generation round.
 */
export interface SummaryStreamEvent {
  type?: string;
  event_type?: "delta" | "snapshot" | "reset" | "done" | "failed" | "level_generated" | "phase";
  content?: string;
  delta?: string;
  level?: string;
  summary_level?: string;
  seq?: number;
  generation_id?: string | null;
  is_replay?: boolean;
  reason?: string;
  attempt?: number;
}

export function subscribeVideoSSE(
  videoId: string,
  callbacks: VideoSSECallbacks,
): () => void {
  const sseUrl = `${API_BASE}/api/v1/videos/${videoId}/progress/stream`;

  callbacks.onConnectionStateChange?.("connected");

  return createSSEConnection({
    url: sseUrl,
    // Resume from the highest seen seq on reconnect (after_seq query +
    // Last-Event-ID header) and dedup replayed frames inside the client.
    resumeOnReconnect: true,
    onEvent: (event) => {
      const { type, data, id } = event;
      // Surface the SSE id (= backend seq) on the payload so consumers can
      // track the high-water mark even when the JSON omits/lags `seq`.
      if (id !== undefined && id !== "" && (data as { seq?: unknown }).seq === undefined) {
        const parsedId = Number(id);
        if (Number.isFinite(parsedId)) (data as { seq?: number }).seq = parsedId;
      }

      switch (type) {
        case "message": {
          const progress = data as unknown as ProgressData;
          callbacks.onProgress?.(progress);
          if (progress.state === "done" || progress.state === "failed") {
            callbacks.onDone?.();
          }
          break;
        }
        case "subtitle_ready":
          callbacks.onSubtitleReady?.(data as { video_id: string; segment_count: number });
          break;
        case "delta":
          callbacks.onDelta?.(data as SummaryStreamEvent);
          break;
        case "snapshot":
          callbacks.onSnapshot?.(data as SummaryStreamEvent);
          break;
        case "reset":
          callbacks.onReset?.(data as SummaryStreamEvent);
          break;
        case "level_ready":
        case "level_generated":
          callbacks.onLevelReady?.(data as { type: string; level: string });
          break;
        case "mindmap_ready":
          callbacks.onMindmapReady?.(data as { type: string; node_count: number });
          break;
        case "done":
          callbacks.onDone?.();
          break;
        case "failed":
          callbacks.onDone?.();
          break;
        default:
          // `phase` and any other progress-only events are ignored here.
          break;
      }
    },
    onError: (err) => {
      callbacks.onError?.(err as unknown as Event);
      callbacks.onConnectionStateChange?.("disconnected");
      callbacks.onFallbackToPolling?.();
    },
    onReconnect: () => {
      callbacks.onConnectionStateChange?.("reconnecting");
    },
    onClose: () => {
      callbacks.onDone?.();
    },
    maxRetries: 3,
  });
}
