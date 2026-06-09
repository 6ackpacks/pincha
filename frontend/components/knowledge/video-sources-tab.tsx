"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAtom } from "jotai";
import { CaretRight, CaretDown, VideoCamera, BookOpen, CircleNotch } from "@phosphor-icons/react";
import { getWikiVideos, type WikiVideoItem } from "@/lib/api";
import { activeKbIdAtom } from "@/atoms/kb";
import { cn } from "@/lib/utils";

function VideoSourceItem({ video }: { video: WikiVideoItem }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors text-left"
      >
        {expanded ? (
          <CaretDown size={14} weight="bold" className="text-zinc-400 shrink-0" />
        ) : (
          <CaretRight size={14} weight="bold" className="text-zinc-400 shrink-0" />
        )}
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt=""
            className="w-10 h-6 object-cover rounded shrink-0"
          />
        ) : (
          <div className="w-10 h-6 bg-zinc-100 rounded flex items-center justify-center shrink-0">
            <VideoCamera size={12} weight="bold" className="text-zinc-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-800 truncate">
            {video.title || "未命名视频"}
          </p>
          <p className="text-xs text-zinc-400">{video.wiki_pages.length} 个知识词条</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/videos/${video.id}`);
          }}
          className="text-xs text-zinc-400 hover:text-emerald-600 transition-colors shrink-0 px-2"
        >
          查看视频
        </button>
      </button>

      {expanded && video.wiki_pages.length > 0 && (
        <div className="px-4 pb-3 pt-1 bg-zinc-50 border-t border-zinc-100">
          <div className="flex flex-wrap gap-2">
            {video.wiki_pages.map((page) => (
              <button
                key={page.id}
                onClick={() => router.push(`/knowledge/${page.slug}`)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-600 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50 transition-all"
              >
                <BookOpen size={10} weight="bold" />
                {page.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {expanded && video.wiki_pages.length === 0 && (
        <div className="px-4 pb-3 pt-1 bg-zinc-50 border-t border-zinc-100">
          <p className="text-xs text-zinc-400">尚未提取到知识词条</p>
        </div>
      )}
    </div>
  );
}

export function VideoSourcesTab() {
  const [activeKbId] = useAtom(activeKbIdAtom);
  const { data: videos, isLoading } = useQuery({
    queryKey: ["wiki-videos", activeKbId],
    queryFn: getWikiVideos,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <CircleNotch size={24} weight="bold" className="animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!videos || videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <VideoCamera size={40} weight="bold" className="text-zinc-200 mb-4" />
        <p className="text-zinc-500 font-bold mb-1">还没有视频收进知识库</p>
        <p className="text-zinc-400 text-sm max-w-xs">在视频详情页点击「收进知识库」</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {videos.map((video) => (
        <VideoSourceItem key={video.id} video={video} />
      ))}
    </div>
  );
}
