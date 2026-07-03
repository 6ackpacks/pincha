"use client";

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  getVideo,
  getVideoProgress,
  getTranscript,
  getMindmap,
  deleteVideo,
  reprocessVideo,
  subscribeVideoSSE,
  type VideoStatus,
} from "@/lib/api/videos";
import type { ProgressData } from "@/lib/api/client";
import { useBufferedStream } from "./use-buffered-stream";
import {
  trackStreamingUIEvent,
  recordStreamingMetric,
  createGenerationId,
  getUiSessionId,
  startLongTaskObserver,
  nowMs,
  type StreamingTrace,
} from "@/lib/streaming-telemetry";

export interface SSELoadingState {
  subtitle: boolean;
  summary: boolean;
  mindmap: boolean;
}

export type SSEConnectionState = "connected" | "reconnecting" | "disconnected" | "idle";

/**
 * Encapsulates all data-fetching (queries + mutations) for the video detail page.
 * Uses SSE with named events for real-time progress, streaming summary, and
 * stage-completion signals.
 */
export function useVideoPageData(videoId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Track consecutive errors to implement circuit-breaker
  const errorCountRef = useRef(0);
  const pollCountRef = useRef(0);

  // Track streamed summary content for direct cache injection on done
  const streamContentRef = useRef("");

  // Track whether the buffered stream has been activated for the current run
  const streamingActiveRef = useRef(false);

  // Idempotency guard: finalize (cache injection + refetch) runs exactly once
  // per generation run. onDone fires twice (explicit done message + natural
  // onClose); only the first should take effect. Reset on reprocess/resubscribe.
  const finalizedRef = useRef(false);

  // Holds the active SSE cleanup so onDone can proactively close the connection.
  const sseCleanupRef = useRef<(() => void) | null>(null);

  // Tracks whether the current run ended in failure. onDone fires for both
  // `done` and `failed` terminal states; finalize must NOT inject streamed
  // (possibly partial) content as a final summary when the run failed.
  const runFailedRef = useRef(false);

  // Track which stages we've already invalidated to avoid redundant calls during polling
  const invalidatedStagesRef = useRef<Set<string>>(new Set());

  // --- PR2: backend-authoritative generation + seq tracking ----------------
  // The backend stamps each summary-stream event with a `generation_id` (one
  // per generation round; regenerate uses a fresh one) and a per-video
  // monotonic `seq`. We treat the FIRST generation_id seen in the current round
  // as authoritative and DROP any delta carrying a different one (stale residue
  // / cross-talk from a previous round). Reset to null on terminal (done/failed)
  // and on reprocess so the next round adopts its own id. The PR1 front-end
  // `generationId` above stays the telemetry trace dimension; this is a
  // separate filter that only engages when the backend actually sends an id
  // (so PR1's id-less delta tests are unaffected).
  const backendGenerationIdRef = useRef<string | null>(null);
  // Highest summary-stream seq seen — used for reconnect telemetry context.
  // (Actual replay resume via after_seq/Last-Event-ID lives in the SSE client.)
  const maxSeqRef = useRef(0);

  const noteSeq = useCallback((seq: number | undefined) => {
    if (typeof seq === "number" && Number.isFinite(seq) && seq > maxSeqRef.current) {
      maxSeqRef.current = seq;
    }
  }, []);

  // --- Streaming UI telemetry ---------------------------------------------
  // Front-end-only generation identifier: one per generation run. Regenerated
  // on new subscription (videoId change) and on reprocess; lazily created on
  // the first delta if absent. PR2 will introduce a backend generation_id; for
  // now this is purely a client-side trace dimension.
  const generationIdRef = useRef<string>(createGenerationId());
  const uiSessionId = getUiSessionId();
  // Exposed via state so SummaryPanel re-renders with the fresh generation_id.
  const [generationId, setGenerationId] = useState<string>(generationIdRef.current);
  // Timestamp (monotonic) of sse_open, to compute first_delta_latency_ms.
  const sseOpenAtRef = useRef<number | null>(null);
  // Whether the first delta of the current generation has been seen.
  const firstDeltaSeenRef = useRef(false);
  // Whether sse_open has been emitted for the current run.
  const sseOpenedRef = useRef(false);
  // Current active level (best-effort, for trace tagging).
  const activeLevelRef = useRef<string | null>(null);

  const newGeneration = useCallback(() => {
    const id = createGenerationId();
    generationIdRef.current = id;
    sseOpenAtRef.current = null;
    firstDeltaSeenRef.current = false;
    sseOpenedRef.current = false;
    setGenerationId(id);
    return id;
  }, []);

  // Build the current telemetry trace (reads refs so callbacks stay closure-safe).
  const buildTrace = useCallback(
    (): StreamingTrace => ({
      video_id: videoId,
      generation_id: generationIdRef.current,
      ui_session_id: uiSessionId,
      active_level: activeLevelRef.current,
    }),
    [videoId, uiSessionId],
  );

  // Long task observer: attributes >100ms main-thread blocks to the current
  // generation. Safe no-op on SSR / unsupported browsers.
  useEffect(() => {
    const cleanup = startLongTaskObserver(() => buildTrace());
    return cleanup;
  }, [buildTrace]);

  // SSE-based real-time progress state
  const [liveProgress, setLiveProgress] = useState<VideoStatus | null>(null);
  const liveProgressRef = useRef<VideoStatus | null>(null);

  // Keep ref in sync for access in SSE callbacks without stale closures
  useEffect(() => {
    liveProgressRef.current = liveProgress;
  }, [liveProgress]);

  // Streaming summary delta (buffered for 50ms to avoid per-token re-renders)
  const { text: streamingSummary, appendToken: appendSummaryToken, start: startStream, stop: stopStream } = useBufferedStream();

  // Loading state per section (driven by SSE events)
  const [sseLoading, setSSELoading] = useState<SSELoadingState>({
    subtitle: true,
    summary: true,
    mindmap: true,
  });

  // SSE connection state for UI indicators
  const [sseConnectionState, setSSEConnectionState] = useState<SSEConnectionState>("idle");

  // Polling fallback interval (null = no polling)
  const [fallbackPollInterval, setFallbackPollInterval] = useState<number | null>(null);

  // 无字幕失败时弹窗提示（后端 SSE 推送 state="failed" + error_code="NO_SUBTITLE"）
  const [showNoSubtitle, setShowNoSubtitle] = useState(false);

  const refreshVideoArtifacts = useCallback((terminalProgress?: VideoStatus) => {
    if (terminalProgress) {
      setLiveProgress(terminalProgress);
      queryClient.setQueryData(["videoProgress", videoId], terminalProgress);
    }

    setSSELoading({ subtitle: false, summary: false, mindmap: false });

    const gid = generationIdRef.current;
    const baseTrace = {
      video_id: videoId,
      generation_id: gid,
      ui_session_id: uiSessionId,
      active_level: activeLevelRef.current,
    };
    trackStreamingUIEvent({ ...baseTrace, event_type: "query_refetch_started", source: "refetch", reason: "refreshVideoArtifacts" });
    void Promise.all([
      queryClient.refetchQueries({ queryKey: ["summaryAvailable", videoId] }),
      queryClient.refetchQueries({ queryKey: ["video", videoId] }),
      queryClient.refetchQueries({ queryKey: ["transcript", videoId] }),
      queryClient.refetchQueries({ queryKey: ["mindmap", videoId] }),
    ]).then(() => {
      trackStreamingUIEvent({ ...baseTrace, event_type: "query_refetch_success", source: "refetch", reason: "refreshVideoArtifacts" });
    });
    // NOTE: intentionally do NOT invalidate/refetch ["summary", videoId] here.
    // The detailed level is injected by onDone (full final content) and
    // highlight/express are refetched precisely by onLevelReady. A wildcard
    // invalidate would mark the injected detailed cache stale and refetch it,
    // briefly emptying summary while the DB write lags → key falls back to
    // streaming → second flicker.
  }, [queryClient, videoId, uiSessionId]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteVideo(videoId),
    onSuccess: () => router.push("/videos"),
  });

  const reprocessMutation = useMutation({
    mutationFn: () => reprocessVideo(videoId),
    onSuccess: () => {
      pollCountRef.current = 0;
      invalidatedStagesRef.current.clear();
      setLiveProgress(null);
      streamContentRef.current = "";
      streamingActiveRef.current = true;
      // New generation run: allow finalize to run once again and clear failure flag.
      finalizedRef.current = false;
      runFailedRef.current = false;
      // New generation round → forget the previous backend generation id + seq
      // so the new round adopts its own authoritative id (and accepts its deltas).
      backendGenerationIdRef.current = null;
      maxSeqRef.current = 0;
      // New generation run → fresh generation_id for telemetry trace.
      newGeneration();
      startStream();
      setSSELoading({ subtitle: true, summary: true, mindmap: true });
      queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      queryClient.invalidateQueries({ queryKey: ["videoProgress", videoId] });
    },
  });

  // Subscribe to enhanced SSE progress stream with named events
  useEffect(() => {
    if (!videoId) return;

    setSSEConnectionState("idle");
    // Fresh subscription = fresh run: reset finalize/failure guards so this
    // run's onDone can finalize exactly once.
    finalizedRef.current = false;
    runFailedRef.current = false;
    // Fresh subscription: forget any prior backend generation id / seq.
    backendGenerationIdRef.current = null;
    maxSeqRef.current = 0;

    const cleanup = subscribeVideoSSE(videoId, {
      onProgress: (data: ProgressData) => {
        setLiveProgress(data);
        errorCountRef.current = 0;

        // First sign the connection is live → emit sse_open once per run and
        // stamp the monotonic clock for first_delta_latency_ms.
        if (!sseOpenedRef.current) {
          sseOpenedRef.current = true;
          sseOpenAtRef.current = nowMs();
          trackStreamingUIEvent({
            ...buildTrace(),
            event_type: "sse_open",
            source: "snapshot",
          });
        }

        // 无字幕失败：弹出 NoSubtitleDialog 提示
        if (data.state === "failed" && data.error_code === "NO_SUBTITLE") {
          setShowNoSubtitle(true);
        }

        // When done/failed, force refetch all dependent data (not just invalidate)
        if (data.state === "done" || data.state === "failed") {
          if (data.state === "failed") runFailedRef.current = true;
          refreshVideoArtifacts(data);
        }
      },
      onSubtitleReady: () => {
        setSSELoading(prev => ({ ...prev, subtitle: false }));
        // Refetch transcript data now that subtitles are ready
        queryClient.invalidateQueries({ queryKey: ["transcript", videoId] });
      },
      onDelta: (data) => {
        // PR2: seq high-water mark (the SSE client already deduped replays;
        // this is for telemetry/reconnect context).
        noteSeq(data.seq);

        // PR2: backend generation_id is authoritative. Adopt the first id seen
        // this round; drop deltas that carry a *different* id (stale residue /
        // cross-talk). Events without an id pass through (PR1 behaviour intact).
        const incomingGen = data.generation_id ?? null;
        if (incomingGen) {
          if (backendGenerationIdRef.current === null) {
            backendGenerationIdRef.current = incomingGen;
          } else if (backendGenerationIdRef.current !== incomingGen) {
            trackStreamingUIEvent({
              ...buildTrace(),
              event_type: "stream_delta_dropped_stale_generation",
              source: data.is_replay ? "replay" : "delta",
              seq: data.seq,
              reason: `incoming ${incomingGen} != active ${backendGenerationIdRef.current}`,
            });
            return; // discard stale-generation delta
          }
        }

        // First delta activates streaming state — covers both first submit and reprocess
        if (!streamingActiveRef.current) {
          startStream();
          streamingActiveRef.current = true;
        }
        const delta = data.content || data.delta || "";
        if (data.level || data.summary_level) {
          activeLevelRef.current = data.level ?? data.summary_level ?? activeLevelRef.current;
        }

        // Lazily create a generation_id if none was established yet (e.g. first
        // delta arrives before any explicit (re)subscription reset).
        if (!firstDeltaSeenRef.current) {
          firstDeltaSeenRef.current = true;
          if (sseOpenAtRef.current !== null) {
            recordStreamingMetric(
              generationIdRef.current,
              "first_delta_latency_ms",
              nowMs() - sseOpenAtRef.current,
            );
          }
        }

        trackStreamingUIEvent({
          ...buildTrace(),
          event_type: "stream_delta_received",
          source: data.is_replay ? "replay" : "delta",
          seq: data.seq,
          content_length: delta.length,
        });

        streamContentRef.current += delta;
        appendSummaryToken(delta);

        trackStreamingUIEvent({
          ...buildTrace(),
          event_type: "stream_delta_applied",
          source: data.is_replay ? "replay" : "delta",
          seq: data.seq,
          content_length: streamContentRef.current.length,
        });
      },
      onReset: (data) => {
        noteSeq(data.seq);
        // Adopt generation id if this reset is the first event of the round.
        if (data.generation_id && backendGenerationIdRef.current === null) {
          backendGenerationIdRef.current = data.generation_id;
        }
        // Fallback retry: discard everything shown for this round so far and
        // wait for fresh delta/snapshot to rebuild. NOT a finalize.
        streamContentRef.current = "";
        startStream(); // clears useBufferedStream accumulation (text + buffers)
        streamingActiveRef.current = true;
        trackStreamingUIEvent({
          ...buildTrace(),
          event_type: "stream_reset_applied",
          source: "snapshot",
          seq: data.seq,
          reason: data.reason
            ? `reset (${data.reason}${data.attempt ? ` attempt ${data.attempt}` : ""})`
            : "reset",
        });
      },
      onSnapshot: (data) => {
        noteSeq(data.seq);
        if (data.generation_id && backendGenerationIdRef.current === null) {
          backendGenerationIdRef.current = data.generation_id;
        }
        // Full content replacement (buffer-expired fallback / non-streamed L2).
        // Inject straight into the detailed cache and clear streaming state so
        // the panel renders the authoritative content (no append).
        const content = data.content ?? data.delta ?? "";
        const level = data.level ?? data.summary_level ?? "detailed";
        streamContentRef.current = "";
        streamingActiveRef.current = false;
        stopStream();
        if (content) {
          queryClient.setQueryData(
            ["summary", videoId, level],
            (old: Record<string, unknown> | undefined) => ({
              ...(old || {}),
              video_id: videoId,
              level,
              content,
              cached: false,
            }),
          );
        }
        trackStreamingUIEvent({
          ...buildTrace(),
          event_type: "stream_snapshot_applied",
          source: "snapshot",
          seq: data.seq,
          active_level: level,
          content_length: content.length,
          reason: data.is_replay ? "replayed snapshot" : "live snapshot",
        });
      },
      onLevelReady: (data) => {
        activeLevelRef.current = data.level;
        if (data.level === "detailed") {
          // detailed is handled by onDone (cache injection) — refetching summary here
          // would overwrite the in-progress streaming content and cause flicker
          setSSELoading(prev => ({ ...prev, summary: false }));
          queryClient.refetchQueries({ queryKey: ["summaryAvailable", videoId], type: "active" });
          return;
        }
        if (data.level === "highlight") {
          setSSELoading(prev => ({ ...prev, summary: false }));
        }
        // Use refetchQueries (immediate) instead of invalidateQueries (deferred)
        queryClient.refetchQueries({ queryKey: ["summaryAvailable", videoId], type: "active" });
        queryClient.refetchQueries({ queryKey: ["summary", videoId, data.level], type: "active" });
      },
      onMindmapReady: () => {
        setSSELoading(prev => ({ ...prev, mindmap: false }));
        queryClient.invalidateQueries({ queryKey: ["mindmap", videoId] });
      },
      onDone: () => {
        trackStreamingUIEvent({
          ...buildTrace(),
          event_type: "stream_done_received",
          source: "done",
        });
        // Idempotency guard: onDone fires twice (explicit `done` message and
        // the natural onClose). Only finalize once per run — a second pass must
        // not re-inject cache, refetch, or toggle streaming state (would flicker).
        if (finalizedRef.current) {
          trackStreamingUIEvent({
            ...buildTrace(),
            event_type: "stream_finalize_skipped_duplicate",
            source: "done",
            reason: "onDone fired again after finalize",
          });
          return;
        }
        finalizedRef.current = true;

        trackStreamingUIEvent({
          ...buildTrace(),
          event_type: "stream_finalize_started",
          source: "done",
          reason: runFailedRef.current ? "failed-run" : "ok",
        });

        setSSEConnectionState("idle");
        // Inject streamed content directly into cache — zero refetch delay.
        // Skip injection on failed runs: partial streamed content must not be
        // persisted as a final summary.
        const streamedContent = streamContentRef.current;
        if (streamedContent && !runFailedRef.current) {
          queryClient.setQueryData(
            ["summary", videoId, "detailed"],
            (old: Record<string, unknown> | undefined) => ({
              ...(old || {}),
              video_id: videoId,
              level: "detailed",
              content: streamedContent,
              cached: false,
            })
          );
          trackStreamingUIEvent({
            ...buildTrace(),
            event_type: "query_set_data",
            source: "done",
            active_level: "detailed",
            content_length: streamedContent.length,
            reason: "inject streamed detailed content",
          });
        }
        streamContentRef.current = "";
        streamingActiveRef.current = false;
        stopStream();
        const doneTrace = buildTrace();
        trackStreamingUIEvent({ ...doneTrace, event_type: "query_refetch_started", source: "done", reason: "onDone refetch" });
        void Promise.all([
          queryClient.refetchQueries({ queryKey: ["video", videoId] }),
          queryClient.refetchQueries({ queryKey: ["summaryAvailable", videoId] }),
        ]).then(() => {
          trackStreamingUIEvent({ ...doneTrace, event_type: "query_refetch_success", source: "done", reason: "onDone refetch" });
        });
        setSSELoading({ subtitle: false, summary: false, mindmap: false });

        // Proactively close the connection so the natural onClose (which would
        // re-enter onDone) is short-circuited by the guard above anyway, but we
        // also stop the network stream eagerly.
        sseCleanupRef.current?.();
      },
      onError: (err) => {
        console.warn("SSE error", err);
        errorCountRef.current += 1;
      },
      onFallbackToPolling: () => {
        // SSE retries exhausted — start REST polling as degraded fallback
        setFallbackPollInterval(2000);
      },
      onConnectionStateChange: (state) => {
        if (state === "reconnecting") {
          recordStreamingMetric(generationIdRef.current, "sse_reconnect_count", 1);
          trackStreamingUIEvent({
            ...buildTrace(),
            event_type: "sse_reconnect",
            source: "reconnect",
          });
        }
        setSSEConnectionState(state);
      },
    });

    sseCleanupRef.current = cleanup;

    return () => {
      streamingActiveRef.current = false;
      sseCleanupRef.current = null;
      trackStreamingUIEvent({
        ...buildTrace(),
        event_type: "sse_close",
        source: "reconnect",
        reason: "subscribe effect cleanup",
      });
      cleanup();
    };
  }, [
    videoId,
    queryClient,
    refreshVideoArtifacts,
    buildTrace,
    appendSummaryToken,
    noteSeq,
    startStream,
    stopStream,
  ]);

  // Polling fallback: activated when SSE retries are exhausted
  useEffect(() => {
    if (!fallbackPollInterval || !videoId) return;

    const timer = setInterval(async () => {
      try {
        const data = await getVideoProgress(videoId);
        setLiveProgress(data);
        errorCountRef.current = 0;

        // Progressive loading: subtitle ready once we enter summarizing
        if (
          (data.state === "summarizing" || data.state === "generating_mindmap" || data.state === "done" || data.state === "failed") &&
          !invalidatedStagesRef.current.has("subtitle")
        ) {
          invalidatedStagesRef.current.add("subtitle");
          queryClient.invalidateQueries({ queryKey: ["transcript", videoId] });
          setSSELoading(prev => ({ ...prev, subtitle: false }));
        }

        // Progressive loading: summary likely ready at progress >= 80 or in later states
        if (
          (data.progress >= 80 || data.state === "generating_mindmap" || data.state === "done" || data.state === "failed") &&
          !invalidatedStagesRef.current.has("summary")
        ) {
          invalidatedStagesRef.current.add("summary");
          queryClient.invalidateQueries({ queryKey: ["summaryAvailable", videoId] });
          setSSELoading(prev => ({ ...prev, summary: false }));
        }

        if (data.state === "done" || data.state === "failed") {
          setFallbackPollInterval(null);
          refreshVideoArtifacts(data);
        }
      } catch {
        // Transient errors — keep polling
        errorCountRef.current += 1;
      }
    }, fallbackPollInterval);

    return () => clearInterval(timer);
  }, [fallbackPollInterval, videoId, queryClient, refreshVideoArtifacts]);

  useEffect(() => {
    if (!videoId || typeof window === "undefined") return;

    const handleQueueComplete = (event: Event) => {
      const detail = (event as CustomEvent<{
        id?: string;
        type?: string;
        state?: string;
        progress?: number;
        message?: string;
      }>).detail;

      if (detail?.type !== "video" || detail.id !== videoId) return;
      if (detail.state !== "done" && detail.state !== "failed") return;

      refreshVideoArtifacts({
        state: detail.state,
        progress: detail.progress ?? (detail.state === "done" ? 100 : 0),
        message: detail.message ?? "",
      });
    };

    window.addEventListener("pingcha:queue-item-complete", handleQueueComplete);
    return () => window.removeEventListener("pingcha:queue-item-complete", handleQueueComplete);
  }, [videoId, refreshVideoArtifacts]);

  const videoQuery = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => getVideo(videoId),
    enabled: !!videoId,
    staleTime: 30 * 60 * 1000, // metadata stable for 30 min
    // in_wiki can change while away (compile finishes elsewhere); revalidate on
    // every mount so re-entering the page never shows a stale "收进知识库" button.
    refetchOnMount: "always",
  });

  const progressQuery = useQuery({
    queryKey: ["videoProgress", videoId],
    queryFn: async () => {
      pollCountRef.current += 1;
      try {
        const result = await getVideoProgress(videoId);
        errorCountRef.current = 0; // reset on success

        // Progressive data loading: subtitle should be ready once summarizing starts
        if (
          (result.state === "summarizing" || result.state === "generating_mindmap" || result.state === "done" || result.state === "failed") &&
          !invalidatedStagesRef.current.has("subtitle")
        ) {
          invalidatedStagesRef.current.add("subtitle");
          queryClient.invalidateQueries({ queryKey: ["transcript", videoId] });
          setSSELoading(prev => ({ ...prev, subtitle: false }));
        }

        // Progressive data loading: detailed summary likely ready at progress >= 80
        if (
          (result.progress >= 80 || result.state === "generating_mindmap" || result.state === "done" || result.state === "failed") &&
          !invalidatedStagesRef.current.has("summary")
        ) {
          invalidatedStagesRef.current.add("summary");
          queryClient.invalidateQueries({ queryKey: ["summaryAvailable", videoId] });
          setSSELoading(prev => ({ ...prev, summary: false }));
        }

        // When polling detects done/failed, force refetch all dependent data
        if (result.state === "done" || result.state === "failed") {
          refreshVideoArtifacts(result);
        }

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

  // When video is already done on initial load, mark all loading as complete
  useEffect(() => {
    if (videoQuery.data?.status.state === "done") {
      setSSELoading({ subtitle: false, summary: false, mindmap: false });
    }
  }, [videoQuery.data?.status.state]);

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
    streamingSummary,
    sseLoading,
    sseConnectionState,
    showNoSubtitle,
    setShowNoSubtitle,
    generationId,
  };
}
