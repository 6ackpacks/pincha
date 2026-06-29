import { request } from "./client";
import { getQueryClient } from "@/lib/query-client";

// Use relative path by default so requests go through nginx proxy in Docker.
// Only use NEXT_PUBLIC_API_URL if explicitly set (e.g. local dev without nginx).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface CurrentUser {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  email: string | null;
  is_admin?: boolean;
}

export function getMe() {
  return request<CurrentUser>("/api/v1/auth/me");
}

export async function logout() {
  await fetch(`${API_BASE}/api/v1/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  // Immediately clear the cached user so the sidebar re-renders with the
  // logged-out state (default avatar) before the redirect.
  getQueryClient().setQueryData(["me"], null);
}
