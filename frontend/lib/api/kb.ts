import { request } from "./client";

// ─── Knowledge Bases ─────────────────────────────────────────────────────────

export interface KnowledgeBaseItem {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
}

export function listKBs() {
  return request<KnowledgeBaseItem[]>("/api/v1/kbs");
}

export function createKB(data: { name: string; description?: string }) {
  return request<KnowledgeBaseItem>("/api/v1/kbs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateKB(kbId: string, data: { name?: string; description?: string }) {
  return request<KnowledgeBaseItem>(`/api/v1/kbs/${kbId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteKB(kbId: string) {
  return request<void>(`/api/v1/kbs/${kbId}`, { method: "DELETE" });
}

// ─── KB Conversations ────────────────────────────────────────────────────────

export interface KBConversation {
  id: string;
  title: string;
  messages: { role: string; content: string }[];
  created_at: string;
  updated_at: string;
}

export function listConversations(kbId: string) {
  return request<KBConversation[]>(`/api/v1/kbs/${kbId}/conversations`);
}

export function createConversation(kbId: string, title?: string) {
  return request<KBConversation>(`/api/v1/kbs/${kbId}/conversations`, {
    method: "POST",
    body: JSON.stringify({ title: title || "新对话" }),
  });
}

export function updateConversation(kbId: string, convoId: string, data: { title?: string; messages?: { role: string; content: string }[] }) {
  return request<KBConversation>(`/api/v1/kbs/${kbId}/conversations/${convoId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteConversation(kbId: string, convoId: string) {
  return request<void>(`/api/v1/kbs/${kbId}/conversations/${convoId}`, { method: "DELETE" });
}
