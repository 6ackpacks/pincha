"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Database, MagnifyingGlass, Plus, LinkSimple, FileText, CircleNotch,
  Warning, Trash, X, BookOpen, FilePlus, DiceFive, CaretLeft, CaretRight,
} from "@phosphor-icons/react";
import { Sidebar } from "@/components/layout/sidebar";
import { WikiEntryPanel } from "@/components/knowledge/wiki-entry-panel";
import { KnowledgeTree } from "@/components/knowledge/knowledge-tree";
import {
  getWikiPages, getWikiTags, searchWiki, createWikiPage, getRandomWikiPage,
  type WikiPageSummary,
} from "@/lib/api/wiki";
import {
  getArticles, createArticle, deleteArticle,
  type ArticleSummary,
} from "@/lib/api/articles";
import { KnowledgeQAPanel } from "@/components/knowledge/qa-panel";
import { STATE_LABELS } from "@/lib/constants";
import { KBSwitcher } from "@/components/knowledge/kb-switcher";
import { activeKbIdAtom } from "@/atoms/kb";
import { useAtom } from "jotai";
import { cn, stripMarkdown } from "@/lib/utils";
import DOMPurify from "dompurify";

// ---------------------------------------------------------------------------
// Import Drawer
// ---------------------------------------------------------------------------

function ImportDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [activeKbId] = useAtom(activeKbIdAtom);
  const [tab, setTab] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const articlesQuery = useQuery({
    queryKey: ["wiki-articles", activeKbId],
    queryFn: getArticles,
    enabled: open,
    refetchInterval: (query) => {
      const articles = query.state.data;
      if (!articles) return false;
      const hasActive = articles.some((a) =>
        ["pending", "fetching", "compiling"].includes(a.status.state)
      );
      return hasActive ? 3000 : false;
    },
  });

  const deleteArticleMutation = useMutation({
    mutationFn: deleteArticle,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-articles"] });
      qc.invalidateQueries({ queryKey: ["wiki-quota"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: createArticle,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-articles"] });
      qc.invalidateQueries({ queryKey: ["wiki-quota"] });
      setUrl("");
      setTitle("");
      setText("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSubmit = () => {
    setError("");
    if (tab === "url") {
      if (!url.trim()) return setError("请输入 URL");
      createMutation.mutate({ source_type: "url", source_url: url.trim(), title: title.trim() || undefined });
    } else {
      if (!text.trim()) return setError("请输入想留下的文本");
      createMutation.mutate({ source_type: "text", title: title.trim() || undefined, content: text.trim() });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-xl",
            "flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-300"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
            <Dialog.Title className="text-sm font-bold text-zinc-900">添加线索</Dialog.Title>
            <Dialog.Close className="text-zinc-400 hover:text-zinc-600 transition-colors">
              <X size={16} weight="bold" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Import form */}
            <div className="p-6 border-b border-zinc-100">
              <div className="flex gap-1 mb-4 bg-zinc-100 rounded-xl p-1 w-fit">
                {(["url", "text"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                      tab === t ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    {t === "url" ? "网页链接" : "粘贴文本"}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="标题（可选）"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                />
                {tab === "url" ? (
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="粘贴网页链接（微信公众号、知乎、Medium…）"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                ) : (
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="粘贴值得留下的正文…"
                    rows={6}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
                  />
                )}
              </div>

              {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {createMutation.isPending && <CircleNotch size={13} weight="bold" className="animate-spin" />}
                  {createMutation.isPending ? "收录中…" : "收进知识库"}
                </button>
              </div>
            </div>

            {/* Articles list */}
            <div className="p-6">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-3">已收录线索</h3>
              {articlesQuery.isLoading ? (
                <div className="flex justify-center py-10">
                  <CircleNotch size={20} weight="bold" className="animate-spin text-zinc-500" />
                </div>
              ) : (articlesQuery.data ?? []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <LinkSimple size={32} weight="bold" className="text-zinc-200 mb-3" />
                  <p className="text-zinc-500 font-bold text-sm mb-1">还没有收录线索</p>
                  <p className="text-zinc-400 text-xs">粘贴链接或文本，给信息一个归处</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(articlesQuery.data ?? []).map((a) => (
                    <ArticleCard
                      key={a.id}
                      article={a}
                      onDelete={() => deleteArticleMutation.mutate(a.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Article card
// ---------------------------------------------------------------------------

const ARTICLE_STATE_LABELS: Record<string, string> = {
  ...STATE_LABELS,
  done: "已入库",
  failed: "失败",
};

function ArticleCard({ article, onDelete }: { article: ArticleSummary; onDelete: () => void }) {
  const state = article.status.state;
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-zinc-200 shadow-sm">
      <FileText size={15} weight="bold" className="text-zinc-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-zinc-800 truncate">{stripMarkdown(article.title) || article.source_url || "粘贴文本"}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{article.source_type === "url" ? "网页" : "文本"}</p>
      </div>
      <span className={cn(
        "text-xs font-bold px-2 py-0.5 rounded-full shrink-0",
        state === "done" && "bg-zinc-100 text-zinc-700",
        state === "failed" && "bg-red-50 text-red-500",
        ["pending", "fetching", "compiling"].includes(state) && "bg-amber-50 text-amber-600",
      )}>
        {["pending", "fetching", "compiling"].includes(state) ? (
          <span className="flex items-center gap-1">
            <CircleNotch size={10} weight="bold" className="animate-spin" />
            {ARTICLE_STATE_LABELS[state] || state}
          </span>
        ) : (ARTICLE_STATE_LABELS[state] || state)}
      </span>
      <button onClick={onDelete} className="text-zinc-300 hover:text-red-400 transition-colors ml-1">
        <Trash size={13} weight="bold" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Wiki Page Dialog
// ---------------------------------------------------------------------------

function CreatePageDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (slug: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: createWikiPage,
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: ["wiki-pages"] });
      qc.invalidateQueries({ queryKey: ["wiki-tags"] });
      setTitle("");
      setContent("");
      setSummary("");
      setTags("");
      setError("");
      onOpenChange(false);
      onCreated(page.slug);
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSubmit = () => {
    setError("");
    if (!title.trim()) return setError("标题不能为空");
    createMutation.mutate({
      title: title.trim(),
      content,
      summary: summary.trim() || undefined,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-white shadow-xl",
            "flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-300"
          )}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
            <Dialog.Title className="text-sm font-bold text-zinc-900">新建知识页</Dialog.Title>
            <Dialog.Close className="text-zinc-400 hover:text-zinc-600 transition-colors">
              <X size={16} weight="bold" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <label className="text-xs font-bold text-zinc-500 mb-1 block">标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="知识页标题"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-500 mb-1 block">摘要（可选）</label>
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="这条知识的简短说明"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-500 mb-1 block">标签（逗号分隔，可选）</label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="标签1, 标签2"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-500 mb-1 block">
                正文（Markdown，支持 [[WikiLink]] 语法）
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在这里整理你的理解…"
                rows={14}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-y"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <div className="px-6 py-4 border-t border-zinc-200 flex justify-end gap-2">
            <Dialog.Close className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:text-zinc-700 border border-zinc-200">
              取消
            </Dialog.Close>
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {createMutation.isPending && <CircleNotch size={13} weight="bold" className="animate-spin" />}
              {createMutation.isPending ? "创建中…" : "创建知识页"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Knowledge tree (left sidebar list)
// ---------------------------------------------------------------------------

function KnowledgeTreeList({
  pages,
  activeSlug,
  onSelect,
  loading,
  q,
  onQChange,
  isSearching,
}: {
  pages: WikiPageSummary[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  loading: boolean;
  q: string;
  onQChange: (val: string) => void;
  isSearching?: boolean;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-100">
        <div className="relative">
          <MagnifyingGlass size={13} weight="bold" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="搜索词条…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex justify-center py-8">
            <CircleNotch size={18} weight="bold" className="animate-spin text-zinc-500" />
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Database size={28} weight="bold" className="text-zinc-200 mb-2" />
            <p className="text-xs text-zinc-400">
              {q ? "未找到相关词条" : "这里还没有知识线索"}
            </p>
          </div>
        ) : (
          pages.map((page) => (
            <button
              key={page.id}
              onClick={() => onSelect(page.slug)}
              className={cn(
                "w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors group",
                activeSlug === page.slug
                  ? "bg-zinc-100 border-r-2 border-zinc-900"
                  : "hover:bg-zinc-50 border-r-2 border-transparent"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={cn(
                    "text-xs font-semibold truncate leading-tight",
                    activeSlug === page.slug ? "text-zinc-900" : "text-zinc-800 group-hover:text-zinc-900"
                  )}>
                    {page.title}
                  </p>
                  {page.has_contradiction && (
                    <Warning size={10} weight="bold" className="text-amber-500 shrink-0" />
                  )}
                </div>
                {isSearching && page.highlight ? (
                  <p
                    className="text-xs text-zinc-500 mt-0.5 line-clamp-2 leading-tight search-highlight"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.highlight, { ALLOWED_TAGS: ['mark'] }) }}
                  />
                ) : page.summary ? (
                  <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2 leading-tight">{page.summary}</p>
                ) : null}
                <p className="text-xs text-zinc-300 mt-1">{page.source_count} 个来源</p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function KnowledgePageInner() {
  const router = useRouter();
  const qc = useQueryClient();
  const [activeKbId] = useAtom(activeKbIdAtom);

  const [listCollapsed, setListCollapsed] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [mountTime] = useState(() => Date.now());
  const prevActiveCountRef = useRef<number>(0);

  // Read initial slug from URL on mount (client-side only, avoids useSearchParams/Suspense)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug");
    if (slug) setActiveSlug(slug);
  }, []);

  // Reset active slug when KB changes
  const prevKbRef = useRef(activeKbId);
  useEffect(() => {
    if (activeKbId !== prevKbRef.current) {
      prevKbRef.current = activeKbId;
      setActiveSlug(null);
      setActiveTag(null);
    }
  }, [activeKbId]);

  // Sync URL when activeSlug changes — use clean /knowledge/slug path for shareability
  useEffect(() => {
    const url = activeSlug ? `/knowledge/${encodeURIComponent(activeSlug)}` : "/knowledge";
    window.history.replaceState(null, "", url);
  }, [activeSlug]);

  const pagesQuery = useQuery({
    queryKey: ["wiki-pages", activeKbId, activeTag],
    queryFn: () => getWikiPages(0, 100, activeTag ?? undefined),
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const tagsQuery = useQuery({
    queryKey: ["wiki-tags", activeKbId],
    queryFn: getWikiTags,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const articlesForBadge = useQuery({
    queryKey: ["wiki-articles", activeKbId],
    queryFn: getArticles,
    refetchInterval: (query) => {
      const articles = query.state.data;
      if (!articles) return false;
      const hasActive = articles.some((a) =>
        ["pending", "fetching", "compiling"].includes(a.status.state)
      );
      return hasActive ? 3000 : false;
    },
  });

  const activeArticleCount = (articlesForBadge.data ?? []).filter((a) =>
    ["pending", "fetching", "compiling"].includes(a.status.state)
  ).length;

  // When active article count drops (articles finished compiling), refresh wiki data
  useEffect(() => {
    if (prevActiveCountRef.current > 0 && activeArticleCount < prevActiveCountRef.current) {
      qc.invalidateQueries({ queryKey: ["wiki-pages"] });
      qc.invalidateQueries({ queryKey: ["wiki-tags"] });
      qc.invalidateQueries({ queryKey: ["wiki-graph"] });
    }
    prevActiveCountRef.current = activeArticleCount;
  }, [activeArticleCount, qc]);

  const searchQuery = useQuery({
    queryKey: ["wiki-search", activeKbId, debouncedQ],
    queryFn: () => searchWiki(debouncedQ),
    enabled: debouncedQ.length > 0,
    staleTime: 30 * 1000,  // 30 s — search results can change quickly
  });

  const handleQChange = (val: string) => {
    setQ(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(val), 300);
  };

  const displayPages = debouncedQ ? (searchQuery.data ?? []) : (pagesQuery.data ?? []);

  const handleSelectSlug = (slug: string) => {
    setActiveSlug(slug);
  };

  const [randomLoading, setRandomLoading] = useState(false);
  const handleRandomPage = async () => {
    setRandomLoading(true);
    try {
      const page = await getRandomWikiPage();
      setActiveSlug(page.slug);
    } catch {
      // ignore — e.g. empty KB
    } finally {
      setRandomLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#FAFAFA] overflow-hidden">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">

        {/* Header */}
        <header className="sticky top-0 z-40 px-4 h-[60px] flex items-center gap-3 bg-white/80 backdrop-blur-md border-b border-zinc-200 shrink-0">
          <Database size={16} weight="bold" className="text-zinc-600 shrink-0" />
          <h1 className="text-sm font-bold text-zinc-900">知识库</h1>
          <div className="flex-1" />
          <span className="text-xs text-zinc-400 font-medium">
            {displayPages.length} 个知识词条
          </span>
          <button
            onClick={handleRandomPage}
            disabled={randomLoading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
            title="随机漫游"
          >
            {randomLoading ? <CircleNotch size={13} weight="bold" className="animate-spin" /> : <DiceFive size={13} weight="bold" />}
            随机漫游
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border border-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            <FilePlus size={13} weight="bold" />
            新建页面
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-700 transition-colors"
          >
            <Plus size={13} weight="bold" />
            添加线索
            {activeArticleCount > 0 && (
              <span className="flex items-center gap-1 ml-1 px-1.5 py-0.5 bg-white/20 rounded-full text-[10px]">
                <CircleNotch size={9} weight="bold" className="animate-spin" />
                {activeArticleCount}
              </span>
            )}
          </button>
        </header>

        {/* Main two-column body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left sidebar — KB switcher + knowledge tree */}
          <aside className={cn(
            "border-r border-zinc-200 shrink-0 flex flex-col overflow-hidden bg-white transition-all duration-200 relative",
            listCollapsed ? "w-0 min-w-0 border-r-0" : "w-72"
          )}>
            {/* KB Switcher */}
            <KBSwitcher />
            <div className="px-3 py-2.5 border-b border-zinc-100 shrink-0 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                知识词条{pagesQuery.data ? ` (${pagesQuery.data.length})` : ""}
              </h2>
              <button
                onClick={() => setListCollapsed(true)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                title="收起词条列表"
              >
                <CaretLeft size={14} weight="bold" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden overflow-y-auto">
              <KnowledgeTree
                pages={displayPages}
                activeSlug={activeSlug}
                onSelect={handleSelectSlug}
                loading={pagesQuery.isLoading && !pagesQuery.isError}
                tagTree={tagsQuery.data}
                tagsLoading={tagsQuery.isLoading}
                activeTag={activeTag}
                onTagSelect={(tag) => setActiveTag(tag)}
                onImport={() => setImportOpen(true)}
              />
            </div>
          </aside>

          {/* Expand button when list is collapsed */}
          {listCollapsed && (
            <div className="shrink-0 flex items-start pt-3 border-r border-zinc-200 bg-white">
              <button
                onClick={() => setListCollapsed(false)}
                className="p-2 mx-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                title="展开词条列表"
              >
                <CaretRight size={16} weight="bold" />
              </button>
            </div>
          )}

          {/* Right panel — entry detail */}
          <main className="flex-1 overflow-hidden bg-[#FAFAFA]">
            <WikiEntryPanel
              slug={activeSlug}
              onSelectSlug={handleSelectSlug}
              onClose={() => setActiveSlug(null)}
              onDeleted={() => setActiveSlug(null)}
            />
          </main>

          {/* QA panel */}
          <KnowledgeQAPanel defaultCollapsed={!!activeSlug} />

        </div>
      </div>

      {/* Import drawer */}
      <ImportDrawer open={importOpen} onOpenChange={setImportOpen} />

      {/* Create page dialog */}
      <CreatePageDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(slug) => setActiveSlug(slug)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export (Suspense boundary for useSearchParams)
// ---------------------------------------------------------------------------

export default function KnowledgePage() {
  return <KnowledgePageInner />;
}
