"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { activeSegmentIndexAtom, seekFnAtom } from "@/atoms/player";
import { cn, formatTime } from "@/lib/utils";
import { MagnifyingGlass, X, Translate, TextAlignLeft } from "@phosphor-icons/react";
import { translateTranscript, type TranscriptSegment } from "@/lib/api";

interface TranscriptPanelProps {
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
  videoId: string;
  segmentsEn?: (TranscriptSegment | null)[] | null;
  isLoading?: boolean;
}

export default function TranscriptPanel({
  segments,
  videoId,
  segmentsEn,
  isLoading = false,
}: TranscriptPanelProps) {
  const activeIndex = useAtomValue(activeSegmentIndexAtom);
  const seekFn = useAtomValue(seekFnAtom);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [bilingual, setBilingual] = useState(false);
  const [translatedTexts, setTranslatedTexts] = useState<Map<number, string>>(new Map());
  const [translatingIndices, setTranslatingIndices] = useState<Set<number>>(new Set());
  // Track which indices have entered viewport while bilingual is on
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

  // Keep refs in sync with state for IntersectionObserver closure
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

  // IntersectionObserver: when bilingual is on, observe segments entering viewport
  useEffect(() => {
    if (!bilingual || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.segIdx);
          if (isNaN(idx) || translatedRef.current.has(idx) || translatingRef.current.has(idx)) continue;
          pendingRef.current.add(idx);
        }
        // Debounce: collect visible segments for 300ms then flush as one batch
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushPending, 300);
      },
      { root: containerRef.current, rootMargin: "200px 0px" }
    );

    // Observe all segment elements
    segmentRefs.current.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [bilingual, segments, flushPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = search.trim().toLowerCase();
  const filteredSegments = query
    ? segments.map((s, i) => ({ ...s, originalIndex: i })).filter((s) => s.text.toLowerCase().includes(query))
    : segments.map((s, i) => ({ ...s, originalIndex: i }));

  /* PLACEHOLDER_RENDER */

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-start animate-pulse">
            <div className="h-6 w-14 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-full rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3.5 w-4/5 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    );
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
      {/* Search bar + Bilingual toggle */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <div
            className="flex-1 flex items-center gap-2 px-3 h-8 rounded-lg transition-all"
            style={{
              background: "#F5F5F4",
              border: searchFocused ? "1.5px solid #78B33E" : "1.5px solid transparent",
              boxShadow: searchFocused ? "0 0 0 2px rgba(120,179,62,0.12)" : "none",
            }}
          >
            <MagnifyingGlass size={12} weight="bold" style={{ color: searchFocused ? "#78B33E" : "#949494" }} className="shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="搜索文字稿..."
              className="flex-1 bg-transparent text-[12px] focus:outline-none"
              style={{ color: "#292929" }}
            />
            {search && (
              <button onClick={() => setSearch("")} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
                <X size={11} weight="bold" style={{ color: "#292929" }} />
              </button>
            )}
          </div>
          {/* Bilingual toggle */}
          <button
            onClick={() => setBilingual((v) => !v)}
            className={cn(
              "shrink-0 flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-medium transition-all",
              bilingual
                ? "bg-emerald-500 text-white"
                : "text-gray-500 hover:text-gray-700"
            )}
            style={bilingual ? {} : { background: "#F5F5F4" }}
            title="双语对照"
          >
            <Translate size={13} weight="bold" />
            <span>双语</span>
          </button>
        </div>
        {query && (
          <p className="text-[11px] mt-1 px-1" style={{ color: "#949494" }}>
            {filteredSegments.length === 0 ? "无匹配结果" : `找到 ${filteredSegments.length} 条`}
          </p>
        )}
      </div>

      {/* Scrollable transcript */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-1">
        {filteredSegments.length === 0 && query && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <MagnifyingGlass size={24} weight="bold" className="text-zinc-300" />
            <p className="text-sm text-gray-400 dark:text-gray-500">未找到 &quot;{search}&quot;</p>
          </div>
        )}
        {filteredSegments.map((segment) => {
          const index = segment.originalIndex;
          const isActive = index === activeIndex;
          const highlight = query;
          const text = segment.text;

          let content: React.ReactNode = text;
          if (highlight) {
            const idx = text.toLowerCase().indexOf(highlight);
            if (idx >= 0) {
              content = (
                <>
                  {text.slice(0, idx)}
                  <mark className="rounded px-0.5" style={{ background: "rgba(120,179,62,0.25)", color: "inherit" }}>
                    {text.slice(idx, idx + highlight.length)}
                  </mark>
                  {text.slice(idx + highlight.length)}
                </>
              );
            }
          }

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
                "group flex gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 border",
                isActive
                  ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 shadow-sm shadow-amber-200/50 dark:shadow-amber-900/30"
                  : "bg-transparent border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:border-gray-200 dark:hover:border-gray-700"
              )}
            >
              <span className={cn(
                "shrink-0 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold transition-colors h-fit mt-0.5",
                isActive
                  ? "bg-amber-400/20 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                  : "bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-800/40"
              )}>
                {formatTime(segment.start)}
              </span>

              <div className="flex-1 min-w-0">
                <span className={cn(
                  "text-[13.5px] leading-[1.7] transition-colors block",
                  isActive ? "text-gray-900 dark:text-gray-100 font-medium" : "text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200"
                )}>
                  {segment.speaker && (
                    <span className="text-xs text-emerald-500 font-medium mr-1">
                      {segment.speaker}:
                    </span>
                  )}
                  {content}
                </span>
                {bilingual && (
                  translatingIndices.has(index) ? (
                    <span className="block h-4 w-4/5 mt-1 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  ) : translatedTexts.has(index) ? (
                    <span className="block text-[12.5px] leading-[1.6] mt-0.5 text-gray-400 dark:text-gray-500">
                      {translatedTexts.get(index)}
                    </span>
                  ) : null
                )}
              </div>

              {isActive && (
                <span className="shrink-0 flex items-center mt-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
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
