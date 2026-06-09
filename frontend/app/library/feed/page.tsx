"use client";

import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "@/components/layout/sidebar";
import {
  getCurateV2Feed,
  triggerDeepAnalyze,
  type CurateV2ChannelPicks,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CaretDown,
  CalendarBlank,
  Rss,
} from "@phosphor-icons/react";
import { useState } from "react";
import { PickCard } from "@/components/curate/pick-card";

function getDates(days: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function formatDateLabel(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "今天";
  if (dateStr === yesterday) return "昨天";
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function ChannelSection({
  channelData,
  onDeepAnalyze,
}: {
  channelData: CurateV2ChannelPicks;
  onDeepAnalyze: (pickId: number) => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(true);
  const picks = channelData.picks;

  if (picks.length === 0) return null;

  return (
    <div className="border border-zinc-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50/60 hover:bg-zinc-100/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-zinc-700">
            {channelData.channel.name}
          </span>
          <span className="text-[11px] text-zinc-400">
            {picks.length} 条内容
          </span>
        </div>
        <CaretDown
          size={13}
          weight="bold"
          className={cn(
            "text-zinc-400 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-zinc-50">
              {picks.map((pick, i) => (
                <PickCard
                  key={pick.id}
                  pick={{
                    ...pick,
                    channel_slug: channelData.channel.slug,
                    channel_name: channelData.channel.name,
                  }}
                  index={i}
                  onDeepAnalyze={(pickId) => onDeepAnalyze(pickId)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FeedPage() {
  const allDates = getDates(7);
  const [selectedDate, setSelectedDate] = useState<string>(allDates[0]);

  const { data: feedData, isLoading } = useQuery({
    queryKey: ["curate-v2-feed", selectedDate],
    queryFn: () => getCurateV2Feed(selectedDate),
  });

  const deepAnalyzeMut = useMutation({
    mutationFn: triggerDeepAnalyze,
  });

  const feedChannels = feedData?.channels ?? [];
  const hasContent = feedChannels.some((ch) => ch.picks.length > 0);

  return (
    <div className="flex h-screen bg-[#FAFAFA]">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Link
              href="/library"
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
            >
              <ArrowLeft size={13} weight="bold" className="transition-transform group-hover:-translate-x-0.5" />
              返回
            </Link>
          </div>

          <div className="flex items-center gap-2 mb-6">
            <Rss size={18} weight="bold" className="text-zinc-600" />
            <h1 className="text-lg font-bold text-zinc-900">猹选线索</h1>
          </div>

          {/* Date selector - full 7 days */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <CalendarBlank size={13} weight="bold" className="text-zinc-400" />
            <div className="flex gap-1.5 flex-wrap">
              {allDates.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    selectedDate === d
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                  )}
                >
                  {formatDateLabel(d)}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-xl bg-zinc-50 animate-pulse"
                />
              ))}
            </div>
          ) : !hasContent ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-zinc-200 rounded-xl">
              <CalendarBlank
                size={28}
                weight="bold"
                className="text-zinc-200 mb-2"
              />
              <p className="text-sm font-medium text-zinc-500">
                {formatDateLabel(selectedDate)}还没有新线索
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                试试切换其他日期
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {feedChannels
                .filter((ch) => ch.picks.length > 0)
                .map((channelData) => (
                  <ChannelSection
                    key={channelData.channel.id}
                    channelData={channelData}
                    onDeepAnalyze={(pickId) =>
                      deepAnalyzeMut.mutateAsync(pickId)
                    }
                  />
                ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
