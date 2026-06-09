"use client";

import { X, FileText, ArrowSquareOut } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArticleDetailData {
  title: string;
  url: string;
  platform: string;
  score?: number | null;
  author?: string | null;
  publishedAt?: string | null;
  tags?: string[] | null;
  summary?: string | null;
  fulltext?: string | null;
}

interface ArticleDetailPanelProps {
  article: ArticleDetailData | null;
  onClose: () => void;
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
// Component
// ---------------------------------------------------------------------------

export function ArticleDetailPanel({ article, onClose }: ArticleDetailPanelProps) {
  // Empty state
  if (!article) {
    return (
      <div className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-900 flex flex-col items-center justify-center h-full px-5 py-5">
        <FileText size={32} weight="bold" className="text-zinc-700 mb-3" />
        <p className="text-xs text-zinc-600">点击左侧条目查看详情</p>
      </div>
    );
  }

  const platformKey = article.platform.toLowerCase();
  const platformCfg = PLATFORM_CONFIG[platformKey] ?? {
    label: article.platform,
    className: "bg-zinc-500/20 text-zinc-300",
  };

  return (
    <div className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-900 overflow-y-auto px-5 py-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
          线索详情
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="关闭详情面板"
        >
          <X size={14} weight="bold" />
        </button>
      </div>

      {/* Title */}
      <h3 className="text-sm font-bold text-zinc-100 leading-snug">
        {article.title}
      </h3>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {/* Platform badge */}
        <span
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold leading-none",
            platformCfg.className
          )}
        >
          {platformCfg.label}
        </span>

        {/* Score badge */}
        {article.score != null && (
          <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
            评分 {article.score}
          </span>
        )}

        {/* Author */}
        {article.author && (
          <span className="text-[10px] text-zinc-500">{article.author}</span>
        )}

        {/* Date */}
        {article.publishedAt && (
          <span className="text-[10px] text-zinc-500">
            {new Date(article.publishedAt).toLocaleDateString("zh-CN")}
          </span>
        )}
      </div>

      {/* Tags */}
      {article.tags && article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {article.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* AI Summary */}
      {article.summary && (
        <div className="mt-4">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
            线索摘记
          </p>
          <div className="bg-zinc-800/30 rounded-lg p-3">
            <p className="text-xs text-zinc-300 leading-relaxed">
              {article.summary}
            </p>
          </div>
        </div>
      )}

      {/* Fulltext preview */}
      {article.fulltext && (
        <div className="mt-4">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
            原文预览
          </p>
          <p className="text-xs text-zinc-400 leading-relaxed line-clamp-[12] whitespace-pre-line">
            {article.fulltext.slice(0, 1200)}
            {article.fulltext.length > 1200 && "..."}
          </p>
        </div>
      )}

      {/* Read original link */}
      <div className="mt-4">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <ArrowSquareOut size={14} weight="bold" />
          阅读原文
        </a>
      </div>
    </div>
  );
}
