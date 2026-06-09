"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { Sidebar } from "@/components/layout/sidebar";
import {
  getCurateV2Channels,
  getCurateV2ChannelPicks,
  subscribeCurateV2Channel,
  unsubscribeCurateV2Channel,
  triggerDeepAnalyze,
  type CurateV2Channel,
  type CurateV2Pick,
} from "@/lib/api/curate";
import { getMe } from "@/lib/api/auth";
import { cn, stripMarkdown } from "@/lib/utils";
import {
  ArrowsClockwise,
  Bell,
  BellSlash,
  CalendarBlank,
  CircleNotch,
  Sparkle,
  CaretRight,
  CheckCircle,
  EnvelopeSimple,
  WarningCircle,
  SealCheck,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNEL_IMAGES = [
  "/channel-1-ai-product-launch.png",
  "/channel-2-ai-tutorial.png",
  "/channel-3-ai-product-insight.png",
  "/channel-4-ai-deep-read.png",
  "/channel-5-ai-daily-brief.png",
];

function getRecentDates(count: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const beijing = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    dates.push(beijing.toISOString().split("T")[0]);
  }
  return dates;
}

function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  const now = new Date();
  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = beijingNow.toISOString().split("T")[0];
  if (iso === today) return "今天";
  const yesterday = new Date(now.getTime() + 8 * 60 * 60 * 1000 - 86400000);
  if (iso === yesterday.toISOString().split("T")[0]) return "昨天";
  return `${parseInt(m)}/${parseInt(d)}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CuratePage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialSlug = searchParams.get("channel");
  const initialDate = searchParams.get("date");

  const [activeSlug, setActiveSlug] = useState<string | null>(initialSlug);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || getRecentDates(1)[0]);
  const [subscribeTarget, setSubscribeTarget] = useState<CurateV2Channel | null>(null);
  const [unsubscribeTarget, setUnsubscribeTarget] = useState<CurateV2Channel | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  const { data: channels = [], isLoading: catLoading, refetch } = useQuery({
    queryKey: ["curate-v2-channels"],
    queryFn: getCurateV2Channels,
  });

  const currentSlug = activeSlug ?? channels[0]?.slug ?? null;
  const activeChannel = channels.find((c) => c.slug === currentSlug);

  const { data: picksData, isLoading: picksLoading } = useQuery({
    queryKey: ["curate-v2-picks", currentSlug, selectedDate],
    queryFn: () => getCurateV2ChannelPicks(currentSlug!, selectedDate),
    enabled: !!currentSlug,
    staleTime: 5 * 60 * 1000,
  });

  const picks = picksData?.picks ?? [];

  const subscribeMut = useMutation({
    mutationFn: ({ channelId, emailEnabled, emailAddress }: { channelId: number; emailEnabled: boolean; emailAddress?: string }) =>
      subscribeCurateV2Channel(channelId, emailEnabled, emailAddress),
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

  const deepAnalyzeMut = useMutation({
    mutationFn: triggerDeepAnalyze,
  });

  const recentDates = getRecentDates(14);

  const handleSubscribeClick = (channel: CurateV2Channel) => {
    setSubscribeTarget(channel);
    if (me?.email) setEmailAddress(me.email);
  };

  const handleChannelChange = (slug: string) => {
    setActiveSlug(slug);
    const today = getRecentDates(1)[0];
    setSelectedDate(today);
    const params = new URLSearchParams();
    params.set("channel", slug);
    params.set("date", today);
    router.replace(`/curate?${params.toString()}`, { scroll: false });
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    const params = new URLSearchParams();
    if (currentSlug) params.set("channel", currentSlug);
    params.set("date", date);
    router.replace(`/curate?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 min-h-0 overflow-y-auto bg-white">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900">猹选</h1>
              <p className="text-sm text-zinc-500 mt-1">
                每天替你筛出值得细读的内容线索
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              <ArrowsClockwise size={12} weight="bold" />
              刷新
            </button>
          </div>

          {/* Channel tabs (mascot image cards) */}
          {catLoading ? (
            <div className="grid grid-cols-5 gap-3 mb-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-zinc-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-3 mb-6">
              {channels.map((channel, i) => {
                const isActive = channel.slug === currentSlug;
                return (
                  <button
                    key={channel.id}
                    onClick={() => handleChannelChange(channel.slug)}
                    className={cn(
                      "relative h-24 rounded-xl overflow-hidden p-3 flex flex-col justify-end text-left transition-all duration-200 border",
                      isActive
                        ? "border-zinc-900 shadow-lg scale-[1.02] bg-white"
                        : "border-zinc-100 bg-white opacity-75 hover:opacity-100 hover:shadow-md"
                    )}
                  >
                    <img
                      src={CHANNEL_IMAGES[i % CHANNEL_IMAGES.length]}
                      alt=""
                      className={cn(
                        "absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-200",
                        isActive ? "opacity-80" : "opacity-80"
                      )}
                    />
                    <div className="relative z-10 flex items-center gap-1.5">
                      <p className="text-white font-bold text-xs leading-tight drop-shadow-sm">{channel.name}</p>
                      {channel.is_subscribed && (
                        <CheckCircle size={12} weight="fill" className="text-emerald-300 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Active channel header + subscribe */}
          {activeChannel && (
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Link href={`/curate/${activeChannel.slug}`} className="group">
                  <h2 className="text-lg font-bold text-zinc-900 group-hover:text-emerald-600 transition-colors">
                    {activeChannel.name}
                  </h2>
                </Link>
                <span className="text-xs text-zinc-400 font-medium">
                  每日 {activeChannel.pick_count} 条线索
                </span>
                <Link
                  href={`/curate/${activeChannel.slug}`}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  查看全部 →
                </Link>
              </div>
              <div className="flex items-center gap-2">
                {activeChannel.is_subscribed ? (
                  <button
                    onClick={() => setUnsubscribeTarget(activeChannel)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-zinc-200 text-zinc-500 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
                  >
                    <BellSlash size={12} weight="bold" />
                    已订阅
                  </button>
                ) : (
                  <button
                    onClick={() => handleSubscribeClick(activeChannel)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    <Bell size={12} weight="bold" />
                    订阅
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Date selector */}
          {currentSlug && (
            <div className="flex items-center gap-2 mb-5 overflow-x-auto scrollbar-hide">
              <CalendarBlank size={14} weight="bold" className="text-zinc-400 shrink-0" />
              {recentDates.map((date) => (
                <button
                  key={date}
                  onClick={() => handleDateChange(date)}
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
          )}

          {/* Feed list */}
          {currentSlug && (
            <div>
              {picksLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-20 rounded-xl bg-zinc-50 animate-pulse" />
                  ))}
                </div>
              ) : picks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Sparkle size={24} weight="bold" className="text-zinc-200 mb-2" />
                  <p className="text-sm font-semibold text-zinc-500">这天还没有新的线索</p>
                  <p className="text-xs text-zinc-400 mt-1">试试选择其他日期</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {picks.map((pick, i) => (
                    <ArticleRow
                      key={pick.id}
                      pick={pick}
                      rank={i + 1}
                      onDeepAnalyze={() => deepAnalyzeMut.mutateAsync(pick.id)}
                    />
                  ))}
                </div>
              )}
            </div>
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
                <p className="text-xs text-zinc-400 mt-0.5">每日线索将发送到你的邮箱</p>
              </div>
            </label>
            {emailEnabled && (
              <div className="pl-7">
                <label className="block text-xs font-medium text-zinc-600 mb-1">通知邮箱</label>
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
              onClick={() => {
                if (!subscribeTarget) return;
                subscribeMut.mutate({ channelId: subscribeTarget.id, emailEnabled, emailAddress: emailEnabled ? emailAddress : undefined });
              }}
              disabled={subscribeMut.isPending || (emailEnabled && !emailAddress)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {subscribeMut.isPending ? <CircleNotch size={14} className="animate-spin" /> : <Bell size={14} weight="bold" />}
              开始订阅
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsubscribe Dialog */}
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
              {unsubscribeMut.isPending ? <CircleNotch size={14} className="animate-spin" /> : <BellSlash size={14} weight="bold" />}
              确认取消
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Article Row (ranked list item style from v1)
// ---------------------------------------------------------------------------

function ArticleRow({ pick, rank, onDeepAnalyze }: { pick: CurateV2Pick; rank: number; onDeepAnalyze: () => Promise<unknown> }) {
  const [analyzeState, setAnalyzeState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const isProduct = pick.source_type === "product";

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (analyzeState === "loading") return;
    setAnalyzeState("loading");
    try {
      await onDeepAnalyze();
      setAnalyzeState("success");
      setTimeout(() => setAnalyzeState("idle"), 3000);
    } catch {
      setAnalyzeState("error");
      setTimeout(() => setAnalyzeState("idle"), 3000);
    }
  };

  return (
    <Link href={`/curate/preview/${pick.id}`} className="block">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: rank * 0.03 }}
        className="flex items-start gap-4 p-4 rounded-xl border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50/50 transition-all group cursor-pointer"
      >
        {/* Rank or Product Avatar */}
        {isProduct && pick.author_avatar ? (
          <img
            src={pick.author_avatar}
            alt={pick.title}
            className="shrink-0 w-10 h-10 rounded-xl object-cover border border-zinc-100"
          />
        ) : (
          <span
            className={cn(
              "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
              rank <= 3 ? "bg-amber-100 text-amber-600" : "bg-zinc-100 text-zinc-400"
            )}
          >
            {rank}
          </span>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-800 line-clamp-1 group-hover:text-emerald-600 transition-colors">
            {stripMarkdown(pick.title)}
            {pick.is_official && (
              <SealCheck size={12} weight="fill" className="inline ml-1.5 text-blue-500" />
            )}
          </h3>
          {pick.summary && (
            <p className="text-xs text-zinc-500 line-clamp-2 mt-1 leading-relaxed">{pick.summary}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {pick.author_name && (
              <div className="flex items-center gap-1.5">
                {!isProduct && (pick.author_avatar ? (
                  <img src={pick.author_avatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full bg-zinc-200" />
                ))}
                <span className="text-[10px] text-zinc-500">
                  {isProduct ? `by ${pick.author_name}` : pick.author_name}
                </span>
              </div>
            )}
            {pick.published_at && (
              <span className="text-[10px] text-zinc-400">
                {new Date(pick.published_at).toLocaleDateString("zh-CN")}
              </span>
            )}
          </div>
        </div>

        {/* Right side: action button or arrow */}
        {!isProduct ? (
          <button
            onClick={handleAnalyze}
            disabled={analyzeState === "loading" || analyzeState === "success"}
            className={cn(
              "shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors opacity-0 group-hover:opacity-100",
              analyzeState === "success"
                ? "text-emerald-600 bg-emerald-50 opacity-100"
                : analyzeState === "error"
                  ? "text-red-600 bg-red-50 opacity-100"
                  : "text-emerald-600 hover:bg-emerald-50"
            )}
          >
            {analyzeState === "loading" ? (
              <CircleNotch size={12} className="animate-spin" />
            ) : analyzeState === "success" ? (
              <><CheckCircle size={12} weight="bold" />已提交</>
            ) : (
              <><Sparkle size={12} weight="bold" />收进知识库</>
            )}
          </button>
        ) : null}

        {/* Arrow indicator on hover */}
        <CaretRight
          size={14}
          weight="bold"
          className="shrink-0 text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity self-center"
        />
      </motion.div>
    </Link>
  );
}
