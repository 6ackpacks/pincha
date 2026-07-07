"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartBar,
  VideoCamera,
  Sparkle,
  ShieldCheck,
  TrendUp,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getMe, type CurrentUser } from "@/lib/api";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin/dashboard", icon: ChartBar, label: "Dashboard" },
  { href: "/admin/trending", icon: TrendUp, label: "热门管理" },
  { href: "/admin/videos", icon: VideoCamera, label: "视频管理" },
  { href: "/admin/curate", icon: Sparkle, label: "Curate 管理" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const { data: me } = useQuery<CurrentUser>({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 30 * 60 * 1000,
  });

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
                alt={me.nickname ?? "本地模式"}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300">
                {(me?.nickname ?? "本")[0].toUpperCase()}
              </div>
            )}
            <span className="flex-1 text-xs text-zinc-300 truncate">
              {me?.nickname ?? "本地模式"}
            </span>
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
