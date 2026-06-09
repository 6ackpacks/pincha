"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { stripMarkdown } from "@/lib/utils";
import { ArrowSquareOut, Sparkle, SealCheck, CircleNotch, CheckCircle, CaretRight } from "@phosphor-icons/react";
import type { CurateV2Pick } from "@/lib/api";

const CHANNEL_COLORS: Record<string, string> = {
  "ai-product-launch": "bg-violet-50 text-violet-600",
  "ai-tutorial": "bg-sky-50 text-sky-600",
  "ai-product-insight": "bg-emerald-50 text-emerald-600",
  "ai-deep-read": "bg-amber-50 text-amber-600",
  "ai-daily-brief": "bg-rose-50 text-rose-600",
};

function getChannelColor(slug: string): string {
  return CHANNEL_COLORS[slug] || "bg-zinc-100 text-zinc-600";
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = new Date();
  const then = new Date(dateStr);
  const diff = now.getTime() - then.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `今天 ${then.getHours().toString().padStart(2, "0")}:${then.getMinutes().toString().padStart(2, "0")}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return `昨天 ${then.getHours().toString().padStart(2, "0")}:${then.getMinutes().toString().padStart(2, "0")}`;
  if (days < 7) return `${days} 天前`;
  return then.toLocaleDateString("zh-CN");
}

export interface PickCardProps {
  pick: CurateV2Pick;
  onDeepAnalyze?: (pickId: number) => Promise<unknown> | void;
  index?: number;
}

export function PickCard({ pick, onDeepAnalyze, index = 0 }: PickCardProps) {
  const [analyzeState, setAnalyzeState] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleDeepAnalyze = async () => {
    if (!onDeepAnalyze || analyzeState === "loading") return;
    setAnalyzeState("loading");
    try {
      await onDeepAnalyze(pick.id);
      setAnalyzeState("success");
      setTimeout(() => setAnalyzeState("idle"), 3000);
    } catch {
      setAnalyzeState("error");
      setTimeout(() => setAnalyzeState("idle"), 3000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="p-4 rounded-xl border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50/50 transition-all group"
    >
      {/* Title row */}
      <div className="flex items-start gap-2">
        <Link
          href={`/curate/preview/${pick.id}`}
          className="flex-1 min-w-0"
        >
          <h3 className="text-sm font-semibold text-zinc-800 line-clamp-2 group-hover:text-indigo-600 transition-colors leading-snug">
            {stripMarkdown(pick.title)}
            {pick.is_official && (
              <SealCheck
                size={13}
                weight="fill"
                className="inline ml-1.5 text-blue-500"
              />
            )}
          </h3>
        </Link>
        <Link href={`/curate/preview/${pick.id}`} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity">
          <CaretRight size={14} className="text-zinc-400" />
        </Link>
      </div>

      {/* Summary */}
      {pick.summary && (
        <p className="text-xs text-zinc-500 line-clamp-2 mt-1.5 leading-relaxed">
          {pick.summary}
        </p>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Author */}
          {pick.author_name && (
            <div className="flex items-center gap-1.5 min-w-0">
              {pick.author_avatar ? (
                <img
                  src={pick.author_avatar}
                  alt=""
                  className="w-4 h-4 rounded-full object-cover"
                />
              ) : (
                <div className="w-4 h-4 rounded-full bg-zinc-200" />
              )}
              <span className="text-[11px] text-zinc-500 truncate max-w-[100px]">
                {pick.author_name}
              </span>
            </div>
          )}

          {/* Time */}
          {pick.published_at && (
            <span className="text-[10px] text-zinc-400 shrink-0">
              {relativeTime(pick.published_at)}
            </span>
          )}

          {/* Channel tag */}
          {pick.channel_slug && pick.channel_name && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${getChannelColor(pick.channel_slug)}`}
            >
              {pick.channel_name}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={pick.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            <ArrowSquareOut size={12} weight="bold" />
            查看原文
          </a>
          {onDeepAnalyze && (
            <button
              onClick={handleDeepAnalyze}
              disabled={analyzeState === "loading" || analyzeState === "success"}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-70 ${
                analyzeState === "success"
                  ? "text-emerald-600 bg-emerald-50"
                  : analyzeState === "error"
                    ? "text-red-600 bg-red-50"
                    : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              {analyzeState === "loading" ? (
                <>
                  <CircleNotch size={12} weight="bold" className="animate-spin" />
                  整理中...
                </>
              ) : analyzeState === "success" ? (
                <>
                  <CheckCircle size={12} weight="bold" />
                  已收录
                </>
              ) : (
                <>
                  <Sparkle size={12} weight="bold" />
                  深度整理
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
