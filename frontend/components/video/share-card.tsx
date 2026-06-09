"use client";

import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { CircleNotch, Copy, DownloadSimple, Check } from "@phosphor-icons/react";
import { domToPng } from "modern-screenshot";
import { getSummary, type VideoResponse } from "@/lib/api";
import { extractKeyPoints } from "@/lib/utils";
import { useExportCard } from "@/lib/use-export-card";

type ColorTheme = "emerald" | "indigo" | "amber";

interface ThemeConfig {
  name: string;
  bg: string;
  headerBg: string;
  accentColor: string;
  accentBg: string;
  dotColor: string;
  titleColor: string;
  textColor: string;
  mutedColor: string;
  footerBg: string;
  footerText: string;
  borderColor: string;
}

const THEMES: Record<ColorTheme, ThemeConfig> = {
  emerald: {
    name: "翡翠绿",
    bg: "#ffffff",
    headerBg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
    accentColor: "#059669",
    accentBg: "#d1fae5",
    dotColor: "#10b981",
    titleColor: "#111827",
    textColor: "#374151",
    mutedColor: "#6b7280",
    footerBg: "#059669",
    footerText: "#ffffff",
    borderColor: "#d1fae5",
  },
  indigo: {
    name: "靛蓝紫",
    bg: "#ffffff",
    headerBg: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
    accentColor: "#4f46e5",
    accentBg: "#e0e7ff",
    dotColor: "#6366f1",
    titleColor: "#111827",
    textColor: "#374151",
    mutedColor: "#6b7280",
    footerBg: "#4f46e5",
    footerText: "#ffffff",
    borderColor: "#e0e7ff",
  },
  amber: {
    name: "暖琥珀",
    bg: "#fffbeb",
    headerBg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
    accentColor: "#d97706",
    accentBg: "#fef3c7",
    dotColor: "#f59e0b",
    titleColor: "#111827",
    textColor: "#374151",
    mutedColor: "#6b7280",
    footerBg: "#d97706",
    footerText: "#ffffff",
    borderColor: "#fef3c7",
  },
};

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  podcast: "播客",
};

interface ShareCardProps {
  video: VideoResponse;
  videoId: string;
  onClose: () => void;
}

export function ShareCard({ video, videoId, onClose }: ShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<ColorTheme>("emerald");
  const { exporting, exportAsPng } = useExportCard();

  useEffect(() => {
    getSummary(videoId, "express")
      .then((res) => setSummary(res.content))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [videoId]);

  const keyPoints = useMemo(() => {
    if (!summary) return [];
    return extractKeyPoints(summary);
  }, [summary]);

  const themeConfig = THEMES[theme];

  const handleDownload = useCallback(async () => {
    if (!cardRef.current) return;
    await exportAsPng(cardRef.current, `品猹-${(video.title || "分享").slice(0, 20)}`);
  }, [video.title, exportAsPng]);

  const handleCopyImage = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await domToPng(cardRef.current, { scale: 3 });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback to download if clipboard fails
      await exportAsPng(cardRef.current!, `品猹-${(video.title || "分享").slice(0, 20)}`);
    }
  }, [video.title, exportAsPng]);

  return (
    <div className="flex flex-col max-h-[90vh]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-100">
        <p className="text-sm font-bold text-zinc-900">分享卡片</p>
        <p className="text-xs text-zinc-400 mt-0.5">
          选择配色，复制或下载图片分享
        </p>
      </div>

      {/* Theme selector */}
      <div className="px-5 py-3 flex items-center gap-2 border-b border-zinc-50">
        <span className="text-xs text-zinc-500 mr-1">配色</span>
        {(Object.keys(THEMES) as ColorTheme[]).map((key) => (
          <button
            key={key}
            onClick={() => setTheme(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              theme === key
                ? "ring-2 ring-offset-1 shadow-sm"
                : "opacity-60 hover:opacity-100"
            }`}
            style={{
              background: THEMES[key].accentBg,
              color: THEMES[key].accentColor,
              ...(theme === key && { outlineColor: THEMES[key].accentColor }),
            }}
          >
            {THEMES[key].name}
          </button>
        ))}
      </div>

      {/* Card preview */}
      <div className="px-5 py-4 overflow-y-auto flex-1 flex justify-center">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <CircleNotch className="w-5 h-5 text-emerald-500 animate-spin" />
          </div>
        ) : (
          <div
            ref={cardRef}
            style={{
              width: 380,
              background: themeConfig.bg,
              borderRadius: 16,
              overflow: "hidden",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
              border: `1px solid ${themeConfig.borderColor}`,
            }}
          >
            {/* Card header with gradient */}
            <div
              style={{
                background: themeConfig.headerBg,
                padding: "24px 28px 20px",
              }}
            >
              {/* Platform badge */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 12,
                  background: themeConfig.accentBg,
                  color: themeConfig.accentColor,
                  fontSize: 11,
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {PLATFORM_LABELS[video.platform] || video.platform}
                {video.duration && (
                  <span style={{ opacity: 0.7 }}> · {video.duration}</span>
                )}
              </div>

              {/* Title */}
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: themeConfig.titleColor,
                  margin: 0,
                  lineHeight: 1.5,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {video.title || "内容品读"}
              </h2>
            </div>

            {/* Key points */}
            <div style={{ padding: "20px 28px" }}>
              {keyPoints.map((point, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    marginBottom: i < keyPoints.length - 1 ? 14 : 0,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: themeConfig.dotColor,
                      marginTop: 7,
                    }}
                  />
                  <p
                    style={{
                      fontSize: 13,
                      color: themeConfig.textColor,
                      lineHeight: 1.7,
                      margin: 0,
                    }}
                  >
                    {point}
                  </p>
                </div>
              ))}
            </div>

            {/* Footer brand bar */}
            <div
              style={{
                background: themeConfig.footerBg,
                padding: "12px 28px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: themeConfig.footerText,
                  letterSpacing: 0.5,
                }}
              >
                品猹 · 让信息有归处
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: themeConfig.footerText,
                  opacity: 0.7,
                }}
              >
                pingcha.app
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-5 py-3 border-t border-zinc-100 flex gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
        >
          关闭
        </button>
        <button
          onClick={handleCopyImage}
          disabled={loading || exporting}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
        >
          {exporting ? (
            <CircleNotch className="w-4 h-4 animate-spin" />
          ) : copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          {copied ? "已复制" : "复制图片"}
        </button>
        <button
          onClick={handleDownload}
          disabled={loading || exporting}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
        >
          <DownloadSimple className="w-4 h-4" />
          下载
        </button>
      </div>
    </div>
  );
}
