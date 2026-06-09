const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function adminRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers as Record<string, string> },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `请求失败: ${res.status}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonitorOverview {
  video_counts: Record<string, number>;
  recent_failed: FailedVideo[];
}

export interface FailedVideo {
  id: string;
  title: string;
  url: string;
  platform: string;
  error: string;
  failed_at: string;
}

export interface WorkerInfo {
  name: string;
  alive: boolean;
  active_tasks: string[];
  last_heartbeat: string | null;
}

export interface SystemInfo {
  redis_memory_used: string;
  redis_connected_clients: number;
  queue_lengths: Record<string, number>;
}

export interface AdminVideo {
  id: string;
  title: string;
  url: string;
  platform: string;
  status: { state: string; progress: number; message: string };
  created_at: string;
}

export interface PaginatedVideos {
  items: AdminVideo[];
  total: number;
  page: number;
  page_size: number;
}

export interface VideoUpdate {
  url: string;
  platform: string;
  title: string;
  status: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  created_at: string;
}

export interface Source {
  id: string;
  category_id: string;
  category_name?: string;
  platform: string;
  name: string;
  url: string;
  enabled: boolean;
  created_at: string;
}

export interface AdminUser {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  email: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface PaginatedUsers {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

export function fetchMonitorOverview() {
  return adminRequest<MonitorOverview>("/api/v1/admin/monitor/overview");
}

export function fetchMonitorWorkers() {
  return adminRequest<WorkerInfo[]>("/api/v1/admin/monitor/workers");
}

export function fetchMonitorSystem() {
  return adminRequest<SystemInfo>("/api/v1/admin/monitor/system");
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export function fetchAdminVideos(params: { page: number; status?: string; search?: string }) {
  const sp = new URLSearchParams({ page: String(params.page) });
  if (params.status) sp.set("status", params.status);
  if (params.search) sp.set("search", params.search);
  return adminRequest<PaginatedVideos>(`/api/v1/admin/videos?${sp}`);
}

export function updateVideo(id: string, data: Partial<VideoUpdate>) {
  return adminRequest<void>(`/api/v1/admin/videos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteVideo(id: string) {
  return adminRequest<void>(`/api/v1/admin/videos/${id}`, { method: "DELETE" });
}

export function retryVideo(id: string) {
  return adminRequest<void>(`/api/v1/admin/videos/${id}/retry`, { method: "POST" });
}

export function batchVideoAction(action: string, videoIds: string[]) {
  return adminRequest<void>("/api/v1/admin/videos/batch", {
    method: "POST",
    body: JSON.stringify({ action, video_ids: videoIds }),
  });
}

// ---------------------------------------------------------------------------
// Curate
// ---------------------------------------------------------------------------

export function fetchCategories() {
  return adminRequest<Category[]>("/api/v1/admin/categories");
}

export function createCategory(data: { name: string; slug: string; description?: string; sort_order?: number }) {
  return adminRequest<Category>("/api/v1/admin/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCategory(id: string, data: Partial<Category>) {
  return adminRequest<void>(`/api/v1/admin/categories/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteCategory(id: string) {
  return adminRequest<void>(`/api/v1/admin/categories/${id}`, { method: "DELETE" });
}

export function fetchSources() {
  return adminRequest<Source[]>("/api/v1/admin/sources");
}

export function createSource(data: { category_id: string; platform: string; name: string; url: string; enabled?: boolean }) {
  return adminRequest<Source>(`/api/v1/admin/categories/${data.category_id}/sources`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateSource(id: string, data: Partial<Source>) {
  return adminRequest<void>(`/api/v1/admin/sources/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteSource(id: string) {
  return adminRequest<void>(`/api/v1/admin/sources/${id}`, { method: "DELETE" });
}

export function triggerCurate() {
  return adminRequest<void>("/api/v1/admin/curate-v2/trigger", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function fetchUsers(params: { page: number; search?: string }) {
  const sp = new URLSearchParams({ page: String(params.page) });
  if (params.search) sp.set("search", params.search);
  return adminRequest<PaginatedUsers>(`/api/v1/admin/users?${sp}`);
}

export function updateUser(id: string, data: { is_admin: boolean }) {
  return adminRequest<void>(`/api/v1/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Trending
// ---------------------------------------------------------------------------

export interface TrendingVideo {
  id: string;
  title: string;
  url: string;
  platform: string;
  view_count: number;
  is_pinned: boolean;
  is_hidden: boolean;
  admin_score: number | null;
  created_at: string;
}

export interface PaginatedTrending {
  items: TrendingVideo[];
  total: number;
  page: number;
  page_size: number;
}

export function fetchTrendingVideos(params: { page: number; filter?: string }) {
  const sp = new URLSearchParams({ page: String(params.page) });
  if (params.filter) sp.set("filter", params.filter);
  return adminRequest<PaginatedTrending>(`/api/v1/admin/trending?${sp}`);
}

export function updateTrending(id: string, data: { is_pinned?: boolean; is_hidden?: boolean; admin_score?: number | null }) {
  return adminRequest<void>(`/api/v1/admin/trending/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function batchTrending(data: { video_ids: string[]; is_pinned?: boolean; is_hidden?: boolean; admin_score?: number | null }) {
  return adminRequest<void>("/api/v1/admin/trending/batch", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
