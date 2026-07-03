"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cdnUrl } from "@/lib/cdn";

interface NoSubtitleDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NoSubtitleDialog({ open, onClose }: NoSubtitleDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="relative w-[360px] rounded-2xl bg-white p-8 shadow-xl shadow-black/10"
          >
            <div className="flex flex-col items-center text-center">
              <img
                src={cdnUrl("/mascot/icon_thinking.gif")}
                alt="猹在思考"
                className="w-20 h-20 object-contain mb-4"
              />
              <h3 className="text-lg font-bold text-zinc-900 mb-2">
                字幕不可用
              </h3>
              <p className="text-sm text-zinc-500 leading-relaxed mb-6">
                我们目前暂不支持没有字幕的视频解析。请尝试选择其他带有字幕的视频。
              </p>
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold
                  hover:bg-emerald-600 active:scale-[0.98] transition-all duration-150
                  shadow-md shadow-emerald-500/20"
              >
                我知道了
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
