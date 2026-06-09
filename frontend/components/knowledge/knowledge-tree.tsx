"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { MagnifyingGlass, CaretDown, CaretRight, Tag, Books, SortAscending, Plus } from "@phosphor-icons/react";
import { type WikiPageSummary, type TagTreeNode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getCommunityColor } from "@/lib/constants/community-colors";

// ---------------------------------------------------------------------------
// Local type extensions (do not modify api.ts)
// ---------------------------------------------------------------------------

type WikiPageWithType = WikiPageSummary & {
  type?: "concept" | "entity" | "method" | "source" | "insight";
  has_contradiction?: boolean;
  community_id?: number | null;
  contradiction_details?: unknown[];
};

// ---------------------------------------------------------------------------
// Type configuration
// ---------------------------------------------------------------------------

const TYPE_CONFIG = {
  concept: {
    label: "概念",
    color: "text-emerald-600",
    bgActive: "bg-emerald-50",
    badge: "bg-emerald-100 text-emerald-700",
  },
  entity: {
    label: "实体",
    color: "text-blue-600",
    bgActive: "bg-blue-50",
    badge: "bg-blue-100 text-blue-700",
  },
  method: {
    label: "方法",
    color: "text-violet-600",
    bgActive: "bg-violet-50",
    badge: "bg-violet-100 text-violet-700",
  },
  source: {
    label: "来源",
    color: "text-amber-600",
    bgActive: "bg-amber-50",
    badge: "bg-amber-100 text-amber-700",
  },
  insight: {
    label: "洞察",
    color: "text-orange-600",
    bgActive: "bg-orange-50",
    badge: "bg-orange-100 text-orange-700",
  },
} as const;

type PageType = keyof typeof TYPE_CONFIG;

const GROUP_ORDER: PageType[] = ["concept", "entity", "method", "source", "insight"];

const WIKI_GROUP_MODE_KEY = "wiki-group-mode";

