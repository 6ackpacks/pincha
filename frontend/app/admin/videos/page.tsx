"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleNotch, MagnifyingGlass, ArrowClockwise, Trash, PencilSimple,
  CaretLeft, CaretRight, CheckSquare, Square, Warning,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { STATE_LABELS } from "@/lib/constants";
import {
  fetchAdminVideos, updateVideo, deleteVideo, retryVideo, batchVideoAction,
  type AdminVideo, type PaginatedVideos,
} from "@/lib/admin-api";

const STATES = ["pending", "transcribing", "summarizing", "done", "failed"] as const;

export default function VideosPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editVideo, setEditVideo] = useState<AdminVideo | null>(null);

  const videosQ = useQuery<PaginatedVideos>({
    queryKey: ["admin", "videos", page, status, search],
    queryFn: () => fetchAdminVideos({ page, status: status || undefined, search: search || undefined }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "videos"] }); },
  });

  const retryMut = useMutation({
    mutationFn: retryVideo,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "videos"] }); },
  });

  const batchMut = useMutation({
    mutationFn: ({ action, ids }: { action: string; ids: string[] }) => batchVideoAction(action, ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "videos"] });
      setSelected(new Set());
    },
  });

  const videos = videosQ.data?.items ?? [];
  const total = videosQ.data?.total ?? 0;
  const pageSize = videosQ.data?.page_size ?? 20;
  const totalPages = Math.ceil(total / pageSize);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === videos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(videos.map((v) => v.id)));
    }
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <h1 className="text-lg font-bold text-zinc-100">视频管理</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="搜索标题/URL"
            className="pl-8 pr-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600 w-56"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
        >
          <option value="">全部状态</option>
          {STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
        </select>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-zinc-400">已选 {selected.size} 项</span>
            <button
              onClick={() => batchMut.mutate({ action: "retry", ids: [...selected] })}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            >
              批量重试
            </button>
            <button
              onClick={() => batchMut.mutate({ action: "fail", ids: [...selected] })}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            >
              强制失败
            </button>
            <button
              onClick={() => batchMut.mutate({ action: "delete", ids: [...selected] })}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-900/50 text-red-300 hover:bg-red-900/70"
            >
              批量删除
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {videosQ.isLoading ? (
        <div className="flex justify-center py-12">
          <CircleNotch size={20} weight="bold" className="animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="w-8 px-3 py-2">
                  <button onClick={toggleAll}>
                    {selected.size === videos.length && videos.length > 0
                      ? <CheckSquare size={14} weight="bold" className="text-emerald-400" />
                      : <Square size={14} weight="bold" />}
                  </button>
                </th>
                <th className="text-left px-3 py-2 font-medium">ID</th>
                <th className="text-left px-3 py-2 font-medium">标题</th>
                <th className="text-left px-3 py-2 font-medium">平台</th>
                <th className="text-left px-3 py-2 font-medium">状态</th>
                <th className="text-left px-3 py-2 font-medium">创建时间</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {videos.map((v) => (
                <tr key={v.id} className="bg-zinc-950 hover:bg-zinc-900/50">
                  <td className="px-3 py-2">
                    <button onClick={() => toggleSelect(v.id)}>
                      {selected.has(v.id)
                        ? <CheckSquare size={14} weight="bold" className="text-emerald-400" />
                        : <Square size={14} weight="bold" className="text-zinc-600" />}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-500">{v.id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-zinc-200 max-w-[200px] truncate">{v.title || v.url}</td>
                  <td className="px-3 py-2 text-zinc-400">{v.platform}</td>
                  <td className="px-3 py-2">
                    <StatusBadge state={v.status.state} />
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{new Date(v.created_at).toLocaleString("zh-CN")}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditVideo(v)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
                        <PencilSimple size={13} weight="bold" />
                      </button>
                      <button onClick={() => retryMut.mutate(v.id)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
                        <ArrowClockwise size={13} weight="bold" />
                      </button>
                      <button onClick={() => deleteMut.mutate(v.id)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400">
                        <Trash size={13} weight="bold" />
                      </button>
                    </div>
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-md border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
            >
              <CaretLeft size={14} weight="bold" />
            </button>
            <span className="text-xs text-zinc-400">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-md border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {editVideo && (
        <EditVideoDialog video={editVideo} onClose={() => setEditVideo(null)} />
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
      state === "done" && "bg-emerald-900/30 text-emerald-400",
      state === "failed" && "bg-red-900/30 text-red-400",
      state === "pending" && "bg-zinc-800 text-zinc-400",
      (state === "transcribing" || state === "summarizing") && "bg-amber-900/30 text-amber-400",
    )}>
      {(state === "transcribing" || state === "summarizing") && (
        <CircleNotch size={10} weight="bold" className="animate-spin" />
      )}
      {STATE_LABELS[state] || state}
    </span>
  );
}

function EditVideoDialog({ video, onClose }: { video: AdminVideo; onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(video.url);
  const [platform, setPlatform] = useState(video.platform);
  const [title, setTitle] = useState(video.title);
  const [statusState, setStatusState] = useState(video.status.state);

  const updateMut = useMutation({
    mutationFn: (data: Record<string, string>) => updateVideo(video.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "videos"] });
      onClose();
    },
  });

  const handleSave = () => {
    updateMut.mutate({ url, platform, title, status: statusState });
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">编辑视频</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="URL" value={url} onChange={setUrl} />
          <Field label="平台" value={platform} onChange={setPlatform} />
          <Field label="标题" value={title} onChange={setTitle} />
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">状态</label>
            <select
              value={statusState}
              onChange={(e) => setStatusState(e.target.value)}
              className="w-full px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none"
            >
              {STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={updateMut.isPending}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-200 text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {updateMut.isPending ? "保存中…" : "保存"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 mb-1 block">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
      />
    </div>
  );
}
