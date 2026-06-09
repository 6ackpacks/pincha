"use client";

import { useEffect } from "react";

export default function KnowledgeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[知识库] 页面错误:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <p className="text-zinc-500 text-sm">知识库加载出错，请重试</p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-700"
      >
        重试
      </button>
    </div>
  );
}
