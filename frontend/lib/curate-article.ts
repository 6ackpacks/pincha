"use client";

import type { QueueItem } from "@/atoms/queue";
import type { ArticleStatus } from "@/lib/api/articles";

type CurateArticleLike = {
  article_id: string | null;
  article_status?: ArticleStatus | null;
  article_in_wiki?: boolean;
  title: string;
};

export type CurateImportUiState = "idle" | "loading" | "success" | "error";

export function getCurateImportUiState(pick: CurateArticleLike): CurateImportUiState {
  if (pick.article_in_wiki) return "success";

  const state = pick.article_status?.state;
  if (!pick.article_id || !state) return "idle";
  if (state === "failed") return "error";
  if (state === "done") return "success";
  return "loading";
}

export function shouldTrackCurateArticle(pick: CurateArticleLike): boolean {
  return getCurateImportUiState(pick) === "loading" && Boolean(pick.article_id);
}

export function buildCurateQueueItem(pick: CurateArticleLike): Omit<QueueItem, "addedAt"> | null {
  if (!pick.article_id) return null;
  return {
    id: pick.article_id,
    type: "article",
    title: pick.title,
    state: "processing",
    progress: pick.article_status?.progress ?? 0,
    message: pick.article_status?.message ?? "等待深度分析...",
  };
}
