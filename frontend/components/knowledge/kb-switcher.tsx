"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { Database, Plus, CaretUpDown, Check, CircleNotch } from "@phosphor-icons/react";
import { listKBs, createKB, type KnowledgeBaseItem } from "@/lib/api";
import { activeKbIdAtom } from "@/atoms/kb";
import { cn } from "@/lib/utils";

export function KBSwitcher() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [activeKbId, setActiveKbId] = useAtom(activeKbIdAtom);
  const qc = useQueryClient();

  const { data: kbs, isLoading } = useQuery({
    queryKey: ["kbs"],
    queryFn: listKBs,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: createKB,
    onSuccess: (newKb) => {
      qc.invalidateQueries({ queryKey: ["kbs"] });
      setActiveKbId(newKb.id);
      setCreating(false);
      setNewName("");
    },
  });

  // Auto-select default KB if none selected
  const activeKb = kbs?.find((kb) => kb.id === activeKbId) ?? kbs?.find((kb) => kb.is_default) ?? kbs?.[0];
  if (activeKb && activeKbId !== activeKb.id) {
    setActiveKbId(activeKb.id);
  }

  const handleSelect = (kb: KnowledgeBaseItem) => {
    setActiveKbId(kb.id);
    setOpen(false);
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim() });
  };

  if (isLoading) {
    return (
      <div className="px-3 py-2">
        <div className="h-8 rounded-lg bg-zinc-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="relative px-3 py-2">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-zinc-100 transition-colors text-left"
      >
        <Database size={16} weight="bold" className="text-emerald-500 shrink-0" />
        <span className="text-sm font-semibold text-zinc-800 truncate flex-1">
          {activeKb?.name ?? "选择知识库"}
        </span>
        <CaretUpDown size={14} weight="bold" className="text-zinc-400 shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-white rounded-xl border border-zinc-200 shadow-lg overflow-hidden">
            <div className="py-1.5">
              {kbs?.map((kb) => (
                <button
                  key={kb.id}
                  onClick={() => handleSelect(kb)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-50 transition-colors",
                    kb.id === activeKb?.id && "bg-emerald-50"
                  )}
                >
                  <Database size={14} weight={kb.id === activeKb?.id ? "fill" : "regular"} className={kb.id === activeKb?.id ? "text-emerald-500" : "text-zinc-400"} />
                  <span className={cn("text-sm truncate flex-1", kb.id === activeKb?.id ? "font-semibold text-emerald-700" : "text-zinc-700")}>
                    {kb.name}
                  </span>
                  {kb.id === activeKb?.id && <Check size={14} weight="bold" className="text-emerald-500" />}
                </button>
              ))}
            </div>

            {/* Create new */}
            <div className="border-t border-zinc-100 p-2">
              {creating ? (
                <div className="flex items-center gap-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    placeholder="知识库名称"
                    autoFocus
                    className="flex-1 text-sm px-2.5 py-1.5 rounded-lg border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                  <button
                    onClick={handleCreate}
                    disabled={createMutation.isPending || !newName.trim()}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {createMutation.isPending ? <CircleNotch size={12} className="animate-spin" /> : "创建"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if ((kbs?.length ?? 0) >= 3) return;
                    setCreating(true);
                  }}
                  disabled={(kbs?.length ?? 0) >= 3}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-zinc-500 hover:text-emerald-600 hover:bg-zinc-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={14} weight="bold" />
                  <span>{(kbs?.length ?? 0) >= 3 ? "已达上限 (3个)" : "新建知识库"}</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
