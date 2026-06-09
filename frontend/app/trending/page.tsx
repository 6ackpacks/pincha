"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Play,
  Headphones,
  FileText,
  CircleNotch,
  TrendUp,
  CheckCircle,
  Clock,
  XCircle,
  Fire,
} from "@phosphor-icons/react";
import { getVideos, getArticlesList, getTrendingVideos, getTrendingArticles, proxyThumbnail } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { cn, stripMarkdown } from "@/lib/utils";

type ContentItem = {
  id: string;
  type: "video" | "podcast" | "article";
  title: string | null;
  platform?: string;
  thumbnailUrl?: string | null;
  duration?: string | null;
  state: string;
  createdAt: string;
};

const TABS = [
  { key: "all", label: "全部", icon: TrendUp },
  { key: "video", label: "视频", icon: Play },
  { key: "podcast", label: "播客", icon: Headphones },
  { key: "article", label: "博客", icon: FileText },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const MAX_PER_TYPE = 20;

export default function TrendingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const videosQuery = useQuery({
    queryKey: ["trending-videos"],
    queryFn: () => getTrendingVideos(20),
    staleTime: 60_000,
  });

  const articlesQuery = useQuery({
    queryKey: ["trending-articles"],
    queryFn: () => getTrendingArticles(20),
    staleTime: 60_000,
  });

  const videoItems: ContentItem[] = [];
  const podcastItems: ContentItem[] = [];
  const articleItems: ContentItem[] = [];

  if (videosQuery.data) {
    for (const v of videosQuery.data) {
      const item: ContentItem = {
        id: v.id,
        type: v.platform === "podcast" ? "podcast" : "video",
        title: v.title,
        platform: v.platform,
        thumbnailUrl: v.thumbnail_url,
        duration: v.duration,
        state: v.status?.state ?? "pending",
        createdAt: v.created_at,
      };
      if (v.platform === "podcast") {
        podcastItems.push(item);
      } else {
        videoItems.push(item);
      }
    }
  }

  if (articlesQuery.data) {
    for (const a of articlesQuery.data) {
      articleItems.push({
        id: a.id,
        type: "article",
        title: a.title,
        thumbnailUrl: a.thumbnail_url,
        state: a.status?.state ?? "pending",
        createdAt: a.created_at,
      });
    }
  }

  const limitedVideos = videoItems.slice(0, MAX_PER_TYPE);
  const limitedPodcasts = podcastItems.slice(0, MAX_PER_TYPE);
  const limitedArticles = articleItems.slice(0, MAX_PER_TYPE);

  const allItems = [...limitedVideos, ...limitedPodcasts, ...limitedArticles].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const filtered =
    activeTab === "all"
      ? allItems
      : activeTab === "video"
      ? limitedVideos
      : activeTab === "podcast"
      ? limitedPodcasts
      : limitedArticles;

  const isLoading = videosQuery.isLoading || articlesQuery.isLoading;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-500 transition-colors"
              >
                <ArrowLeft size={18} weight="bold" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
                  <Fire size={22} weight="bold" className="text-orange-500" />
                  热门线索
                </h1>
                <p className="text-sm text-zinc-500 mt-0.5">
                  全站内容线索 · 每类最多展示 {MAX_PER_TYPE} 条
                </p>
              </div>
            </div>
            <div className="text-xs text-zinc-400">
              {!isLoading && (
                <span>
                  视频 {limitedVideos.length} · 播客 {limitedPodcasts.length} · 博客{" "}
                  {limitedArticles.length}
                </span>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 mb-6 border-b border-zinc-100 pb-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const count =
                tab.key === "all"
                  ? allItems.length
                  : tab.key === "video"
                  ? limitedVideos.length
                  : tab.key === "podcast"
                  ? limitedPodcasts.length
                  : limitedArticles.length;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                    activeTab === tab.key
                      ? "bg-zinc-900 text-white border border-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-50 border border-transparent"
                  )}
                >
                  <Icon size={14} weight="bold" />
                  {tab.label}
                  {!isLoading && <span className="text-xs opacity-60 ml-0.5">{count}</span>}
                </button>
              );
            })}
          </div>

          {/* Content Grid */}
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="aspect-video rounded-xl bg-zinc-100" />
                  <div className="mt-2.5 h-4 w-3/4 bg-zinc-100 rounded" />
                  <div className="mt-1.5 h-3 w-1/2 bg-zinc-50 rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
              <TrendUp size={48} weight="bold" className="mb-4 opacity-20" />
              <p className="text-base font-medium mb-1">暂无内容</p>
              <p className="text-sm">
                回到首页放入视频、播客或文章链接，开始品读
              </p>
              <Link
                href="/"
                className="mt-4 px-5 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-700 transition-colors"
              >
                去放入内容
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {filtered.map((item, i) => (
                <TrendingCard key={`${item.type}-${item.id}`} item={item} index={i} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function TrendingCard({ item, index }: { item: ContentItem; index: number }) {
  const href = item.type === "article" ? `/articles/${item.id}` : `/videos/${item.id}`;
  const thumbSrc = item.thumbnailUrl
    ? item.type !== "article"
      ? proxyThumbnail(item.thumbnailUrl) ?? item.thumbnailUrl
      : item.thumbnailUrl
    : null;

  const isDone = item.state === "done";
  const isFailed = item.state === "failed";
  const isProcessing = !isDone && !isFailed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
    >
      <Link href={href} className="block group">
        <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-100">
          {thumbSrc ? (
            <img
              src={thumbSrc}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
              {item.type === "article" ? (
                <FileText size={28} weight="bold" className="text-zinc-400" />
              ) : item.type === "podcast" ? (
                <Headphones size={28} weight="bold" className="text-zinc-400" />
              ) : (
                <Play size={28} weight="bold" className="text-zinc-400" />
              )}
            </div>
          )}

          {/* Duration badge */}
          {item.duration && (
            <span className="absolute bottom-2 right-2 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/75 text-white">
              {item.duration}
            </span>
          )}

          {/* Type badge */}
          <span
            className={cn(
              "absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full text-white",
              item.type === "video" && item.platform === "youtube" && "bg-red-500",
              item.type === "podcast" && "bg-purple-500",
              item.type === "article" && "bg-amber-500"
            )}
          >
            {item.type === "video"
              ? "YouTube"
              : item.type === "podcast"
              ? "播客"
              : "博客"}
          </span>

          {/* Status overlay for non-done items */}
          {!isDone && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              {isProcessing ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 rounded-full">
                  <CircleNotch size={12} weight="bold" className="animate-spin text-zinc-600" />
                  <span className="text-xs font-medium text-zinc-700">整理中</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 rounded-full">
                  <XCircle size={12} weight="bold" className="text-red-500" />
                  <span className="text-xs font-medium text-zinc-700">失败</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Title + meta */}
        <div className="mt-2.5 px-0.5">
          <p className="text-sm font-semibold text-zinc-800 line-clamp-2 group-hover:text-zinc-600 transition-colors">
            {stripMarkdown(item.title) || "无标题"}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {isDone && <CheckCircle size={11} weight="bold" className="text-zinc-600" />}
            {isProcessing && <Clock size={11} weight="bold" className="text-amber-500" />}
            {isFailed && <XCircle size={11} weight="bold" className="text-red-400" />}
            <span className="text-xs text-zinc-400">
              {new Date(item.createdAt).toLocaleDateString("zh-CN", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
