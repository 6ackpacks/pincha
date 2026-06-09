"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { addVideoToWiki, type VideoResponse } from "@/lib/api/videos";
import { addToQueueAtom } from "@/atoms/queue";

/**
 * Encapsulates wiki compilation polling logic for the video detail page.
 */
export function useWikiCompile(
  videoId: string,
  video: VideoResponse | undefined
) {
  const queryClient = useQueryClient();
  const addToQueue = useSetAtom(addToQueueAtom);

  const [wikiCompiling, setWikiCompiling] = useState(false);
  const [showKBDialog, setShowKBDialog] = useState(false);
  const [flyingItem, setFlyingItem] = useState<{
    title: string;
    key: number;
  } | null>(null);

  const wikiPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wikiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addToWikiMutation = useMutation({
    mutationFn: (kbId?: string) => addVideoToWiki(videoId, kbId),
    onSuccess: (data) => {
      setShowKBDialog(false);
      if (data.already_ingested) {
        queryClient.invalidateQueries({ queryKey: ["video", videoId] });
        return;
      }
      setWikiCompiling(true);
      const title = video?.title || "知识库编译";
      addToQueue({
        id: videoId,
        type: "wiki",
        title,
        state: "processing",
        progress: 0,
        message: "正在编译到知识库…",
      });
      setFlyingItem({ title, key: Date.now() });
      // Poll every 3 s until video.in_wiki becomes true, timeout after 3 min
      wikiPollRef.current = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      }, 3000);
      wikiTimeoutRef.current = setTimeout(() => {
        if (wikiPollRef.current) {
          clearInterval(wikiPollRef.current);
          wikiPollRef.current = null;
        }
        setWikiCompiling(false);
        queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      }, 3 * 60 * 1000);
    },
  });

  // Stop polling when video.in_wiki becomes true
  useEffect(() => {
    if (video?.in_wiki && wikiCompiling) {
      setWikiCompiling(false);
      if (wikiPollRef.current) clearInterval(wikiPollRef.current);
      if (wikiTimeoutRef.current) clearTimeout(wikiTimeoutRef.current);
      queryClient.invalidateQueries({ queryKey: ["wiki-graph"] });
      queryClient.invalidateQueries({ queryKey: ["wiki-pages"] });
    }
  }, [video?.in_wiki, wikiCompiling, queryClient]);

  // Cleanup wiki poll and timeout on unmount
  useEffect(() => {
    return () => {
      if (wikiPollRef.current) clearInterval(wikiPollRef.current);
      if (wikiTimeoutRef.current) clearTimeout(wikiTimeoutRef.current);
    };
  }, []);

  return {
    wikiCompiling,
    addToWikiMutation,
    showKBDialog,
    setShowKBDialog,
    flyingItem,
    setFlyingItem,
  };
}