interface KnowledgeTreeProps {
  pages: WikiPageWithType[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  loading?: boolean;
  tagTree?: TagTreeNode[];
  tagsLoading?: boolean;
  activeTag?: string | null;
  onTagSelect?: (tagPath: string | null) => void;
  onImport?: () => void;
}

// ---------------------------------------------------------------------------
// Tag tree node component
// ---------------------------------------------------------------------------

function TagTreeNodeItem({
  node,
  collapsed,
  onToggle,
  activeTag,
  onTagSelect,
  depth = 0,
}: {
  node: TagTreeNode;
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  activeTag: string | null;
  onTagSelect: (tagPath: string | null) => void;
  depth?: number;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = !!collapsed[`tag-${node.full_path}`];
  const isActive = activeTag === node.full_path;
  // Count total pages under this node (own + all descendants)
  const totalCount = _countTagTree(node);

  return (
    <div>
      <div
        onClick={() => onTagSelect(isActive ? null : node.full_path)}
        className={cn(
          "flex items-center gap-1.5 py-1.5 cursor-pointer rounded-md mx-1 group select-none",
          isActive
            ? "bg-emerald-50/60 text-emerald-900"
            : "text-zinc-700 hover:bg-zinc-100"
        )}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(`tag-${node.full_path}`);
            }}
            className="shrink-0 p-0.5 rounded hover:bg-zinc-200 transition-colors"
          >
            {isCollapsed ? (
              <CaretRight size={12} weight="bold" className="text-zinc-400" />
            ) : (
              <CaretDown size={12} weight="bold" className="text-zinc-400" />
            )}
          </button>
        ) : (
          <span className="w-[16px] shrink-0" />
        )}
        <Tag size={11} weight="bold" className={cn("shrink-0", isActive ? "text-emerald-500" : "text-zinc-400")} />
        <span className="truncate flex-1 text-xs font-medium">{node.name}</span>
        {totalCount > 0 && (
          <span
            className={cn(
              "text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0 mr-2",
              isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"
            )}
          >
            {totalCount}
          </span>
        )}
      </div>
      {hasChildren && !isCollapsed && node.children.map((child) => (
        <TagTreeNodeItem
          key={child.full_path}
          node={child}
          collapsed={collapsed}
          onToggle={onToggle}
          activeTag={activeTag}
          onTagSelect={onTagSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

/** Count pages for a tag node: own count + all descendant counts */
function _countTagTree(node: TagTreeNode): number {
  let total = node.count;
  for (const child of node.children) {
    total += _countTagTree(child);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KnowledgeTree({
  pages,
  activeSlug,
  onSelect,
  loading = false,
  tagTree,
  tagsLoading,
  activeTag,
  onTagSelect,
  onImport,
}: KnowledgeTreeProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<"name" | "date">("date");
  const [groupMode, setGroupMode] = useState<"type" | "community" | "tag">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(WIKI_GROUP_MODE_KEY) as "type" | "community" | "tag") || "type";
    }
    return "type";
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 300ms debounce for search input
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const toggleGroup = (type: string) => {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  // Filter pages by query (case-insensitive title match)
  const filteredPages = useMemo(() => {
    const filtered = debouncedQuery
      ? pages.filter((p) =>
          p.title.toLowerCase().includes(debouncedQuery.toLowerCase())
        )
      : pages;

    // Sort
    return [...filtered].sort((a, b) => {
      if (sortBy === "name") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      // date — newest first
      return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    });
  }, [pages, debouncedQuery, sortBy]);

  // Group pages by type; pages without type go into a synthetic "other" bucket
  // then assign to the closest match — we'll just map unknown/missing to "concept"
  // as a safe fallback so every page is shown.
  const groups: Record<PageType, WikiPageWithType[]> = {
    concept: [],
    entity: [],
    method: [],
    source: [],
    insight: [],
  };

  for (const page of filteredPages) {
    const t: PageType =
      page.type && page.type in TYPE_CONFIG ? page.type : "concept";
    groups[t].push(page);
  }

  // Group pages by community_id — only computed when needed
  const communityGroups: Map<number | null, WikiPageWithType[]> = groupMode === "community" ? (() => {
    const map: Map<number | null, WikiPageWithType[]> = new Map();
    for (const page of filteredPages) {
      const cid = page.community_id ?? null;
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(page);
    }
    return map;
  })() : new Map();
  const communityKeys = groupMode === "community"
    ? [...communityGroups.keys()].sort((a, b) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      })
    : [];

  // Determine if there is any content to show
  const totalFiltered = filteredPages.length;

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="px-3 py-2 border-b border-zinc-100 shrink-0">
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索词条…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>
      </div>

      {/* Group mode toggle + sort */}
      <div className="flex items-center gap-0.5 px-2 pb-2">
        {(["type", "community", "tag"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => {
              setGroupMode(mode);
              localStorage.setItem(WIKI_GROUP_MODE_KEY, mode);
            }}
            className={cn(
              "text-xs px-2 py-1 rounded-full transition-all whitespace-nowrap",
              groupMode === mode
                ? "bg-emerald-100 text-emerald-700 font-bold"
                : "text-zinc-400 hover:text-zinc-600"
            )}
          >
            {mode === "type" ? "类型" : mode === "community" ? "社区" : "标签"}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setSortBy(sortBy === "name" ? "date" : "name")}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 px-1.5 py-1 rounded transition-colors whitespace-nowrap"
          title={sortBy === "name" ? "按名称排序" : "按时间排序"}
        >
          <SortAscending size={12} weight="bold" />
          <span>{sortBy === "name" ? "名称" : "时间"}</span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 py-1">
        {loading ? (
          /* Skeleton loader */
          <div className="px-3 py-3 space-y-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <div
                  className="animate-pulse bg-zinc-200 rounded h-3.5"
                  style={{ width: ["85%", "70%", "60%", "90%", "55%"][i] }}
                />
                <div
                  className="animate-pulse bg-zinc-100 rounded h-2.5"
                  style={{ width: ["60%", "50%", "75%", "45%", "65%"][i] }}
                />
              </div>
            ))}
          </div>
        ) : pages.length === 0 ? (
          /* Empty state — no pages at all */
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
            <Books size={28} weight="bold" className="text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-600">这里还没有知识线索</p>
            <p className="text-xs text-zinc-400">
              放入视频、文章或文本，给信息一个归处
            </p>
            {onImport && (
              <button
                onClick={onImport}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-700 transition-colors"
              >
                <Plus size={12} weight="bold" />
                添加线索
              </button>
            )}
          </div>
        ) : totalFiltered === 0 ? (
          /* Search no results */
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <p className="text-xs text-zinc-400">
              未找到 &ldquo;{debouncedQuery}&rdquo; 相关词条
            </p>
          </div>
        ) : groupMode === "type" ? (
          /* Grouped by type */
          GROUP_ORDER.map((type) => {
            const group = groups[type];
            if (group.length === 0) return null;

            const config = TYPE_CONFIG[type];
            const isCollapsed = !!collapsed[`type-${type}`];

            return (
              <div key={type}>
                {/* Group header */}
                <div
                  onClick={() => toggleGroup(`type-${type}`)}
                  className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    {isCollapsed ? (
                      <CaretRight size={12} weight="bold" className="text-zinc-400 shrink-0" />
                    ) : (
                      <CaretDown size={12} weight="bold" className="text-zinc-400 shrink-0" />
                    )}
                    <span className={cn("text-xs font-semibold", config.color)}>
                      {config.label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-semibold px-1.5 py-0.5 rounded-full",
                      config.badge
                    )}
                  >
                    {group.length}
                  </span>
                </div>

                {/* Group items */}
                {!isCollapsed &&
                  group.map((page) => {
                    const isActive = activeSlug === page.slug;
                    return (
                      <div
                        key={page.id}
                        onClick={() => onSelect(page.slug)}
                        className={cn(
                          "flex items-center gap-2 py-1.5 text-sm cursor-pointer rounded-md mx-1 group",
                          isActive
                            ? "border-l-2 border-emerald-500 pl-3.5 bg-emerald-50/60 text-emerald-900"
                            : "pl-4 text-zinc-700 hover:bg-zinc-100"
                        )}
                      >
                        <span className="truncate flex-1 text-xs font-medium">
                          {page.title}
                        </span>
                        {page.contradiction_details?.length ? (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold shrink-0">
                            {page.contradiction_details.length}
                          </span>
                        ) : page.has_contradiction === true ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            );
          })
        ) : groupMode === "tag" ? (
          /* Tag tree */
          tagsLoading ? (
            <div className="px-3 py-3 space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="animate-pulse bg-zinc-200 rounded h-4"
                  style={{ width: i === 1 ? "70%" : i === 2 ? "55%" : "85%" }}
                />
              ))}
            </div>
          ) : !tagTree || tagTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
              <Tag size={24} weight="bold" className="text-zinc-200" />
              <p className="text-sm font-semibold text-zinc-600">暂无标签</p>
              <p className="text-xs text-zinc-400">
                为知识页面添加标签后即可使用
              </p>
            </div>
          ) : (
            <div>
              {activeTag && (
                <button
                  onClick={() => onTagSelect?.(null)}
                  className="flex items-center gap-1.5 mx-3 mb-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold hover:bg-emerald-200 transition-colors"
                >
                  <Tag size={10} weight="bold" />
                  {activeTag}
                  <span className="ml-0.5 text-emerald-500">x</span>
                </button>
              )}
              {tagTree.map((node) => (
                <TagTreeNodeItem
                  key={node.full_path}
                  node={node}
                  collapsed={collapsed}
                  onToggle={toggleGroup}
                  activeTag={activeTag ?? null}
                  onTagSelect={onTagSelect ?? (() => {})}
                />
              ))}
            </div>
          )
        ) : (
          /* Grouped by community */
          communityKeys.map((cid) => {
            const group = communityGroups.get(cid)!;
            const key = cid === null ? "uncategorized" : `community-${cid}`;
            const isCollapsed = !!collapsed[key];
            const color = getCommunityColor(cid);

            return (
              <div key={key}>
                {/* Group header */}
                <div
                  onClick={() => toggleGroup(key)}
                  className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    {isCollapsed ? (
                      <CaretRight size={12} weight="bold" className="text-zinc-400 shrink-0" />
                    ) : (
                      <CaretDown size={12} weight="bold" className="text-zinc-400 shrink-0" />
                    )}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-semibold text-zinc-600">
                      {cid === null ? "未分类" : `社区 #${cid}`}
                    </span>
                  </div>
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
                    {group.length}
                  </span>
                </div>

                {/* Group items */}
                {!isCollapsed &&
                  group.map((page) => {
                    const isActive = activeSlug === page.slug;
                    return (
                      <div
                        key={page.id}
                        onClick={() => onSelect(page.slug)}
                        className={cn(
                          "flex items-center gap-2 py-1.5 text-sm cursor-pointer rounded-md mx-1 group",
                          isActive
                            ? "border-l-2 border-emerald-500 pl-3.5 bg-emerald-50/60 text-emerald-900"
                            : "pl-4 text-zinc-700 hover:bg-zinc-100"
                        )}
                      >
                        <span className="truncate flex-1 text-xs font-medium">
                          {page.title}
                        </span>
                        {page.contradiction_details?.length ? (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold shrink-0">
                            {page.contradiction_details.length}
                          </span>
                        ) : page.has_contradiction === true ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
