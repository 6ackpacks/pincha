"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "@/components/layout/sidebar";
import { getVideos, deleteVideo, type VideoResponse } from "@/lib/api/videos";
import { getArticlesList, type ArticleAnalysisResponse } from "@/lib/api/articles";
import { proxyThumbnail } from "@/lib/api/client";
import { getMe } from "@/lib/api/auth";
import { getCurateV2Feed, triggerDeepAnalyze, type CurateV2ChannelPicks } from "@/lib/api/curate";
import { cn, stripMarkdown } from "@/lib/utils";
import {
  Play,
  CheckCircle,
  CircleNotch,
  XCircle,
  VideoCamera,
  Trash,
  Rss,
  Heart,
  ArrowRight,
  CaretRight,
  CaretDown,
  CalendarBlank,
  FileText,
  Microphone,
} from "@phosphor-icons/react";
import { useRef, useState, useEffect } from "react";
import { PickCard } from "@/components/curate/pick-card";


function getRecentDates(days: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function formatDateLabel(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "今天";
  if (dateStr === yesterday) return "昨天";
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function ChannelFoldGroup({
  channelData,
  onDeepAnalyze,
}: {
  channelData: CurateV2ChannelPicks;
  onDeepAnalyze: (pickId: number) => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const picks = channelData.picks;
  const previewCount = 1;
  const hasMore = picks.length > previewCount;
  const visiblePicks = expanded ? picks : picks.slice(0, previewCount);

  return (
    <div className="border border-zinc-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-600">
            {channelData.channel.name}
          </span>
          <span className="text-[10px] text-zinc-400">
            {picks.length} 条内容
          </span>
        </div>
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
          >
            {expanded ? "收起" : `展开全部`}
            <CaretDown
              size={11}
              weight="bold"
              className={cn("transition-transform duration-200", expanded && "rotate-180")}
            />
          </button>
        )}
      </div>
      <div className="divide-y divide-zinc-50">
        <AnimatePresence initial={false}>
          {visiblePicks.map((pick, i) => (
            <motion.div
              key={pick.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <PickCard
                pick={{
                  ...pick,
                  channel_slug: channelData.channel.slug,
                  channel_name: channelData.channel.name,
                }}
                index={i}
                onDeepAnalyze={(pickId) => onDeepAnalyze(pickId)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function HScrollRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCanScroll(el.scrollWidth > el.clientWidth + el.scrollLeft + 10);
    check();
    el.addEventListener("scroll", check);
    window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [children]);

  return (
    <div className="relative group/scroll">
      <div ref={ref} className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollBehavior: "smooth", scrollbarWidth: "none" }}>
        {children}
      </div>
      {canScroll && (
        <button
          onClick={() => ref.current?.scrollBy({ left: 300, behavior: "smooth" })}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-zinc-200 shadow-md flex items-center justify-center text-zinc-500 hover:text-zinc-900 transition-all opacity-0 group-hover/scroll:opacity-100"
        >
          <CaretRight size={14} weight="bold" />
        </button>
      )}
    </div>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  const { data: videos = [], isLoading: loadingVideos } = useQuery({
    queryKey: ["videos"],
    queryFn: () => getVideos(),
  });

  const { data: articles = [], isLoading: loadingArticles } = useQuery({
    queryKey: ["articles-list"],
    queryFn: () => getArticlesList(),
  });

  const recentDates = getRecentDates(3);
  const [selectedDate, setSelectedDate] = useState<string>(recentDates[0]);

  const { data: feedData, isLoading: loadingFeed } = useQuery({
    queryKey: ["curate-v2-feed", selectedDate],
    queryFn: () => getCurateV2Feed(selectedDate),
  });

  const deepAnalyzeMut = useMutation({
    mutationFn: triggerDeepAnalyze,
  });

  const deleteMut = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });

  const sortedVideos = [...videos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const feedChannels = feedData?.channels ?? [];
  const hasSubscriptions = feedChannels.length > 0;

  return (
    <div className="flex h-screen bg-[#FAFAFA]">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">

          {/* Greeting */}
          <div className="mb-10">
            <h1 className="text-2xl font-bold text-zinc-900">
              你好，{me?.nickname ?? "用户"}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              你的个人书房，内容与知识都在这里
            </p>
          </div>

          {/* ═══ 我的解析 ═══ */}
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <VideoCamera size={16} weight="bold" className="text-zinc-500" />
                <h2 className="text-sm font-bold text-zinc-700">我的品读</h2>
                {(videos.length + articles.length) > 0 && (
                  <span className="text-xs text-zinc-400">{videos.filter((v) => v.platform !== "podcast").length} 个视频 · {videos.filter((v) => v.platform === "podcast").length} 个播客 · {articles.length} 篇文章</span>
                )}
              </div>
              <Link href="/videos" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 font-medium transition-colors">
                查看全部 <ArrowRight size={12} weight="bold" />
              </Link>
            </div>

            {/* 视频解析 */}
            {loadingVideos ? (
              <div className="flex gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="shrink-0 w-[260px]">
                    <div className="aspect-video rounded-xl bg-zinc-100 animate-pulse" />
                    <div className="mt-2 h-4 w-3/4 bg-zinc-100 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : sortedVideos.filter((v) => v.platform !== "podcast").length === 0 && articles.length === 0 && sortedVideos.filter((v) => v.platform === "podcast").length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-zinc-200 rounded-xl">
                <VideoCamera size={32} weight="bold" className="text-zinc-200 mb-3" />
                <p className="text-sm font-medium text-zinc-500 mb-1">还没有品读记录</p>
                <p className="text-xs text-zinc-400 mb-4">放入一条内容开始整理</p>
                <Link href="/" className="px-4 py-2 text-xs font-bold bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors">
                  开始品读
                </Link>
              </div>
            ) : (
              <>
                {/* 视频 */}
                {sortedVideos.filter((v) => v.platform !== "podcast").length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <VideoCamera size={14} weight="bold" className="text-zinc-400" />
                      <span className="text-xs font-semibold text-zinc-500">视频品读</span>
                    </div>
                    <HScrollRow>
                      {sortedVideos.filter((v) => v.platform !== "podcast").map((v, i) => (
                        <VideoCard key={v.id} video={v} index={i} onDelete={() => deleteMut.mutate(v.id)} />
                      ))}
                    </HScrollRow>
                  </div>
                )}

                {/* 播客 */}
                {sortedVideos.filter((v) => v.platform === "podcast").length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Microphone size={14} weight="bold" className="text-zinc-400" />
                      <span className="text-xs font-semibold text-zinc-500">播客品读</span>
                    </div>
                    <HScrollRow>
                      {sortedVideos.filter((v) => v.platform === "podcast").map((v, i) => (
                        <VideoCard key={v.id} video={v} index={i} onDelete={() => deleteMut.mutate(v.id)} />
                      ))}
                    </HScrollRow>
                  </div>
                )}

                {/* 文章 */}
                {articles.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FileText size={14} weight="bold" className="text-zinc-400" />
                      <span className="text-xs font-semibold text-zinc-500">文章品读</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {articles.slice(0, 6).map((article) => (
                        <ArticleCard key={article.id} article={article} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ═══ 我的订阅 ═══ */}
          <section id="subscriptions" className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Rss size={16} weight="bold" className="text-zinc-500" />
                <h2 className="text-sm font-bold text-zinc-700">我的猹选</h2>
                {feedChannels.length > 0 && (
                  <span className="text-xs text-zinc-400">{feedChannels.length} 个频道</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Link href="/library/subscriptions" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 font-medium transition-colors">
                  管理频道 <ArrowRight size={12} weight="bold" />
                </Link>
              </div>
            </div>

            {/* Date selector */}
            {hasSubscriptions && (
              <div className="flex items-center gap-2 mb-4">
                <CalendarBlank size={13} weight="bold" className="text-zinc-400" />
                <div className="flex gap-1.5">
                  {recentDates.map((d) => (
                    <button
                      key={d}
                      onClick={() => setSelectedDate(d)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                        selectedDate === d
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                      )}
                    >
                      {formatDateLabel(d)}
                    </button>
                  ))}
                </div>
                <Link
                  href="/library/feed"
                  className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 font-medium transition-colors"
                >
                  查看全部 <ArrowRight size={11} weight="bold" />
                </Link>
              </div>
            )}

            {loadingFeed ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 rounded-xl bg-zinc-50 animate-pulse" />
                ))}
              </div>
            ) : !hasSubscriptions ? (
              <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-zinc-200 rounded-xl">
                <Rss size={28} weight="bold" className="text-zinc-200 mb-2" />
                <p className="text-sm font-medium text-zinc-500 mb-1">还没有订阅频道</p>
                <p className="text-xs text-zinc-400 mb-3">去猹选里订阅感兴趣的内容线索</p>
                <Link href="/curate" className="px-4 py-2 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
                  去猹选
                </Link>
              </div>
            ) : feedChannels.every((ch) => ch.picks.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-zinc-200 rounded-xl">
                <CalendarBlank size={24} weight="bold" className="text-zinc-200 mb-2" />
                <p className="text-sm font-medium text-zinc-500">
                  {formatDateLabel(selectedDate)}还没有新线索
                </p>
                <p className="text-xs text-zinc-400 mt-1">试试切换其他日期</p>
              </div>
            ) : (
              <div className="space-y-3">
                {feedChannels
                  .filter((ch) => ch.picks.length > 0)
                  .map((channelData) => (
                    <ChannelFoldGroup
                      key={channelData.channel.id}
                      channelData={channelData}
                      onDeepAnalyze={(pickId) => deepAnalyzeMut.mutateAsync(pickId)}
                    />
                  ))}
              </div>
            )}
          </section>

          {/* ═══ 我的收藏 ═══ */}
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Heart size={16} weight="bold" className="text-zinc-500" />
                <h2 className="text-sm font-bold text-zinc-700">我的收藏</h2>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50">
              <Heart size={28} weight="bold" className="text-zinc-200 mb-2" />
              <p className="text-sm font-medium text-zinc-500 mb-1">收藏功能即将上线</p>
              <p className="text-xs text-zinc-400">之后可以把好内容先放在这里慢慢读</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function ArticleCard({ article }: { article: ArticleAnalysisResponse }) {
  const isDone = article.status?.state === "done";
  const isProcessing = article.status?.state === "processing";

  return (
    <Link href={`/articles/${article.id}`} className="block group">
      <div className="p-4 rounded-xl border border-zinc-100 bg-white hover:border-zinc-200 hover:shadow-sm transition-all">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
            {isProcessing ? (
              <CircleNotch size={14} weight="bold" className="animate-spin text-zinc-400" />
            ) : (
              <FileText size={14} weight="bold" className="text-zinc-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-800 line-clamp-2 group-hover:text-zinc-600 transition-colors">
              {stripMarkdown(article.title) || "无标题文章"}
            </p>
            {article.content && (
              <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1">{article.content.slice(0, 100)}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              {isDone && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-medium">已完成</span>}
              {isProcessing && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">整理中</span>}
              <span className="text-[10px] text-zinc-300">
                {new Date(article.created_at).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function VideoCard({ video, index, onDelete }: { video: VideoResponse; index: number; onDelete: () => void }) {
  const router = useRouter();
  const isDone = video.status.state === "done";
  const isFailed = video.status.state === "failed";
  const thumbSrc = video.thumbnail_url
    ? (proxyThumbnail(video.thumbnail_url) ?? video.thumbnail_url)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className="shrink-0 w-[260px] group relative"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-3 z-10 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
      >
        <Trash size={11} weight="bold" />
      </button>

      <div onClick={() => router.push(`/videos/${video.id}`)} className="cursor-pointer">
        <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-100">
          {thumbSrc ? (
            <img src={thumbSrc} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-50">
              <Play size={20} weight="bold" className="text-zinc-300" />
            </div>
          )}
          <span className={cn("absolute top-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded", video.platform === "youtube" ? "bg-red-500 text-white" : "bg-purple-500 text-white")}>
            {video.platform === "youtube" ? "YouTube" : "播客"}
          </span>
          {video.duration && (
            <span className="absolute bottom-2 right-2 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/70 text-white">{video.duration}</span>
          )}
        </div>
        <div className="mt-2.5 px-0.5">
          <p className="text-xs font-semibold text-zinc-800 line-clamp-2 leading-snug group-hover:text-zinc-600 transition-colors">
            {stripMarkdown(video.title) || "无标题"}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            {isDone ? (
              <span className="flex items-center gap-1 text-[10px] font-medium text-zinc-500">
                <CheckCircle size={10} weight="bold" /> 已完成
              </span>
            ) : isFailed ? (
              <span className="flex items-center gap-1 text-[10px] font-medium text-red-400">
                <XCircle size={10} weight="bold" /> 失败
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500">
                <CircleNotch size={10} weight="bold" className="animate-spin" /> 整理中
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
