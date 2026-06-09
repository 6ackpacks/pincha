"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle, Circle, ArrowLeft } from "@phosphor-icons/react";
import { getNotifications, markNotificationRead, markAllNotificationsRead, type NotificationItem } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { cn, stripMarkdown } from "@/lib/utils";

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function NotificationCard({ item, onMarkRead }: { item: NotificationItem; onMarkRead: (id: number) => void }) {
  const router = useRouter();

  const handleClick = () => {
    if (!item.is_read) onMarkRead(item.id);
    if (item.pick?.original_url) {
      window.open(item.pick.original_url, "_blank");
    }
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "flex gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors",
        item.is_read ? "bg-white hover:bg-zinc-50" : "bg-emerald-50/50 hover:bg-emerald-50"
      )}
    >
      <div className="shrink-0 mt-0.5">
        {item.is_read ? (
          <CheckCircle size={16} weight="bold" className="text-zinc-300" />
        ) : (
          <Circle size={16} weight="fill" className="text-emerald-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        {item.pick ? (
          <>
            <p className={cn("text-sm line-clamp-2", item.is_read ? "text-zinc-600" : "text-zinc-900 font-medium")}>
              {stripMarkdown(item.pick.title)}
            </p>
            {item.pick.summary && (
              <p className="text-xs text-zinc-400 line-clamp-1 mt-0.5">{item.pick.summary}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              {item.pick.author_name && (
                <span className="text-[11px] text-zinc-400">{item.pick.author_name}</span>
              )}
              <span className="text-[11px] text-zinc-300">{formatTime(item.created_at)}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">通知内容已删除</p>
        )}
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getNotifications({ limit: 100 }),
  });

  const handleMarkRead = async (id: number) => {
    await markNotificationRead(id);
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
  };

  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;

  return (
    <div className="flex min-h-screen bg-zinc-50/50">
      <Sidebar />
      <main className="flex-1 px-8 py-6 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors">
              <ArrowLeft size={18} weight="bold" />
            </button>
            <h1 className="text-xl font-bold text-zinc-900">通知</h1>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-medium">
                {unreadCount} 条未读
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              全部标为已读
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-500 rounded-full animate-spin" />
          </div>
        ) : !notifications || notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <Bell size={40} weight="light" className="mb-3" />
            <p className="text-sm">暂无通知</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {notifications.map((item) => (
              <NotificationCard key={item.id} item={item} onMarkRead={handleMarkRead} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
