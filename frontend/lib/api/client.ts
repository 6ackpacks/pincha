import type { SyntheticEvent } from "react";

// Use relative path by default so requests go through nginx proxy in Docker.
// Only use NEXT_PUBLIC_API_URL if explicitly set (e.g. local dev without nginx).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

/** Thumbnail size tier. `thumb` (mqdefault, 320×180) for lists; `full` (maxresdefault, 1280×720) for detail/hero. */
export type ThumbnailQuality = "thumb" | "full";

// Hosts whose thumbnail filename we may downscale/upscale.
const YT_THUMB_HOSTS = ["i.ytimg.com", "img.youtube.com"];
// Hosts that must be proxied through the backend (blocked from the browser).
const PROXY_HOSTS = ["i.ytimg.com", "img.youtube.com", "hdslb.com"];

// Matches the filename segment of a YouTube thumbnail URL, e.g. `/maxresdefault.jpg`.
const YT_THUMB_FILE = /\/(maxresdefault|hq720|sddefault|hqdefault|mqdefault|default)(\.[a-zA-Z]+)/;

/**
 * Proxy YouTube/Bilibili thumbnails through the backend to avoid direct
 * connections to blocked domains from the browser.
 *
 * For YouTube thumbnail hosts (i.ytimg.com / img.youtube.com) the filename
 * is rewritten to the requested size tier:
 *   - "thumb" (default) → mqdefault.jpg  (320×180, native 16:9, a few KB — list use)
 *   - "full"            → maxresdefault.jpg (1280×720 — detail / hero use)
 * Other hosts (e.g. hdslb.com) keep their original URL and are only proxied.
 */
export function proxyThumbnail(
  url: string | null | undefined,
  quality: ThumbnailQuality = "thumb",
): string | null {
  if (!url) return null;

  let out = url;
  if (YT_THUMB_HOSTS.some((h) => url.includes(h))) {
    const target = quality === "full" ? "maxresdefault" : "mqdefault";
    out = url.replace(YT_THUMB_FILE, `/${target}$2`);
  }

  if (PROXY_HOSTS.some((h) => out.includes(h))) {
    return `${API_BASE}/img-proxy?url=${encodeURIComponent(out)}`;
  }
  return out;
}

/**
 * onError handler for YouTube `maxresdefault` thumbnails: falls back to
 * `hqdefault` once (which always exists), guarded against infinite loops.
 * Mirrors lite-youtube-embed's behavior. No-op for non-maxres URLs.
 */
export function youtubeThumbnailFallback(
  e: SyntheticEvent<HTMLImageElement>,
): void {
  const img = e.currentTarget;
  if (img.dataset.thumbFallbackApplied) return;
  const next = img.src.replace("maxresdefault", "hqdefault");
  if (next !== img.src) {
    img.dataset.thumbFallbackApplied = "1";
    img.src = next;
  }
}

/**
 * Read the active KB ID from localStorage and return it as a header map.
 */
export function getActiveKbHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window === "undefined") return headers;
  try {
    const raw = localStorage.getItem("pingcha_active_kb_id");
    if (raw) {
      const kbId = JSON.parse(raw);
      if (kbId) headers["X-KB-ID"] = kbId;
    }
  } catch { /* ignore */ }
  return headers;
}

// ---------------------------------------------------------------------------
// Shared SSE + polling fallback for progress subscriptions
// ---------------------------------------------------------------------------

export interface ProgressData {
  state: string;
  progress: number;
  message: string;
  error_code?: string;
}

/**
 * Subscribe to processing progress via SSE with polling fallback.
 * If the SSE connection fails (e.g. IPv6 ECONNREFUSED), automatically
 * falls back to polling the REST endpoint every 3 seconds.
 * Returns a cleanup function to close the connection / stop polling.
 */
export function subscribeProgress(
  sseUrl: string,
  pollUrl: string,
  onProgress: (data: ProgressData) => void,
  onDone?: () => void,
  onError?: (err: Event) => void,
): () => void {
  let stopped = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function startPollingFallback() {
    if (stopped || pollTimer) return;
    pollTimer = setInterval(async () => {
      if (stopped) { cleanup(); return; }
      try {
        const data = await request<ProgressData>(pollUrl);
        onProgress(data);
        if (data.state === "done" || data.state === "failed") {
          cleanup();
          onDone?.();
        }
      } catch {
        // keep polling — transient errors are expected
      }
    }, 3000);
  }

  function cleanup() {
    stopped = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    es.close();
  }

  const es = new EventSource(sseUrl);

  es.onmessage = (event) => {
    try {
      const data: ProgressData = JSON.parse(event.data);
      onProgress(data);
      if (data.state === "done" || data.state === "failed") {
        cleanup();
        onDone?.();
      }
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = (err) => {
    es.close();
    onError?.(err);
    // SSE failed — fall back to polling
    startPollingFallback();
  };

  return cleanup;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getActiveKbHeaders(),
  };

  // Merge caller-provided headers (they take precedence)
  const mergedHeaders = { ...headers, ...(options?.headers as Record<string, string>) };

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: mergedHeaders,
  });

  if (res.status === 401) {
    // Session expired or revoked — redirect to login
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("未登录");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}
