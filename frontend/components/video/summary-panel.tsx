"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { DownloadSimple, FileText, CircleNotch, ListBullets, Cursor } from "@phosphor-icons/react";
import {
  getSummary,
  regenerateSummaryStream,
  getAvailableSummaryLevels,
  triggerFullSummary,
  subscribeSummaryStream,
  type SummaryLevel,
  type SummaryResponse,
} from "@/lib/api/videos";
import { SummaryCardExport } from "./summary-card-export";
import { SUMMARY_LEVELS } from "@/lib/constants";
import { LoadingPlaceholder, StreamingIndicator } from "@/components/ui/loading-placeholder";

interface SummaryPanelProps {
  videoId: string;
  videoTitle?: string;
  thumbnail?: string;
  isDone?: boolean;
  currentState?: string;
}

export default function SummaryPanel({ videoId, videoTitle, thumbnail, isDone, currentState }: SummaryPanelProps) {
  const [activeLevel, setActiveLevel] = useState<SummaryLevel | null>(null);
  const [fullGenerating, setFullGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInitialStreaming, setIsInitialStreaming] = useState(false);
  const [initialStreamContent, setInitialStreamContent] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamTimeout, setStreamTimeout] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cleanupStreamRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  const isSummarizing =
    currentState === "summarizing" || currentState === "generating_mindmap";

  const { data: availableLevels } = useQuery<string[]>({
    queryKey: ["summaryAvailable", videoId],
    queryFn: () => getAvailableSummaryLevels(videoId),
    enabled: !!videoId && (isSummarizing || !!isDone),
    staleTime: 60 * 1000,
    refetchInterval: (query) => {
      const count = (query.state.data ?? []).length;
      const allReady = count >= 3 && (!fullGenerating || count >= 4);
      return isSummarizing || fullGenerating || (isDone && !allReady) ? 2000 : false;
    },
  });

  const availableSet = new Set(availableLevels ?? []);

  // Default to "detailed" when it becomes available (or during streaming)
  useEffect(() => {
    if (activeLevel === null) {
      if (availableSet.has("detailed") || isInitialStreaming) {
        setActiveLevel("detailed");
      } else if (availableSet.has("express")) {
        setActiveLevel("express");
      }
    }
  }, [availableLevels, isDone, isInitialStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to summary stream when summarizing starts
  useEffect(() => {
    if (!isSummarizing || availableSet.has("detailed")) return;

    setIsInitialStreaming(true);
    setInitialStreamContent("");
    setActiveLevel("detailed");
    setStreamError(null);
    setStreamTimeout(false);

    // Set timeout warning after 60 seconds
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (isInitialStreaming) {
        setStreamTimeout(true);
      }
    }, 60000);

    const cleanup = subscribeSummaryStream(
      videoId,
      (_level, delta) => {
        setInitialStreamContent((prev) => prev + delta);
        setStreamTimeout(false); // Reset timeout if we're receiving data
      },
      (level) => {
        queryClient.invalidateQueries({ queryKey: ["summaryAvailable", videoId] });
        queryClient.invalidateQueries({ queryKey: ["summary", videoId, level] });
      },
      (error) => {
        setIsInitialStreaming(false);
        if (error) {
          setStreamError(error.message || "连接中断，请刷新重试");
        }
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        queryClient.invalidateQueries({ queryKey: ["summaryAvailable", videoId] });
        queryClient.invalidateQueries({ queryKey: ["summary", videoId, "detailed"] });
      },
    );
    cleanupStreamRef.current = cleanup;

    return () => {
      cleanup();
      cleanupStreamRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isSummarizing, videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to full when it becomes available after on-demand generation
  useEffect(() => {
    if (fullGenerating && availableSet.has("full")) {
      setFullGenerating(false);
      setActiveLevel("full");
    }
  }, [availableLevels, fullGenerating]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abort streaming on unmount or videoId change
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [videoId]);

  const {
    data: summary,
    isLoading,
    isError,
    error,
  } = useQuery<SummaryResponse>({
    queryKey: ["summary", videoId, activeLevel],
    queryFn: () => getSummary(videoId, activeLevel!),
    enabled: !!activeLevel && availableSet.has(activeLevel),
    staleTime: Infinity,
  });

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Level selector */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-wrap gap-2">
          {SUMMARY_LEVELS.map((level) => {
            const isActive = activeLevel === level.key;
            const isAvailable = availableSet.has(level.key);
            const isPending = isSummarizing && !isAvailable;
            const isFull = level.key === "full";
            const isClickable = isAvailable || (isFull && isDone);
            return (
              <button
                key={level.key}
                disabled={!isClickable}
                onClick={() => setActiveLevel(level.key)}
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
                {isPending && (
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
        {isSummarizing && availableSet.size === 0 && !isInitialStreaming && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin opacity-60" />
            <p className="text-sm text-gray-400 dark:text-gray-500">
              摘记生成中，稍候片刻...
            </p>
          </div>
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
          <div className="flex flex-col items-center justify-center h-52 gap-4">
            <CircleNotch size={32} weight="bold" className="text-violet-500 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">完整文稿生成中</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">后台整理中，完成后会自动显示，你可以先查看其他级别</p>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {activeLevel && !isFullOnDemand && isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            <span className="ml-2.5 text-sm text-gray-400">加载中...</span>
          </div>
        )}

        {/* Error state */}
        {activeLevel && !isFullOnDemand && isError && (
          <p className="text-red-500 text-sm py-4 text-center">
            加载失败: {(error as Error)?.message || "未知错误"}
          </p>
        )}

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeLevel && (summary || isStreaming || isInitialStreaming) && !isLoading && !isFullOnDemand && (
            <motion.div
              key={`${activeLevel}-${summary?.id ?? "streaming"}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex flex-col gap-4"
            >
              {/* Meta toolbar */}
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                {summary?.cached && !isStreaming && !isInitialStreaming && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    已缓存
                  </span>
                )}
                {(isStreaming || isInitialStreaming) && (
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
                <div className="prose prose-sm dark:prose-invert max-w-none text-[14px] leading-[1.85]
                  prose-headings:text-gray-900 dark:prose-headings:text-gray-100
                  prose-p:text-gray-700 dark:prose-p:text-gray-300
                  prose-strong:text-gray-900 dark:prose-strong:text-gray-100
                  prose-li:text-gray-700 dark:prose-li:text-gray-300
                  prose-a:text-violet-600 dark:prose-a:text-violet-400
                  prose-code:text-violet-700 dark:prose-code:text-violet-300
                  prose-code:bg-violet-50 dark:prose-code:bg-violet-900/30
                  prose-code:rounded prose-code:px-1 prose-code:py-0.5">
                  <ReactMarkdown>{isStreaming ? (streamingContent || "") : isInitialStreaming ? initialStreamContent : (summary?.content ?? "")}</ReactMarkdown>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
