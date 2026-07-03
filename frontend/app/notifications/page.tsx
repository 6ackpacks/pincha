"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { Bell, CheckCircle, Circle, ArrowLeft, Checks, CaretDown, CaretRight, ArrowSquareOut } from "@phosphor-icons/react";
import { getNotifications, markNotificationRead, markAllNotificationsRead, type NotificationItem } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { cn, stripMarkdown } from "@/lib/utils";
import { processingQueueAtom, removeFromQueueAtom, type QueueItem } from "@/atoms/queue";

// 防御式交叉类型：与并行 Agent D 解耦。
// 即使 Agent D 给 NotificationItem 增加可选字段（notif_type/title/body/action_url，pick 可为 null），
// 本文件也能独立编译。所有新增字段都是可选，访问时用 ?.。
type NotifItem = NotificationItem & {
  notif_type?: string;
  title?: string | null;
  body?: string | null;
  action_url?: string | null;
};

const QUEUE_GROUP_KEY = "__queue_done__";

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

function groupByDate(items: NotifItem[]) {
  const groups: { key: string; label: string; items: NotifItem[] }[] = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const todayItems: NotifItem[] = [];
  const yesterdayItems: NotifItem[] = [];
  const earlierItems: NotifItem[] = [];

  for (const item of items) {
    const d = new Date(item.created_at);
    const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (itemDate.getTime() === today.getTime()) {
      todayItems.push(item);
    } else if (itemDate.getTime() === yesterday.getTime()) {
      yesterdayItems.push(item);
    } else {
      earlierItems.push(item);
    }
  }

  if (todayItems.length > 0) groups.push({ key: "today", label: "今天", items: todayItems });
  if (yesterdayItems.length > 0) groups.push({ key: "yesterday", label: "昨天", items: yesterdayItems });
  if (earlierItems.length > 0) groups.push({ key: "earlier", label: "更早", items: earlierItems });
  return groups;
}

