"use client";

import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useState } from "react";
import { CaretDown, CaretRight, WarningCircle, Lightning, LinkSimple } from "@phosphor-icons/react";
import { getKnowledgeHealth, type KnowledgeHealth } from "@/lib/api";
import { activeKbIdAtom } from "@/atoms/kb";

interface HealthPanelProps {
  onSelectSlug?: (slug: string) => void;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={88} height={88} className="-rotate-90">
        <circle cx={44} cy={44} r={radius} fill="none" stroke="#f4f4f5" strokeWidth={6} />
        <circle
          cx={44} cy={44} r={radius} fill="none"
          stroke={color} strokeWidth={6}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div
        className="absolute flex flex-col items-center justify-center"
        style={{ width: 88, height: 88 }}
      >
        <span className="text-xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-zinc-400">健康度</span>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ElementType;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="border-t border-zinc-100 pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-left"
      >
        {open ? <CaretDown size={14} weight="bold" className="text-zinc-400" /> : <CaretRight size={14} weight="bold" className="text-zinc-400" />}
        <Icon size={14} weight="bold" className="text-zinc-500" />
        <span className="text-xs font-bold text-zinc-600 flex-1">{title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-bold">{count}</span>
      </button>
      {open && <div className="mt-2 space-y-1 pl-6">{children}</div>}
    </div>
  );
}

export function HealthPanel({ onSelectSlug }: HealthPanelProps) {
  const [activeKbId] = useAtom(activeKbIdAtom);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["wiki-health", activeKbId],
    queryFn: getKnowledgeHealth,
    staleTime: 5 * 60 * 1000,  // health data stable for 5 min, avoid refetch on every page visit
  });

  if (isLoading && !isError) {
    return (
      <div className="p-4 space-y-3 animate-pulse">
        <div className="h-20 w-20 rounded-full bg-zinc-100 mx-auto" />
        <div className="h-4 w-24 bg-zinc-100 rounded mx-auto" />
      </div>
    );
  }

  if (isError || !data) return null;

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wide">知识健康度</h3>

      <div className="relative flex justify-center">
        <ScoreRing score={data.overall_score} />
      </div>
      <CollapsibleSection
        title="孤立词条"
        icon={WarningCircle}
        count={data.isolated_pages.length}
        defaultOpen={data.isolated_pages.length > 0}
      >
        {data.isolated_pages.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectSlug?.(p.slug)}
            className="block w-full text-left text-xs text-zinc-600 hover:text-emerald-600 py-0.5 truncate"
          >
            {p.title}
          </button>
        ))}
        <p className="text-[10px] text-zinc-400 mt-1">这些词条关联较少，建议补充相关内容</p>
      </CollapsibleSection>

      <CollapsibleSection
        title="薄弱关联"
        icon={LinkSimple}
        count={data.sparse_communities.length}
      >
        {data.sparse_communities.map((c) => (
          <div key={c.community_id} className="text-xs text-zinc-600 py-0.5">
            社区 {c.community_id + 1}：{c.page_count} 个词条，内聚度 {(c.cohesion * 100).toFixed(0)}%
          </div>
        ))}
        <p className="text-[10px] text-zinc-400 mt-1">这些知识群组内部关联薄弱</p>
      </CollapsibleSection>

      <CollapsibleSection
        title="核心概念"
        icon={Lightning}
        count={data.bridge_nodes.length}
      >
        {data.bridge_nodes.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectSlug?.(p.slug)}
            className="block w-full text-left text-xs text-zinc-600 hover:text-emerald-600 py-0.5 truncate"
          >
            {p.title}
            <span className="text-zinc-400 ml-1">连接 {p.communities_connected} 个社区</span>
          </button>
        ))}
        <p className="text-[10px] text-zinc-400 mt-1">这些概念连接多个知识群组，是核心枢纽</p>
      </CollapsibleSection>
    </div>
  );
}
