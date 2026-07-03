"use client";

import { useState, useEffect, useRef, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { cdnUrl } from "@/lib/cdn";
import { DownloadSimple, FileText, CircleNotch, ListBullets, Cursor } from "@phosphor-icons/react";
import {
  getSummary,
  regenerateSummaryStream,
  getAvailableSummaryLevels,
  triggerFullSummary,
  type SummaryLevel,
  type SummaryResponse,
} from "@/lib/api/videos";
import { SummaryCardExport } from "./summary-card-export";
import { SUMMARY_LEVELS } from "@/lib/constants";
import { LoadingPlaceholder, MascotLoading, StreamingIndicator } from "@/components/ui/loading-placeholder";
import {
  trackStreamingUIEvent,
  recordStreamingMetric,
  nowMs,
  STREAMING_THRESHOLDS,
} from "@/lib/streaming-telemetry";

interface SummaryPanelProps {
  videoId: string;
  videoTitle?: string;
  thumbnail?: string;
  isDone?: boolean;
  currentState?: string;
  streamingSummary?: string;
  /** Front-end-only generation trace id (one per generation run). */
  generationId?: string;
}

// Block-level memoization to avoid re-rendering completed paragraphs during streaming
const MemoizedMarkdownBlock = memo(({ content }: { content: string }) => (
  <ReactMarkdown>{content}</ReactMarkdown>
));
MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

function StreamingMarkdown({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const blocks = useMemo(() => {
    const parts = content.split(/\n\n+/);
    return parts.filter(p => p.trim());
  }, [content]);

  if (!content) return null;

  return (
    <>
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1;
        if (isLast && isStreaming) {
          // Last block (still being written) — don't memo
          return <ReactMarkdown key={`live-${i}`}>{block}</ReactMarkdown>;
        }
        return <MemoizedMarkdownBlock key={`block-${i}`} content={block} />;
      })}
    </>
  );
}

