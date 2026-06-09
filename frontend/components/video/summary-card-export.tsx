"use client";

import React, { useRef } from "react";
import { ImageSquare, CircleNotch } from "@phosphor-icons/react";
import { useExportCard } from "@/lib/use-export-card";
import { extractKeyPoints } from "@/lib/utils";

interface SummaryCardExportProps {
  videoTitle: string;
  thumbnail: string | null;
  summaryContent: string;
  level: string;
  modelUsed: string | null;
  createdAt: string;
}

const LEVEL_LABELS: Record<string, string> = {
  express: "极速概览",
  highlight: "精华摘要",
  detailed: "详细解读",
  full: "完整文稿",
};

export function SummaryCardExport({
  videoTitle,
  thumbnail,
  summaryContent,
  level,
  modelUsed,
  createdAt,
}: SummaryCardExportProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { exporting, exportAsPng } = useExportCard();

  const handleExport = () => {
    if (!cardRef.current) return;
    exportAsPng(cardRef.current, `品猹摘记-${videoTitle.slice(0, 20)}`);
  };

  const keyPoints = extractKeyPoints(summaryContent);
  const levelLabel = LEVEL_LABELS[level] || level;
  const date = new Date(createdAt).toLocaleDateString("zh-CN");

  return (
    <>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
      >
        {exporting ? <CircleNotch size={10} weight="bold" className="animate-spin" /> : <ImageSquare size={10} weight="bold" />}
        导出卡片
      </button>

      {/* Hidden card for export */}
      <div className="fixed -left-[9999px] top-0">
        <div
          ref={cardRef}
          style={{
            width: 480,
            background: "linear-gradient(180deg, #1e1b4b 0%, #312e81 100%)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            position: "relative",
            overflow: "hidden",
            borderRadius: 16,
          }}
        >
          {/* Thumbnail area */}
          {thumbnail && (
            <div style={{ position: "relative", width: "100%", height: 180 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnail}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  opacity: 0.6,
                }}
                crossOrigin="anonymous"
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 80,
                  background: "linear-gradient(transparent, #1e1b4b)",
                }}
              />
            </div>
          )}

          {/* Content */}
          <div style={{ padding: "24px 32px 32px" }}>
            {/* Level badge */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 20,
                background: "rgba(139, 92, 246, 0.2)",
                color: "#c4b5fd",
                fontSize: 11,
                fontWeight: 600,
                marginBottom: 14,
              }}
            >
              {levelLabel}
            </div>

            {/* Video title */}
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#ffffff",
                margin: "0 0 18px 0",
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {videoTitle.length > 50
                ? videoTitle.slice(0, 50) + "…"
                : videoTitle}
            </h2>

            {/* Key points */}
            <div style={{ marginBottom: 24 }}>
              {keyPoints.map((point, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "rgba(139, 92, 246, 0.3)",
                      color: "#c4b5fd",
                      fontSize: 11,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                    }}
                  >
                    {i + 1}
                  </span>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#e2e8f0",
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    {point.length > 60 ? point.slice(0, 60) + "…" : point}
                  </p>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: 16,
                borderTop: "1px solid rgba(139, 92, 246, 0.2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-sm.png"
                  alt="品猹"
                  style={{ width: 18, height: 18, borderRadius: 4 }}
                />
                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
                  品猹 Pingcha
                </span>
              </div>
              <span style={{ fontSize: 10, color: "#64748b" }}>
                {modelUsed && `${modelUsed} · `}{date}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
