"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Desktop, DeviceMobile, Globe, SignOut } from "@phosphor-icons/react";
import { getMe, getSessions, revokeSession, type SessionInfo } from "@/lib/api/auth";
import { cn } from "@/lib/utils";

function parseUA(ua: string): { device: string; icon: typeof Desktop } {
  if (/mobile|android|iphone/i.test(ua)) return { device: "手机", icon: DeviceMobile };
  if (/mac|windows|linux/i.test(ua)) return { device: "电脑", icon: Desktop };
  return { device: "未知设备", icon: Globe };
}

function formatSessionTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 30 * 60 * 1000 });
  const { data: sessions = [] } = useQuery({ queryKey: ["sessions"], queryFn: getSessions });

  const handleRevoke = async (jti: string) => {
    await revokeSession(jti);
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-base font-bold text-zinc-900">个人信息</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors">
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* User info */}
        <div className="px-6 py-5">
          <div className="flex items-center gap-4">
            {me?.avatar_url ? (
              <img src={me.avatar_url} alt={me.nickname ?? ""} className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-zinc-200 flex items-center justify-center text-lg font-bold text-zinc-600">
                {(me?.nickname ?? "U")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-zinc-900 truncate">{me?.nickname ?? "用户"}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{me?.email || me?.phone || "未绑定联系方式"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-5">
            {me?.email && (
              <div className="px-3 py-2 rounded-lg bg-zinc-50">
                <p className="text-[10px] text-zinc-400 font-medium">邮箱</p>
                <p className="text-xs text-zinc-700 truncate mt-0.5">{me.email}</p>
              </div>
            )}
            {me?.phone && (
              <div className="px-3 py-2 rounded-lg bg-zinc-50">
                <p className="text-[10px] text-zinc-400 font-medium">手机</p>
                <p className="text-xs text-zinc-700 mt-0.5">{me.phone}</p>
              </div>
            )}
          </div>
        </div>

        {/* Sessions */}
        <div className="px-6 pb-5">
          <p className="text-xs font-semibold text-zinc-500 mb-2">登录设备</p>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {sessions.map((s) => {
              const { device, icon: Icon } = parseUA(s.user_agent);
              return (
                <div
                  key={s.jti}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg",
                    s.is_current ? "bg-emerald-50 border border-emerald-100" : "bg-zinc-50"
                  )}
                >
                  <Icon size={16} weight="bold" className={s.is_current ? "text-emerald-600" : "text-zinc-400"} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-700">
                      {device}
                      {s.is_current && <span className="ml-1.5 text-emerald-600 text-[10px]">当前</span>}
                    </p>
                    <p className="text-[10px] text-zinc-400 truncate">
                      {s.ip && `${s.ip} · `}{formatSessionTime(s.created_at)}
                    </p>
                  </div>
                  {!s.is_current && (
                    <button
                      onClick={() => handleRevoke(s.jti)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="踢出该设备"
                    >
                      <SignOut size={14} weight="bold" />
                    </button>
                  )}
                </div>
              );
            })}
            {sessions.length === 0 && (
              <p className="text-xs text-zinc-400 py-2 text-center">暂无会话记录</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
