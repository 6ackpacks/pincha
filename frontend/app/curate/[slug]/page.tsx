"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Sidebar } from "@/components/layout/sidebar";
import {
  getCurateV2Channels,
  getCurateV2ChannelPicks,
  subscribeCurateV2Channel,
  unsubscribeCurateV2Channel,
  triggerDeepAnalyze,
  getMe,
} from "@/lib/api";
import { PickCard } from "@/components/curate/pick-card";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bell,
  BellSlash,
  CalendarBlank,
  CircleNotch,
  Sparkle,
  EnvelopeSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

function getRecentDates(count: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  const today = new Date().toISOString().split("T")[0];
  if (iso === today) return "今天";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === yesterday.toISOString().split("T")[0]) return "昨天";
  return `${parseInt(m)}/${parseInt(d)}`;
}

export default function ChannelDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string>(
    getRecentDates(1)[0]
  );
  const [showSubscribeDialog, setShowSubscribeDialog] = useState(false);
  const [showUnsubscribeDialog, setShowUnsubscribeDialog] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  const { data: channelsData } = useQuery({
    queryKey: ["curate-v2-channels"],
    queryFn: getCurateV2Channels,
    staleTime: 10 * 60 * 1000,
  });

  const channel = channelsData?.find((c) => c.slug === slug);

  const { data: picksData, isLoading } = useQuery({
    queryKey: ["curate-v2-picks", slug, selectedDate],
    queryFn: () => getCurateV2ChannelPicks(slug, selectedDate),
    staleTime: 5 * 60 * 1000,
  });

  const picks = picksData?.picks ?? [];

  const subscribeMut = useMutation({
    mutationFn: ({
      emailEnabled,
      emailAddress,
    }: {
      emailEnabled: boolean;
      emailAddress?: string;
    }) => subscribeCurateV2Channel(channel!.id, emailEnabled, emailAddress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curate-v2-channels"] });
      setShowSubscribeDialog(false);
      setEmailEnabled(false);
      setEmailAddress("");
    },
  });

  const unsubscribeMut = useMutation({
    mutationFn: () => unsubscribeCurateV2Channel(channel!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curate-v2-channels"] });
      setShowUnsubscribeDialog(false);
    },
  });

  const deepAnalyzeMut = useMutation({
    mutationFn: triggerDeepAnalyze,
  });

  const recentDates = getRecentDates(14);

  const handleSubscribeClick = () => {
    if (me?.email) {
      setEmailAddress(me.email);
    }
    setShowSubscribeDialog(true);
  };

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 min-h-0 overflow-y-auto bg-white">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-zinc-100">
          <div className="max-w-4xl mx-auto px-8 py-4 flex items-center gap-4">
            <Link
              href="/curate"
              className="p-2 rounded-lg hover:bg-zinc-100 transition-colors"
            >
              <ArrowLeft size={18} weight="bold" className="text-zinc-500" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-zinc-900">
                {channel?.name || slug}
              </h1>
              {channel?.description && (
                <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">
                  {channel.description}
                </p>
              )}
            </div>

            {/* Subscribe button */}
            {channel && (
              <div>
                {channel.is_subscribed ? (
                  <button
                    onClick={() => setShowUnsubscribeDialog(true)}
                    disabled={unsubscribeMut.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-zinc-200 text-zinc-500 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
                  >
                    <BellSlash size={12} weight="bold" />
                    已订阅
                  </button>
                ) : (
                  <button
                    onClick={handleSubscribeClick}
                    disabled={subscribeMut.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    <Bell size={12} weight="bold" />
                    订阅
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Date selector */}
          <div className="max-w-4xl mx-auto px-8 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            <CalendarBlank
              size={14}
              className="text-zinc-400 shrink-0"
            />
            {recentDates.map((date) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  selectedDate === date
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                )}
              >
                {formatDateShort(date)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-4xl mx-auto px-8 py-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <CircleNotch
                size={24}
                className="animate-spin text-zinc-300"
              />
            </div>
          ) : picks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Sparkle size={28} weight="bold" className="text-zinc-200 mb-2" />
              <p className="text-sm font-medium text-zinc-500">
                这天还没有新的线索
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                试试选择其他日期
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {picks.map((pick, i) => (
                <PickCard
                  key={pick.id}
                  pick={pick}
                  index={i}
                  onDeepAnalyze={(pickId) => deepAnalyzeMut.mutateAsync(pickId)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Subscribe Dialog */}
      <Dialog open={showSubscribeDialog} onOpenChange={setShowSubscribeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>订阅「{channel?.name}」</DialogTitle>
            <DialogDescription>
              订阅后将自动开启站内通知，每日线索会送到你的书房。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div>
                <span className="text-sm font-medium text-zinc-700 flex items-center gap-1.5">
                  <EnvelopeSimple size={14} weight="bold" />
                  同时开启邮件通知
                </span>
                <p className="text-xs text-zinc-400 mt-0.5">
                  每日线索将发送到你的邮箱
                </p>
              </div>
            </label>
            {emailEnabled && (
              <div className="pl-7">
                <label className="block text-xs font-medium text-zinc-600 mb-1">
                  通知邮箱
                </label>
                <input
                  type="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
                {!emailAddress && (
                  <p className="text-[11px] text-amber-500 mt-1 flex items-center gap-1">
                    <WarningCircle size={11} weight="bold" />
                    请填写邮箱地址以接收邮件通知
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              onClick={() => setShowSubscribeDialog(false)}
              className="px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => subscribeMut.mutate({ emailEnabled, emailAddress: emailEnabled ? emailAddress : undefined })}
              disabled={subscribeMut.isPending || (emailEnabled && !emailAddress)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {subscribeMut.isPending ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Bell size={14} weight="bold" />
              )}
              开始订阅
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsubscribe Confirmation Dialog */}
      <Dialog open={showUnsubscribeDialog} onOpenChange={setShowUnsubscribeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消订阅</DialogTitle>
            <DialogDescription>
              确定要取消订阅「{channel?.name}」吗？取消后将不再收到这个频道的新线索。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setShowUnsubscribeDialog(false)}
              className="px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              再想想
            </button>
            <button
              onClick={() => unsubscribeMut.mutate()}
              disabled={unsubscribeMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {unsubscribeMut.isPending ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <BellSlash size={14} weight="bold" />
              )}
              确认取消
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
