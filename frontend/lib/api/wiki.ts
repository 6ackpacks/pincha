import { request, getActiveKbHeaders } from "./client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface WikiPageSummary {
  id: string;
  title: string;
  slug: string;
  type: "concept" | "entity" | "method" | "source" | "insight";
  summary: string | null;
  source_count: number;
  status: string;
  has_contradiction: boolean;
  community_id: number | null;
  tags: string[];
  updated_at: string;
  highlight?: string | null;
}

export interface WikiSourceInfo {
  id: string;
  source_type: string;
  source_id: string;
  contribution: string | null;
  created_at: string;
}

export interface WikiRelationInfo {
  id: string;
  to_page_id: string;
  to_page_slug: string;
  to_page_title: string;
  relation_type: string;
  strength: number;
}

export interface WikiBacklinkInfo {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
}

export interface WikiPageDetail extends WikiPageSummary {
  content: string;
  sources: WikiSourceInfo[];
  relations: WikiRelationInfo[];
  backlinks: WikiBacklinkInfo[];
  contradiction_details: ContradictionDetail[];
  review_items: ReviewItem[];
}

export interface ContradictionDetail {
  entity: string;
  claim: string;
  existing_claim: string;
  severity: "minor" | "major";
  suggestion?: string;
}

export interface ReviewItem {
  type: "contradiction" | "duplicate" | "missing_page" | "suggestion";
  description: string;
  action: string;
  resolved: boolean;
}

export interface WikiQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface WikiVideoPageRef {
  id: string;
  title: string;
  slug: string;
}

export interface WikiVideoItem {
  id: string;
  title: string | null;
  thumbnail_url: string | null;
  created_at: string;
  wiki_pages: WikiVideoPageRef[];
}

export interface GraphNode {
  id: string;
  title: string;
  slug: string;
  type: string;
  community_id: number | null;
  source_count: number;
}

export interface GraphEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation_type: string;
  strength: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LocalGraphNode extends GraphNode {
  is_center: boolean;
}

export interface LocalGraphData {
  nodes: LocalGraphNode[];
  edges: GraphEdge[];
}

export interface CompileStatus {
  state: "idle" | "analyzing" | "extracting" | "done" | "failed";
  progress: number;
  message: string;
}

export interface UnlinkedMention {
  page_id: string;
  page_title: string;
  page_slug: string;
  context: string;
}

export interface KnowledgeHealth {
  isolated_pages: { id: string; title: string; slug: string }[];
  sparse_communities: { community_id: number; page_count: number; cohesion: number }[];
  bridge_nodes: { id: string; title: string; slug: string; communities_connected: number }[];
  overall_score: number;
}

export interface TagTreeNode {
  name: string;
  full_path: string;
  count: number;
  children: TagTreeNode[];
}

export function getWikiPages(offset = 0, limit = 20, tag?: string) {
  let url = `/api/v1/wiki/pages?offset=${offset}&limit=${limit}`;
  if (tag) url += `&tag=${encodeURIComponent(tag)}`;
  return request<WikiPageSummary[]>(url);
}

export function getWikiPage(slug: string) {
  return request<WikiPageDetail>(`/api/v1/wiki/pages/${slug}`);
}

export function searchWiki(q: string, limit = 10) {
  return request<WikiPageSummary[]>(
    `/api/v1/wiki/search?q=${encodeURIComponent(q)}&limit=${limit}`
  );
}

export function getRandomWikiPage() {
  return request<WikiPageSummary>("/api/v1/wiki/random");
}

export function getWikiQuota() {
  return request<WikiQuota>("/api/v1/wiki/quota");
}

export function getWikiVideos() {
  return request<WikiVideoItem[]>("/api/v1/wiki/videos");
}

export function getWikiGraph() {
  return request<GraphData>("/api/v1/wiki/graph");
}

export function getLocalGraph(pageId: string, depth = 1) {
  return request<LocalGraphData>(`/api/v1/wiki/pages/${pageId}/local-graph?depth=${depth}`);
}

export function resolveReviewItem(pageId: string, itemIndex: number) {
  return request<{ success: boolean }>(
    `/api/v1/wiki/pages/${pageId}/review-items/${itemIndex}/resolve`,
    { method: "POST" }
  );
}

export function createWikiPage(data: {
  title: string;
  content?: string;
  summary?: string;
  tags?: string[];
  type?: string;
}) {
  return request<WikiPageDetail>("/api/v1/wiki/pages", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateWikiPage(
  pageId: string,
  data: {
    title?: string;
    content?: string;
    summary?: string;
    tags?: string[];
    type?: string;
  }
) {
  return request<WikiPageDetail>(`/api/v1/wiki/pages/${pageId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteWikiPage(pageId: string) {
  return request<{ message: string }>(`/api/v1/wiki/pages/${pageId}`, {
    method: "DELETE",
  });
}

export function getCompileStatus(videoId: string) {
  return request<CompileStatus>(`/api/v1/wiki/compile-status/${videoId}`);
}

export function getWikiCompileProgress(videoId: string) {
  return request<{ state: string; progress: number; message: string }>(`/api/v1/wiki/compile-status/${videoId}`);
}

export function getUnlinkedMentions(pageId: string) {
  return request<UnlinkedMention[]>(`/api/v1/wiki/pages/${pageId}/unlinked-mentions`);
}

export function linkMention(pageId: string, data: { source_page_id: string; mention_text: string }) {
  return request<{ success: boolean; page_id: string; slug: string }>(
    `/api/v1/wiki/pages/${pageId}/link-mention`,
    { method: "POST", body: JSON.stringify(data) }
  );
}

export function getKnowledgeHealth() {
  return request<KnowledgeHealth>("/api/v1/wiki/health");
}

export function getWikiTags() {
  return request<TagTreeNode[]>("/api/v1/wiki/tags");
}

export function streamWikiAsk(
  question: string,
  topic?: string,
  history?: Array<{role: string; content: string}>,
  options?: { signal?: AbortSignal },
): Promise<ReadableStream<Uint8Array>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getActiveKbHeaders(),
  };
  return fetch(`${API_BASE}/api/v1/wiki/ask`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ question, topic, history }),
    signal: options?.signal,
  }).then((res) => {
    if (!res.ok) {
      return res.json().catch(() => ({})).then((body) => {
        throw new Error(body.detail || `Wiki ask failed: ${res.status}`);
      });
    }
    return res.body!;
  });
}
