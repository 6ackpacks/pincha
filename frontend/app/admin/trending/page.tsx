"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PushPin, EyeSlash, ArrowsClockwise, MagnifyingGlass, Funnel,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  fetchTrendingVideos, updateTrending, batchTrending,
  type TrendingVideo, type PaginatedTrending,
} from "@/lib/admin-api";

const FILTERS = [
  { value: "", label: "全部" },
  { value: "pinned", label: "置顶" },
  { value: "hidden", label: "隐藏" },
  { value: "override", label: "手动加权" },
];

export default function TrendingPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState("");

  const { data, isLoading } = useQuery<PaginatedTrending>({
    queryKey: ["admin", "trending", page, filter],
    queryFn: () => fetchTrendingVideos({ page, filter: filter || undefined }),
  });

  const mutation = useMutation({
    mutationFn: ({ id, ...rest }: { id: string } & Parameters<typeof updateTrending>[1]) =>
      updateTrending(id, rest),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "trending"] }),
  });

  const batchMut = useMutation({
    mutationFn: batchTrending,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "trending"] });
      setSelected(new Set());
    },
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (!data) return;
    if (selected.size === data.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.items.map((v) => v.id)));
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 30);

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-100">热门管理</h1>
        <span className="text-xs text-zinc-500">
          公式: (解析量×0.7 + 浏览量×0.3) × 时间衰减(7天半衰) | 管理员可覆盖
        </span>
      </div>

      {/* Filters + Batch actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Funnel size={14} className="text-zinc-500" />
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setFilter(f.value); setPage(1); }}
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filter === f.value
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-zinc-400">已选 {selected.size} 项</span>
            <button
              onClick={() => batchMut.mutate({ video_ids: [...selected], is_pinned: true })}
              className="px-2.5 py-1 rounded text-xs bg-amber-900/30 text-amber-300 hover:bg-amber-900/50"
            >
              批量置顶
            </button>
            <button
              onClick={() => batchMut.mutate({ video_ids: [...selected], is_hidden: true })}
              className="px-2.5 py-1 rounded text-xs bg-red-900/30 text-red-300 hover:bg-red-900/50"
            >
              批量隐藏
            </button>
            <button
              onClick={() => batchMut.mutate({ video_ids: [...selected], is_pinned: false, is_hidden: false, admin_score: null })}
              className="px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            >
              重置为算法排序
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <ArrowsClockwise size={20} className="animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={selectAll}
                    className="rounded border-zinc-600"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">标题</th>
                <th className="text-left px-3 py-2 font-medium w-20">平台</th>
                <th className="text-right px-3 py-2 font-medium w-20">浏览量</th>
                <th className="text-center px-3 py-2 font-medium w-16">置顶</th>
                <th className="text-center px-3 py-2 font-medium w-16">隐藏</th>
                <th className="text-right px-3 py-2 font-medium w-24">手动分数</th>
                <th className="text-right px-3 py-2 font-medium w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {items.map((v) => (
                <tr key={v.id} className={cn("bg-zinc-950 hover:bg-zinc-900/50", v.is_hidden && "opacity-50")}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(v.id)}
                      onChange={() => toggleSelect(v.id)}
                      className="rounded border-zinc-600"
                    />
                  </td>
                  <td className="px-3 py-2 text-zinc-200 truncate max-w-[300px]">{v.title}</td>
                  <td className="px-3 py-2 text-zinc-400">{v.platform}</td>
                  <td className="px-3 py-2 text-right text-zinc-300 font-mono">{v.view_count}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => mutation.mutate({ id: v.id, is_pinned: !v.is_pinned })}
                      className={cn(
                        "p-1 rounded transition-colors",
                        v.is_pinned ? "text-amber-400 bg-amber-900/20" : "text-zinc-600 hover:text-zinc-400"
                      )}
                    >
                      <PushPin size={14} weight={v.is_pinned ? "fill" : "regular"} />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => mutation.mutate({ id: v.id, is_hidden: !v.is_hidden })}
                      className={cn(
                        "p-1 rounded transition-colors",
                        v.is_hidden ? "text-red-400 bg-red-900/20" : "text-zinc-600 hover:text-zinc-400"
                      )}
                    >
                      <EyeSlash size={14} weight={v.is_hidden ? "fill" : "regular"} />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editingId === v.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const val = scoreInput.trim() === "" ? null : parseFloat(scoreInput);
                          mutation.mutate({ id: v.id, admin_score: val });
                          setEditingId(null);
                        }}
                        className="flex items-center gap-1 justify-end"
                      >
                        <input
                          autoFocus
                          value={scoreInput}
                          onChange={(e) => setScoreInput(e.target.value)}
                          placeholder="留空清除"
                          className="w-16 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs text-right"
                        />
                        <button type="submit" className="text-emerald-400 text-xs">✓</button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-zinc-500 text-xs">✕</button>
                      </form>
                    ) : (
                      <button
                        onClick={() => { setEditingId(v.id); setScoreInput(v.admin_score?.toString() ?? ""); }}
                        className={cn(
                          "font-mono text-xs px-1.5 py-0.5 rounded",
                          v.admin_score !== null
                            ? "text-emerald-400 bg-emerald-900/20"
                            : "text-zinc-600 hover:text-zinc-400"
                        )}
                      >
                        {v.admin_score !== null ? v.admin_score : "—"}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(v.is_pinned || v.is_hidden || v.admin_score !== null) && (
                      <button
                        onClick={() => mutation.mutate({ id: v.id, is_pinned: false, is_hidden: false, admin_score: null })}
                        className="text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        重置
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-zinc-500">共 {total} 条</span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 disabled:opacity-30"
            >
              上一页
            </button>
            <span className="text-xs text-zinc-400 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 disabled:opacity-30"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
