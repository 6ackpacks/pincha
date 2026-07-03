"use client";

import React from "react";
import dynamic from "next/dynamic";

const RelationGraph3D = dynamic(
  () => import("./relation-graph-3d").then((mod) => mod.RelationGraph3D),
  { ssr: false, loading: () => <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" /></div> },
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RELATION_LABELS: Record<string, string> = {
  related: "相关", extends: "延伸", contradicts: "矛盾",
};
export const RELATION_COLORS: Record<string, string> = {
  related: "bg-zinc-100 text-zinc-600",
  extends: "bg-blue-50 text-blue-600",
  contradicts: "bg-amber-50 text-amber-600",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .slice(0, 80);
}

export function normalizeWikiTarget(target: string): string {
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }
  decoded = decoded.trim();
  if (!decoded) return "";

  const stripped = decoded
    .replace(/^wiki:/i, "")
    .replace(/^\/?knowledge\/?/i, "")
    .replace(/^\/+|\/+$/g, "");

  if (!stripped) return "";

  if (/^[\w\u4e00-\u9fff-]+$/i.test(stripped) && !/\s/.test(stripped)) {
    return stripped.toLowerCase();
  }

  return titleToSlug(stripped);
}

export interface WikiTargetIndexEntry {
  title: string;
  slug: string;
}

function normalizeTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveWikiTargetSlug(
  target: string,
  pages: WikiTargetIndexEntry[] | undefined,
  options: { display?: string; currentSlug?: string | null } = {},
): string {
  const fallbackSlug = normalizeWikiTarget(target);
  const currentSlug = options.currentSlug ? normalizeWikiTarget(options.currentSlug) : "";
  const display = options.display?.trim();

  if (!pages?.length) return fallbackSlug;

  const slugMap = new Map<string, string>();
  const titleMap = new Map<string, string>();
  for (const page of pages) {
    slugMap.set(normalizeWikiTarget(page.slug), page.slug);
    titleMap.set(normalizeTitleKey(page.title), page.slug);
  }

  const slugMatch = slugMap.get(fallbackSlug);
  const titleMatch = titleMap.get(normalizeTitleKey(target));
  const resolvedTarget = slugMatch || titleMatch || fallbackSlug;

  if (!display) return resolvedTarget;

  const displaySlug = normalizeWikiTarget(display);
  const displayMatch =
    slugMap.get(displaySlug) ||
    titleMap.get(normalizeTitleKey(display));

  if (displayMatch && displayMatch !== resolvedTarget) {
    if (!slugMatch && !titleMatch) return displayMatch;
    if (currentSlug && normalizeWikiTarget(resolvedTarget) === currentSlug) return displayMatch;
  }

  return resolvedTarget;
}

/** Generate a heading anchor ID from heading text (supports Chinese characters). */
export function headingToAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .slice(0, 120);
}

/** Recursively extract plain text from React children (for heading ID generation). */
export function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>;
    return extractTextFromChildren(el.props.children);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

export function SkeletonLoader() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-6 animate-pulse">
      <div className="flex gap-2 mb-6">
        <div className="h-5 w-16 rounded-full bg-zinc-100" />
        <div className="h-5 w-20 rounded-full bg-zinc-100" />
      </div>
      <div className="h-7 w-2/3 rounded-lg bg-zinc-100 mb-4" />
      <div className="space-y-2 mb-6">
        <div className="h-4 w-full rounded bg-zinc-100" />
        <div className="h-4 w-5/6 rounded bg-zinc-100" />
        <div className="h-4 w-4/5 rounded bg-zinc-100" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-zinc-100" />
        <div className="h-4 w-3/4 rounded bg-zinc-100" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome state (Graph Overview)
// ---------------------------------------------------------------------------

export function GraphOverview({ activeSlug, onSelectSlug }: { activeSlug?: string | null; onSelectSlug: (slug: string) => void }) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <h2 className="text-lg font-bold text-zinc-800">知识图谱</h2>
        <p className="text-xs text-zinc-400 mt-0.5">点击节点查看词条详情</p>
      </div>
      <div className="flex-1 min-h-0 px-2 pb-2">
        <div className="h-full rounded-2xl overflow-hidden">
          <RelationGraph3D activeSlug={activeSlug} onSelectSlug={onSelectSlug} />
        </div>
      </div>
    </div>
  );
}
