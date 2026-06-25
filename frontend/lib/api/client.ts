// Use relative path by default so requests go through nginx proxy in Docker.
// Only use NEXT_PUBLIC_API_URL if explicitly set (e.g. local dev without nginx).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * Proxy YouTube thumbnails through the backend to avoid direct
 * connections to blocked domains from the browser.
 */
export function proxyThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;
  const blocked = ["i.ytimg.com", "img.youtube.com", "hdslb.com"];
  if (blocked.some((h) => url.includes(h))) {
    return `${API_BASE}/img-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
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

// Guard against multiple concurrent 401s all triggering a redirect.
let redirectingToLogin = false;

/**
 * Redirect to the login page on an unrecoverable 401.
 *
 * The session JWT cannot be refreshed — the only way to obtain a new token is
 * to re-run the Watcha OAuth flow via /login — so an expired/invalid session
 * means the user must log in again. The auth cookie is HttpOnly, so there is
 * nothing to clear client-side; the backend issues a fresh cookie on callback.
 */
function redirectToLogin(): void {
  if (typeof window === "undefined" || redirectingToLogin) return;
  if (window.location.pathname.startsWith("/login")) return;
  redirectingToLogin = true;
  window.location.href = "/login";
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

  if (!res.ok) {
    if (res.status === 401) {
      redirectToLogin();
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}