export default function SummaryPanel({ videoId, videoTitle, thumbnail, isDone, currentState, streamingSummary, generationId }: SummaryPanelProps) {
  const [activeLevel, setActiveLevel] = useState<SummaryLevel | null>(null);
  const [fullGenerating, setFullGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamTimeout, setStreamTimeout] = useState(false);
  const [forceLoadedLevels, setForceLoadedLevels] = useState<string[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSelectedRef = useRef(false);
  const queryClient = useQueryClient();

  // --- Streaming UI telemetry ---------------------------------------------
  // Stable generation id for trace tagging (defaults when parent omits it).
  const gid = generationId ?? "no-generation";
  // render counter: bumped every render; bumps during streaming feed the
  // render_count_during_stream metric.
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  // Previous AnimatePresence key, to detect remount-triggering key changes.
  const prevKeyRef = useRef<string | null>(null);
  // Timestamp (monotonic) of the latest streamingSummary change, for delta→paint.
  const lastStreamChangeAtRef = useRef<number | null>(null);
  // Timestamp (monotonic) when isDone first became true, for finalize→stable.
  const finalizeStartedAtRef = useRef<number | null>(null);
  const finalizeStableRecordedRef = useRef(false);
  // Whether the displayed summary content was non-empty last render (empty/restore).
  const wasContentNonEmptyRef = useRef(false);

  const isSummarizing =
    currentState === "summarizing" || currentState === "generating_mindmap";

  // Track when isDone first becomes true to implement a grace period for cache propagation
  const [doneTimestamp, setDoneTimestamp] = useState<number | null>(null);
  const [pastGracePeriod, setPastGracePeriod] = useState(false);
  useEffect(() => {
    if (isDone && !doneTimestamp) {
      setDoneTimestamp(Date.now());
      setPastGracePeriod(false);
      const timer = setTimeout(() => setPastGracePeriod(true), 3000);
      return () => clearTimeout(timer);
    } else if (!isDone) {
      setDoneTimestamp(null);
      setPastGracePeriod(false);
    }
  }, [isDone, doneTimestamp]);

  const { data: availableLevels } = useQuery<string[]>({
    queryKey: ["summaryAvailable", videoId],
    queryFn: () => getAvailableSummaryLevels(videoId),
    enabled: !!videoId && (isSummarizing || !!isDone),
    staleTime: 0,
    refetchInterval: (query) => {
      const count = (query.state.data ?? []).length;
      const allReady = count >= 3 && (!fullGenerating || count >= 4);
      return isSummarizing || fullGenerating || (isDone && !allReady) ? 2000 : false;
    },
  });

  const availableSet = new Set([
    ...(availableLevels ?? []),
    ...(forceLoadedLevels ?? []),
  ]);

  // Force-load available levels when isDone becomes true (fallback mechanism)
  // No delay — fetch immediately so detailed summary displays as soon as possible.
  useEffect(() => {
    if (!isDone || !videoId) return;
    let cancelled = false;

    const applyLevels = (levels: string[]) => {
      if (cancelled) return;
      setForceLoadedLevels(levels);
      queryClient.refetchQueries({ queryKey: ["summaryAvailable", videoId] });
      for (const level of levels) {
        queryClient.invalidateQueries({ queryKey: ["summary", videoId, level] });
      }
      if (!activeLevel && !userSelectedRef.current) {
        setActiveLevel(levels.includes("detailed") ? "detailed" : levels[0] as SummaryLevel);
      }
    };

    (async () => {
      try {
        const levels = await getAvailableSummaryLevels(videoId);
        if (levels && levels.length > 0) {
          applyLevels(levels);
        }
      } catch {
        // First attempt failed — retry once after 500ms
        if (cancelled) return;
        setTimeout(async () => {
          try {
            const levels = await getAvailableSummaryLevels(videoId);
            if (levels && levels.length > 0) {
              applyLevels(levels);
            }
          } catch {
            console.warn("[SummaryPanel] Force load levels failed after retry");
          }
        }, 500);
      }
    })();

    return () => { cancelled = true; };
  }, [isDone, videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progressive auto-upgrade: show the best available level immediately.
  // If user manually selects a tab, stop auto-upgrading.
  const LEVEL_PRIORITY: SummaryLevel[] = ["detailed", "highlight", "express"];
  useEffect(() => {
    if (userSelectedRef.current) return;
    if (streamingSummary && !availableSet.has("detailed")) {
      setActiveLevel("detailed");
      return;
    }
    for (const level of LEVEL_PRIORITY) {
      if (availableSet.has(level)) {
        setActiveLevel(level);
        return;
      }
    }
  }, [availableLevels, isDone, streamingSummary, forceLoadedLevels]); // eslint-disable-line react-hooks/exhaustive-deps


  // Auto-switch to full when it becomes available after on-demand generation
  useEffect(() => {
    if (fullGenerating && availableSet.has("full")) {
      setFullGenerating(false);
      setActiveLevel("full");
    }
  }, [availableLevels, fullGenerating]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abort streaming on unmount or videoId change
  useEffect(() => {
    const timeout = timeoutRef.current;
    return () => {
      abortRef.current?.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, [videoId]);

  const {
    data: summary,
    isLoading,
    isError,
  } = useQuery<SummaryResponse>({
    queryKey: ["summary", videoId, activeLevel],
    queryFn: () => getSummary(videoId, activeLevel!),
    // Enable when level is in availableSet OR when isDone (optimistic: detailed may
    // already exist in DB even if availableLevels hasn't propagated yet)
    enabled: !!activeLevel && (availableSet.has(activeLevel) || !!isDone),
    staleTime: Infinity,
    retry: isDone ? 3 : 1,
    retryDelay: 1000,
  });

  // Determine whether we should actually show an error to the user
  const shouldShowError = useMemo(() => {
    // Still processing → never show error (backend hasn't finished)
    if (isSummarizing) return false;
    // Streaming from parent → don't show error
    if (streamingSummary && !summary?.content) return false;
    // Query didn't error → nothing to show
    if (!isError) return false;
    // isDone is not true → still in some intermediate state, don't alarm user
    if (!isDone) return false;
    // Give 3 seconds after isDone for cache invalidation to propagate
    if (!pastGracePeriod) return false;
    return true;
  }, [isSummarizing, streamingSummary, summary?.content, isError, isDone, pastGracePeriod]);

  // Whether the active tab's level is still being generated (not yet in availableSet)
  const isActiveLevelGenerating = useMemo(() => {
    if (!activeLevel) return false;
    if (activeLevel === "full") return false; // full has its own on-demand flow
    return isSummarizing && !availableSet.has(activeLevel);
  }, [activeLevel, isSummarizing, availableSet.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const regenerate = useMutation({
    mutationFn: async () => {
      setStreamingContent("");
      setIsStreaming(true);
      setStreamError(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const stream = await regenerateSummaryStream(videoId, activeLevel!, { signal: controller.signal });
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          // Parse SSE lines
          const lines = text.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.delta) {
                fullContent += parsed.delta;
                setStreamingContent(fullContent);
              }
              if (parsed.done) {
                // Stream complete, update cache with final content
                const existing = queryClient.getQueryData<SummaryResponse>(["summary", videoId, activeLevel]);
                if (existing) {
                  queryClient.setQueryData(["summary", videoId, activeLevel], {
                    ...existing,
                    content: fullContent,
                    cached: false,
                  });
                } else {
                  // Invalidate to refetch fresh data
                  queryClient.invalidateQueries({ queryKey: ["summary", videoId, activeLevel] });
                }
              }
            } catch {
              // ignore malformed JSON lines
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setStreamError("生成失败，请重试");
        throw e;
      } finally {
        setIsStreaming(false);
        setStreamingContent(null);
      }
    },
  });

  const fullTrigger = useMutation({
    mutationFn: () => triggerFullSummary(videoId),
    onSuccess: (data) => {
      if (data.status === "already_exists") {
        queryClient.invalidateQueries({ queryKey: ["summaryAvailable", videoId] });
      } else {
        setFullGenerating(true);
      }
    },
  });

  const isFullOnDemand = activeLevel === "full" && !availableSet.has("full");

  // --- Telemetry: derived display content + AnimatePresence key -----------
  // Mirror exactly the content fed to <StreamingMarkdown> below, so empty/
  // restore detection and delta→paint reflect what the user actually sees.
  const displayedContent =
    (streamingSummary && !summary?.content) ? streamingSummary
    : isStreaming ? (streamingContent || "")
    : (summary?.content ?? "");
  // Stable across the streaming→final transition of one level: keyed by
  // activeLevel only, NOT summary.id. When the final summary arrives (gaining
  // an id), the key must NOT change — otherwise AnimatePresence unmounts the
  // streamed node and remounts a fresh one, replaying the enter animation and
  // flashing the panel. Switching levels still changes the key (intended).
  const currentKey = activeLevel ?? "streaming";
  const isStreamingNow = isStreaming || (!!streamingSummary && !summary?.content);

  const traceBase = useMemo(
    () => ({ video_id: videoId, generation_id: gid, ui_session_id: undefined, active_level: activeLevel }),
    [videoId, gid, activeLevel],
  );

  // Mount / unmount. unmount within a live generation is a flicker signal →
  // recorded as warning by the telemetry module's ALWAYS_WARNING set is not
  // applied to mount/unmount, so flag the reason explicitly for querying.
  useEffect(() => {
    trackStreamingUIEvent({
      video_id: videoId,
      generation_id: gid,
      active_level: null,
      event_type: "summary_panel_mount",
      source: "snapshot",
      component_key: "SummaryPanel",
    });
    return () => {
      trackStreamingUIEvent({
        video_id: videoId,
        generation_id: gid,
        active_level: null,
        event_type: "summary_panel_unmount",
        source: "snapshot",
        component_key: "SummaryPanel",
        severity: "warning",
      });
    };
    // Mount/unmount once per panel instance — gid captured at mount is fine.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // AnimatePresence key change → potential remount of the content block.
  useEffect(() => {
    const prev = prevKeyRef.current;
    if (prev !== null && prev !== currentKey) {
      trackStreamingUIEvent({
        ...traceBase,
        event_type: "summary_panel_key_changed",
        source: "snapshot",
        component_key: currentKey,
        reason: `${prev} → ${currentKey}`,
      });
    }
    prevKeyRef.current = currentKey;
  }, [currentKey, traceBase]);

  // Render count during streaming → metric (one increment per render while streaming).
  useEffect(() => {
    if (isStreamingNow) {
      recordStreamingMetric(gid, "render_count_during_stream", 1);
    }
  });

  // delta→paint: when streamingSummary changes, measure time to the next frame.
  useEffect(() => {
    if (!streamingSummary) return;
    if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") return;
    const startedAt = nowMs();
    lastStreamChangeAtRef.current = startedAt;
    const raf = requestAnimationFrame(() => {
      const elapsed = nowMs() - startedAt;
      recordStreamingMetric(gid, "delta_to_paint_ms", elapsed);
      if (elapsed > STREAMING_THRESHOLDS.DELTA_TO_PAINT_MS) {
        trackStreamingUIEvent({
          ...traceBase,
          event_type: "delta_to_paint_slow",
          source: "delta",
          reason: `delta→paint ${Math.round(elapsed)}ms`,
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [streamingSummary, gid, traceBase]);

  // summary content became empty / restored (flicker / content-disappear signal).
  useEffect(() => {
    const nonEmpty = displayedContent.trim().length > 0;
    const wasNonEmpty = wasContentNonEmptyRef.current;
    if (wasNonEmpty && !nonEmpty) {
      trackStreamingUIEvent({
        ...traceBase,
        event_type: "summary_content_became_empty",
        source: "snapshot",
        reason: "displayed summary went non-empty → empty",
      });
    } else if (!wasNonEmpty && nonEmpty) {
      trackStreamingUIEvent({
        ...traceBase,
        event_type: "summary_content_restored",
        source: "snapshot",
        content_length: displayedContent.length,
      });
    }
    wasContentNonEmptyRef.current = nonEmpty;
  }, [displayedContent, traceBase]);

  // finalize→stable: time from isDone to first stable non-empty render.
  useEffect(() => {
    if (isDone && finalizeStartedAtRef.current === null) {
      finalizeStartedAtRef.current = nowMs();
      finalizeStableRecordedRef.current = false;
    } else if (!isDone) {
      finalizeStartedAtRef.current = null;
      finalizeStableRecordedRef.current = false;
    }
  }, [isDone]);

  useEffect(() => {
    if (
      isDone &&
      !finalizeStableRecordedRef.current &&
      finalizeStartedAtRef.current !== null &&
      !isStreamingNow &&
      displayedContent.trim().length > 0
    ) {
      finalizeStableRecordedRef.current = true;
      recordStreamingMetric(gid, "finalize_to_stable_ms", nowMs() - finalizeStartedAtRef.current);
    }
  }, [isDone, isStreamingNow, displayedContent, gid]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Level selector — each tab independently clickable once its level is available */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-wrap gap-2">
          {SUMMARY_LEVELS.map((level) => {
            const isActive = activeLevel === level.key;
            const isAvailable = availableSet.has(level.key);
            const isFull = level.key === "full";
            // Non-full tabs: clickable as soon as available in availableSet
            // Full tab: clickable once isDone (on-demand generation)
            const isClickable = isAvailable || (isFull && isDone);
            // Show spinner on tabs that are still being generated
            const isLevelPending = isSummarizing && !isAvailable && !isFull;
            return (
              <button
                key={level.key}
                disabled={!isClickable}
                onClick={() => { userSelectedRef.current = true; setActiveLevel(level.key); }}
                className={cn(
                  "relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-medium transition-all border",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  isActive
                    ? "text-white border-transparent shadow-lg shadow-violet-500/25"
                    : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-violet-300 dark:hover:border-violet-700 hover:text-gray-900 dark:hover:text-gray-100 bg-white/60 dark:bg-gray-800/60"
                )}
                style={
                  isActive
                    ? { background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }
                    : {}
                }
              >
                <span className="font-semibold">{level.label}</span>
                <span
                  className={cn(
                    "text-[10px] rounded-full px-1.5 py-0.5",
                    isActive
                      ? "bg-white/20 text-white/90"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                  )}
                >
                  {level.pct}
                </span>
                {isLevelPending && (
                  <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin opacity-60" />
                )}
                {isFull && fullGenerating && (
                  <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin opacity-60" title="生成中..." />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Stream error — SSE disconnect is not a real error, polling still works. Hide from user. */}

        {/* Timeout info banner — gentle hint, not an error */}
        {streamTimeout && isStreaming && (
          <div className="mb-4 p-3 rounded-xl bg-zinc-50 border border-zinc-200 dark:bg-zinc-800/40 dark:border-zinc-700">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              内容生成中，请耐心等待...
            </p>
          </div>
        )}

        {/* Not ready state */}
        {!isDone && !isSummarizing && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <ListBullets size={28} weight="bold" className="text-zinc-300" />
            <p className="text-sm text-gray-400 dark:text-gray-500">
              内容整理完成后即可查看摘记
            </p>
          </div>
        )}

        {/* Summarizing but nothing ready yet — show streaming content if available */}
        {isSummarizing && availableSet.size === 0 && !streamingSummary && !activeLevel && (
          <MascotLoading scene="thinking" message="猹正在整理摘记..." />
        )}

        {/* Prompt to select a level */}
        {(isDone || availableSet.size > 0) && !activeLevel && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Cursor size={28} weight="bold" className="text-zinc-300" />
            <p className="text-sm text-gray-400 dark:text-gray-500">
              选择一个品读深度开始
            </p>
          </div>
        )}

        {/* Full on-demand CTA */}
        {isFullOnDemand && !fullGenerating && (
          <div className="flex flex-col items-center justify-center h-52 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
              <FileText size={28} weight="bold" className="text-violet-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">完整文稿需要单独生成</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">将尽量保留原内容脉络，生成需要 3-5 分钟</p>
            </div>
            <button
              onClick={() => fullTrigger.mutate()}
              disabled={fullTrigger.isPending}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-lg shadow-violet-500/25 transition-all disabled:opacity-50"
            >
              {fullTrigger.isPending ? "提交中..." : "生成完整文稿"}
            </button>
          </div>
        )}

        {/* Full generating progress */}
        {isFullOnDemand && fullGenerating && (
          <MascotLoading scene="thinking" message="完整文稿生成中，完成后会自动显示" />
        )}

        {/* Active level is still generating — show inline generating placeholder */}
        {activeLevel && !isFullOnDemand && isActiveLevelGenerating && !streamingSummary && (
          <MascotLoading scene="thinking" message={`「${SUMMARY_LEVELS.find((l) => l.key === activeLevel)?.label}」正在生成中...`} />
        )}

        {/* Loading skeleton — show when fetching already-available data */}
        {activeLevel && !isFullOnDemand && !streamingSummary && !isActiveLevelGenerating && (isLoading || (!summary && !isStreaming && !shouldShowError)) && (
          <LoadingPlaceholder message={isSummarizing ? "摘要生成中..." : "加载中..."} />
        )}

        {/* Error state — only show when we're confident it's a real error */}
        {activeLevel && !isFullOnDemand && shouldShowError && !isLoading && !isActiveLevelGenerating && (
          <div className="py-4 text-center">
            <p className="text-zinc-400 dark:text-zinc-500 text-sm">
              内容暂时不可用，请刷新页面重试
            </p>
          </div>
        )}

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeLevel && (summary || isStreaming || (!!streamingSummary && !summary)) && !isLoading && !isFullOnDemand && (!isActiveLevelGenerating || !!streamingSummary) && (
            <motion.div
              key={currentKey}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex flex-col gap-4"
            >
              {/* Meta toolbar */}
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                {summary?.cached && !isStreaming && !(streamingSummary && !summary?.content) && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    已缓存
                  </span>
                )}
                {(isStreaming || (!!streamingSummary && !summary?.content)) && (
                  <span className="flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-2.5 py-1 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                    生成中
                  </span>
                )}
                <button
                  disabled={regenerate.isPending}
                  onClick={() => regenerate.mutate()}
                  className="flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2.5 py-1 font-medium transition-colors disabled:opacity-50"
                >
                  <span className={regenerate.isPending ? "animate-spin inline-block" : ""}>↻</span>
                  {regenerate.isPending ? "生成中..." : "重新生成"}
                </button>
                <button
                  onClick={() => {
                    const content = streamingContent ?? summary?.content ?? "";
                    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `summary_${activeLevel}_${videoId}.md`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2.5 py-1 font-medium transition-colors"
                >
                  <DownloadSimple size={10} weight="bold" />
                  导出 .md
                </button>
                {summary && !isStreaming && (
                  <SummaryCardExport
                    videoTitle={videoTitle || "内容摘记"}
                    thumbnail={thumbnail || null}
                    summaryContent={summary.content}
                    level={activeLevel!}
                    modelUsed={summary.model_used || null}
                    createdAt={summary.created_at}
                  />
                )}
                {summary?.model_used && !isStreaming && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {summary.model_used} · {new Date(summary.created_at).toLocaleDateString("zh-CN")}
                  </span>
                )}
              </div>

              {/* Prose container */}
              <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 p-4">
                {((streamingSummary && !summary?.content && !streamingSummary.trim()) || (isStreaming && !streamingContent)) ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <img src={cdnUrl("/mascot/icon_thinking.gif")} alt="" className="w-20 h-20 object-contain" />
                    <p className="text-sm text-zinc-400 font-medium">猹正在组织语言...</p>
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-[14px] leading-[1.85]
                    prose-headings:text-gray-900 dark:prose-headings:text-gray-100
                    prose-p:text-gray-700 dark:prose-p:text-gray-300
                    prose-strong:text-gray-900 dark:prose-strong:text-gray-100
                    prose-li:text-gray-700 dark:prose-li:text-gray-300
                    prose-a:text-violet-600 dark:prose-a:text-violet-400
                    prose-code:text-violet-700 dark:prose-code:text-violet-300
                    prose-code:bg-violet-50 dark:prose-code:bg-violet-900/30
                    prose-code:rounded prose-code:px-1 prose-code:py-0.5">
                    <StreamingMarkdown
                      content={
                        (streamingSummary && !summary?.content) ? streamingSummary
                        : isStreaming ? (streamingContent || "")
                        : (summary?.content ?? "")
                      }
                      isStreaming={isStreaming || (!!streamingSummary && !summary?.content)}
                    />
                  </div>
                )}
                {/* Streaming indicator - show when content is being streamed */}
                {(isStreaming || (!!streamingSummary && !summary?.content)) && (streamingContent || streamingSummary) && (
                  <StreamingIndicator className="mt-3" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
