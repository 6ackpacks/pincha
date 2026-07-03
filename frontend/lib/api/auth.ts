import { request } from "./client";

// Use relative path by default so requests go through nginx proxy in Docker.
// Only use NEXT_PUBLIC_API_URL if explicitly set (e.g. local dev without nginx).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface CurrentUser {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  is_admin?: boolean;
}

export interface SessionInfo {
  jti: string;
  is_current: boolean;
  created_at: number;
  user_agent: string;
  ip: string;
}

export function getMe() {
  return request<CurrentUser>("/api/v1/auth/me");
}

export async function logout() {
  await fetch(`${API_BASE}/api/v1/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export function refreshSession() {
  return request<{ message: string }>("/api/v1/auth/refresh", { method: "POST" });
}

export function getSessions() {
  return request<SessionInfo[]>("/api/v1/auth/sessions");
}

export function revokeSession(jti: string) {
  return request<{ message: string }>(`/api/v1/auth/sessions/${jti}`, { method: "DELETE" });
}
