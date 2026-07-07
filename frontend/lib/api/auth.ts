import { request } from "./client";

export interface CurrentUser {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  is_admin?: boolean;
}

export function getMe() {
  return request<CurrentUser>("/api/v1/auth/me");
}
