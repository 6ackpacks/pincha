"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sidebar } from "@/components/layout/sidebar";
import {
  getCurateV2Channels,
  subscribeCurateV2Channel,
  unsubscribeCurateV2Channel,
  getMe,
  type CurateV2Channel,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Rss,
  Bell,
  BellSlash,
  CircleNotch,
  Sparkle,
  ArrowLeft,
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

const CHANNEL_GRADIENTS = [
  "from-rose-500 to-pink-600",
  "from-orange-400 to-amber-600",
  "from-emerald-400 to-teal-600",
  "from-sky-400 to-blue-600",
  "from-violet-500 to-purple-700",
  "from-fuchsia-500 to-pink-700",
  "from-lime-400 to-green-600",
  "from-cyan-400 to-teal-500",
  "from-indigo-400 to-blue-700",
  "from-red-500 to-rose-700",
  "from-amber-400 to-orange-600",
  "from-teal-400 to-cyan-600",
  "from-blue-500 to-indigo-600",
  "from-pink-400 to-rose-600",
  "from-purple-400 to-violet-600",
];

const spring = { type: "spring" as const, stiffness: 300, damping: 24 };

export default function LibrarySubscriptionsPage() {
  const queryClient = useQueryClient();
  const [unsubscribeTarget, setUnsubscribeTarget] = useState<CurateV2Channel | null>(null);
  const [subscribeTarget, setSubscribeTarget] = useState<CurateV2Channel | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["curate-v2-channels"],
    queryFn: getCurateV2Channels,
  });

  const subscribeMut = useMutation({
    mutationFn: ({
      channelId,
      emailEnabled,
      emailAddress,
    }: {
      channelId: number;
      emailEnabled: boolean;
      emailAddress?: string;
    }) => subscribeCurateV2Channel(channelId, emailEnabled, emailAddress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curate-v2-channels"] });
      setSubscribeTarget(null);
      setEmailEnabled(false);
      setEmailAddress("");
    },
  });

  const unsubscribeMut = useMutation({
    mutationFn: (channelId: number) => unsubscribeCurateV2Channel(channelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curate-v2-channels"] });
      setUnsubscribeTarget(null);
    },
  });

  const subscribed = channels.filter((c) => c.is_subscribed);
  const available = channels.filter((c) => !c.is_subscribed);

  const handleSubscribeClick = (channel: CurateV2Channel) => {
    setSubscribeTarget(channel);
    if (me?.email) {
      setEmailAddress(me.email);
    }
  };

  const handleConfirmSubscribe = () => {
    if (!subscribeTarget) return;
    subscribeMut.mutate({
      channelId: subscribeTarget.id,
      emailEnabled,
      emailAddress: emailEnabled ? emailAddress : undefined,
    });
  };

  return (
    <div className="flex h-screen bg-[#FAFAFA]">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8 lg:p-12">
          <div className="mb-8">
            <Link
              href="/library"
              className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all mb-4"
            >
              <ArrowLeft size={14} weight="bold" className="transition-transform group-hover:-translate-x-0.5" /> 返回书房
            </Link>
            <h1 className="text-2xl font-extrabold text-zinc-950 tracking-tight">
              管理频道
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              已订阅 {subscribed.length} 个猹选频道
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-zinc-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {/* Subscribed */}
              <section className="mb-10">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-4">
                  已订阅
                </h3>
                {subscribed.length === 0 ? (
                  <p className="text-xs text-zinc-400">还没有订阅任何频道</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {subscribed.map((channel, idx) => (
                      <motion.div
                        key={channel.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ ...spring, delay: idx * 0.04 }}
                        className={cn(
                          "relative rounded-xl p-4 bg-gradient-to-br text-white overflow-hidden",
                          CHANNEL_GRADIENTS[idx % CHANNEL_GRADIENTS.length]
                        )}
                      >
                        <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10" />
                        <div className="relative z-10 flex items-start justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold truncate">{channel.name}</p>
                            {channel.description && (
                              <p className="text-[10px] text-white/70 mt-0.5 truncate">
                                {channel.description}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => setUnsubscribeTarget(channel)}
                            disabled={unsubscribeMut.isPending}
                            className="ml-2 flex-shrink-0 w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors disabled:opacity-50"
                          >
                            <BellSlash size={12} weight="bold" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </section>

              {/* Available */}
              {available.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-4">
                    发现更多
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {available.map((channel, idx) => (
                      <div
                        key={channel.id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 transition-colors"
                      >
                        <div
                          className={cn(
                            "w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center text-white",
                            CHANNEL_GRADIENTS[(subscribed.length + idx) % CHANNEL_GRADIENTS.length]
                          )}
                        >
                          <Sparkle size={14} weight="bold" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-zinc-800 truncate">{channel.name}</p>
                          {channel.description && (
                            <p className="text-[10px] text-zinc-400 truncate">{channel.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleSubscribeClick(channel)}
                          disabled={subscribeMut.isPending}
                          className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-50"
                        >
                          <span className="flex items-center gap-1">
                            <Bell size={10} weight="bold" /> 订阅
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {/* Subscribe Dialog */}
      <Dialog open={!!subscribeTarget} onOpenChange={(open) => { if (!open) setSubscribeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>订阅「{subscribeTarget?.name}」</DialogTitle>
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
              onClick={() => setSubscribeTarget(null)}
              className="px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirmSubscribe}
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
      <Dialog open={!!unsubscribeTarget} onOpenChange={(open) => { if (!open) setUnsubscribeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消订阅</DialogTitle>
            <DialogDescription>
              确定要取消订阅「{unsubscribeTarget?.name}」吗？取消后将不再收到这个频道的新线索。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setUnsubscribeTarget(null)}
              className="px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              再想想
            </button>
            <button
              onClick={() => { if (unsubscribeTarget) unsubscribeMut.mutate(unsubscribeTarget.id); }}
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
