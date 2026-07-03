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
  className?: string;
}

export default function ChapterBar({ chapters, videoDuration, className }: ChapterBarProps) {
  const currentTime = useAtomValue(currentTimeAtom);
  const seekFn = useAtomValue(seekFnAtom);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Find current active chapter index
  const activeIndex = chapters.reduce((acc, ch, i) => {
    return currentTime >= ch.seconds ? i : acc;
  }, -1);

  // Auto-scroll active chapter into view
  useEffect(() => {
    if (!activeRef.current || !listRef.current) return;
    const container = listRef.current;
    const el = activeRef.current;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIndex]);

  if (chapters.length === 0) return null;

  const seek = (seconds: number) => seekFn?.(seconds);

  return (
    <section className={cn("min-h-[176px] rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden flex flex-col", className)}>
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-zinc-100 bg-white">
        <span className="text-xs font-semibold text-zinc-500">
          章节 · {chapters.length}
        </span>
      </div>

      {/* Chapter list */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 max-h-[clamp(176px,28vh,360px)] overflow-y-auto overscroll-contain py-1 [scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent"
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
                  "min-w-0 text-[13px] leading-snug",
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
    </section>
  );
}
