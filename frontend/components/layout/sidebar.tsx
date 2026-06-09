"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { House, Database, SignOut, Books, Sparkle, CaretLeft, CaretRight, Bell } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { getMe, logout, getCurateV2UnreadCount } from "@/lib/api";
import { cn } from "@/lib/utils";
import { sidebarCollapsedAtom } from "@/atoms/sidebar";
import { useMarkRead } from "@/hooks/use-mark-read";

const NAV_ITEMS = [
  { href: "/", icon: House, label: "首页" },
  { href: "/curate", icon: Sparkle, label: "猹选" },
  { href: "/knowledge", icon: Database, label: "知识库" },
  { href: "/library", icon: Books, label: "书房" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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
  const { markAll } = useMarkRead();
  const unreadCount = unreadData?.count ?? 0;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
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
        <Link href="/" className={cn("flex items-center", collapsed ? "justify-center" : "gap-[2px]")}>
          <img src="/logo.svg" alt="品猹" className={cn("shrink-0", collapsed ? "w-10 h-10" : "w-16 h-16")} style={{ objectFit: "contain" }} />
          {!collapsed && <span className="font-bold text-[24px] text-zinc-900 tracking-[0.06em] whitespace-nowrap" style={{ fontFamily: "'LXGW WenKai TC', serif" }}>品猹</span>}
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
      <div className={cn("border-t border-zinc-100 shrink-0 relative", collapsed ? "px-1.5 py-3" : "px-3 py-3")} ref={menuRef}>
        {/* Avatar with unread badge */}
        <div
          className="relative cursor-pointer"
          onMouseEnter={() => setShowMenu(true)}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="relative">
                {me?.avatar_url ? (
                  <img src={me.avatar_url} alt={me.nickname ?? "用户"} className="w-7 h-7 shrink-0 object-cover rounded-full" />
                ) : (
                  <div className="w-7 h-7 flex items-center justify-center shrink-0 text-xs font-bold bg-zinc-200 rounded-full text-zinc-700">
                    {(me?.nickname ?? "U")[0].toUpperCase()}
                  </div>
                )}
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -left-1 min-w-[14px] h-3.5 flex items-center justify-center px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold leading-none">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-zinc-100 bg-zinc-50 hover:bg-zinc-100 transition-colors">
              <div className="relative">
                {me?.avatar_url ? (
                  <img src={me.avatar_url} alt={me.nickname ?? "用户"} className="w-7 h-7 shrink-0 object-cover rounded-full" />
                ) : (
                  <div className="w-7 h-7 flex items-center justify-center shrink-0 text-xs font-bold bg-zinc-200 rounded-full text-zinc-700">
                    {(me?.nickname ?? "U")[0].toUpperCase()}
                  </div>
                )}
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -left-1 min-w-[14px] h-3.5 flex items-center justify-center px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold leading-none">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-xs text-zinc-950">{me?.nickname ?? "用户"}</div>
                <div className="text-[10px] text-zinc-400">个人书房</div>
              </div>
            </div>
          )}
        </div>

        {/* Hover menu */}
        {showMenu && (
          <div
            className="absolute bottom-full left-1 mb-1 w-40 bg-white rounded-xl border border-zinc-200 shadow-lg py-1 z-50"
            onMouseLeave={() => setShowMenu(false)}
          >
            <button
              onClick={() => {
                router.push("/notifications");
                setShowMenu(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              <Bell size={14} weight={unreadCount > 0 ? "fill" : "bold"} className={unreadCount > 0 ? "text-red-500" : "text-zinc-400"} />
              <span>通知</span>
              {unreadCount > 0 && (
                <span className="ml-auto min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full bg-red-500 text-white text-[9px] font-bold">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={async () => { await logout(); router.push("/login"); setShowMenu(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <SignOut size={14} weight="bold" className="text-zinc-400" />
              <span>退出登录</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
