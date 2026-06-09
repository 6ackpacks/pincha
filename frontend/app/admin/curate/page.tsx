"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import {
  CircleNotch, Plus, PencilSimple, Trash, ArrowClockwise,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchCategories, createCategory, updateCategory, deleteCategory,
  fetchSources, createSource, updateSource, deleteSource, triggerCurate,
  type Category, type Source,
} from "@/lib/admin-api";

export default function CuratePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("categories");

  const triggerMut = useMutation({
    mutationFn: triggerCurate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "curate"] }),
  });

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-100">Curate 管理</h1>
        <button
          onClick={() => triggerMut.mutate()}
          disabled={triggerMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60 disabled:opacity-50"
        >
          {triggerMut.isPending
            ? <CircleNotch size={12} weight="bold" className="animate-spin" />
            : <ArrowClockwise size={12} weight="bold" />}
          手动触发抓取
        </button>
      </div>

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex gap-1 border-b border-zinc-800 mb-4">
          <Tabs.Trigger
            value="categories"
            className={cn(
              "px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              tab === "categories" ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-500 hover:text-zinc-300",
            )}
          >
            分类
          </Tabs.Trigger>
          <Tabs.Trigger
            value="sources"
            className={cn(
              "px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              tab === "sources" ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-500 hover:text-zinc-300",
            )}
          >
            来源
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="categories">
          <CategoriesTab />
        </Tabs.Content>
        <Tabs.Content value="sources">
          <SourcesTab />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories Tab
// ---------------------------------------------------------------------------

function CategoriesTab() {
  const qc = useQueryClient();
  const [editItem, setEditItem] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  const categoriesQ = useQuery<Category[]>({
    queryKey: ["admin", "curate", "categories"],
    queryFn: fetchCategories,
  });

  const deleteMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "curate", "categories"] }),
  });

  const categories = categoriesQ.data ?? [];

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        >
          <Plus size={12} weight="bold" />
          新增分类
        </button>
      </div>

      {categoriesQ.isLoading ? (
        <div className="flex justify-center py-8">
          <CircleNotch size={18} weight="bold" className="animate-spin text-zinc-500" />
        </div>
      ) : categories.length === 0 ? (
        <p className="text-xs text-zinc-500 text-center py-8">暂无分类</p>
      ) : (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium">名称</th>
                <th className="text-left px-4 py-2 font-medium">Slug</th>
                <th className="text-left px-4 py-2 font-medium">描述</th>
                <th className="text-left px-4 py-2 font-medium">排序</th>
                <th className="text-right px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {categories.map((c) => (
                <tr key={c.id} className="bg-zinc-950">
                  <td className="px-4 py-2 text-zinc-200">{c.name}</td>
                  <td className="px-4 py-2 font-mono text-zinc-500">{c.slug}</td>
                  <td className="px-4 py-2 text-zinc-400 max-w-[200px] truncate">{c.description}</td>
                  <td className="px-4 py-2 text-zinc-400">{c.sort_order}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditItem(c)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
                        <PencilSimple size={13} weight="bold" />
                      </button>
                      <button onClick={() => deleteMut.mutate(c.id)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400">
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

      {(creating || editItem) && (
        <CategoryFormDialog
          category={editItem}
          onClose={() => { setCreating(false); setEditItem(null); }}
        />
      )}
    </div>
  );
}

function CategoryFormDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!category;
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0));

  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof createCategory>[0]) => createCategory(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "curate", "categories"] }); onClose(); },
  });

  const updateMut = useMutation({
    mutationFn: (data: Partial<Category>) => updateCategory(category!.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "curate", "categories"] }); onClose(); },
  });

  const handleSave = () => {
    const data = { name, slug, description, sort_order: Number(sortOrder) };
    if (isEdit) updateMut.mutate(data);
    else createMut.mutate(data);
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">{isEdit ? "编辑分类" : "新增分类"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="名称" value={name} onChange={setName} />
          <FormField label="Slug" value={slug} onChange={setSlug} />
          <FormField label="描述" value={description} onChange={setDescription} />
          <FormField label="排序" value={sortOrder} onChange={setSortOrder} type="number" />
        </div>
        <DialogFooter>
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200">取消</button>
          <button onClick={handleSave} disabled={isPending} className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-200 text-zinc-900 hover:bg-white disabled:opacity-50">
            {isPending ? "保存中…" : "保存"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sources Tab
// ---------------------------------------------------------------------------

function SourcesTab() {
  const qc = useQueryClient();
  const [editItem, setEditItem] = useState<Source | null>(null);
  const [creating, setCreating] = useState(false);

  const sourcesQ = useQuery<Source[]>({
    queryKey: ["admin", "curate", "sources"],
    queryFn: fetchSources,
  });

  const categoriesQ = useQuery<Category[]>({
    queryKey: ["admin", "curate", "categories"],
    queryFn: fetchCategories,
  });

  const deleteMut = useMutation({
    mutationFn: deleteSource,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "curate", "sources"] }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateSource(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "curate", "sources"] }),
  });

  const sources = sourcesQ.data ?? [];

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        >
          <Plus size={12} weight="bold" />
          新增来源
        </button>
      </div>

      {sourcesQ.isLoading ? (
        <div className="flex justify-center py-8">
          <CircleNotch size={18} weight="bold" className="animate-spin text-zinc-500" />
        </div>
      ) : sources.length === 0 ? (
        <p className="text-xs text-zinc-500 text-center py-8">暂无来源</p>
      ) : (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium">名称</th>
                <th className="text-left px-4 py-2 font-medium">分类</th>
                <th className="text-left px-4 py-2 font-medium">平台</th>
                <th className="text-left px-4 py-2 font-medium">启用</th>
                <th className="text-right px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {sources.map((s) => (
                <tr key={s.id} className="bg-zinc-950">
                  <td className="px-4 py-2 text-zinc-200">{s.name}</td>
                  <td className="px-4 py-2 text-zinc-400">{s.category_name || s.category_id.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-zinc-400">{s.platform}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleMut.mutate({ id: s.id, enabled: !s.enabled })}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-colors",
                        s.enabled ? "bg-emerald-600" : "bg-zinc-700",
                      )}
                    >
                      <span className={cn(
                        "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                        s.enabled ? "left-4.5" : "left-0.5",
                      )} />
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditItem(s)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
                        <PencilSimple size={13} weight="bold" />
                      </button>
                      <button onClick={() => deleteMut.mutate(s.id)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400">
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

      {(creating || editItem) && (
        <SourceFormDialog
          source={editItem}
          categories={categoriesQ.data ?? []}
          onClose={() => { setCreating(false); setEditItem(null); }}
        />
      )}
    </div>
  );
}

