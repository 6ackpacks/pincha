"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChartBar,
  VideoCamera,
  Sparkle,
  Users,
  SignOut,
  CircleNotch,
  ShieldCheck,
  TrendUp,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getMe, logout, type CurrentUser } from "@/lib/api";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin/dashboard", icon: ChartBar, label: "Dashboard" },
  { href: "/admin/trending", icon: TrendUp, label: "热门管理" },
  { href: "/admin/videos", icon: VideoCamera, label: "视频管理" },
  { href: "/admin/curate", icon: Sparkle, label: "Curate 管理" },
  { href: "/admin/users", icon: Users, label: "用户管理" },
];

type AuthState = "loading" | "forbidden" | "ok";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("loading");

  const { data: me, isLoading, isError } = useQuery<CurrentUser>({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    if (isLoading) return;
    if (isError || !me) {
      router.replace("/login");
      return;
    }
    if (me.is_admin === false) {
      setAuthState("forbidden");
    } else {
      setAuthState("ok");
    }
  }, [me, isLoading, isError, router]);

  if (authState === "loading" || isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <CircleNotch size={28} weight="bold" className="animate-spin text-zinc-500" />
      </div>
    );
  }

  if (authState === "forbidden") {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-zinc-950 gap-4">
        <ShieldCheck size={48} weight="bold" className="text-red-500" />
        <p className="text-zinc-300 text-sm">你没有管理员权限</p>
        <button
          onClick={() => router.replace("/")}
          className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors"
        >
          返回首页
        </button>
      </div>
    );
  }

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <div className="h-screen flex bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[200px] min-w-[200px] h-screen flex flex-col border-r border-zinc-800 bg-zinc-950">
        {/* Header */}
        <div className="px-4 py-4 border-b border-zinc-800">
          <Link href="/admin/dashboard" className="flex items-center gap-2">
            <ShieldCheck size={20} weight="bold" className="text-emerald-400" />
            <span className="font-bold text-sm text-zinc-100">品猹 Admin</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {ADMIN_NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-zinc-800 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                )}
              >
                <Icon size={16} weight={active ? "fill" : "bold"} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 px-2 py-1.5">
            {me?.avatar_url ? (
              <img
                src={me.avatar_url}
                alt={me.nickname ?? "Admin"}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300">
                {(me?.nickname ?? "A")[0].toUpperCase()}
              </div>
            )}
            <span className="flex-1 text-xs text-zinc-300 truncate">
              {me?.nickname ?? "Admin"}
            </span>
            <button
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
              title="退出登录"
              className="p-1 rounded text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <SignOut size={14} weight="bold" />
            </button>
          </div>
          <Link
            href="/"
            className="block mt-2 px-2 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← 返回前台
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
