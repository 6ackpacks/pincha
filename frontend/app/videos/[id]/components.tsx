"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CircleNotch, Trash } from "@phosphor-icons/react";
import { UseMutationResult } from "@tanstack/react-query";
import { ShareCard } from "@/components/video/share-card";
import { Sidebar } from "@/components/layout/sidebar";
import type { VideoResponse } from "@/lib/api";

export function VideoPageSkeleton() {
  return (
    <div className="flex min-h-screen bg-[#FAFAFA]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-10">
          <div className="h-5 w-24 bg-zinc-200 rounded animate-pulse mb-6" />
          <div className="h-7 w-2/3 bg-zinc-200 rounded-xl animate-pulse mb-2" />
          <div className="h-4 w-1/3 bg-zinc-100 rounded animate-pulse mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3">
              <div className="aspect-video bg-zinc-200 rounded-2xl animate-pulse" />
              <div className="h-10 bg-zinc-100 rounded-xl animate-pulse mt-3" />
            </div>
            <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              <div className="flex border-b border-zinc-200 px-2 py-3 gap-4">
                {["文字稿", "摘记", "脉络图", "追问"].map((t) => (
                  <div key={t} className="h-4 w-16 bg-zinc-200 rounded animate-pulse" />
                ))}
              </div>
              <div className="p-4 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-4 bg-zinc-100 rounded animate-pulse" style={{ width: `${85 - i * 5}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function VideoPageError({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex min-h-screen bg-[#FAFAFA]">
      <Sidebar />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8 bg-white rounded-2xl border border-red-100 shadow-sm max-w-sm">
          <p className="text-red-500 text-lg font-bold">无法访问视频</p>
          <p className="text-zinc-500 mt-2 text-sm">{message}</p>
          <button onClick={onBack} className="mt-6 px-4 py-2 bg-zinc-100 font-bold text-zinc-700 rounded-lg hover:bg-zinc-200">返回</button>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirmDialog({
  open,
  onClose,
  deleteMutation,
}: {
  open: boolean;
  onClose: () => void;
  deleteMutation: UseMutationResult<unknown, Error, void, unknown>;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl p-6 w-[340px] shadow-xl border border-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                <Trash className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-base font-bold text-zinc-900">确认删除这条记录？</p>
                <p className="text-sm text-zinc-500 mt-1.5 leading-relaxed">
                  删除后，文字稿、摘记和脉络图将无法恢复
                </p>
              </div>
              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
                >
                  再想想
                </button>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center gap-1.5"
                >
                  {deleteMutation.isPending && <CircleNotch size={14} weight="bold" className="animate-spin" />}
                  确认删除
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ShareCardDialog({
  open,
  onClose,
  video,
  videoId,
}: {
  open: boolean;
  onClose: () => void;
  video: VideoResponse;
  videoId: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl w-[440px] max-h-[90vh] shadow-xl border border-zinc-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <ShareCard video={video} videoId={videoId} onClose={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
