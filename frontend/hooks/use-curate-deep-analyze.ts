"use client";

import { useEffect } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { addToQueueAtom } from "@/atoms/queue";
import { getArticleProgress } from "@/lib/api/articles";
import { triggerDeepAnalyze, type CurateV2Pick, type PickDetail } from "@/lib/api/curate";
import { buildCurateQueueItem, shouldTrackCurateArticle } from "@/lib/curate-article";

type CurateAnalyzablePick = PickDetail | CurateV2Pick;

export function useCurateDeepAnalyze(queryKeysToInvalidate: QueryKey[] = []) {
  const queryClient = useQueryClient();
  const addToQueue = useSetAtom(addToQueueAtom);

  return useMutation({
    mutationFn: async (pick: CurateAnalyzablePick) => {
      const result = await triggerDeepAnalyze(pick.id);
      return { result, pick };
    },
    onSuccess: async ({ result, pick }) => {
      try {
        const progress = await getArticleProgress(result.article_id);
        if (progress.state !== "done" && progress.state !== "failed") {
          addToQueue({
            id: result.article_id,
            type: "article",
            title: pick.title,
            state: "processing",
            progress: progress.progress,
            message: progress.message || "等待深度分析...",
          });
        }
      } catch {
        addToQueue({
          id: result.article_id,
          type: "article",
          title: pick.title,
          state: "processing",
          progress: 0,
          message: result.message || "等待深度分析...",
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-detail", pick.id] }),
        queryClient.invalidateQueries({ queryKey: ["articles-list"] }),
        ...queryKeysToInvalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ]);
    },
  });
}

export function useSyncCurateArticleQueue(pick: CurateAnalyzablePick | null | undefined) {
  const addToQueue = useSetAtom(addToQueueAtom);

  useEffect(() => {
    if (!pick || !shouldTrackCurateArticle(pick)) return;
    const queueItem = buildCurateQueueItem(pick);
    if (queueItem) addToQueue(queueItem);
  }, [addToQueue, pick]);
}
