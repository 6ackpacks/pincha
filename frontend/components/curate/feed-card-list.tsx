"use client";

import { useState } from "react";
import {
  CheckCircle,
  CircleNotch,
  PushPin,
} from "@phosphor-icons/react";
import { cn, stripMarkdown } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedCardItem {
  id: string;
  title: string;
  summary?: string;
  platform: string;
  publishedAt?: string;
  tags?: string[];
  inKb?: boolean;
}

interface FeedCardListProps {
  channelName: string;
  items: FeedCardItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onViewAll?: () => void;
  onAddToKb?: (id: string) => void;
  addingIds?: string[];
}

// ---------------------------------------------------------------------------
// Platform badge config (dark theme)
// ---------------------------------------------------------------------------

const PLATFORM_CONFIG: Record<string, { label: string; className: string }> = {
  youtube: { label: "YouTube", className: "bg-red-500/20 text-red-300" },
  github: { label: "GitHub", className: "bg-zinc-500/20 text-zinc-300" },
  hn: { label: "HN", className: "bg-orange-500/20 text-orange-300" },
  hackernews: { label: "HN", className: "bg-orange-500/20 text-orange-300" },
  arxiv: { label: "arXiv", className: "bg-blue-500/20 text-blue-300" },
  reddit: { label: "Reddit", className: "bg-orange-500/20 text-orange-300" },
  producthunt: { label: "PH", className: "bg-red-500/20 text-red-300" },
  wechat: { label: "微信", className: "bg-green-500/20 text-green-300" },
  gnews: { label: "GNews", className: "bg-blue-500/20 text-blue-300" },
  freenews: { label: "News", className: "bg-zinc-500/20 text-zinc-300" },
  techcrunch: { label: "TC", className: "bg-emerald-500/20 text-emerald-300" },
  huggingface: { label: "HF", className: "bg-yellow-500/20 text-yellow-300" },
  tldr: { label: "TLDR", className: "bg-violet-500/20 text-violet-300" },
};

// ---------------------------------------------------------------------------
// Rank color helper
// ---------------------------------------------------------------------------

function getRankColor(rank: number): string {
  if (rank === 1) return "text-amber-400";
  if (rank === 2) return "text-zinc-400";
  if (rank === 3) return "text-orange-400";
  return "text-zinc-600";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeedCardList({
  channelName,
  items,
  selectedId,
  onSelect,
  onViewAll,
  onAddToKb,
  addingIds = [],
}: FeedCardListProps) {
  return (
    <div className="bg-[#111111] px-6 py-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-white">{channelName}</h2>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            查看全部 →
          </button>
        )}
      </div>

      {/* Card list */}
      <div className="space-y-3">
        {items.map((item, i) => {
          const rank = i + 1;
          const isSelected = selectedId === item.id;
          const isAdding = addingIds.includes(item.id);
          const platformKey = item.platform.toLowerCase();
          const platformCfg = PLATFORM_CONFIG[platformKey] ?? {
            label: item.platform,
            className: "bg-zinc-500/20 text-zinc-300",
          };

          return (
            <div
              key={item.id}
              onClick={() => onSelect?.(item.id)}
              className={cn(
                "group flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all",
                isSelected
                  ? "bg-zinc-800/80 border-l-2 border-emerald-400 pl-3.5"
                  : "bg-zinc-900/50 hover:bg-zinc-800/70"
              )}
            >
              {/* Rank */}
              <span
                className={cn(
                  "shrink-0 w-6 text-sm font-bold",
                  getRankColor(rank)
                )}
              >
                #{rank}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-100 line-clamp-1">
                  {stripMarkdown(item.title)}
                </p>
                {item.summary && (
                  <p className="text-xs text-zinc-500 line-clamp-2 mt-1 leading-relaxed">
                    {item.summary}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  {/* Platform badge */}
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none",
                      platformCfg.className
                    )}
                  >
                    {platformCfg.label}
                  </span>

                  {/* Time */}
                  {item.publishedAt && (
                    <span className="text-[10px] text-zinc-600">
                      {item.publishedAt}
                    </span>
                  )}

                  {/* Tags */}
                  {item.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action button */}
              <div className="shrink-0">
                {item.inKb ? (
                  <CheckCircle
                    size={16}
                    weight="bold"
                    className="text-emerald-400"
                  />
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToKb?.(item.id);
                    }}
                    disabled={isAdding}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold border border-zinc-700 text-zinc-400 hover:border-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {isAdding ? (
                      <CircleNotch
                        size={10}
                        weight="bold"
                        className="animate-spin"
                      />
                    ) : (
                      "收录"
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
