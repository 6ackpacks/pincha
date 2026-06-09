"use client";

import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useQuery } from "@tanstack/react-query";
import { getWikiPage } from "@/lib/api";

interface WikiLinkPreviewProps {
  slug: string;
  onClick: () => void;
  children: React.ReactNode;
}

export function WikiLinkPreview({ slug, onClick, children }: WikiLinkPreviewProps) {
  const [open, setOpen] = useState(false);

  const { data: page, isLoading } = useQuery({
    queryKey: ["wiki-page", slug],
    queryFn: () => getWikiPage(slug),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Tooltip.Provider delayDuration={400}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button
            onClick={onClick}
            className="text-emerald-600 hover:text-emerald-700 underline underline-offset-2 cursor-pointer"
          >
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="start"
            sideOffset={6}
            className="z-50 w-80 max-h-[200px] overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-lg animate-in fade-in-0 zoom-in-95"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-zinc-400">加载中…</span>
              </div>
            ) : page ? (
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-zinc-800 truncate">{page.title}</p>
                {page.summary && (
                  <p className="text-xs text-zinc-500 line-clamp-2">{page.summary}</p>
                )}
                {page.content && (
                  <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
                    {page.content.replace(/[#*\[\]]/g, "").slice(0, 200)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">页面不存在</p>
            )}
            <Tooltip.Arrow className="fill-white" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
