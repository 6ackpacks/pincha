"use client";

import { getCommunityColor } from "@/lib/constants/community-colors";

interface CommunityLegendItem {
  id: number;
  color: string;
}

interface RelationGraphControlsProps {
  colorMode: "type" | "community";
  setColorMode: (mode: "type" | "community") => void;
  hiddenTypes: Set<string>;
  toggleType: (type: string) => void;
  hideOrphans: boolean;
  setHideOrphans: (v: boolean | ((prev: boolean) => boolean)) => void;
  communityLegend: CommunityLegendItem[];
  onReset: () => void;
}

export function RelationGraphControls({
  colorMode,
  setColorMode,
  hiddenTypes,
  toggleType,
  hideOrphans,
  setHideOrphans,
  communityLegend,
  onReset,
}: RelationGraphControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-white border-t border-zinc-200">
      <div className="flex gap-1 mr-2">
        {(["type", "community"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setColorMode(mode)}
            className={`text-[11px] px-2 py-0.5 rounded-full transition-all ${
              colorMode === mode
                ? "bg-white text-zinc-900 font-bold"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {mode === "type" ? "按类型" : "按社区"}
          </button>
        ))}
      </div>
      <div className="w-px h-4 bg-zinc-700" />
      {colorMode === "type" ? (
        <>
          {[
            { type: "entity", color: "#60a5fa", label: "实体" },
            { type: "concept", color: "#c084fc", label: "概念" },
            { type: "method", color: "#4ade80", label: "方法" },
            { type: "source", color: "#fb923c", label: "来源" },
          ].map((item) => (
            <button
              key={item.type}
              onClick={() => toggleType(item.type)}
              className={`flex items-center gap-1.5 transition-all ${
                hiddenTypes.has(item.type) ? "opacity-30" : ""
              }`}
            >
              <div
                className="w-2.5 h-2.5 rounded-full transition-all"
                style={{
                  background: hiddenTypes.has(item.type) ? "#52525b" : item.color,
                  boxShadow: hiddenTypes.has(item.type) ? "none" : `0 0 6px ${item.color}80`,
                }}
              />
              <span className={`text-[11px] ${
                hiddenTypes.has(item.type)
                  ? "text-zinc-600 line-through"
                  : "text-zinc-400"
              }`}>
                {item.label}
              </span>
            </button>
          ))}
        </>
      ) : (
        communityLegend.map((c) => (
          <div key={c.id} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color, boxShadow: `0 0 6px ${c.color}80` }} />
            <span className="text-[11px] text-zinc-500">社区 {c.id + 1}</span>
          </div>
        ))
      )}
      <div className="w-px h-4 bg-zinc-700" />
      <button
        onClick={() => setHideOrphans((v: boolean) => !v)}
        className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all ${
          hideOrphans
            ? "bg-white text-zinc-900 border-white font-bold"
            : "text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:border-zinc-500"
        }`}
      >
        隐藏孤立节点
      </button>
      {(hiddenTypes.size > 0 || hideOrphans) && (
        <button
          onClick={onReset}
          className="text-[11px] px-2 py-0.5 rounded-full text-zinc-500 hover:text-zinc-300 transition-all"
        >
          重置过滤
        </button>
      )}
    </div>
  );
}
