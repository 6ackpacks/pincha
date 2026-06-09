"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle } from "@phosphor-icons/react";
import { cn, stripMarkdown } from "@/lib/utils";
import { proxyThumbnail, type VideoResponse } from "@/lib/api";

const CARD_GRADIENTS = [
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-orange-500 to-amber-600",
  "from-rose-500 to-pink-600",
  "from-blue-500 to-cyan-600",
  "from-fuchsia-500 to-purple-600",
  "from-indigo-500 to-blue-600",
  "from-teal-500 to-emerald-600",
];

export function VideoCard({ video, index }: { video: VideoResponse; index: number }) {
  const state = video.status?.state ?? "unknown";
  const isDone = state === "done";
  const thumbSrc = video.thumbnail_url ? (proxyThumbnail(video.thumbnail_url) ?? video.thumbnail_url) : null;
  const [imgFailed, setImgFailed] = useState(false);
  const gradient = CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  const showTextCover = !thumbSrc || imgFailed;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: index * 0.05 }} className="shrink-0 w-[240px]">
      <Link href={`/videos/${video.id}`} className="block group">
        <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-100">
          {!showTextCover ? (
            <img src={thumbSrc!} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={() => setImgFailed(true)} />
          ) : (
            <div className={cn("w-full h-full flex flex-col justify-end p-4 bg-gradient-to-br", gradient)}>
              <p className="text-white text-sm font-bold leading-tight line-clamp-3 drop-shadow-sm">
                {stripMarkdown(video.title) || "无标题"}
              </p>
              <span className="mt-2 text-white/70 text-[10px] font-medium">
                {video.platform === "youtube" ? "YouTube" : video.platform === "podcast" ? "播客" : video.platform}
              </span>
            </div>
          )}
          {video.duration && (
            <span className="absolute bottom-2 right-2 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/75 text-white">{video.duration}</span>
          )}
          <span className={cn("absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-sm", video.platform === "youtube" ? "bg-red-500" : "bg-purple-500")}>
            {video.platform === "youtube" ? "Y" : "P"}
          </span>
        </div>
        <div className="mt-2.5 px-0.5">
          <p className="text-sm font-semibold text-zinc-800 line-clamp-1 group-hover:text-zinc-600 transition-colors">{stripMarkdown(video.title) || "无标题"}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-zinc-500">{video.platform === "youtube" ? "YouTube" : "播客"}</span>
            {isDone && <CheckCircle size={11} weight="bold" className="text-zinc-600" />}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
