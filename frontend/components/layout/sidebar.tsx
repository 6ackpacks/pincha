"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Database, SignOut, Books, Sparkle, CaretLeft, CaretRight, UserCircle, Bell } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { getMe, logout, getCurateV2UnreadCount } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cdnUrl } from "@/lib/cdn";
import { sidebarCollapsedAtom } from "@/atoms/sidebar";

const NAV_ITEMS = [
  { href: "/", icon: House, label: "首页" },
  { href: "/curate", icon: Sparkle, label: "猹选" },
  { href: "/knowledge", icon: Database, label: "知识库" },
  { href: "/library", icon: Books, label: "书房" },
];

function DefaultAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-200/80",
        className
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.95),rgba(226,232,240,0.92)_38%,rgba(203,213,225,0.96)_100%)] blur-[1px]" />
      <UserCircle size={18} weight="bold" className="relative text-zinc-400/85" />
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });
  const { data: unreadData } = useQuery({
    queryKey: ["curate-v2-unread-count"],
    queryFn: getCurateV2UnreadCount,
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });
  const unreadCount = unreadData?.count ?? 0;
  const notificationCount = unreadCount;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // Ignore network errors here; we still clear client state and move to login.
    } finally {
      queryClient.removeQueries({ queryKey: ["me"], exact: true });
      queryClient.removeQueries({ queryKey: ["sessions"], exact: true });
      if (typeof window !== "undefined") {
        window.location.replace("/login");
      }
    }
  };

  return (
    <aside
      className={cn(
        "h-screen flex flex-col sticky top-0 bg-white border-r border-zinc-100 transition-all duration-200 shrink-0",
        collapsed ? "w-[56px] min-w-[56px]" : "w-[170px] min-w-[170px]"
      )}
    >
      {/* Logo */}
      <div className={cn("border-b border-zinc-100 shrink-0", collapsed ? "px-2 pt-4 pb-3" : "pl-3 pr-4 pt-5 pb-4")}>
        <Link href="/" className={cn("flex items-center", collapsed ? "justify-center" : "")}>
          <img
            src={cdnUrl("/brand/pincha-script.svg")}
            alt="Pincha"
            className={cn("shrink-0 object-contain", collapsed ? "h-9 w-10" : "h-16 w-[148px] object-left")}
          />
        </Link>
      </div>

      {/* Nav */}
      <nav className={cn("py-3 flex flex-col gap-0.5 shrink-0", collapsed ? "px-1.5" : "px-3")}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative flex items-center rounded-xl transition-all duration-150",
                collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2",
                active
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-zinc-900 rounded-full" />
              )}
              <Icon
                size={18}
                weight="bold"
                className={cn("shrink-0", active ? "text-zinc-900" : "text-zinc-400")}
              />
              {!collapsed && (
                <span className={cn("flex-1 text-sm", active ? "font-semibold" : "font-normal")}>
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className={cn("shrink-0 flex items-center border-b border-zinc-100", collapsed ? "justify-center px-1.5 py-2" : "justify-end px-3 py-2")}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <CaretRight size={16} weight="bold" /> : <CaretLeft size={16} weight="bold" />}
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User */}
      <div className={cn("border-t border-zinc-100 shrink-0", collapsed ? "px-1.5 py-3" : "px-3 py-3")}>
        {!me ? (
          <Link
            href="/login"
            prefetch={false}
            title="立即登录"
            className={cn(
              "group flex items-center rounded-xl transition-all duration-150",
              collapsed ? "justify-center px-0 py-1.5" : "gap-2.5 px-2.5 py-2 hover:bg-zinc-50 border border-zinc-100"
            )}
          >
            <DefaultAvatar className={collapsed ? "w-7 h-7" : "w-8 h-8 shrink-0"} />
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                  <span>立即登录</span>
                  <UserCircle size={13} weight="bold" className="text-zinc-400" />
                </div>
                <div className="text-[10px] text-zinc-400">登录后同步你的内容</div>
              </div>
            )}
          </Link>
        ) : (
          <div className={cn("flex items-center gap-2.5 rounded-xl", collapsed ? "justify-center px-0 py-1.5" : "px-2.5 py-2 border border-zinc-100 bg-zinc-50")}>
            <div className="group/avatar relative shrink-0">
              {/* 头像：仅展示，点击不跳转 */}
              <div className="relative">
                {me.avatar_url && !avatarFailed ? (
                  <img
                    src={me.avatar_url}
                    alt={me.nickname ?? "用户"}
                    className="w-7 h-7 object-cover rounded-full"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <DefaultAvatar className="w-7 h-7" />
                )}
                {notificationCount > 0 && (
                  <span className="absolute -top-1 -left-1 min-w-[14px] h-3.5 flex items-center justify-center px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold leading-none pointer-events-none shadow-sm shadow-red-500/25">
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </span>
                )}
              </div>
              {/* 悬浮通知入口：点击跳转通知页 */}
              <Link
                href="/notifications"
                title={notificationCount > 0 ? `${notificationCount} 条未读通知` : "查看通知"}
                aria-label={notificationCount > 0 ? `${notificationCount} 条未读通知` : "查看通知"}
                className="absolute left-0 bottom-full mb-2 w-44 rounded-2xl border border-red-100 bg-white p-3 text-left opacity-0 shadow-xl shadow-zinc-900/10 ring-1 ring-white/80 translate-y-1 scale-95 pointer-events-none group-hover/avatar:pointer-events-auto group-hover/avatar:opacity-100 group-hover/avatar:translate-y-0 group-hover/avatar:scale-100 transition-all duration-150 before:absolute before:left-4 before:top-full before:h-3 before:w-3 before:-translate-y-1.5 before:rotate-45 before:border-b before:border-r before:border-red-100 before:bg-white"
              >
                <div className="relative z-10 flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                    <Bell size={15} weight={notificationCount > 0 ? "fill" : "bold"} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-zinc-900">通知</p>
                      {notificationCount > 0 && (
                        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                          {notificationCount > 99 ? "99+" : notificationCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                      点击查看今日需要处理的消息
                    </p>
                  </div>
                </div>
              </Link>
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0 text-left">
                <p className="whitespace-normal break-all text-xs font-medium leading-snug text-zinc-950">
                  {me.nickname ?? "用户"}
                </p>
                <p className={cn(
                  "mt-0.5 text-[10px] font-medium text-left",
                  me.is_admin ? "text-red-500" : "text-zinc-400"
                )}>
                  {me.is_admin ? "管理员" : "个人"}
                </p>
              </div>
            )}
            {!collapsed && (
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-white transition-colors disabled:opacity-50"
                title="退出登录"
              >
                <SignOut size={14} weight="bold" />
              </button>
            )}
            {collapsed && (
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors disabled:opacity-50"
                title="退出登录"
              >
                <SignOut size={14} weight="bold" />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
