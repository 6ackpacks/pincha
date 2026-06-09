"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Warning,
  ArrowLeft,
  PencilSimple, Trash, FloppyDisk, X,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import { getWikiPage, updateWikiPage, deleteWikiPage } from "@/lib/api/wiki";
import { cn } from "@/lib/utils";
import { WikiLinkPreview } from "./wiki-link-preview";
import { WikiCardExport } from "./wiki-card-export";
import { WikiEntrySidebar } from "./wiki-entry-sidebar";
import {
  titleToSlug,
  headingToAnchor,
  extractTextFromChildren,
  SkeletonLoader,
  GraphOverview,
} from "./wiki-entry-helpers";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WikiEntryPanelProps {
  slug: string | null;
  onSelectSlug: (slug: string) => void;
  onClose?: () => void;
  onDeleted?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WikiEntryPanel({ slug, onSelectSlug, onClose, onDeleted }: WikiEntryPanelProps) {
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editTags, setEditTags] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const pageQuery = useQuery({
    queryKey: ["wiki-page", slug],
    queryFn: () => getWikiPage(slug!),
    enabled: !!slug,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateWikiPage>[1]) =>
      updateWikiPage(pageQuery.data!.id, data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["wiki-page"] });
      qc.invalidateQueries({ queryKey: ["wiki-pages"] });
      setEditing(false);
      // If slug changed, navigate to new slug
      if (updated.slug !== slug) {
        onSelectSlug(updated.slug);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteWikiPage(pageQuery.data!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-pages"] });
      qc.invalidateQueries({ queryKey: ["wiki-graph"] });
      setConfirmDelete(false);
      onDeleted?.();
      onClose?.();
    },
  });

  // Scroll to heading anchor after page content loads
  useEffect(() => {
    if (!pendingAnchor || !pageQuery.data || pageQuery.isLoading) return;
    // Allow a tick for DOM to render
    const timer = setTimeout(() => {
      const el = document.getElementById(pendingAnchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setPendingAnchor(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [pendingAnchor, pageQuery.data, pageQuery.isLoading]);

  function startEditing() {
    const page = pageQuery.data!;
    setEditTitle(page.title);
    setEditContent(page.content);
    setEditSummary(page.summary || "");
    setEditTags((page.tags || []).join(", "));
    setEditing(true);
  }

  function handleSave() {
    updateMutation.mutate({
      title: editTitle,
      content: editContent,
      summary: editSummary || undefined,
      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
    });
  }

  // Parse [[WikiLink]] syntax and wire clicks to onSelectSlug
  function parseWikiLinks(content: string): string {
    return content.replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_, target, heading, display) => {
      const wikiSlug = titleToSlug(target.trim());
      const anchor = heading ? headingToAnchor(heading.trim()) : "";
      const label = display ? display.trim() : heading ? `${target.trim()}#${heading.trim()}` : target.trim();
      const href = anchor ? `wiki:${wikiSlug}#${anchor}` : `wiki:${wikiSlug}`;
      return `[${label}](${href})`;
    });
  }

  if (!slug) {
    return <GraphOverview onSelectSlug={onSelectSlug} />;
  }

  if (pageQuery.isLoading) {
    return <SkeletonLoader />;
  }

  if (pageQuery.isError || !pageQuery.data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-white rounded-2xl border border-red-100 shadow-sm max-w-sm">
          <p className="text-red-500 font-bold mb-2">知识词条不存在</p>
          <p className="text-xs text-zinc-400 mt-1">该词条可能已被删除或链接有误</p>
        </div>
      </div>
    );
  }

  const page = pageQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div key={slug} className="flex h-full">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-8 min-w-0">
          <div className="max-w-3xl mx-auto">

            {/* Back button + action buttons */}
            <div className="flex items-center gap-2 mb-6">
              {onClose && (
                <button
                  onClick={onClose}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
                >
                  <ArrowLeft size={15} weight="bold" className="transition-transform group-hover:-translate-x-0.5" />
                  返回知识图谱
                </button>
              )}
              <div className="flex-1" />
              {!editing && (
                <>
                  <WikiCardExport
                    title={page.title}
                    type={page.type}
                    summary={page.summary}
                    tags={page.tags || []}
                    relationsCount={page.relations?.length || 0}
                    sourcesCount={page.sources?.length || 0}
                    updatedAt={page.updated_at}
                  />
                  <button
                    onClick={startEditing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 border border-zinc-200 transition-colors"
                  >
                    <PencilSimple size={12} weight="bold" />
                    编辑
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 hover:text-red-600 hover:bg-red-50 border border-zinc-200 transition-colors"
                  >
                    <Trash size={12} weight="bold" />
                    删除
                  </button>
                </>
              )}
              {editing && (
                <>
                  <button
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                  >
                    <FloppyDisk size={12} weight="bold" />
                    {updateMutation.isPending ? "保存中…" : "保存"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 hover:text-zinc-700 border border-zinc-200 transition-colors"
                  >
                    <X size={12} weight="bold" />
                    取消
                  </button>
                </>
              )}
            </div>

            {/* Delete confirmation */}
            {confirmDelete && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
                <Warning size={16} weight="bold" className="text-red-500 shrink-0" />
                <p className="text-sm text-red-700 flex-1">确定要删除「{page.title}」吗？此操作不可撤销。</p>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? "删除中…" : "确认删除"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 hover:text-zinc-700 border border-zinc-200"
                >
                  取消
                </button>
              </div>
            )}

            {updateMutation.isError && (
              <p className="mb-4 text-xs text-red-500">保存失败：{(updateMutation.error as Error).message}</p>
            )}

            {editing ? (
              /* ---- Edit mode ---- */
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-zinc-500 mb-1 block">标题</label>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-500 mb-1 block">摘要</label>
                  <input
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    placeholder="简短摘要（可选）"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-500 mb-1 block">标签（逗号分隔）</label>
                  <input
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="标签1, 标签2"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-500 mb-1 block">
                    内容（Markdown，支持 [[WikiLink]] 语法）
                  </label>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={20}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-y"
                  />
                </div>
              </div>
            ) : (
              /* ---- View mode ---- */
              <>
                {/* Tags */}
                {page.tags.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-6">
                    {page.tags.map((tag) => (
                      <span key={tag} className="text-xs px-2.5 py-1 bg-zinc-100 text-zinc-500 rounded-full font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

            {/* Contradiction details */}
            {(page.contradiction_details?.length > 0) ? (
              <div className="mb-6 space-y-3">
                <div className="flex items-center gap-2">
                  <Warning size={16} weight="bold" className="text-amber-500" />
                  <span className="text-sm font-bold text-amber-700">
                    存在 {page.contradiction_details.length} 处矛盾观点
                  </span>
                </div>
                {page.contradiction_details.map((c, i) => (
                  <div key={i} className="p-4 bg-amber-50/50 border border-amber-200 rounded-xl">
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-bold mb-2 inline-block",
                      c.severity === "major" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                    )}>
                      {c.severity === "major" ? "重大矛盾" : "轻微分歧"}
                    </span>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="p-3 bg-white rounded-lg border border-zinc-100">
                        <p className="text-xs text-zinc-400 mb-1">新来源说法</p>
                        <p className="text-sm text-zinc-700">{c.claim}</p>
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-zinc-100">
                        <p className="text-xs text-zinc-400 mb-1">现有知识库说法</p>
                        <p className="text-sm text-zinc-700">{c.existing_claim}</p>
                      </div>
                    </div>
                    {c.suggestion && (
                      <p className="text-xs text-zinc-500 italic mt-2">{c.suggestion}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : page.has_contradiction ? (
              <div className="flex items-start gap-3 p-4 mb-6 bg-amber-50 border border-amber-200 rounded-xl">
                <Warning size={16} weight="bold" className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-amber-700">不同来源存在矛盾观点</p>
                  <p className="text-xs text-amber-600 mt-0.5">请对比下方各来源内容，自行判断</p>
                </div>
              </div>
            ) : null}

            {/* Markdown content */}
            <div className="prose prose-zinc prose-sm max-w-none
              prose-headings:font-bold prose-headings:text-zinc-900
              prose-h2:text-lg prose-h2:border-b prose-h2:border-zinc-100 prose-h2:pb-2
              prose-p:text-zinc-700 prose-p:leading-relaxed
              prose-li:text-zinc-700
              prose-strong:text-zinc-900
              prose-blockquote:border-l-emerald-300 prose-blockquote:text-zinc-500
              prose-code:bg-zinc-100 prose-code:px-1 prose-code:rounded
            ">
              <ReactMarkdown
                components={{
                  a: ({ href, children }) => {
                    if (href?.startsWith("wiki:")) {
                      const wikiPart = href.slice(5);
                      const hashIdx = wikiPart.indexOf("#");
                      const targetSlug = hashIdx >= 0 ? wikiPart.slice(0, hashIdx) : wikiPart;
                      const anchor = hashIdx >= 0 ? wikiPart.slice(hashIdx + 1) : null;
                      const handleWikiClick = () => {
                        if (targetSlug === slug && anchor) {
                          // Same page: just scroll to anchor
                          const el = document.getElementById(anchor);
                          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                        } else {
                          // Different page: navigate and set pending anchor
                          if (anchor) setPendingAnchor(anchor);
                          onSelectSlug(targetSlug);
                        }
                      };
                      return (
                        <WikiLinkPreview slug={targetSlug} onClick={handleWikiClick}>
                          {children}
                        </WikiLinkPreview>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700">
                        {children}
                      </a>
                    );
                  },
                  h1: ({ children, ...props }) => {
                    const text = extractTextFromChildren(children);
                    const id = headingToAnchor(text);
                    return <h1 id={id} {...props}>{children}</h1>;
                  },
                  h2: ({ children, ...props }) => {
                    const text = extractTextFromChildren(children);
                    const id = headingToAnchor(text);
                    return <h2 id={id} {...props}>{children}</h2>;
                  },
                  h3: ({ children, ...props }) => {
                    const text = extractTextFromChildren(children);
                    const id = headingToAnchor(text);
                    return <h3 id={id} {...props}>{children}</h3>;
                  },
                  h4: ({ children, ...props }) => {
                    const text = extractTextFromChildren(children);
                    const id = headingToAnchor(text);
                    return <h4 id={id} {...props}>{children}</h4>;
                  },
                  h5: ({ children, ...props }) => {
                    const text = extractTextFromChildren(children);
                    const id = headingToAnchor(text);
                    return <h5 id={id} {...props}>{children}</h5>;
                  },
                  h6: ({ children, ...props }) => {
                    const text = extractTextFromChildren(children);
                    const id = headingToAnchor(text);
                    return <h6 id={id} {...props}>{children}</h6>;
                  },
                }}
              >
                {parseWikiLinks(page.content)}
              </ReactMarkdown>
            </div>
              </>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <WikiEntrySidebar page={page} slug={slug} onSelectSlug={onSelectSlug} />
      </div>
    </div>
  );
}
