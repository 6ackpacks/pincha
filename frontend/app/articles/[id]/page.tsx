"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  FileText,
  ShareNetwork,
  CircleNotch,
  Trash,
  CheckCircle,
  XCircle,
  ArrowSquareOut,
  UserCircle,
  Globe,
  ArrowsClockwise,
  TextAlignLeft,
  ListBullets,
  TreeStructure,
} from "@phosphor-icons/react";
import {
  getArticleAnalysis,
  getArticleProgress,
  deleteArticleAnalysis,
  reprocessArticle,
  getArticleAnalysisSummary,
  regenerateArticleSummary,
  triggerFullArticleSummary,
  getArticleAnalysisMindmap,
  regenerateArticleMindmap,
  type ArticleStatus,
  type SummaryLevel,
} from "@/lib/api/articles";
import { Sidebar } from "@/components/layout/sidebar";
import { cn, stripMarkdown } from "@/lib/utils";
import { STATE_LABELS, SUMMARY_LEVELS } from "@/lib/constants";

const TABS = [
  { key: "content", label: "原文", icon: TextAlignLeft },
  { key: "summary", label: "摘记", icon: ListBullets },
  { key: "mindmap", label: "脉络图", icon: TreeStructure },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ArticleAnalysisPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const articleId = params.id;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [activeLevel, setActiveLevel] = useState<SummaryLevel>("express");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullGenerating, setFullGenerating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const articleQuery = useQuery({
    queryKey: ["article", articleId],
    queryFn: () => getArticleAnalysis(articleId),
    enabled: !!articleId,
    staleTime: 30 * 60 * 1000,
  });

  const progressQuery = useQuery({
    queryKey: ["articleProgress", articleId],
    queryFn: () => getArticleProgress(articleId),
    enabled: !!articleId,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "done" || state === "failed") return false;
      return 2500;
    },
  });

  // When progress reaches done/failed, refetch article data so UI updates immediately
  useEffect(() => {
    if (progressQuery.data?.state === "done" || progressQuery.data?.state === "failed") {
      queryClient.invalidateQueries({ queryKey: ["article", articleId] });
    }
  }, [progressQuery.data?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const article = articleQuery.data;
  const progress = progressQuery.data;
  const currentState = progress?.state ?? article?.status.state ?? "pending";
  const currentProgress = progress?.progress ?? article?.status.progress ?? 0;
  const isDone = currentState === "done";
  const isFailed = currentState === "failed";
  const isProcessing = !isDone && !isFailed;

  const summaryQuery = useQuery({
    queryKey: ["articleSummary", articleId, activeLevel],
    queryFn: () => getArticleAnalysisSummary(articleId, activeLevel),
    enabled: !!articleId && isDone && activeTab === "summary",
    staleTime: Infinity,
    retry: 1,
  });

  const mindmapQuery = useQuery({
    queryKey: ["articleMindmap", articleId],
    queryFn: () => getArticleAnalysisMindmap(articleId),
    enabled: !!articleId && isDone && activeTab === "mindmap",
    staleTime: Infinity,
  });

  const regenerateSummaryMut = useMutation({
    mutationFn: () => regenerateArticleSummary(articleId, activeLevel),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["articleSummary", articleId, activeLevel] }),
  });

  const regenerateMindmapMut = useMutation({
    mutationFn: () => regenerateArticleMindmap(articleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["articleMindmap", articleId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteArticleAnalysis(articleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
      router.push("/videos");
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: () => reprocessArticle(articleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["article", articleId] });
      queryClient.invalidateQueries({ queryKey: ["articleProgress", articleId] });
    },
  });

  const handleTriggerFull = async () => {
    setFullGenerating(true);
    try {
      await triggerFullArticleSummary(articleId);
      // Clear any previous poll/timeout before starting new ones
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);

      pollRef.current = setInterval(async () => {
        try {
          const s = await getArticleAnalysisSummary(articleId, "full");
          if (s) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
            pollRef.current = null;
            pollTimeoutRef.current = null;
            setFullGenerating(false);
            setActiveLevel("full");
            queryClient.invalidateQueries({ queryKey: ["articleSummary", articleId, "full"] });
          }
        } catch {}
      }, 5000);
      pollTimeoutRef.current = setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        pollTimeoutRef.current = null;
        setFullGenerating(false);
      }, 5 * 60 * 1000);
    } catch { setFullGenerating(false); }
  };

  // Cleanup poll/timeout on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-white">
        {/* Header */}
        <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-zinc-100">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
            <button onClick={() => router.back()} className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all">
              <ArrowLeft size={16} weight="bold" className="transition-transform group-hover:-translate-x-0.5" />
              返回
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleShare} className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-500 transition-colors" title="复制链接">
                {copied ? <CheckCircle size={16} weight="bold" className="text-emerald-500" /> : <ShareNetwork size={16} weight="bold" />}
              </button>
              {isFailed && (
                <button onClick={() => reprocessMutation.mutate()} disabled={reprocessMutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors">
                  <ArrowsClockwise size={12} weight="bold" className={reprocessMutation.isPending ? "animate-spin" : ""} />
                  重新整理
                </button>
              )}
              <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors" title="删除">
                <Trash size={16} weight="bold" />
              </button>
            </div>
          </div>
        </div>

        {/* Delete confirmation */}
        <AnimatePresence>
          {confirmDelete && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="sticky top-[52px] z-30 bg-red-50 border-b border-red-200 px-6 py-3 flex items-center justify-between max-w-5xl mx-auto">
              <span className="text-sm text-red-600">确定要删除这篇文章吗？</span>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-600 hover:bg-zinc-50">取消</button>
                <button onClick={() => deleteMutation.mutate()} className="px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600">确认删除</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-5xl mx-auto px-6 py-6">
          {/* Article meta */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full font-medium",
                isDone ? "bg-emerald-50 text-emerald-600" : isFailed ? "bg-red-50 text-red-500" : "bg-amber-50 text-amber-600"
              )}>
                {isDone ? <CheckCircle size={12} weight="bold" className="inline mr-1" /> : isFailed ? <XCircle size={12} weight="bold" className="inline mr-1" /> : <CircleNotch size={12} weight="bold" className="inline mr-1 animate-spin" />}
                {STATE_LABELS[currentState] || currentState}
              </span>
              {article?.word_count && (
                <span className="text-xs text-zinc-400">{article.word_count.toLocaleString()} 字</span>
              )}
              {article?.language && (
                <span className="text-xs text-zinc-400 flex items-center gap-0.5"><Globe size={10} weight="bold" />{article.language}</span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 leading-snug">{stripMarkdown(article?.title) || "文章整理中..."}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500">
              {article?.author && (
                <span className="flex items-center gap-1"><UserCircle size={13} weight="bold" />{article.author}</span>
              )}
              {article?.source_url && (
                <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-emerald-500 transition-colors">
                  <ArrowSquareOut size={13} weight="bold" />原文链接
                </a>
              )}
            </div>
          </div>

          {/* Processing progress */}
          {isProcessing && (
            <div className="mb-6 p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 mb-2">
                <CircleNotch size={14} weight="bold" className="animate-spin" />
                {progress?.message || STATE_LABELS[currentState] || "整理中..."}
              </div>
              <div className="w-full bg-emerald-100 rounded-full h-1.5">
                <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${currentProgress}%` }} />
              </div>
            </div>
          )}

          {/* Failed state */}
          {isFailed && (
            <div className="mb-6 p-4 bg-red-50 rounded-xl border border-red-200">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-600 mb-1">
                <XCircle size={16} weight="bold" />
                整理失败
              </div>
              <p className="text-sm text-red-500 ml-6">
                {progress?.message || article?.status.message || "整理过程中发生未知错误，请稍后重试。"}
              </p>
            </div>
          )}

          {/* Tabs */}
          {isDone && (
            <>
              <div className="flex items-center gap-1 mb-4 border-b border-zinc-100 pb-0.5">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors relative",
                      activeTab === tab.key
                        ? "text-emerald-600 bg-emerald-50/50"
                        : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
                    )}
                  >
                    <tab.icon size={14} weight="bold" />
                    {tab.label}
                    {activeTab === tab.key && (
                      <motion.div layoutId="article-tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              {/* Content Tab */}
              {activeTab === "content" && (
                <div className="prose prose-zinc max-w-none">
                  <ReactMarkdown>{article?.content ?? ""}</ReactMarkdown>
                </div>
              )}

              {/* Summary Tab */}
              {activeTab === "summary" && (
                <div>
                  {/* Level selector */}
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {SUMMARY_LEVELS.map((level) => (
                      <button
                        key={level.key}
                        onClick={() => {
                          if (level.key === "full" && !summaryQuery.data) {
                            handleTriggerFull();
                            return;
                          }
                          setActiveLevel(level.key);
                        }}
                        className={cn(
                          "px-3 py-2 rounded-lg text-sm transition-all border",
                          activeLevel === level.key
                            ? "bg-emerald-50 text-emerald-600 border-emerald-200 font-semibold"
                            : "bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-zinc-300"
                        )}
                      >
                        <span className="font-medium">{level.label}</span>
                        <span className="text-[10px] ml-1 opacity-60">{level.pct}</span>
                      </button>
                    ))}
                  </div>

                  {/* Summary content */}
                  {summaryQuery.isLoading || (activeLevel === "full" && fullGenerating) ? (
                    <div className="flex items-center gap-2 justify-center py-12 text-zinc-400 text-sm">
                      <CircleNotch size={16} weight="bold" className="animate-spin" />
                      正在生成{activeLevel === "full" ? "完整文稿" : "摘记"}...
                    </div>
                  ) : summaryQuery.isError ? (
                    <div className="text-center py-12 text-zinc-400 text-sm">
                      {activeLevel === "full" ? (
                        <button onClick={handleTriggerFull} className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm">
                          生成完整文稿
                        </button>
                      ) : "加载失败"}
                    </div>
                  ) : summaryQuery.data ? (
                    <div>
                      <div className="flex justify-end mb-2">
                        <button
                          onClick={() => regenerateSummaryMut.mutate()}
                          disabled={regenerateSummaryMut.isPending}
                          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-emerald-500 transition-colors"
                        >
                          <ArrowsClockwise size={12} weight="bold" className={regenerateSummaryMut.isPending ? "animate-spin" : ""} />
                          重新生成
                        </button>
                      </div>
                      <div className="prose prose-zinc max-w-none prose-headings:text-emerald-700">
                        <ReactMarkdown>{summaryQuery.data.content}</ReactMarkdown>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Mindmap Tab */}
              {activeTab === "mindmap" && (
                <div>
                  {mindmapQuery.isLoading ? (
                    <div className="flex items-center gap-2 justify-center py-12 text-zinc-400 text-sm">
                      <CircleNotch size={16} weight="bold" className="animate-spin" />
                      加载脉络图...
                    </div>
                  ) : mindmapQuery.data ? (
                    <div>
                      <div className="flex justify-end mb-2">
                        <button
                          onClick={() => regenerateMindmapMut.mutate()}
                          disabled={regenerateMindmapMut.isPending}
                          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-emerald-500 transition-colors"
                        >
                          <ArrowsClockwise size={12} weight="bold" className={regenerateMindmapMut.isPending ? "animate-spin" : ""} />
                          重新生成
                        </button>
                      </div>
                      <ArticleMindmapView markdown={mindmapQuery.data.markdown} />
                    </div>
                  ) : (
                    <div className="text-center py-12 text-zinc-400 text-sm">暂无脉络图</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ArticleMindmapView({ markdown }: { markdown: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Transformer } = await import("markmap-lib");
      const { Markmap } = await import("markmap-view");
      if (cancelled || !svgRef.current) return;

      const transformer = new Transformer();
      // 禁用 HTML 解析，防止 LLM 生成的内容注入脚本（存储型 XSS）
      const md = transformer.md as { set?: (opts: { html: boolean }) => void };
      md?.set?.({ html: false });
      const { root } = transformer.transform(markdown);

      if (mmRef.current) {
        mmRef.current.setData(root);
        mmRef.current.fit();
      } else {
        mmRef.current = Markmap.create(svgRef.current, { autoFit: true }, root);
      }
    })();
    return () => { cancelled = true; };
  }, [markdown]);

  return (
    <div className="w-full h-[500px] border border-zinc-200 rounded-xl overflow-hidden bg-white">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
