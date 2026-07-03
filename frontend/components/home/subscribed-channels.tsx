"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getCurateV2Channels, getCurateV2ChannelPicks } from "@/lib/api";
import { Broadcast, ArrowRight } from "@phosphor-icons/react";
import { cn, stripMarkdown } from "@/lib/utils";
import { cdnUrl } from "@/lib/cdn";
import { motion, AnimatePresence } from "framer-motion";

const CHANNEL_IMAGES = [
  "/channel-1-ai-product-launch.webp",
  "/channel-2-ai-tutorial.webp",
  "/channel-3-ai-product-insight.webp",
  "/channel-4-ai-deep-read.webp",
  "/channel-5-ai-daily-brief.webp",
].map(cdnUrl);

function ChannelPicksOverlay({ slug }: { slug: string }) {
  const { data: picksData } = useQuery({
    queryKey: ["curate-v2-picks-preview", slug],
    queryFn: () => getCurateV2ChannelPicks(slug),
    staleTime: 10 * 60 * 1000,
  });

  const picks = picksData?.picks ?? [];

  if (!picksData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <p className="text-zinc-400 text-xs text-center pt-4">暂无内容</p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-3 overflow-hidden flex-1">
      {picks.slice(0, 6).map((item, i) => (
        <div key={item.id} className="flex items-start gap-2">
          <span className="shrink-0 w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-[9px] font-bold text-zinc-500 mt-0.5">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-zinc-700 font-medium line-clamp-1">
              {stripMarkdown(item.title)}
            </p>
            {item.summary && (
              <p className="text-[10px] text-zinc-400 line-clamp-1 hidden xl:block">{item.summary}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SubscribedChannels() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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
        <div className="grid grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-[3/2] rounded-2xl bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div
          className="grid grid-cols-5 gap-3"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {channels.slice(0, 5).map((cat, i) => (
            <Link
              key={cat.id}
              href={`/curate/${cat.slug}`}
              className="relative block"
              onMouseEnter={() => setHoveredIndex(i)}
            >
              <div className={cn(
                "aspect-[3/2] overflow-hidden rounded-2xl",
                "transition-all duration-200 ease-out",
                hoveredIndex === i && "scale-[1.03] shadow-xl"
              )}>
                <img
                  src={CHANNEL_IMAGES[i % CHANNEL_IMAGES.length]}
                  alt={cat.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover block"
                />
                <AnimatePresence>
                  {hoveredIndex === i && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="absolute inset-0 bg-white/90 backdrop-blur-sm rounded-2xl flex flex-col"
                    >
                      <div className="px-3 pt-2.5 pb-1">
                        <p className="text-xs font-bold text-zinc-700">{cat.name}</p>
                      </div>
                      <ChannelPicksOverlay slug={cat.slug} />
                      <div className="px-3 pb-2 mt-auto">
                        <span className="text-[10px] text-zinc-400 font-medium">
                          点击查看全部 →
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
