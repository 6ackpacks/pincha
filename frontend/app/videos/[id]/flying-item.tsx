"use client";

import { BookmarkSimple } from "@phosphor-icons/react";
import { motion } from "framer-motion";

interface FlyingItemProps {
  keyName: string;
  onComplete: () => void;
}

export function FlyingItem({ keyName, onComplete }: FlyingItemProps) {
  return (
    <motion.div
      key={keyName}
      initial={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      animate={{ opacity: 0, y: -80, x: 300, scale: 0.4 }}
      transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={onComplete}
      className="fixed top-1/3 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/30 pointer-events-none flex items-center gap-2"
    >
      <BookmarkSimple size={14} weight="bold" />
      已加入收录队列
    </motion.div>
  );
}
