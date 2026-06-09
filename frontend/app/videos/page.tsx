"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useSetAtom } from "jotai";
import { Sidebar } from "@/components/layout/sidebar";
import { getVideos, deleteVideo, reprocessVideo, type VideoResponse } from "@/lib/api/videos";
import { getArticlesList, deleteArticleAnalysis, type ArticleAnalysisResponse } from "@/lib/api/articles";
import { proxyThumbnail } from "@/lib/api/client";
import { removeFromQueueAtom } from "@/atoms/queue";
import { cn, stripMarkdown } from "@/lib/utils";
import { STATE_LABELS } from "@/lib/constants";
import {
  Play,
  Plus,
  MagnifyingGlass,
  Clock,
  CheckCircle,
  CircleNotch,
  XCircle,
  Warning,
  VideoCamera,
  Trash,
  FilmStrip,
  ArrowLeft,
  FileText,
  Microphone,
} from "@phosphor-icons/react";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "processing", label: "整理中" },
  { key: "failed", label: "整理失败" },
];

const TYPE_TABS = [
  { key: "all", label: "全部" },
  { key: "video", label: "视频" },
  { key: "podcast", label: "播客" },
  { key: "article", label: "文章" },
];

function StatusBadge({ state }: { state: string }) {
  const isDone = state === "done";
  const isFailed = state === "failed";
  const isProcessing = !isDone && !isFailed;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full",
        isDone && "bg-emerald-50 text-emerald-600 border border-emerald-100",
        isFailed && "bg-red-50 text-red-600 border border-red-100",
        isProcessing && "bg-amber-50 text-amber-600 border border-amber-100"
      )}
    >
      {isDone && <CheckCircle size={12} weight="bold" />}
      {isFailed && <XCircle size={12} weight="bold" />}
      {isProcessing && <CircleNotch size={12} weight="bold" className="animate-spin" />}
      {STATE_LABELS[state] ?? state}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-white border border-zinc-100 shadow-sm animate-pulse">
      <div className="h-44 bg-zinc-100" />
      <div className="p-5 space-y-4">
        <div className="h-5 bg-zinc-100 rounded-xl w-3/4" />
        <div className="h-4 bg-zinc-100 rounded-lg w-1/2" />
        <div className="pt-2 flex justify-between">
          <div className="h-6 w-16 bg-zinc-100 rounded-full" />
          <div className="h-6 w-20 bg-zinc-100 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// Inline confirm overlay
function DeleteConfirm({
  onConfirm,
  onCancel,
  isPending,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-xl bg-zinc-900/90 backdrop-blur-md"
      onClick={(e) => e.preventDefault()}
    >
      <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mb-1">
         <Warning size={24} weight="bold" />
      </div>
      <p className="text-white text-base font-bold text-center px-4">
        要永久删除此视频吗？
      </p>
      <div className="flex gap-3">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white/80 bg-white/10 hover:bg-white/20 hover:text-white transition-all"
        >
          取消
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onConfirm(); }}
          disabled={isPending}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-all flex items-center gap-2"
        >
          {isPending ? <CircleNotch size={16} weight="bold" className="animate-spin" /> : <Trash size={16} weight="bold" />}
          {isPending ? "正在删除..." : "确认删除"}
        </button>
      </div>
    </motion.div>
  );
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 20 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } },
};

interface VideoCardItemProps {
  v: VideoResponse;
  index: number;
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  deleteMutation: UseMutationResult<void, Error, string, { previous: VideoResponse[] | undefined }>;
  reprocessMutation: UseMutationResult<VideoResponse, Error, string>;
  thumbFallback: Map<string, "direct" | "failed">;
  setThumbFallback: React.Dispatch<React.SetStateAction<Map<string, "direct" | "failed">>>;
  router: ReturnType<typeof useRouter>;
}

interface ArticleCardItemProps {
  article: ArticleAnalysisResponse;
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  deleteArticleMutation: UseMutationResult<void, Error, string, { previous: ArticleAnalysisResponse[] | undefined }>;
  router: ReturnType<typeof useRouter>;
}

