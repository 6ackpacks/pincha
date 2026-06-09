import { request, subscribeProgress } from "./client";
import type { ProgressData } from "./client";
import type { SummaryLevel } from "./videos";

export type { SummaryLevel } from "./videos";

export interface ArticleSummary {
  id: string;
  source_type: string;
  source_url: string | null;
  title: string | null;
  status: { state: string; progress: number; message: string };
  in_wiki: boolean;
  created_at: string;
}

export interface ArticleStatus {
  state: string;
  progress: number;
  message: string;
}

export interface ArticleAnalysisResponse {
  id: string;
  source_type: string;
  source_url: string | null;
  title: string | null;
  author: string | null;
  thumbnail_url: string | null;
  word_count: number | null;
  language: string | null;
  content: string | null;
  status: ArticleStatus;
  in_wiki: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface ArticleSummaryAnalysis {
  id: string;
  article_id: string;
  level: string;
  content: string;
  model_used: string;
  created_at: string;
  cached: boolean;
}

export interface ArticleMindmapResponse {
  id: string;
  article_id: string;
  markdown: string;
  model_used: string;
  created_at: string;
  cached: boolean;
}

export function createArticle(data: {
  source_type: "url" | "text";
  source_url?: string;
  title?: string;
  content?: string;
}) {
  return request<ArticleSummary>("/api/v1/wiki/articles", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getArticles() {
  return request<ArticleSummary[]>("/api/v1/wiki/articles");
}

export function deleteArticle(id: string) {
  return request<{ message: string }>(`/api/v1/wiki/articles/${id}`, {
    method: "DELETE",
  });
}

export function getTrendingArticles(limit = 20) {
  return request<ArticleAnalysisResponse[]>(`/api/v1/articles/trending?limit=${limit}`);
}

export function submitArticle(url: string, content?: string) {
  const body: Record<string, string> = {};
  if (url) body.url = url;
  if (content) body.content = content;
  return request<ArticleAnalysisResponse>("/api/v1/articles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getArticlesList() {
  return request<ArticleAnalysisResponse[]>("/api/v1/articles");
}

export function getArticleAnalysis(id: string) {
  return request<ArticleAnalysisResponse>(`/api/v1/articles/${id}`);
}

export function getArticleProgress(id: string) {
  return request<ArticleStatus>(`/api/v1/articles/${id}/progress`);
}

export function deleteArticleAnalysis(id: string) {
  return request<void>(`/api/v1/articles/${id}`, { method: "DELETE" });
}

export function reprocessArticle(id: string) {
  return request<ArticleAnalysisResponse>(`/api/v1/articles/${id}/reprocess`, { method: "POST" });
}

export function getArticleAnalysisSummary(articleId: string, level: SummaryLevel) {
  return request<ArticleSummaryAnalysis>(`/api/v1/articles/${articleId}/summary/${level}`);
}

export function regenerateArticleSummary(articleId: string, level: SummaryLevel) {
  return request<ArticleSummaryAnalysis>(`/api/v1/articles/${articleId}/summary/${level}/regenerate`, {
    method: "POST",
  });
}

export function triggerFullArticleSummary(articleId: string) {
  return request<{ status: string; task_id?: string }>(
    `/api/v1/articles/${articleId}/summary/full/generate`,
    { method: "POST" }
  );
}

export function getArticleAnalysisMindmap(articleId: string) {
  return request<ArticleMindmapResponse>(`/api/v1/articles/${articleId}/mindmap`);
}

export function regenerateArticleMindmap(articleId: string) {
  return request<ArticleMindmapResponse>(`/api/v1/articles/${articleId}/mindmap/regenerate`, {
    method: "POST",
  });
}

export function subscribeArticleProgress(
  articleId: string,
  onProgress: (data: ProgressData) => void,
  onDone?: () => void,
  onError?: (err: Event) => void,
): () => void {
  return subscribeProgress(
    `/api/v1/articles/${articleId}/progress/stream`,
    `/api/v1/articles/${articleId}/progress`,
    onProgress,
    onDone,
    onError,
  );
}