function NotificationCard({ item, onMarkRead }: { item: NotifItem; onMarkRead: (id: number) => void }) {
  const handleClick = () => {
    if (!item.is_read) onMarkRead(item.id);
    // 优先使用 pick.original_url（站外新标签），否则退回 action_url（Agent D 持久化通知）
    const url = item.pick?.original_url ?? item.action_url ?? null;
    const title = item.pick ? stripMarkdown(item.pick.title) : item.title ?? "通知";
    if (url) {
      toast.info(`正在打开：${title}`);
      window.open(url, "_blank");
    } else if (item.title) {
      // 有标题但无 URL：仅标记已读，给一个轻反馈
      toast.info(title);
    }
  };

  // 渲染卡片正文：pick 存在走精选卡片；否则若有 title 走通用卡片（Agent D 持久化通知）。
  const body = item.pick ? (
    <>
      <p className={cn(
        "text-sm line-clamp-2 leading-relaxed",
        item.is_read ? "text-zinc-500" : "text-zinc-900 font-medium"
      )}>
        {stripMarkdown(item.pick.title)}
      </p>
      {item.pick.summary && (
        <p className="text-xs text-zinc-400 line-clamp-1 mt-1">{item.pick.summary}</p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        {item.pick.author_name && (
          <span className="text-[11px] text-zinc-400 font-medium">{item.pick.author_name}</span>
        )}
        <span className="text-[11px] text-zinc-300">{formatTime(item.created_at)}</span>
      </div>
    </>
  ) : item.title ? (
    <>
      <p className={cn(
        "text-sm line-clamp-2 leading-relaxed",
        item.is_read ? "text-zinc-500" : "text-zinc-900 font-medium"
      )}>
        {item.title}
      </p>
      {item.body && (
        <p className="text-xs text-zinc-400 line-clamp-2 mt-1">{item.body}</p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[11px] text-zinc-300">{formatTime(item.created_at)}</span>
      </div>
    </>
  ) : (
    <p className="text-sm text-zinc-400 italic">内容已删除</p>
  );

  const typeLabel = item.pick ? "每日精选" : item.notif_type === "organize_done" ? "整理完成" : "通知";

  return (
    <div
      onClick={handleClick}
      className={cn(
        "group flex gap-3 px-4 py-3.5 rounded-xl cursor-pointer border transition-all duration-150",
        item.is_read
          ? "bg-white border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50"
          : "bg-red-50/70 hover:bg-red-100/60 border-red-100"
      )}
    >
      <div className="shrink-0 mt-0.5">
        {item.is_read ? (
          <CheckCircle size={16} weight="bold" className="text-zinc-300" />
        ) : (
          <Circle size={8} weight="fill" className="text-red-500 mt-1" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            item.is_read ? "bg-zinc-100 text-zinc-400" : "bg-white text-red-600"
          )}>
            {typeLabel}
          </span>
          {(item.pick?.original_url || item.action_url) && (
            <ArrowSquareOut size={12} weight="bold" className="ml-auto text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
        {body}
      </div>
    </div>
  );
}

function getQueueItemPath(item: QueueItem) {
  if (item.type === "video") return `/videos/${item.id}`;
  if (item.type === "article") return `/articles/${item.id}`;
  return "/knowledge";
}

function QueueNotificationCard({ item, onOpen }: { item: QueueItem; onOpen: (item: QueueItem) => void }) {
  return (
    <div
      onClick={() => onOpen(item)}
      className="group flex gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-all duration-150 bg-emerald-50/60 hover:bg-emerald-100/60 border border-emerald-100"
    >
      <div className="shrink-0 mt-0.5">
        <CheckCircle size={16} weight="fill" className="text-emerald-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm line-clamp-2 leading-relaxed text-zinc-900 font-medium">
          {item.title || "内容整理完成"}
        </p>
        <p className="text-xs text-zinc-400 line-clamp-1 mt-1">整理完成，点击查看</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-zinc-400 font-medium">
            {item.type === "video" ? "视频" : item.type === "article" ? "文章" : "知识库"}
          </span>
          <span className="text-[11px] text-zinc-300">{formatTime(new Date(item.addedAt).toISOString())}</span>
        </div>
      </div>
    </div>
  );
}

interface CollapsibleGroupProps {
  groupKey: string;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}

function CollapsibleGroup({ groupKey, label, count, expanded, onToggle, children }: CollapsibleGroupProps) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(groupKey)}
        className="w-full flex items-center gap-1.5 mb-2 px-1 py-1 group/header transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <CaretDown size={12} weight="bold" className="text-zinc-400" />
        ) : (
          <CaretRight size={12} weight="bold" className="text-zinc-400" />
        )}
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
          {label}
        </h3>
        <span className="text-[11px] text-zinc-400 font-normal">· {count} 条</span>
      </button>
      {expanded && <div className="flex flex-col gap-1">{children}</div>}
    </div>
  );
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const queue = useAtomValue(processingQueueAtom);
  const removeQueueItem = useSetAtom(removeFromQueueAtom);
  const markedOnViewRef = useRef(false);

  const { data: notifications, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getNotifications({ limit: 100 }),
  });

  const handleMarkRead = async (id: number) => {
    queryClient.setQueryData<NotifItem[]>(["notifications"], (old) =>
      old?.map((item) => item.id === id ? { ...item, is_read: true } : item)
    );
    await markNotificationRead(id);
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
  };

  const handleMarkAllRead = async () => {
    queryClient.setQueryData<NotifItem[]>(["notifications"], (old) =>
      old?.map((item) => ({ ...item, is_read: true }))
    );
    queryClient.setQueryData(["curate-v2-unread-count"], { count: 0 });
    await markAllNotificationsRead();
    completedQueueItems.forEach((item) => removeQueueItem(item.id, item.type));
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
  };

  const completedQueueItems = queue.filter((item) => item.state === "done");
  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;
  const groups = useMemo(() => groupByDate(notifications ?? []), [notifications]);
  const hasItems = completedQueueItems.length > 0 || (notifications && notifications.length > 0);

  useEffect(() => {
    if (markedOnViewRef.current || !notifications?.some((item) => !item.is_read)) return;
    markedOnViewRef.current = true;
    queryClient.setQueryData<NotifItem[]>(["notifications"], (old) =>
      old?.map((item) => ({ ...item, is_read: true }))
    );
    queryClient.setQueryData(["curate-v2-unread-count"], { count: 0 });
    markAllNotificationsRead()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
      })
      .catch(() => {
        markedOnViewRef.current = false;
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
      });
  }, [notifications, queryClient]);

  // 默认全部展开，避免入口有角标但页面首屏看起来没有内容。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>([QUEUE_GROUP_KEY, "today", "yesterday", "earlier"]));
  const toggleGroup = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleOpenQueueItem = (item: QueueItem) => {
    toast.info(`正在打开：${item.title || "内容整理完成"}`);
    removeQueueItem(item.id, item.type);
    router.push(getQueueItemPath(item));
  };

  return (
    <div className="flex h-screen bg-[#F7F7F5] overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-hidden">
        {/* Header：sticky 固定在顶部 */}
        <div className="sticky top-0 z-10 border-b border-zinc-200/70 bg-[#F7F7F5]/85 backdrop-blur-sm">
          <div className="mx-auto flex h-[68px] w-full max-w-[860px] items-center justify-between px-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="p-1.5 rounded-lg hover:bg-white text-zinc-400 hover:text-zinc-700 transition-colors"
                aria-label="返回"
              >
                <ArrowLeft size={18} weight="bold" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-zinc-900">通知</h1>
                <p className="mt-0.5 text-xs text-zinc-400">
                  每日精选和内容整理进度都会汇总在这里
                </p>
              </div>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-semibold">
                  {unreadCount} 条未读
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-white transition-colors"
              >
                <Checks size={14} weight="bold" />
                全部已读
              </button>
            )}
          </div>
        </div>

        {/* 可滚轮滚动的内容区域 */}
        <div className="h-[calc(100vh-68px)] overflow-y-auto">
          <div className="mx-auto w-full max-w-[860px] px-6 py-7">
          {isLoading ? (
            <div className="flex flex-col gap-3 py-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-zinc-100 animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-red-100 bg-white py-20 text-center">
              <Bell size={42} weight="light" className="mb-4 text-red-200" />
              <p className="text-sm font-medium text-zinc-700">通知加载失败</p>
              <button
                onClick={() => refetch()}
                className="mt-4 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                重试
              </button>
            </div>
          ) : !hasItems ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-100 bg-white py-24 text-zinc-400">
              <Bell size={48} weight="light" className="mb-4 text-zinc-200" />
              <p className="text-sm font-medium">暂无通知</p>
              <p className="text-xs text-zinc-300 mt-1">订阅频道后，每日精选会推送到这里</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {completedQueueItems.length > 0 && (
                <CollapsibleGroup
                  groupKey={QUEUE_GROUP_KEY}
                  label="整理完成"
                  count={completedQueueItems.length}
                  expanded={expanded.has(QUEUE_GROUP_KEY)}
                  onToggle={toggleGroup}
                >
                  {completedQueueItems.map((item) => (
                    <QueueNotificationCard key={`${item.type}:${item.id}`} item={item} onOpen={handleOpenQueueItem} />
                  ))}
                </CollapsibleGroup>
              )}
              {groups.map((group) => (
                <CollapsibleGroup
                  key={group.key}
                  groupKey={group.key}
                  label={group.label}
                  count={group.items.length}
                  expanded={expanded.has(group.key)}
                  onToggle={toggleGroup}
                >
                  {group.items.map((item) => (
                    <NotificationCard key={item.id} item={item} onMarkRead={handleMarkRead} />
                  ))}
                </CollapsibleGroup>
              ))}
            </div>
          )}
          </div>
        </div>
      </main>
    </div>
  );
}