function VideoCardItem({ v, index, confirmingId, setConfirmingId, deleteMutation, reprocessMutation, thumbFallback, setThumbFallback, router }: VideoCardItemProps) {
  const isDone = v.status.state === "done";
  const isFailed = v.status.state === "failed";
  const isProcessing = !isDone && !isFailed;
  const isConfirming = confirmingId === v.id;
  const isDeleting = deleteMutation.isPending && deleteMutation.variables === v.id;

  return (
    <motion.div key={v.id} variants={cardVariants} initial="hidden" animate="show" exit="exit" layout className="relative group h-full">
      <AnimatePresence>{isConfirming && <DeleteConfirm onConfirm={() => deleteMutation.mutate(v.id)} onCancel={() => setConfirmingId(null)} isPending={isDeleting} />}</AnimatePresence>
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmingId(isConfirming ? null : v.id); }} className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-zinc-900/60 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all duration-200" title="删除"><Trash size={16} weight="bold" /></button>
      <div className="rounded-xl overflow-hidden bg-white border border-zinc-200 cursor-pointer h-full flex flex-col spring-hover hover:border-emerald-300 hover:shadow-[0_4px_24px_-4px_rgba(52,211,153,0.12)] hover:-translate-y-1" onClick={() => { if (!isConfirming) router.push(`/videos/${v.id}`); }}>
        <div className="h-44 flex items-center justify-center relative bg-zinc-100 overflow-hidden shrink-0">
          {v.thumbnail_url && thumbFallback.get(v.id) !== "failed" ? (
            <>
              <img src={thumbFallback.get(v.id) === "direct" ? v.thumbnail_url : (proxyThumbnail(v.thumbnail_url) ?? v.thumbnail_url)} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading={index === 0 ? "eager" : "lazy"} onError={() => { setThumbFallback((prev) => { const next = new Map(prev); next.set(v.id, prev.get(v.id) === "direct" ? "failed" : "direct"); return next; }); }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center"><Play size={24} weight="bold" className="text-emerald-500 ml-1" /></div>
          )}
          {v.duration && <span className="absolute bottom-3 right-3 text-[11px] font-mono font-bold px-2 py-1 rounded-md bg-zinc-900/80 text-white backdrop-blur flex items-center gap-1.5"><Clock size={12} weight="bold" />{v.duration}</span>}
          {isProcessing && (
            <div className="absolute inset-0 bg-zinc-900/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
              <CircleNotch size={28} weight="bold" className="text-emerald-400 animate-spin" />
              <span className="text-sm font-bold text-white">{v.status.message || "整理中"}</span>
              {v.status.progress > 0 && <div className="w-32 h-2 rounded-full bg-white/20 overflow-hidden"><motion.div className="h-full bg-emerald-500 rounded-full" animate={{ width: `${v.status.progress}%` }} transition={{ duration: 0.5 }} /></div>}
            </div>
          )}
          {isFailed && (
            <div className="absolute inset-0 bg-red-900/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
              <Warning size={28} weight="bold" className="text-red-400" /><span className="text-sm font-bold text-white">整理失败</span>
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); reprocessMutation.mutate(v.id); }} className="mt-2 px-4 py-2 rounded-lg text-xs font-bold text-white bg-white/20 hover:bg-white/30 transition-colors">重新整理</button>
            </div>
          )}
        </div>
        <div className="p-5 flex-1 flex flex-col justify-between">
          <div className="text-[15px] font-bold text-zinc-900 leading-snug mb-4 line-clamp-2 group-hover:text-emerald-600 transition-colors">{stripMarkdown(v.title) || "无标题视频"}</div>
          <div className="flex items-center justify-between mt-auto">
            <div className="flex items-center gap-2">
              <span className={cn("w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white", v.platform === "youtube" ? "bg-red-500" : "bg-purple-500")}>{v.platform === "youtube" ? "Y" : "P"}</span>
              <span className="text-xs font-semibold text-zinc-500">{v.platform === "youtube" ? "YouTube" : "播客"}</span>
            </div>
            <StatusBadge state={v.status.state} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ArticleCardItem({ article, confirmingId, setConfirmingId, deleteArticleMutation, router }: ArticleCardItemProps) {
  const isDone = article.status?.state === "done";
  const isFailed = article.status?.state === "failed";
  const isProcessing = !isDone && !isFailed;
  const isConfirming = confirmingId === `article-${article.id}`;
  const isDeleting = deleteArticleMutation.isPending && deleteArticleMutation.variables === article.id;

  return (
    <motion.div key={article.id} variants={cardVariants} initial="hidden" animate="show" exit="exit" layout className="relative group">
      <AnimatePresence>{isConfirming && <DeleteConfirm onConfirm={() => deleteArticleMutation.mutate(article.id)} onCancel={() => setConfirmingId(null)} isPending={isDeleting} />}</AnimatePresence>
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmingId(isConfirming ? null : `article-${article.id}`); }} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-zinc-900/60 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all duration-200" title="删除文章"><Trash size={14} weight="bold" /></button>
      <div className="rounded-xl overflow-hidden bg-white border border-zinc-200 cursor-pointer h-full flex flex-col spring-hover hover:border-emerald-300 hover:shadow-[0_4px_24px_-4px_rgba(52,211,153,0.12)] hover:-translate-y-1" onClick={() => { if (!isConfirming) router.push(`/articles/${article.id}`); }}>
        <div className="h-28 flex items-center justify-center relative bg-gradient-to-br from-zinc-50 to-zinc-100 overflow-hidden shrink-0">
          {isProcessing && <div className="absolute inset-0 bg-zinc-900/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2"><CircleNotch size={24} weight="bold" className="text-emerald-400 animate-spin" /><span className="text-xs font-bold text-white">{article.status?.message || "整理中"}</span></div>}
          {isFailed && <div className="absolute inset-0 bg-red-900/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2"><Warning size={24} weight="bold" className="text-red-400" /><span className="text-xs font-bold text-white">整理失败</span></div>}
          {!isProcessing && !isFailed && <FileText size={32} weight="light" className="text-zinc-300" />}
        </div>
        <div className="p-4 flex-1 flex flex-col justify-between">
          <div className="text-sm font-bold text-zinc-900 leading-snug mb-3 line-clamp-2 group-hover:text-emerald-600 transition-colors">{stripMarkdown(article.title) || "无标题文章"}</div>
          {article.content && isDone && <p className="text-[11px] text-zinc-400 line-clamp-2 mb-3">{article.content.slice(0, 80)}</p>}
          <div className="flex items-center justify-between mt-auto">
            <span className="text-[10px] text-zinc-400">{new Date(article.created_at).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</span>
            <StatusBadge state={article.status?.state ?? "unknown"} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function VideosPage() {
  const [filter, setFilter] = useState("all");
  const [typeTab, setTypeTab] = useState("all");
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [thumbFallback, setThumbFallback] = useState<Map<string, "direct" | "failed">>(() => new Map());

  // Debounce search input by 400ms to avoid hammering the backend
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const router = useRouter();
  const queryClient = useQueryClient();
  const removeFromQueue = useSetAtom(removeFromQueueAtom);

  const { data, isLoading } = useQuery({
    queryKey: ["videos", debouncedSearch],
    queryFn: () => getVideos(debouncedSearch || undefined),
    refetchInterval: (query) => {
      const videos = query.state.data ?? [];
      const hasProcessing = videos.some(
        (v: VideoResponse) => v.status.state !== "done" && v.status.state !== "failed"
      );
      return hasProcessing ? 6000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const { data: articlesData, isLoading: loadingArticles } = useQuery({
    queryKey: ["articles-list"],
    queryFn: () => getArticlesList(),
    refetchInterval: (query) => {
      const articles = query.state.data ?? [];
      const hasProcessing = articles.some(
        (a: ArticleAnalysisResponse) => a.status.state !== "done" && a.status.state !== "failed"
      );
      return hasProcessing ? 6000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteVideo(id),
    onMutate: async (id: string) => {
      setConfirmingId(null);
      removeFromQueue(id, "video");
      await queryClient.cancelQueries({ queryKey: ["videos", debouncedSearch] });
      const previous = queryClient.getQueryData<VideoResponse[]>(["videos", debouncedSearch]);
      queryClient.setQueryData<VideoResponse[]>(["videos", debouncedSearch], (old) =>
        (old ?? []).filter((v) => v.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["videos", debouncedSearch], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: string) => reprocessVideo(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });

  const deleteArticleMutation = useMutation({
    mutationFn: (id: string) => deleteArticleAnalysis(id),
    onMutate: async (id: string) => {
      setConfirmingId(null);
      removeFromQueue(id, "article");
      await queryClient.cancelQueries({ queryKey: ["articles-list"] });
      const previous = queryClient.getQueryData<ArticleAnalysisResponse[]>(["articles-list"]);
      queryClient.setQueryData<ArticleAnalysisResponse[]>(["articles-list"], (old) =>
        (old ?? []).filter((a) => a.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["articles-list"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
    },
  });

  const videos: VideoResponse[] = data ?? [];
  const articles: ArticleAnalysisResponse[] = articlesData ?? [];

  const filtered = videos.filter((v) => {
    const statusMatch = filter === "all" ||
      (filter === "failed" && v.status.state === "failed") ||
      (filter === "processing" && v.status.state !== "done" && v.status.state !== "failed");
    const typeMatch = typeTab === "all" ||
      (typeTab === "video" && v.platform !== "podcast") ||
      (typeTab === "podcast" && v.platform === "podcast");
    return statusMatch && typeMatch;
  });

  const filteredArticles = (typeTab === "all" || typeTab === "article") ? articles.filter((a) => {
    return filter === "all" ||
      (filter === "failed" && a.status?.state === "failed") ||
      (filter === "processing" && a.status?.state !== "done" && a.status?.state !== "failed");
  }) : [];

  const videoItems = filtered.filter((v) => v.platform !== "podcast");
  const podcastItems = filtered.filter((v) => v.platform === "podcast");

  const doneCount = videos.filter((v) => v.status.state === "done").length + articles.filter((a) => a.status?.state === "done").length;
  const processingCount = videos.filter((v) => v.status.state !== "done" && v.status.state !== "failed").length + articles.filter((a) => a.status?.state !== "done" && a.status?.state !== "failed").length;
  const totalCount = videos.length + articles.length;

  return (
    <div className="flex h-screen bg-[#FAFAFA]">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8 lg:p-12">
        
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="flex items-end justify-between flex-wrap gap-6 mb-10"
        >
          <div>
            <Link
              href="/library"
              className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-600 transition-colors mb-4"
            >
              <ArrowLeft size={14} weight="bold" /> 返回
            </Link>
            <div className="flex items-center gap-4 mb-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-600 shadow-sm border border-emerald-50">
                <FilmStrip size={24} weight="bold" />
              </div>
              <h1 className="text-3xl font-extrabold text-zinc-950 tracking-tighter">
                我的品读
              </h1>
            </div>
            <p className="text-zinc-500 pl-[4.5rem] flex items-center gap-4 font-medium text-sm">
              {isLoading ? (
                <>
                  <span className="h-4 w-12 bg-zinc-200 rounded animate-pulse inline-block" />
                  <span className="h-4 w-14 bg-zinc-200 rounded animate-pulse inline-block" />
                  <span className="h-4 w-14 bg-zinc-200 rounded animate-pulse inline-block" />
                </>
              ) : (
                <>
                  <span>全部 <span className="text-zinc-900 font-bold">{totalCount}</span></span>
                  <span>已完成 <span className="text-emerald-600 font-bold">{doneCount}</span></span>
                  <span>整理中 <span className="text-amber-500 font-bold">{processingCount}</span></span>
                </>
              )}
            </p>
          </div>

          <Link
            href="/"
            className="flex items-center gap-2 px-6 py-3.5 text-sm font-bold text-white bg-zinc-950 rounded-xl spring-hover hover:bg-emerald-500 hover:text-zinc-950 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-95"
          >
            <Plus size={18} weight="bold" />
            放入新内容
          </Link>
        </motion.div>

        {/* ── Filters + Search ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.1 }}
          className="flex items-center justify-between mb-8 flex-wrap gap-4"
        >
          <div className="flex items-center p-1.5 rounded-2xl bg-zinc-100/80 backdrop-blur-sm border border-zinc-200/50">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => startTransition(() => setFilter(f.key))}
                className={cn(
                  "px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300",
                  filter === f.key
                    ? "bg-white text-emerald-600 shadow-sm border border-zinc-200/50"
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50",
                  isPending && "opacity-70"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Type tabs */}
          <div className="flex gap-1 bg-zinc-100 rounded-xl p-1">
            {TYPE_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTypeTab(t.key)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                  typeTab === t.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            className={cn(
              "flex items-center gap-3 px-5 py-2.5 rounded-2xl min-w-[280px] transition-all duration-300 bg-white border",
              searchFocused ? "border-emerald-500 ring-4 ring-emerald-500/10" : "border-zinc-200 shadow-sm hover:border-zinc-300"
            )}
          >
            <MagnifyingGlass size={18} weight="bold" className={cn("shrink-0 transition-colors", searchFocused ? "text-emerald-500" : "text-zinc-400")} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="搜索线索..."
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none placeholder:text-zinc-400 text-zinc-900"
            />
          </div>
        </motion.div>

        {/* ── Loading Skeletons ── */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* ── Content ── */}
        {!isLoading && (
          <>
            {/* Videos + Podcasts */}
            {(typeTab === "all" || typeTab === "video" || typeTab === "podcast") && filtered.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 mb-8">
                <AnimatePresence mode="popLayout">
                  {filtered.map((v, i) => (
                    <VideoCardItem key={v.id} v={v} index={i} confirmingId={confirmingId} setConfirmingId={setConfirmingId} deleteMutation={deleteMutation} reprocessMutation={reprocessMutation} thumbFallback={thumbFallback} setThumbFallback={setThumbFallback} router={router} />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Articles */}
            {filteredArticles.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 mb-8">
                <AnimatePresence mode="popLayout">
                  {filteredArticles.map((article) => (
                    <ArticleCardItem key={article.id} article={article} confirmingId={confirmingId} setConfirmingId={setConfirmingId} deleteArticleMutation={deleteArticleMutation} router={router} />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Empty */}
            {filtered.length === 0 && filteredArticles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
                <VideoCamera size={32} weight="light" className="text-zinc-300 mb-3" />
                <p className="text-sm text-zinc-500">{filter === "all" && typeTab === "all" ? "还没有品读记录" : "没有匹配的记录"}</p>
              </div>
            )}
          </>
        )}
        </div>
      </main>
    </div>
  );
}
