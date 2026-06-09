"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { activeSegmentIndexAtom, seekFnAtom } from "@/atoms/player";
import { cn, formatTime } from "@/lib/utils";
import { MagnifyingGlass, X, TextAlignLeft } from "@phosphor-icons/react";
import { translateTranscript, type TranscriptSegment } from "@/lib/api";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";

interface TranslationPanelProps {
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
  videoId: string;
  segmentsEn?: (TranscriptSegment | null)[] | null;
  isLoading?: boolean;
}

export default function TranslationPanel({
  segments,
  videoId,
  segmentsEn,
  isLoading = false,
}: TranslationPanelProps) {
  const activeIndex = useAtomValue(activeSegmentIndexAtom);
  const seekFn = useAtomValue(seekFnAtom);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [translatedTexts, setTranslatedTexts] = useState<Map<number, string>>(new Map());
  const [translatingIndices, setTranslatingIndices] = useState<Set<number>>(new Set());

  const pendingRef = useRef<Set<number>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translatedRef = useRef<Map<number, string>>(new Map());
  const translatingRef = useRef<Set<number>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const isUserScrolling = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSegmentRef = useCallback(
    (index: number) => (el: HTMLDivElement | null) => {
      if (el) segmentRefs.current.set(index, el);
      else segmentRefs.current.delete(index);
    },
    []
  );

  // Pause auto-scroll on manual scroll
  const handleScroll = useCallback(() => {
    isUserScrolling.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => { isUserScrolling.current = false; }, 5000);
  }, []);

  // Auto-scroll to active segment
  useEffect(() => {
    if (search || activeIndex < 0 || isUserScrolling.current) return;
    const el = segmentRefs.current.get(activeIndex);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIndex, search]);

  useEffect(() => {
    return () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); };
  }, []);

  const handleClick = useCallback(
    (start: number) => { if (seekFn) seekFn(start); },
    [seekFn]
  );

  // Keep refs in sync with state
  useEffect(() => { translatedRef.current = translatedTexts; }, [translatedTexts]);
  useEffect(() => { translatingRef.current = translatingIndices; }, [translatingIndices]);

  // Initialize from DB-cached translations
  useEffect(() => {
    if (!segmentsEn) return;
    const map = new Map<number, string>();
    segmentsEn.forEach((seg, i) => { if (seg?.text) map.set(i, seg.text); });
    if (map.size > 0) setTranslatedTexts((prev) => new Map([...prev, ...map]));
  }, [segmentsEn]);

  // Flush pending viewport indices — batch translate after 300ms debounce
  const flushPending = useCallback(() => {
    const indices = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (indices.length === 0) return;

    setTranslatingIndices((prev) => new Set([...prev, ...indices]));

    const BATCH = 20;
    (async () => {
      for (let i = 0; i < indices.length; i += BATCH) {
        const batch = indices.slice(i, i + BATCH);
        try {
          const res = await translateTranscript(videoId, { segment_indices: batch });
          setTranslatedTexts((prev) => {
            const next = new Map(prev);
            for (const [idx, text] of Object.entries(res.translations)) next.set(Number(idx), text);
            return next;
          });
        } catch { /* silently skip failed batch */ }
        setTranslatingIndices((prev) => {
          const next = new Set(prev);
          batch.forEach((idx) => next.delete(idx));
          return next;
        });
      }
    })();
  }, [videoId]);

  // IntersectionObserver: observe segments entering viewport for auto-translate
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.segIdx);
          if (isNaN(idx) || translatedRef.current.has(idx) || translatingRef.current.has(idx)) continue;
          pendingRef.current.add(idx);
        }
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushPending, 300);
      },
      { root: containerRef.current, rootMargin: "200px 0px" }
    );

    segmentRefs.current.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [segments, flushPending]);

  const query = search.trim().toLowerCase();
  const filteredSegments = query
    ? segments.map((s, i) => ({ ...s, originalIndex: i })).filter((s) => s.text.toLowerCase().includes(query))
    : segments.map((s, i) => ({ ...s, originalIndex: i }));

  if (isLoading) {
    return <LoadingPlaceholder message="字幕加载中..." />;
  }

  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2">
        <TextAlignLeft size={28} weight="bold" className="text-zinc-300" />
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无字幕数据</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <div
            className="flex-1 flex items-center gap-2 px-3 h-8 rounded-lg transition-all"
            style={{
              background: "#F5F5F4",
              border: searchFocused ? "1.5px solid #10B981" : "1.5px solid transparent",
              boxShadow: searchFocused ? "0 0 0 2px rgba(16,185,129,0.12)" : "none",
            }}
          >
            <MagnifyingGlass size={12} weight="bold" style={{ color: searchFocused ? "#10B981" : "#949494" }} className="shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="搜索翻译..."
              className="flex-1 bg-transparent text-[12px] focus:outline-none"
              style={{ color: "#292929" }}
            />
            {search && (
              <button onClick={() => setSearch("")} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
                <X size={11} weight="bold" style={{ color: "#292929" }} />
              </button>
            )}
          </div>
        </div>
        {query && (
          <p className="text-[11px] mt-1 px-1" style={{ color: "#949494" }}>
            {filteredSegments.length === 0 ? "无匹配结果" : `找到 ${filteredSegments.length} 条`}
          </p>
        )}
      </div>

      {/* Scrollable bilingual transcript */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {filteredSegments.length === 0 && query && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <MagnifyingGlass size={24} weight="bold" className="text-zinc-300" />
            <p className="text-sm text-gray-400 dark:text-gray-500">未找到 &quot;{search}&quot;</p>
          </div>
        )}
        {filteredSegments.map((segment) => {
          const index = segment.originalIndex;
          const isActive = index === activeIndex;
          const enText = translatedTexts.get(index);
          const isTranslating = translatingIndices.has(index);

          return (
            <motion.div
              key={index}
              ref={setSegmentRef(index)}
              data-seg-idx={index}
              onClick={() => handleClick(segment.start)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: Math.min(index * 0.003, 0.12) }}
              className={cn(
                "group flex gap-3 px-3 py-3 cursor-pointer transition-all duration-200 rounded-lg",
                isActive
                  ? "bg-emerald-50/80 dark:bg-emerald-950/30 border-l-[3px] border-l-emerald-500"
                  : "border-l-[3px] border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/40"
              )}
            >
              {/* Timestamp */}
              <span className={cn(
                "shrink-0 text-[11px] font-mono tabular-nums pt-0.5 transition-colors",
                isActive
                  ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                  : "text-gray-400 dark:text-gray-500"
              )}>
                {formatTime(segment.start)}
              </span>

              {/* Bilingual content */}
              <div className="flex-1 min-w-0">
                {/* Chinese (primary) */}
                <p className={cn(
                  "text-[14px] leading-[1.75] transition-colors",
                  isActive
                    ? "text-gray-900 dark:text-gray-100 font-semibold"
                    : "text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100"
                )}>
                  {segment.speaker && (
                    <span className="text-xs text-emerald-500 font-medium mr-1">
                      {segment.speaker}:
                    </span>
                  )}
                  {segment.text}
                </p>
                {/* English (secondary) */}
                {isTranslating ? (
                  <span className="block h-3.5 w-4/5 mt-1 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                ) : enText ? (
                  <p className={cn(
                    "text-[12.5px] leading-[1.6] mt-0.5 transition-colors",
                    isActive
                      ? "text-gray-500 dark:text-gray-400"
                      : "text-gray-400 dark:text-gray-500"
                  )}>
                    {enText}
                  </p>
                ) : null}
              </div>

              {/* Active indicator */}
              {isActive && (
                <span className="shrink-0 flex items-center mt-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
