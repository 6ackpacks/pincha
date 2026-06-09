"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CircleNotch, CheckCircle, XCircle, Queue, X } from "@phosphor-icons/react";
import {
  processingQueueAtom,
  updateQueueItemAtom,
  removeFromQueueAtom,
  activeQueueCountAtom,
  type QueueItem,
} from "@/atoms/queue";
import { cn } from "@/lib/utils";

/* --- Progress fetcher registry (removes hardcoded domain knowledge) --- */
type ProgressFetcher = (id: string) => Promise<{ state: string; progress: number; message: string }>;

const PROGRESS_FETCHERS: Record<string, ProgressFetcher> = {
  video: (id) => import("@/lib/api/videos").then((m) => m.getVideoProgress(id)),
  wiki: (id) => import("@/lib/api/wiki").then((m) => m.getWikiCompileProgress(id)),
  article: (id) => import("@/lib/api/articles").then((m) => m.getArticleProgress(id)),
};

/** Number of consecutive "idle" responses before treating as done (per type). */
const IDLE_THRESHOLD: Partial<Record<string, number>> = { wiki: 3 };

function QueueItemRow({ item, onRemove }: { item: QueueItem; onRemove: () => void }) {
  const router = useRouter();
  const [displayProgress, setDisplayProgress] = useState(item.progress);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (item.state !== "processing") {
      setDisplayProgress(item.state === "done" ? 100 : 0);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    setDisplayProgress((prev) => Math.max(prev, item.progress));
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setDisplayProgress((prev) => {
        const ceiling = Math.min(item.progress + 18, 95);
        if (prev >= ceiling) return prev;
        return prev + 1;
      });
    }, 800);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [item.progress, item.state]);

  const handleClick = () => {
    const path = item.type === "video" ? `/videos/${item.id}`
      : item.type === "wiki" ? `/knowledge`
      : `/articles/${item.id}`;
    router.push(path);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors",
        item.state === "done" ? "hover:bg-emerald-50" : "",
        item.state === "failed" ? "bg-red-50/50 hover:bg-red-50" : "",
        item.state === "processing" ? "hover:bg-zinc-50" : ""
      )}
      onClick={handleClick}
    >
      <div className="shrink-0">
        {item.state === "processing" && <CircleNotch size={14} weight="bold" className="animate-spin text-emerald-500" />}
        {item.state === "done" && <CheckCircle size={14} weight="fill" className="text-emerald-500" />}
        {item.state === "failed" && <XCircle size={14} weight="fill" className="text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-zinc-700 truncate">{item.title || "整理中..."}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {item.state === "processing" && (
            <>
              <div className="flex-1 h-1 rounded-full bg-zinc-100 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-emerald-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${displayProgress}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
              <span className="text-[9px] text-zinc-400 tabular-nums shrink-0">{displayProgress}%</span>
            </>
          )}
          {item.state === "processing" && item.message && (
            <span className="text-[9px] text-zinc-400 truncate ml-0.5">{item.message}</span>
          )}
          {item.state === "done" && <span className="text-[10px] text-emerald-600">完成，点击查看</span>}
          {item.state === "failed" && <span className="text-[10px] text-red-400 truncate">{item.message || "失败"}</span>}
        </div>
      </div>
      {item.state !== "processing" && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 p-0.5 rounded text-zinc-300 hover:text-zinc-500 transition-colors"
        >
          <X size={10} weight="bold" />
        </button>
      )}
    </motion.div>
  );
}

