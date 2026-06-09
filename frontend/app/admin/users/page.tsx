"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleNotch, MagnifyingGlass, CaretLeft, CaretRight, ShieldCheck, ShieldSlash,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { fetchUsers, updateUser, type PaginatedUsers } from "@/lib/admin-api";

export default function UsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const usersQ = useQuery<PaginatedUsers>({
    queryKey: ["admin", "users", page, search],
    queryFn: () => fetchUsers({ page, search: search || undefined }),
  });

  const toggleAdminMut = useMutation({
    mutationFn: ({ id, is_admin }: { id: string; is_admin: boolean }) => updateUser(id, { is_admin }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const users = usersQ.data?.items ?? [];
  const total = usersQ.data?.total ?? 0;
  const pageSize = usersQ.data?.page_size ?? 20;
  const totalPages = Math.ceil(total / pageSize);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <h1 className="text-lg font-bold text-zinc-100">用户管理</h1>

      <div className="flex items-center gap-3">
        <div className="relative">
          <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="搜索昵称/邮箱"
            className="pl-8 pr-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600 w-56"
          />
        </div>
      </div>

      {usersQ.isLoading ? (
        <div className="flex justify-center py-12">
          <CircleNotch size={20} weight="bold" className="animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium">用户</th>
                <th className="text-left px-4 py-2 font-medium">邮箱</th>
                <th className="text-left px-4 py-2 font-medium">管理员</th>
                <th className="text-left px-4 py-2 font-medium">注册时间</th>
                <th className="text-right px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.map((u) => (
                <tr key={u.id} className="bg-zinc-950 hover:bg-zinc-900/50">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-[10px] font-bold">
                          {(u.nickname || u.email || "?")[0].toUpperCase()}
                        </div>
                      )}
                      <span className="text-zinc-200">{u.nickname || "未设置"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{u.email || "-"}</td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                      u.is_admin ? "bg-emerald-900/30 text-emerald-400" : "bg-zinc-800 text-zinc-500",
                    )}>
                      {u.is_admin ? "管理员" : "普通用户"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{new Date(u.created_at).toLocaleString("zh-CN")}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => toggleAdminMut.mutate({ id: u.id, is_admin: !u.is_admin })}
                      disabled={toggleAdminMut.isPending}
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                        u.is_admin
                          ? "bg-red-900/30 text-red-400 hover:bg-red-900/50"
                          : "bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50",
                      )}
                    >
                      {u.is_admin ? <ShieldSlash size={12} weight="bold" /> : <ShieldCheck size={12} weight="bold" />}
                      {u.is_admin ? "撤销" : "授予"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-zinc-500">共 {total} 位用户</span>
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
    </div>
  );
}
