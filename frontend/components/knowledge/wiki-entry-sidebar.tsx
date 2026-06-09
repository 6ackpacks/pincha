"use client";

import React from "react";
import {
  Warning, VideoCamera, FileText,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { resolveReviewItem, getUnlinkedMentions, linkMention } from "@/lib/api";
import type { WikiPageDetail } from "@/lib/api/wiki";
import { RELATION_LABELS, RELATION_COLORS } from "./wiki-entry-helpers";

const LocalGraph = dynamic(
  () => import("./local-graph").then((mod) => mod.LocalGraph),
  { ssr: false, loading: () => <div className="text-xs text-zinc-400 text-center py-4">加载关系图...</div> },
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WikiEntrySidebarProps {
  page: WikiPageDetail;
  slug: string;
  onSelectSlug: (slug: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WikiEntrySidebar({ page, slug, onSelectSlug }: WikiEntrySidebarProps) {
  const router = useRouter();
  const qc = useQueryClient();

  const resolveMutation = useMutation({
    mutationFn: ({ pageId, itemIndex }: { pageId: string; itemIndex: number }) =>
      resolveReviewItem(pageId, itemIndex),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-page", slug] }),
  });

  const unlinkedQuery = useQuery({
    queryKey: ["wiki-unlinked", page.id],
    queryFn: () => getUnlinkedMentions(page.id),
    enabled: !!page.id,
    staleTime: 60_000,
  });

  const linkMentionMutation = useMutation({
    mutationFn: (data: { source_page_id: string; mention_text: string }) =>
      linkMention(page.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-unlinked", page.id] });
      qc.invalidateQueries({ queryKey: ["wiki-page", slug] });
    },
  });

  return (
    <aside className="w-80 shrink-0 border-l border-zinc-200 overflow-y-auto p-5 bg-white/50">

      {/* Local Graph */}
      <div className="mb-6">
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-2">局部图谱</h4>
        <LocalGraph pageId={page.id} currentSlug={page.slug} onSelectSlug={onSelectSlug} />
      </div>

      {/* Review Items */}
      {page.review_items?.some(item => !item.resolved) && (
        <div className="mb-6">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-3 flex items-center gap-2">
            待确认建议
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">
              {page.review_items!.filter(i => !i.resolved).length}
            </span>
          </h4>
          <div className="space-y-2">
            {page.review_items!.map((item, idx) => (
              <div
                key={idx}
                className={cn(
                  "p-3 rounded-lg border text-xs",
                  item.resolved
                    ? "opacity-50 border-zinc-100 bg-zinc-50"
                    : "border-zinc-200 bg-white"
                )}
              >
                <span className={cn(
                  "px-1.5 py-0.5 rounded font-bold",
                  item.type === "contradiction" ? "bg-red-50 text-red-600" :
                  item.type === "suggestion" ? "bg-blue-50 text-blue-600" :
                  item.type === "duplicate" ? "bg-violet-50 text-violet-600" :
                  "bg-amber-50 text-amber-600"
                )}>
                  {item.type === "contradiction" ? "矛盾" :
                   item.type === "suggestion" ? "建议" :
                   item.type === "duplicate" ? "重复" : "缺失"}
                </span>
                <p className="text-zinc-600 mt-1.5">{item.description}</p>
                {item.action && <p className="text-zinc-400 mt-1">{item.action}</p>}
                {!item.resolved && (
                  <button
                    onClick={() => resolveMutation.mutate({ pageId: page.id, itemIndex: idx })}
                    disabled={resolveMutation.isPending}
                    className="mt-2 text-emerald-600 hover:text-emerald-700 font-bold"
                  >
                    标记为已确认
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Relations */}
      {page.relations.length > 0 && (
        <div className="mb-6">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-3">此页链接到</h4>
          <div className="space-y-2">
            {page.relations.map((rel) => (
              <button
                key={rel.id}
                onClick={() => onSelectSlug(rel.to_page_slug || rel.to_page_id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 border border-transparent hover:border-zinc-200 transition-all text-left"
              >
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded font-bold shrink-0",
                  RELATION_COLORS[rel.relation_type] || "bg-zinc-100 text-zinc-500"
                )}>
                  {RELATION_LABELS[rel.relation_type] || rel.relation_type}
                </span>
                <span className="text-sm text-zinc-700 truncate">{rel.to_page_title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      {page.sources.length > 0 && (
        <div className="mb-6">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-3">来源</h4>
          <div className="space-y-2">
            {page.sources.map((src) => (
              <div key={src.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">
                {src.source_type === "video"
                  ? <VideoCamera size={13} weight="bold" className="text-zinc-400 mt-0.5 shrink-0" />
                  : <FileText size={13} weight="bold" className="text-zinc-400 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500 font-medium mb-0.5">
                    {src.source_type === "video" ? "视频" : "文章"}
                  </p>
                  {src.contribution && (
                    <p className="text-xs text-zinc-400 line-clamp-2">{src.contribution}</p>
                  )}
                  <button
                    onClick={() => router.push(
                      src.source_type === "video" ? `/videos/${src.source_id}` : `/knowledge`
                    )}
                    className="flex items-center gap-1 mt-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    <ArrowSquareOut size={10} weight="bold" />
                    查看原始来源
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backlinks */}
      {page.backlinks && page.backlinks.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            链接到此页
            <span className="ml-auto text-zinc-300 font-normal normal-case tracking-normal">{page.backlinks.length}</span>
          </h4>
          <div className="space-y-2">
            {page.backlinks.map((bl) => (
              <button
                key={bl.id}
                onClick={() => onSelectSlug(bl.slug)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-50 border border-transparent hover:border-zinc-200 transition-all group"
              >
                <p className="text-xs font-medium text-zinc-700 group-hover:text-emerald-600 transition-colors">
                  {bl.title}
                </p>
                {bl.summary && (
                  <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{bl.summary}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Unlinked Mentions */}
      {unlinkedQuery.data && unlinkedQuery.data.length > 0 && (
        <div className="mt-6">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            未链接提及
            <span className="ml-auto text-zinc-300 font-normal normal-case tracking-normal">{unlinkedQuery.data.length}</span>
          </h4>
          <div className="space-y-2">
            {unlinkedQuery.data.map((mention) => (
              <div
                key={mention.page_id}
                className="px-3 py-2 rounded-lg border border-zinc-100 bg-zinc-50/50"
              >
                <button
                  onClick={() => onSelectSlug(mention.page_slug)}
                  className="text-xs font-medium text-zinc-700 hover:text-emerald-600 transition-colors"
                >
                  {mention.page_title}
                </button>
                <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                  {mention.context.split(new RegExp(`(${page.title})`, "i")).map((part, i) =>
                    part.toLowerCase() === page.title.toLowerCase()
                      ? <mark key={i} className="bg-amber-100 text-amber-700 rounded px-0.5">{part}</mark>
                      : part
                  )}
                </p>
                <button
                  onClick={() => linkMentionMutation.mutate({
                    source_page_id: mention.page_id,
                    mention_text: page.title,
                  })}
                  disabled={linkMentionMutation.isPending}
                  className="mt-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                >
                  {linkMentionMutation.isPending ? "整理中…" : "转为链接"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
