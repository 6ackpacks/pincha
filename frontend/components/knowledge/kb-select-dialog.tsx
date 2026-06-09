"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Plus, Check, CircleNotch } from "@phosphor-icons/react";
import { listKBs, createKB, type KnowledgeBaseItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface KBSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (kbId: string) => void;
  loading?: boolean;
}

export function KBSelectDialog({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
}: KBSelectDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const qc = useQueryClient();

  const { data: kbs, isLoading: kbsLoading } = useQuery({
    queryKey: ["kbs"],
    queryFn: listKBs,
    staleTime: 60_000,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: createKB,
    onSuccess: (newKb) => {
      qc.invalidateQueries({ queryKey: ["kbs"] });
      setSelectedId(newKb.id);
      setCreating(false);
      setNewName("");
    },
  });

  // Pre-select default KB when data loads
  useEffect(() => {
    if (kbs && !selectedId) {
      const defaultKb = kbs.find((kb) => kb.is_default) ?? kbs[0];
      if (defaultKb) setSelectedId(defaultKb.id);
    }
  }, [kbs, selectedId]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setCreating(false);
      setNewName("");
    }
  }, [open]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim() });
  };

  const handleConfirm = () => {
    if (selectedId) {
      onConfirm(selectedId);
    }
  };

  const kbCount = kbs?.length ?? 0;
  const atLimit = kbCount >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-bold text-zinc-900">
            选择知识库
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            选择一个归处，内容会被整理为知识线索
          </DialogDescription>
        </DialogHeader>

        {/* KB List */}
        <div className="px-3 pb-2">
          {kbsLoading ? (
            <div className="flex items-center justify-center py-8">
              <CircleNotch size={20} className="text-emerald-500 animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {kbs?.map((kb) => (
                <button
                  key={kb.id}
                  onClick={() => setSelectedId(kb.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all",
                    selectedId === kb.id
                      ? "bg-emerald-50 border border-emerald-200"
                      : "hover:bg-zinc-50 border border-transparent"
                  )}
                >
                  <Database
                    size={16}
                    weight={selectedId === kb.id ? "fill" : "regular"}
                    className={cn(
                      "shrink-0",
                      selectedId === kb.id ? "text-emerald-500" : "text-zinc-400"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm truncate",
                        selectedId === kb.id
                          ? "font-semibold text-emerald-700"
                          : "font-medium text-zinc-700"
                      )}
                    >
                      {kb.name}
                    </p>
                    {kb.description && (
                      <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                        {kb.description}
                      </p>
                    )}
                  </div>
                  {kb.is_default && (
                    <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">
                      默认
                    </span>
                  )}
                  {selectedId === kb.id && (
                    <Check size={14} weight="bold" className="text-emerald-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Create new KB */}
        <div className="mx-3 mb-3 border-t border-zinc-100 pt-2">
          {creating ? (
            <div className="flex items-center gap-2 px-1">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder="输入知识库名称"
                autoFocus
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
              />
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending || !newName.trim()}
                className="px-3 py-2 text-xs font-bold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? (
                  <CircleNotch size={12} className="animate-spin" />
                ) : (
                  "创建"
                )}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="px-2 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-700 transition-colors"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              disabled={atLimit}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-500 hover:text-emerald-600 hover:bg-zinc-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={14} weight="bold" />
              <span>{atLimit ? `已达上限 (${kbCount}/3)` : "新建知识库"}</span>
              {!atLimit && (
                <span className="ml-auto text-[10px] text-zinc-400">
                  {kbCount}/3
                </span>
              )}
            </button>
          )}
          {createMutation.isError && (
            <p className="text-xs text-red-500 mt-1 px-1">
              创建失败: {createMutation.error?.message || "请重试"}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-zinc-100 bg-zinc-50/50">
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-100 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId || loading}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {loading && <CircleNotch size={14} className="animate-spin" />}
            {loading ? "收录中..." : "确认收录"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
