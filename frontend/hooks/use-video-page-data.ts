"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  getVideo,
  getVideoProgress,
  getTranscript,
  getMindmap,
  deleteVideo,
  reprocessVideo,
  subscribeVideoProgress,
  type VideoStatus,
} from "@/lib/api/videos";

/**
 * Encapsulates all data-fetching (queries + mutations) for the video detail page.
 */
export function useVideoPageData(videoId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Track consecutive errors to implement circuit-breaker
  const errorCountRef = useRef(0);
  const pollCountRef = useRef(0);

  // SSE-based real-time progress state
  const [liveProgress, setLiveProgress] = useState<VideoStatus | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteVideo(videoId),
    onSuccess: () => router.push("/videos"),
  });

  const reprocessMutation = useMutation({
    mutationFn: () => reprocessVideo(videoId),
    onSuccess: () => {
      pollCountRef.current = 0;
      setLiveProgress(null);
      queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      queryClient.invalidateQueries({ queryKey: ["videoProgress", videoId] });
    },
  });

  // Subscribe to SSE progress stream
  useEffect(() => {
    if (!videoId) return;

    const cleanup = subscribeVideoProgress(
      videoId,
      (data) => {
        setLiveProgress(data);
        errorCountRef.current = 0;

        // Trigger refetch of dependent data when stages complete
        if (data.state === "done" || data.state === "failed") {
          queryClient.invalidateQueries({ queryKey: ["video", videoId] });
          queryClient.invalidateQueries({ queryKey: ["transcript", videoId] });
          queryClient.invalidateQueries({ queryKey: ["mindmap", videoId] });
        }
      },
      () => {
        // onDone - final state reached
        queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      },
      (err) => {
        console.warn("SSE error, falling back to polling", err);
        errorCountRef.current += 1;
      }
    );

    return cleanup;
  }, [videoId, queryClient]);

  const videoQuery = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => getVideo(videoId),
    enabled: !!videoId,
    staleTime: 30 * 60 * 1000, // metadata stable for 30 min
  });

  const progressQuery = useQuery({
    queryKey: ["videoProgress", videoId],
    queryFn: async () => {
      pollCountRef.current += 1;
      try {
        const result = await getVideoProgress(videoId);
        errorCountRef.current = 0; // reset on success
        return result;
      } catch (err) {
        errorCountRef.current += 1;
        throw err;
      }
    },
    enabled: !!videoId && !videoQuery.isError && !liveProgress, // Disable polling when SSE is active
    retry: 2,
    refetchInterval: (query) => {
      if (liveProgress) return false; // SSE is handling updates
      const state = query.state.data?.state;
      // Stop polling once processing is complete
      if (state === "done" || state === "failed") return false;
      // Poll every 2.5s while processing
      return 2500;
    },
  });

  const currentStateForQuery =
    liveProgress?.state ?? progressQuery.data?.state ?? videoQuery.data?.status.state;
  // Use videoQuery state as initial signal — don't wait for progressQuery to resolve
  const initialState = videoQuery.data?.status.state;

  // For already-done videos: enable transcript/mindmap immediately from videoQuery state
  const isDoneOrPast = (s?: string) =>
    !!s && !["pending", "downloading", "transcribing"].includes(s);

  const transcriptQuery = useQuery({
    queryKey: ["transcript", videoId],
    queryFn: () => getTranscript(videoId),
    enabled: !!videoId && isDoneOrPast(currentStateForQuery ?? initialState),
    staleTime: Infinity, // transcript never changes once written
  });

  const mindmapQuery = useQuery({
    queryKey: ["mindmap", videoId],
    queryFn: () => getMindmap(videoId),
    enabled:
      !!videoId &&
      (currentStateForQuery === "done" || initialState === "done"),
    staleTime: Infinity, // mindmap never changes once written
  });

  const video = videoQuery.data;
  const progress = liveProgress ?? progressQuery.data;
  const transcript = transcriptQuery.data;
  const segments = useMemo(
    () => transcript?.segments ?? [],
    [transcript?.segments]
  );
  const segmentsEn = useMemo(
    () => transcript?.segments_en ?? null,
    [transcript?.segments_en]
  );

  return {
    videoQuery,
    progressQuery,
    transcriptQuery,
    mindmapQuery,
    deleteMutation,
    reprocessMutation,
    video,
    progress,
    transcript,
    segments,
    segmentsEn,
    errorCountRef,
    pollCountRef,
    queryClient,
    liveProgress,
  };
}
