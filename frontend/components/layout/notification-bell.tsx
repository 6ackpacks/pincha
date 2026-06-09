"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bell } from "@phosphor-icons/react";
import { getCurateV2UnreadCount } from "@/lib/api";
import { useMarkRead } from "@/hooks/use-mark-read";

/**
 * Notification bell icon with unread count badge.
 * Clicking navigates to Library (我的订阅 section) and marks all as read.
 */
export function NotificationBell() {
  const router = useRouter();
  const { markAll, isMarkingAll } = useMarkRead();

  const { data } = useQuery({
    queryKey: ["curate-v2-unread-count"],
    queryFn: getCurateV2UnreadCount,
    refetchInterval: 60 * 1000, // Poll every 60s
    staleTime: 30 * 1000,
  });

  const count = data?.count ?? 0;

  const handleClick = () => {
    if (count > 0) {
      markAll();
    }
    router.push("/library#subscriptions");
  };

  return (
    <button
      onClick={handleClick}
      disabled={isMarkingAll}
      className="relative p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
      title={count > 0 ? `${count} 条未读通知` : "无未读通知"}
      aria-label={count > 0 ? `${count} 条未读通知` : "无未读通知"}
    >
      <Bell size={18} weight={count > 0 ? "fill" : "bold"} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
