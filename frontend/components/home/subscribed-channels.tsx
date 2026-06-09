"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getCurateV2Channels } from "@/lib/api";
import { Broadcast, ArrowRight } from "@phosphor-icons/react";
import { ChannelCard } from "@/components/home/channel-card";

export function SubscribedChannels() {
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);

  const { data: channels = [] } = useQuery({
    queryKey: ["curate-v2-channels"],
    queryFn: getCurateV2Channels,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  return (
    <section className="px-8 pt-4 pb-20">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Broadcast size={20} weight="bold" className="text-violet-500" />
          <h2 className="text-lg font-bold text-zinc-900">猹选频道</h2>
          <span className="text-sm text-zinc-400">每天替你筛出值得细读的线索</span>
        </div>
        <Link href="/curate" className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 font-medium transition-colors">
          查看全部 <ArrowRight size={14} weight="bold" />
        </Link>
      </div>
      {channels.length === 0 ? (
        <div className="flex gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 h-36 rounded-xl bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 h-[200px]" onMouseLeave={() => setHoveredChannel(null)}>
          {channels.slice(0, 5).map((cat, i) => (
            <ChannelCard
              key={cat.id}
              cat={cat}
              index={i}
              isExpanded={hoveredChannel === cat.slug}
              onHover={() => setHoveredChannel(cat.slug)}
              onLeave={() => {}}
            />
          ))}
        </div>
      )}
    </section>
  );
}
