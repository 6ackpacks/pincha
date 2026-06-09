"use client";

import { useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getPopularVideos } from "@/lib/api";
import { Fire, ArrowRight, Play } from "@phosphor-icons/react";
import { HScrollRow } from "@/components/home/shared";
import { VideoCard } from "@/components/home/video-card";

export function RecommendedVideos() {
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: recentVideos = [], isLoading: loadingVideos } = useQuery({
    queryKey: ["videos", "popular"],
    queryFn: () => getPopularVideos(12),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return (
    <section className="px-8 pt-8 pb-10">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Fire size={20} weight="bold" className="text-orange-500" />
          <h2 className="text-lg font-bold text-zinc-900">最近品读</h2>
          <span className="text-sm text-zinc-400">最近汇入书房的内容线索</span>
        </div>
        <Link href="/trending" className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 font-medium transition-colors">
          查看全部 <ArrowRight size={14} weight="bold" />
        </Link>
      </div>
      {loadingVideos ? (
        <div className="flex gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="shrink-0 w-[240px]">
              <div className="aspect-video rounded-xl bg-zinc-100 animate-pulse" />
              <div className="mt-2 h-4 w-3/4 bg-zinc-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : recentVideos.length === 0 ? (
        <button
          onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); inputRef.current?.focus(); }}
          className="w-full flex items-center justify-center gap-2 px-6 py-12 border border-dashed border-zinc-200 rounded-xl text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <Play size={16} weight="bold" />
              <span className="text-sm font-semibold">放入第一条内容，开始品读 →</span>
        </button>
      ) : (
        <HScrollRow>
          {recentVideos.map((video, i) => (
            <VideoCard key={video.id} video={video} index={i} />
          ))}
        </HScrollRow>
      )}
    </section>
  );
}