function SourceFormDialog({ source, categories, onClose }: { source: Source | null; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!source;
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [platform, setPlatform] = useState(source?.platform ?? "youtube");
  const [categoryId, setCategoryId] = useState(source?.category_id ?? (categories[0]?.id ?? ""));
  const [enabled, setEnabled] = useState(source?.enabled ?? true);

  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof createSource>[0]) => createSource(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "curate", "sources"] }); onClose(); },
  });

  const updateMut = useMutation({
    mutationFn: (data: Partial<Source>) => updateSource(source!.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "curate", "sources"] }); onClose(); },
  });

  const handleSave = () => {
    const data = { name, url, platform, category_id: categoryId, enabled };
    if (isEdit) updateMut.mutate(data);
    else createMut.mutate(data);
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">{isEdit ? "编辑来源" : "新增来源"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="名称" value={name} onChange={setName} />
          <FormField label="URL" value={url} onChange={setUrl} />
          <FormField label="平台" value={platform} onChange={setPlatform} />
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">分类</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none"
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400">启用</label>
            <button
              onClick={() => setEnabled(!enabled)}
              className={cn("w-8 h-4 rounded-full relative transition-colors", enabled ? "bg-emerald-600" : "bg-zinc-700")}
            >
              <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform", enabled ? "left-4.5" : "left-0.5")} />
            </button>
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200">取消</button>
          <button onClick={handleSave} disabled={isPending} className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-200 text-zinc-900 hover:bg-white disabled:opacity-50">
            {isPending ? "保存中…" : "保存"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function FormField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
      />
    </div>
  );
}
