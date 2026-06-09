import { request, getActiveKbHeaders, subscribeProgress } from "./client";
import type { ProgressData } from "./client";

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
    credentials: "include",
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
  const controller = new AbortController();
  const url = `${API_BASE}/api/v1/videos/${videoId}/summary/stream`;

  (async () => {
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: getActiveKbHeaders(),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onDone();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === ": connected") continue;
          try {
            const data = JSON.parse(payload);
            if (data.type === "delta") {
              onDelta(data.level, data.delta);
            } else if (data.type === "level_ready") {
              onLevelReady(data.level);
            } else if (data.type === "done") {
              onDone();
              return;
            }
          } catch {
            // ignore malformed
          }
        }
      }
      onDone();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      onDone();
    }
  })();

  return () => controller.abort();
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

export function deleteVideo(id: string) {
  return request<void>(`/api/v1/videos/${id}`, { method: "DELETE" });
}

export function reprocessVideo(id: string) {
  return request<VideoResponse>(`/api/v1/videos/${id}/reprocess`, { method: "POST" });
}

// RAG / Knowledge Base (single-video chat)
export async function getIngestStatus(videoId: string): Promise<{ ingested: boolean; chunks_count: number }> {
  const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/ingest/status`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to get ingest status");
  return res.json();
}

export async function ingestVideo(videoId: string): Promise<{ chunks_count: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/ingest`, { method: "POST", credentials: "include" });
  if (!res.ok) throw new Error("Failed to ingest video");
  return res.json();
}

export function streamChat(videoId: string, question: string): Promise<ReadableStream<Uint8Array>> {
  return fetch(`${API_BASE}/api/v1/videos/${videoId}/chat`, {
    method: "POST",
    credentials: "include",
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
    credentials: "include",
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
