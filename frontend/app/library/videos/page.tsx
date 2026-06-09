"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sidebar } from "@/components/layout/sidebar";
import { getVideos, deleteVideo, proxyThumbnail, type VideoResponse } from "@/lib/api";
import { cn, stripMarkdown } from "@/lib/utils";
import {
  Play,
  CheckCircle,
  CircleNotch,
  XCircle,
  VideoCamera,
  Trash,
  ArrowLeft,
} from "@phosphor-icons/react";

const spring = { type: "spring" as const, stiffness: 300, damping: 24 };

function VideoGrid({
  videos,
  onDelete,
}: {
  videos: VideoResponse[];
  onDelete: (id: string) => void;
}) {
  const router = useRouter();

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <VideoCamera size={36} weight="bold" className="text-zinc-200 mb-3" />
        <p className="text-sm font-bold text-zinc-500 mb-1">还没有视频记录</p>
        <p className="text-xs text-zinc-400 mb-4">放入一个视频链接开始品读</p>
        <Link
          href="/"
          className="px-4 py-2 text-xs font-bold bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors"
        >
          放入视频
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {videos.map((v, i) => {
        const isDone = v.status.state === "done";
        const isFailed = v.status.state === "failed";
        const thumbSrc = v.thumbnail_url
          ? (proxyThumbnail(v.thumbnail_url) ?? v.thumbnail_url)
          : null;

        return (
          <motion.div
            key={v.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.03 }}
            className="group relative"
          >
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}
              className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-zinc-900/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
            >
              <Trash size={13} weight="bold" />
            </button>

            <div
              onClick={() => router.push(`/videos/${v.id}`)}
              className="rounded-xl overflow-hidden bg-white border border-zinc-200 cursor-pointer spring-hover hover:border-emerald-300 hover:shadow-sm"
            >
              <div className="h-36 bg-zinc-100 relative overflow-hidden">
                {thumbSrc ? (
                  <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-100">
                    <Play size={20} weight="bold" className="text-emerald-400" />
                  </div>
                )}
                <span
                  className={cn(
                    "absolute top-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm",
                    v.platform === "youtube" ? "bg-red-500/80 text-white" : "bg-purple-500/80 text-white"
                  )}
                >
                  {v.platform === "youtube" ? "YouTube" : "播客"}
                </span>
                {v.duration && (
                  <span className="absolute bottom-2 right-2 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/70 text-white">
                    {v.duration}
                  </span>
                )}
              </div>

              <div className="p-3">
                <p className="text-xs font-semibold text-zinc-900 line-clamp-2 leading-snug mb-2">
                  {stripMarkdown(v.title) || "无标题"}
                </p>
                <div className="flex items-center justify-between">
                  {isDone ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                      <CheckCircle size={10} weight="bold" /> 已完成
                    </span>
                  ) : isFailed ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-red-400">
                      <XCircle size={10} weight="bold" /> 失败
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
                      <CircleNotch size={10} weight="bold" className="animate-spin" /> 整理中
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

export default function LibraryVideosPage() {
  const queryClient = useQueryClient();

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["videos"],
    queryFn: () => getVideos(),
  });

  const deleteMut = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });

  const sortedVideos = [...videos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

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
              全部视频
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              共 {videos.length} 个视频
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="h-52 rounded-xl bg-zinc-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <VideoGrid videos={sortedVideos} onDelete={(id) => deleteMut.mutate(id)} />
          )}
        </div>
      </main>
    </div>
  );
}
