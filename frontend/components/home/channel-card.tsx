"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { CircleNotch } from "@phosphor-icons/react";
import { cn, stripMarkdown } from "@/lib/utils";
import { getCurateV2ChannelPicks, type CurateV2Channel } from "@/lib/api";

const CHANNEL_IMAGES = [
  "/channel-1-ai-product-launch.png",
  "/channel-2-ai-tutorial.png",
  "/channel-3-ai-product-insight.png",
  "/channel-4-ai-deep-read.png",
  "/channel-5-ai-daily-brief.png",
];

export function ChannelCard({ cat, index, isExpanded, onHover, onLeave }: { cat: CurateV2Channel; index: number; isExpanded: boolean; onHover: () => void; onLeave: () => void }) {
  const cardImage = CHANNEL_IMAGES[index % CHANNEL_IMAGES.length];

  const { data: picksData } = useQuery({
    queryKey: ["curate-v2-picks-preview", cat.slug],
    queryFn: () => getCurateV2ChannelPicks(cat.slug),
    staleTime: 10 * 60 * 1000,
    enabled: isExpanded,
  });

  const picks = picksData?.picks ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="min-w-0 relative"
      style={{ flex: isExpanded ? 3 : 1, transition: "flex 0.35s cubic-bezier(0.4, 0, 0.2, 1)" }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <Link href={`/curate/${cat.slug}`} className="block h-full">
        <div className={cn(
          "h-full rounded-xl overflow-hidden flex relative transition-all duration-300",
          isExpanded ? "shadow-xl shadow-black/15" : "hover:shadow-lg hover:shadow-black/10"
        )}>
          {/* Character image area */}
          <div className={cn(
            "relative transition-all duration-300 overflow-hidden shrink-0",
            isExpanded ? "w-[150px]" : "w-full"
          )}>
            <img
              src={cardImage}
              alt={cat.name}
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-all duration-300",
                isExpanded ? "object-[70%_center]" : "object-center"
              )}
            />
            {!isExpanded && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent flex flex-col justify-end p-4">
                <p className="text-white font-bold text-sm leading-tight drop-shadow-sm">{cat.name}</p>
              </div>
            )}
          </div>

          {/* Right panel: info + feed (only when expanded) */}
          {isExpanded && (
            <div className="flex-1 bg-white border-l border-zinc-100 py-3 px-4 overflow-hidden flex flex-col">
              <div className="mb-2">
                <p className="text-sm font-bold text-zinc-800">{cat.name}</p>
                {cat.description && (
                  <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{cat.description}</p>
                )}
              </div>
              {!picksData ? (
                <div className="flex items-center gap-2 py-3">
                  <CircleNotch size={12} weight="bold" className="animate-spin text-zinc-300" />
                  <span className="text-xs text-zinc-400">加载中...</span>
                </div>
              ) : picks.length === 0 ? (
                <p className="text-xs text-zinc-400 py-2">暂无内容</p>
              ) : (
                <div className="space-y-1.5 flex-1">
                  {picks.slice(0, 4).map((item, i) => (
                    <div key={item.id} className="flex items-start gap-2">
                      <span className="shrink-0 w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-[9px] font-bold text-zinc-400 mt-0.5">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-zinc-700 line-clamp-1">{stripMarkdown(item.title)}</p>
                        {item.summary && (
                          <p className="text-[10px] text-zinc-400 line-clamp-1">{item.summary}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <span className="mt-auto pt-2 text-[10px] font-semibold text-zinc-400">
                查看全部 →
              </span>
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