export function ProcessingQueue() {
  const [queue, setQueue] = useAtom(processingQueueAtom);
  const updateItem = useSetAtom(updateQueueItemAtom);
  const removeItem = useSetAtom(removeFromQueueAtom);
  const activeCount = useAtomValue(activeQueueCountAtom);
  const [expanded, setExpanded] = useState(false);
  const unsubsRef = useRef<Map<string, () => void>>(new Map());
  const prevActiveRef = useRef(0);
  const router = useRouter();

  // Auto-expand when an item finishes
  useEffect(() => {
    if (prevActiveRef.current > 0 && activeCount === 0 && queue.length > 0) {
      setExpanded(true);
    }
    prevActiveRef.current = activeCount;
  }, [activeCount, queue.length]);

  useEffect(() => {
    for (const item of queue) {
      if (item.state !== "processing") continue;
      const key = `${item.type}:${item.id}`;
      if (unsubsRef.current.has(key)) continue;

      const onProgress = (data: { state: string; progress: number; message: string }) => {
        if (data.state === "done") {
          updateItem({ id: item.id, type: item.type, state: "done", progress: 100, message: "" });
          unsubsRef.current.delete(key);
        } else if (data.state === "failed") {
          updateItem({ id: item.id, type: item.type, state: "failed", progress: 0, message: data.message || "整理失败" });
          unsubsRef.current.delete(key);
        } else {
          updateItem({ id: item.id, type: item.type, progress: data.progress, message: data.message });
        }
      };

      // Use polling directly — SSE through Next.js rewrite is unreliable
      const getter = PROGRESS_FETCHERS[item.type];
      if (!getter) continue;

      let idleCount = 0;
      const idleMax = IDLE_THRESHOLD[item.type];
      const pollInterval = setInterval(async () => {
        try {
          const data = await getter(item.id);
          if (idleMax && data.state === "idle") {
            idleCount++;
            if (idleCount >= idleMax) {
              onProgress({ state: "done", progress: 100, message: "" });
              clearInterval(pollInterval);
            }
            return;
          }
          idleCount = 0;
          onProgress(data);
          if (data.state === "done" || data.state === "failed") {
            clearInterval(pollInterval);
          }
        } catch { /* transient error, keep polling */ }
      }, 2000);

      unsubsRef.current.set(key, () => clearInterval(pollInterval));
    }

    return () => {};
  }, [queue, updateItem]);

  useEffect(() => {
    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current.clear();
    };
  }, []);

  const clearAllPolling = () => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current.clear();
  };

  const handleClearQueue = () => {
    clearAllPolling();
    setQueue([]);
  };

  const handleRemoveItem = (id: string, type: "video" | "article" | "wiki") => {
    const key = `${type}:${id}`;
    const unsub = unsubsRef.current.get(key);
    if (unsub) {
      unsub();
      unsubsRef.current.delete(key);
    }
    removeItem(id, type);
  };

  const handleBadgeClick = () => {
    // If only one done item and no active, navigate directly
    const doneItems = queue.filter((q) => q.state === "done");
    if (activeCount === 0 && doneItems.length === 1) {
      const item = doneItems[0];
      const path = item.type === "video" ? `/videos/${item.id}`
        : item.type === "wiki" ? `/knowledge`
        : `/articles/${item.id}`;
      router.push(path);
      handleClearQueue();
      return;
    }
    setExpanded(!expanded);
  };

  const failedCount = queue.filter((q) => q.state === "failed").length;
  const doneCount = queue.filter((q) => q.state === "done").length;

  if (queue.length === 0) return null;

  const badgeLabel = activeCount > 0
    ? `${activeCount} 条线索整理中`
    : failedCount > 0 && doneCount === 0
      ? `${failedCount} 项失败`
      : failedCount > 0
        ? `${doneCount} 项完成，${failedCount} 项失败`
        : `${doneCount} 项已完成`;

  return (
    <div className="fixed top-4 right-4 z-50">
      {/* Badge button */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleBadgeClick}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-lg transition-all",
            activeCount > 0
              ? "bg-white border-emerald-200 shadow-emerald-100/50"
              : failedCount > 0
                ? "bg-white border-red-200 shadow-red-100/50"
                : "bg-white border-emerald-200 shadow-emerald-100/50"
          )}
        >
          {activeCount > 0 ? (
            <CircleNotch size={14} weight="bold" className="animate-spin text-emerald-500" />
          ) : failedCount > 0 && doneCount === 0 ? (
            <XCircle size={14} weight="fill" className="text-red-400" />
          ) : (
            <CheckCircle size={14} weight="fill" className="text-emerald-500" />
          )}
          <span className="text-xs font-medium text-zinc-700">
            {badgeLabel}
          </span>
        </button>
        <button
          onClick={handleClearQueue}
          className="p-1.5 rounded-lg bg-white border border-zinc-200 shadow-lg text-zinc-400 hover:text-zinc-600 transition-colors"
          title="清除队列"
        >
          <X size={12} weight="bold" />
        </button>
      </div>

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl border border-zinc-200 shadow-xl overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-zinc-100 flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-700">整理队列</span>
              <button
                onClick={handleClearQueue}
                className="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                清空
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto py-1 px-1">
              <AnimatePresence>
                {queue.map((item) => (
                  <QueueItemRow
                    key={`${item.type}:${item.id}`}
                    item={item}
                    onRemove={() => handleRemoveItem(item.id, item.type)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
