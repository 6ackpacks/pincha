"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Sidebar } from "@/components/layout/sidebar";
import { getVideos, deleteVideo, type VideoResponse } from "@/lib/api/videos";
import { getArticlesList, type ArticleAnalysisResponse } from "@/lib/api/articles";
import { proxyThumbnail } from "@/lib/api/client";
import { getMe } from "@/lib/api/auth";
import { getCurateV2Feed, type CurateV2ChannelPicks, type CurateV2Pick } from "@/lib/api/curate";
import { cn, extractReadableText, stripMarkdown } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCurateDeepAnalyze } from "@/hooks/use-curate-deep-analyze";
import {
  Play,
  CheckCircle,
  CircleNotch,
  XCircle,
  VideoCamera,
  Trash,
  Rss,
  ArrowRight,
  CaretRight,
  CaretDown,
  CalendarBlank,
  DotsThree,
  Compass,
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

// 频道色彩系统 —— 用于卡片左侧色条 + 频道圆点，制造清晰视觉分界
const CHANNEL_ACCENT: Record<
  string,
  { bar: string; dot: string; soft: string; text: string }
> = {
  "ai-product-launch": { bar: "bg-violet-400", dot: "bg-violet-500", soft: "bg-violet-50", text: "text-violet-600" },
  "ai-tutorial": { bar: "bg-sky-400", dot: "bg-sky-500", soft: "bg-sky-50", text: "text-sky-600" },
  "ai-product-insight": { bar: "bg-emerald-400", dot: "bg-emerald-500", soft: "bg-emerald-50", text: "text-emerald-600" },
  "ai-deep-read": { bar: "bg-amber-400", dot: "bg-amber-500", soft: "bg-amber-50", text: "text-amber-600" },
  "ai-daily-brief": { bar: "bg-rose-400", dot: "bg-rose-500", soft: "bg-rose-50", text: "text-rose-600" },
};

function getAccent(slug: string) {
  return (
    CHANNEL_ACCENT[slug] ?? {
      bar: "bg-zinc-300",
      dot: "bg-zinc-400",
      soft: "bg-zinc-100",
      text: "text-zinc-600",
    }
  );
}

function ChannelFoldGroup({
  channelData,
  onDeepAnalyze,
}: {
  channelData: CurateV2ChannelPicks;
  onDeepAnalyze: (pick: CurateV2Pick) => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const picks = channelData.picks;
  const previewCount = 2;
  const hasMore = picks.length > previewCount;
  const visiblePicks = expanded ? picks : picks.slice(0, previewCount);
  const hiddenCount = picks.length - previewCount;
  const accent = getAccent(channelData.channel.slug);

  return (
    <div className="relative rounded-2xl bg-white border border-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-shadow overflow-hidden">
      {/* 左侧频道色条 —— 强化频道分界 */}
      <span className={cn("absolute left-0 top-0 bottom-0 w-1", accent.bar)} aria-hidden />

      {/* 频道头部 */}
      <div className="flex items-center justify-between pl-5 pr-4 py-3 border-b border-zinc-100/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn("w-2 h-2 rounded-full shrink-0", accent.dot)} aria-hidden />
          <span className="text-[13px] font-bold text-zinc-800 truncate">
            {channelData.channel.name}
          </span>
          <span
            className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
              accent.soft,
              accent.text
            )}
          >
            {picks.length}
          </span>
        </div>
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-all shrink-0"
          >
            {expanded ? "收起" : `展开 ${hiddenCount} 条`}
            <CaretDown
              size={11}
              weight="bold"
              className={cn("transition-transform duration-200", expanded && "rotate-180")}
            />
          </button>
        )}
      </div>

      {/* 内容列表 */}
      <div className="divide-y divide-zinc-50 pl-2">
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
                  onDeepAnalyze={(targetPick) => onDeepAnalyze(targetPick)}
                />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 折叠态省略提示 —— 暗示还有更多内容 */}
      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50/40 border-t border-dashed border-zinc-100 transition-colors"
        >
          <DotsThree size={16} weight="bold" />
          还有 {hiddenCount} 条线索
        </button>
      )}
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

  const deepAnalyzeMut = useCurateDeepAnalyze([["curate-v2-feed", selectedDate]]);

  const deleteMut = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      toast.success("已删除该解析");
    },
    onError: () => {
      toast.error("删除失败，请稍后重试");
    },
  });

  const sortedVideos = [...videos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeleteVideo = sortedVideos.find((v) => v.id === pendingDeleteId) ?? null;
  const pendingDeleteIsPodcast = pendingDeleteVideo?.platform === "podcast";

  const feedChannels = feedData?.channels ?? [];
  const hasSubscriptions = feedChannels.length > 0;

  return (
    <div className="flex h-screen bg-[#FAFAFA]">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">

          {/* Greeting */}
          <div className="mb-12">
            <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight">
              你好，{me?.nickname ?? "用户"}
            </h1>
            <p className="text-base text-zinc-400 mt-2">
              你的个人空间，内容与知识都在这里
            </p>
          </div>

          {/* ═══ 我的品读 ═══ */}
          <section className="mb-14">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight flex items-center gap-2.5">
                <VideoCamera size={20} weight="bold" className="text-emerald-500" />
                我的品读
              </h2>
              <Link href="/videos" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-emerald-600 font-semibold transition-colors">
                查看全部 <ArrowRight size={14} weight="bold" />
              </Link>
            </div>
            {(videos.length + articles.length) > 0 && (
              <p className="text-xs text-zinc-400 mb-5">
                {videos.filter((v) => v.platform !== "podcast").length} 个视频 · {videos.filter((v) => v.platform === "podcast").length} 个播客 · {articles.length} 篇文章
              </p>
            )}
            <div className="border-b border-zinc-100 mb-6" />

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
                        <VideoCard key={v.id} video={v} index={i} onDelete={() => setPendingDeleteId(v.id)} />
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
                        <VideoCard key={v.id} video={v} index={i} onDelete={() => setPendingDeleteId(v.id)} />
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

          {/* ═══ 我的猹选 ═══ */}
          <section id="subscriptions" className="mb-14">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight flex items-center gap-2.5">
                <Rss size={20} weight="bold" className="text-emerald-500" />
                我的猹选
              </h2>
              <div className="flex items-center gap-3">
                <Link href="/library/subscriptions" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-emerald-600 font-semibold transition-colors">
                  管理频道 <ArrowRight size={14} weight="bold" />
                </Link>
              </div>
            </div>
            {feedChannels.length > 0 && (
              <p className="text-xs text-zinc-400 mb-5">
                {formatDateLabel(selectedDate)} · {feedChannels.filter((ch) => ch.picks.length > 0).length} 个频道有更新
              </p>
            )}
            <div className="border-b border-zinc-100 mb-6" />

            {/* 历史记录时间线 —— 今天 / 昨天 / 更早 */}
            {hasSubscriptions && (
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-1.5 bg-zinc-100/70 rounded-full p-1">
                  {recentDates.map((d) => (
                    <button
                      key={d}
                      onClick={() => setSelectedDate(d)}
                      className={cn(
                        "px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all",
                        selectedDate === d
                          ? "bg-white text-zinc-900 shadow-sm"
                          : "text-zinc-400 hover:text-zinc-600"
                      )}
                    >
                      {formatDateLabel(d)}
                    </button>
                  ))}
                </div>
                {/* 省略提示：更早的记录都在「查看全部」 */}
                <Link
                  href="/library/feed"
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50/60 transition-all"
                >
                  <DotsThree size={16} weight="bold" />
                  更早
                </Link>
                <Link
                  href="/library/feed"
                  className="ml-auto flex items-center gap-1 text-[12px] text-zinc-400 hover:text-zinc-700 font-semibold transition-colors"
                >
                  查看全部 <ArrowRight size={12} weight="bold" />
                </Link>
              </div>
            )}

            {loadingFeed ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-28 rounded-2xl bg-zinc-50 animate-pulse" />
                ))}
              </div>
            ) : !hasSubscriptions ? (
              <div className="relative flex flex-col items-center justify-center py-16 px-6 text-center rounded-2xl border border-zinc-100 bg-gradient-to-b from-emerald-50/40 to-white overflow-hidden">
                <div className="absolute inset-0 opacity-[0.4] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgb(16 185 129 / 0.08) 1px, transparent 0)", backgroundSize: "16px 16px" }} aria-hidden />
                <div className="relative w-14 h-14 rounded-2xl bg-emerald-100/70 flex items-center justify-center mb-4">
                  <Compass size={26} weight="bold" className="text-emerald-500" />
                </div>
                <p className="relative text-base font-bold text-zinc-800 mb-1.5">订阅你的第一个频道</p>
                <p className="relative text-sm text-zinc-500 max-w-sm mb-5 leading-relaxed">
                  猹选会每天为你追踪 AI 产品发布、教程、深度阅读等线索，订阅后这里会按频道汇总每日更新。
                </p>
                <Link href="/curate" className="relative inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-sm hover:shadow-md transition-all">
                  <Compass size={16} weight="bold" />
                  去猹选逛逛
                </Link>
              </div>
            ) : feedChannels.every((ch) => ch.picks.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/40">
                <CalendarBlank size={26} weight="bold" className="text-zinc-300 mb-2.5" />
                <p className="text-sm font-bold text-zinc-600 mb-1">
                  {formatDateLabel(selectedDate)}还没有新线索
                </p>
                <p className="text-xs text-zinc-400 mb-4">换个日期，或去查看更早的记录</p>
                <div className="flex items-center gap-2">
                  {recentDates
                    .filter((d) => d !== selectedDate)
                    .map((d) => (
                      <button
                        key={d}
                        onClick={() => setSelectedDate(d)}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-zinc-500 bg-white border border-zinc-200 hover:border-emerald-300 hover:text-emerald-600 transition-all"
                      >
                        看{formatDateLabel(d)}
                      </button>
                    ))}
                  <Link
                    href="/library/feed"
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-zinc-500 bg-white border border-zinc-200 hover:border-emerald-300 hover:text-emerald-600 transition-all"
                  >
                    查看全部
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {feedChannels
                  .filter((ch) => ch.picks.length > 0)
                  .map((channelData) => (
                    <ChannelFoldGroup
                      key={channelData.channel.id}
                      channelData={channelData}
                      onDeepAnalyze={(pick) => deepAnalyzeMut.mutateAsync(pick)}
                    />
                  ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* 删除确认弹窗 —— 视频/播客卡片共用 */}
      <Dialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingDeleteIsPodcast ? "删除播客" : "删除视频"}</DialogTitle>
            <DialogDescription>
              确定要删除这条{pendingDeleteIsPodcast ? "播客" : "视频"}品读吗？删除后数据不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setPendingDeleteId(null)}
              disabled={deleteMut.isPending}
              className="px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={() => {
                if (pendingDeleteId) {
                  deleteMut.mutate(pendingDeleteId, {
                    onSettled: () => setPendingDeleteId(null),
                  });
                }
              }}
              disabled={deleteMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {deleteMut.isPending ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Trash size={14} weight="bold" />
              )}
              确认删除
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArticleCard({ article }: { article: ArticleAnalysisResponse }) {
  const isDone = article.status?.state === "done";
  const isProcessing = article.status?.state === "processing";
  const previewText = extractReadableText(article.content).replace(/\s+/g, " ").trim();

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
            {previewText && (
              <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1">{previewText.slice(0, 100)}</p>
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
            <Image
              src={thumbSrc}
              alt={video.title || ""}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="260px"
              unoptimized
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
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
