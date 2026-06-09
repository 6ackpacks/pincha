import { request } from "./client";

export interface NotificationItem {
  id: number;
  user_id: string;
  pick_id: number;
  is_read: boolean;
  created_at: string;
  pick: {
    id: number;
    channel_id: number;
    pick_date: string;
    rank: number;
    source_type: string;
    source_id: number;
    title: string;
    summary: string | null;
    author_name: string | null;
    author_avatar: string | null;
    original_url: string;
    published_at: string | null;
    score: number | null;
    is_official: boolean;
    article_id: string | null;
    created_at: string;
  } | null;
}

export function getNotifications(params?: { limit?: number; offset?: number; unread_only?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  if (params?.unread_only) searchParams.set("unread_only", "true");
  const qs = searchParams.toString();
  return request<NotificationItem[]>(`/api/v1/curate-v2/notifications${qs ? `?${qs}` : ""}`);
}

export function markNotificationRead(notificationId: number) {
  return request<{ message: string }>(`/api/v1/curate-v2/notifications/${notificationId}/read`, {
    method: "PUT",
  });
}

export function markAllNotificationsRead() {
  return request<{ message: string }>("/api/v1/curate-v2/notifications/read-all", {
    method: "PUT",
  });
}
