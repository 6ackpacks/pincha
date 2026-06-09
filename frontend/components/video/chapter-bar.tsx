"use client";

import { useRef, useEffect } from "react";
import { useAtomValue } from "jotai";
import { currentTimeAtom, seekFnAtom } from "@/atoms/player";
import { cn, formatTime } from "@/lib/utils";

export interface Chapter {
  title: string;
  seconds: number;
}

interface ChapterBarProps {
  chapters: Chapter[];
  videoDuration: number; // seconds
}

export default function ChapterBar({ chapters, videoDuration }: ChapterBarProps) {
  const currentTime = useAtomValue(currentTimeAtom);
  const seekFn = useAtomValue(seekFnAtom);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  if (chapters.length === 0) return null;

  // Find current active chapter index
  const activeIndex = chapters.reduce((acc, ch, i) => {
    return currentTime >= ch.seconds ? i : acc;
  }, -1);

  const seek = (seconds: number) => seekFn?.(seconds);

  // Auto-scroll active chapter into view
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      const container = listRef.current;
      const el = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [activeIndex]);

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-100">
        <span className="text-xs font-semibold text-zinc-500">
          章节 · {chapters.length}
        </span>
      </div>

      {/* Chapter list */}
      <div
        ref={listRef}
        className="max-h-[360px] overflow-y-auto py-1"
      >
        {chapters.map((ch, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => seek(ch.seconds)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 border-l-[3px]",
                isActive
                  ? "bg-emerald-50/70 border-l-emerald-500"
                  : "border-l-transparent hover:bg-zinc-50"
              )}
            >
              {/* Timestamp */}
              <span
                className={cn(
                  "shrink-0 font-mono text-[12px] tabular-nums w-[42px]",
                  isActive ? "text-emerald-600 font-medium" : "text-zinc-400"
                )}
              >
                {formatTime(ch.seconds)}
              </span>

              {/* Title */}
              <span
                className={cn(
                  "text-[13px] leading-snug truncate",
                  isActive
                    ? "text-zinc-900 font-medium"
                    : "text-zinc-600"
                )}
              >
                {ch.title}
              </span>

              {/* Active indicator - pulsing dot */}
              {isActive && (
                <span className="shrink-0 ml-auto flex items-center">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
