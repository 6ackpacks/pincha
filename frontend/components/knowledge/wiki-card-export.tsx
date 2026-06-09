"use client";

import React, { useRef } from "react";
import { ImageSquare, CircleNotch } from "@phosphor-icons/react";
import { useExportCard } from "@/lib/use-export-card";

interface WikiCardExportProps {
  title: string;
  type: string;
  summary: string | null;
  tags: string[];
  relationsCount: number;
  sourcesCount: number;
  updatedAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  concept: "概念",
  entity: "实体",
  method: "方法",
  source: "来源",
  insight: "洞察",
};

const TYPE_COLORS: Record<string, string> = {
  concept: "#6366f1",
  entity: "#10b981",
  method: "#f59e0b",
  source: "#3b82f6",
  insight: "#ec4899",
};

export function WikiCardExport({
  title,
  type,
  summary,
  tags,
  relationsCount,
  sourcesCount,
  updatedAt,
}: WikiCardExportProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { exporting, exportAsPng } = useExportCard();

  const handleExport = () => {
    if (!cardRef.current) return;
    exportAsPng(cardRef.current, `知识卡-${title}`);
  };

  const typeColor = TYPE_COLORS[type] || "#6366f1";
  const typeLabel = TYPE_LABELS[type] || type;
  const displaySummary = summary || "暂无摘要";
  const date = new Date(updatedAt).toLocaleDateString("zh-CN");

  return (
    <>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 border border-zinc-200 transition-colors disabled:opacity-50"
      >
        {exporting ? <CircleNotch size={12} weight="bold" className="animate-spin" /> : <ImageSquare size={12} weight="bold" />}
        导出卡片
      </button>

      {/* Hidden card for export */}
      <div className="fixed -left-[9999px] top-0">
        <div
          ref={cardRef}
          style={{
            width: 480,
            padding: 40,
            background: "linear-gradient(135deg, #fafafa 0%, #f0fdf4 100%)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Decorative circle */}
          <div
            style={{
              position: "absolute",
              top: -60,
              right: -60,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: `${typeColor}10`,
            }}
          />

          {/* Type badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 20,
              background: `${typeColor}15`,
              color: typeColor,
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: typeColor,
              }}
            />
            {typeLabel}
          </div>

          {/* Title */}
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#18181b",
              margin: "0 0 12px 0",
              lineHeight: 1.3,
            }}
          >
            {title}
          </h2>

          {/* Summary */}
          <p
            style={{
              fontSize: 14,
              color: "#52525b",
              lineHeight: 1.7,
              margin: "0 0 20px 0",
              maxHeight: 100,
              overflow: "hidden",
            }}
          >
            {displaySummary.length > 120
              ? displaySummary.slice(0, 120) + "…"
              : displaySummary}
          </p>

          {/* Tags */}
          {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
              {tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 12,
                    background: "#f4f4f5",
                    color: "#71717a",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              gap: 16,
              paddingTop: 16,
              borderTop: "1px solid #e4e4e7",
              marginBottom: 20,
            }}
          >
            <span style={{ fontSize: 11, color: "#a1a1aa" }}>
              {relationsCount} 个关联
            </span>
            <span style={{ fontSize: 11, color: "#a1a1aa" }}>
              {sourcesCount} 个来源
            </span>
            <span style={{ fontSize: 11, color: "#a1a1aa" }}>
              更新于 {date}
            </span>
          </div>

          {/* Brand footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-sm.png"
              alt="品猹"
              style={{ width: 20, height: 20, borderRadius: 4 }}
            />
            <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 500 }}>
              品猹 Pingcha · 知识库
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
