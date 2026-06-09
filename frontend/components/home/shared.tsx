"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CaretRight, Robot, ChartBar, Rocket, Play, Microphone, FileText } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export const PLACEHOLDERS = [
  "放入一个视频、播客或文章链接...",
  "粘贴一段值得细读的内容...",
  "给今天的重要信息一个归处...",
];

export function useTypewriter(phrases: string[], typingSpeed = 70, deletingSpeed = 40, pauseDuration = 2000) {
  const [displayText, setDisplayText] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!isActive) return;
    const currentPhrase = phrases[phraseIndex];
    if (isPaused) {
      const timeout = setTimeout(() => { setIsPaused(false); setIsTyping(false); }, pauseDuration);
      return () => clearTimeout(timeout);
    }
    if (isTyping) {
      if (displayText.length < currentPhrase.length) {
        const timeout = setTimeout(() => setDisplayText(currentPhrase.slice(0, displayText.length + 1)), typingSpeed);
        return () => clearTimeout(timeout);
      } else {
        setIsPaused(true);
      }
    } else {
      if (displayText.length > 0) {
        const timeout = setTimeout(() => setDisplayText(displayText.slice(0, -1)), deletingSpeed);
        return () => clearTimeout(timeout);
      } else {
        setPhraseIndex((prev) => (prev + 1) % phrases.length);
        setIsTyping(true);
      }
    }
  }, [displayText, phraseIndex, isTyping, isPaused, isActive, phrases, typingSpeed, deletingSpeed, pauseDuration]);

  const stop = useCallback(() => setIsActive(false), []);
  const start = useCallback(() => setIsActive(true), []);
  return { displayText, stop, start };
}

export function HScrollRow({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCanScrollRight(el.scrollWidth > el.clientWidth + el.scrollLeft + 10);
    check();
    el.addEventListener("scroll", check);
    window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [children]);

  return (
    <div className={cn("relative group/scroll", className)}>
      <div ref={ref} className="flex gap-4 overflow-x-auto pb-3 scrollbar-hide" style={{ scrollBehavior: "smooth", scrollbarWidth: "none" }}>
        {children}
      </div>
      {canScrollRight && (
        <button
          onClick={() => ref.current?.scrollBy({ left: 300, behavior: "smooth" })}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white border border-zinc-200 shadow-md flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:border-zinc-400 transition-all opacity-0 group-hover/scroll:opacity-100"
        >
          <CaretRight size={16} weight="bold" />
        </button>
      )}
    </div>
  );
}

const FEATURES = [
  { icon: Robot, title: "提炼要点", desc: "从长内容里抓住值得留下的部分" },
  { icon: ChartBar, title: "梳理脉络", desc: "把零散信息整理成可回看的线索" },
  { icon: Rocket, title: "继续追问", desc: "围绕原文、视频与知识库继续探索" },
] as const;

export function FeatureCards() {
  return (
    <div className="mt-6 grid grid-cols-3 gap-3">
      {FEATURES.map((card) => {
        const CardIcon = card.icon;
        return (
          <div key={card.title} className="flex items-start gap-3 p-4 rounded-xl border border-zinc-100 bg-white/80 hover:shadow-sm hover:border-zinc-200 transition-all">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
              <CardIcon size={16} weight="bold" className="text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-800">{card.title}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{card.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type Platform = "youtube" | "article" | "podcast";

const MODES = [
  { key: "youtube" as const, icon: Play, label: "YouTube" },
  { key: "podcast" as const, icon: Microphone, label: "播客" },
  { key: "article" as const, icon: FileText, label: "文章" },
];

export function PlatformTabs({ platform, onChange }: { platform: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="mt-5 flex items-center gap-3">
      <span className="text-sm text-zinc-400 mr-1">选择内容类型：</span>
      {MODES.map((mode) => {
        const ModeIcon = mode.icon;
        const isActive = platform === mode.key;
        return (
          <button
            key={mode.key}
            onClick={() => onChange(mode.key)}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all border",
              isActive
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300 hover:text-zinc-700"
            )}
          >
            <ModeIcon size={16} weight="bold" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
