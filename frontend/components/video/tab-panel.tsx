"use client";

import React, { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ListBullets, TreeStructure, ChatCircle, Translate } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { TranscriptSegment } from "@/lib/api/videos";

function PanelSkeleton() {
  return (
    <div className="p-4 space-y-3 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-4 bg-zinc-100 rounded" style={{ width: `${90 - i * 8}%` }} />
      ))}
    </div>
  );
}

const TranslationPanel = dynamic(() => import("./translation-panel"), {
  loading: () => <PanelSkeleton />,
});

const SummaryPanel = dynamic(() => import("./summary-panel"), {
  loading: () => <PanelSkeleton />,
});

const ChatPanel = dynamic(() => import("./chat-panel"), {
  loading: () => <PanelSkeleton />,
});

const MindmapPanel = dynamic(() => import("./mindmap-panel"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
      加载脉络图...
    </div>
  ),
});

interface TabPanelProps {
  videoId: string;
  videoTitle?: string;
  thumbnail?: string;
  segments: TranscriptSegment[];
  segmentsEn?: (TranscriptSegment | null)[] | null;
  isTranscriptLoading?: boolean;
  isDone?: boolean;
  currentState?: string;
  forcedTab?: TabKey;
}

const TABS = [
  { key: "translation", label: "翻译", icon: Translate },
  { key: "summary", label: "摘记", icon: ListBullets },
  { key: "mindmap", label: "脉络图", icon: TreeStructure },
  { key: "chat", label: "追问", icon: ChatCircle },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export const TabPanel = React.memo(function TabPanel({ videoId, videoTitle, thumbnail, segments, segmentsEn, isTranscriptLoading, isDone, currentState, forcedTab }: TabPanelProps) {
  // Default to "translation" tab
  const [activeTab, setActiveTab] = useState<TabKey>("translation");
  // Track which tabs have been activated — activated tabs stay mounted to avoid re-fetching
  const [activatedTabs, setActivatedTabs] = useState<Set<string>>(new Set(["translation"]));

  // Allow parent to force-switch to a specific tab
  useEffect(() => {
    if (forcedTab) {
      setActiveTab(forcedTab);
      setActivatedTabs((prev) => new Set([...prev, forcedTab]));
    }
  }, [forcedTab]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setActivatedTabs((prev) => new Set([...prev, tab]));
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Animated tab bar */}
      <div className="flex border-b border-zinc-200 px-2 shrink-0 bg-zinc-50/50 backdrop-blur-sm">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={cn(
                "relative flex items-center gap-1.5 px-4 py-4 text-sm font-bold transition-colors outline-none",
                isActive
                  ? "text-emerald-600"
                  : "text-zinc-500 hover:text-zinc-900"
              )}
            >
              <tab.icon size={14} weight="bold" />
              {tab.label}

              {isActive && (
                <motion.span
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-1 right-1 h-[3px] rounded-t-full bg-emerald-500"
                  initial={false}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content — mindmap uses display:none instead of unmounting to preserve SVG state */}
      <div className="flex-1 overflow-hidden bg-white min-h-0">
        <div className={cn("h-full", activeTab !== "translation" && "hidden")}>
          <Suspense fallback={<PanelSkeleton />}>
            <TranslationPanel segments={segments} videoId={videoId} segmentsEn={segmentsEn} isLoading={isTranscriptLoading} />
          </Suspense>
        </div>

        <div className={cn("h-full overflow-y-auto", activeTab !== "summary" && "hidden")}>
          <Suspense fallback={<PanelSkeleton />}>
            <SummaryPanel videoId={videoId} videoTitle={videoTitle} thumbnail={thumbnail} isDone={isDone} currentState={currentState} />
          </Suspense>
        </div>

        {/* Mindmap: only mount after first activation, then keep alive via hidden to preserve SVG */}
        <div className={cn("h-full flex flex-col", activeTab !== "mindmap" && "hidden")}>
          {activatedTabs.has("mindmap") && (
            <Suspense fallback={<PanelSkeleton />}>
              <MindmapPanel videoId={videoId} isDone={isDone} segments={segments} />
            </Suspense>
          )}
        </div>

        {/* Chat: only mount after first activation, then keep alive to preserve conversation */}
        <div className={cn("h-full flex flex-col", activeTab !== "chat" && "hidden")}>
          {activatedTabs.has("chat") && (
            <Suspense fallback={<PanelSkeleton />}>
              <ChatPanel videoId={videoId} videoTitle={videoTitle} isDone={isDone ?? false} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
});
