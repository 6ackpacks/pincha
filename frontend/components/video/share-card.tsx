"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ChartBar,
  Check,
  CircleNotch,
  Clock,
  Copy,
  DownloadSimple,
  LinkSimple,
  MagnifyingGlass,
  Sparkle,
  UsersThree,
} from "@phosphor-icons/react";
import { type VideoResponse } from "@/lib/api";
import { SHARE_CARD_VERSION } from "@/lib/utils";
import { PUBLIC_SITE_HOST, PUBLIC_SITE_URL } from "@/lib/constants";
import {
  SHARE_CARD_THEME_IDS,
  SHARE_CARD_THEMES,
  type ShareCardThemeId,
} from "./share-card-themes";

const SHARE_CARD_WIDTH = 420;

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  podcast: "播客",
};

function isUrlLike(value: string | null | undefined) {
  if (!value) return false;
  return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/|\?|$)/i.test(value.trim());
}

function getDisplayTitle(video: VideoResponse) {
  if (video.title && !isUrlLike(video.title)) return video.title;
  if (video.description && !isUrlLike(video.description)) return video.description;
  if (video.show_name) return `${video.show_name} 的内容摘记`;
  return `${PLATFORM_LABELS[video.platform] || "内容"}摘记`;
}

function compactText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

const POINT_ICONS = [ChartBar, Clock, UsersThree];

type PosterTone = {
  background: string;
  gridColor: string;
  sparkle: string;
  sparkleSoft: string;
  orbit: string;
  heading: string;
  body: string;
  muted: string;
  panel: string;
  panelStrong: string;
  divider: string;
  numberBg: string;
  numberText: string;
  icon: string;
  shadow: string;
  searchBg: string;
};

const POSTER_TONES: Record<ShareCardThemeId, PosterTone> = {
  mint: {
    background:
      "radial-gradient(circle at 90% 24%, rgba(204, 247, 230, 0.92) 0 16%, transparent 36%), radial-gradient(circle at 12% 8%, rgba(225, 255, 244, 0.92), transparent 34%), linear-gradient(180deg, #f8fcf7 0%, #edf9f3 100%)",
    gridColor: "rgba(255,255,255,0.36)",
    sparkle: "#71c6aa",
    sparkleSoft: "#8edfc4",
    orbit: "rgba(89, 188, 150, 0.42)",
    heading: "#074424",
    body: "#14251c",
    muted: "#718078",
    panel: "rgba(255, 255, 255, 0.62)",
    panelStrong: "rgba(255, 255, 255, 0.82)",
    divider: "rgba(113, 184, 154, 0.2)",
    numberBg: "#d9f5e8",
    numberText: "#0f6d45",
    icon: "#68aa98",
    shadow: "rgba(78, 151, 117, 0.14)",
    searchBg: "rgba(255, 255, 255, 0.92)",
  },
  ink: {
    background:
      "radial-gradient(circle at 88% 24%, rgba(210, 224, 255, 0.96) 0 17%, transparent 37%), radial-gradient(circle at 12% 8%, rgba(235, 242, 255, 0.96), transparent 36%), linear-gradient(180deg, #f8fbff 0%, #edf4ff 100%)",
    gridColor: "rgba(255,255,255,0.42)",
    sparkle: "#6d8ed9",
    sparkleSoft: "#9bb7f1",
    orbit: "rgba(78, 116, 204, 0.34)",
    heading: "#112350",
    body: "#17213c",
    muted: "#69748e",
    panel: "rgba(255, 255, 255, 0.66)",
    panelStrong: "rgba(255, 255, 255, 0.84)",
    divider: "rgba(84, 124, 207, 0.2)",
    numberBg: "#dfe9ff",
    numberText: "#244f9f",
    icon: "#6383c7",
    shadow: "rgba(74, 103, 163, 0.14)",
    searchBg: "rgba(255, 255, 255, 0.93)",
  },
  citrus: {
    background:
      "radial-gradient(circle at 88% 24%, rgba(255, 222, 158, 0.78) 0 17%, transparent 38%), radial-gradient(circle at 12% 8%, rgba(255, 246, 220, 0.96), transparent 34%), linear-gradient(180deg, #fffdf7 0%, #fff3dc 100%)",
    gridColor: "rgba(255,255,255,0.42)",
    sparkle: "#d9953d",
    sparkleSoft: "#f0bd74",
    orbit: "rgba(217, 149, 61, 0.32)",
    heading: "#3a250f",
    body: "#34291d",
    muted: "#826f59",
    panel: "rgba(255, 255, 255, 0.64)",
    panelStrong: "rgba(255, 255, 255, 0.82)",
    divider: "rgba(217, 149, 61, 0.22)",
    numberBg: "#ffedcf",
    numberText: "#965110",
    icon: "#bd7f32",
    shadow: "rgba(163, 111, 48, 0.14)",
    searchBg: "rgba(255, 255, 255, 0.92)",
  },
  night: {
    background:
      "radial-gradient(circle at 88% 24%, rgba(65, 98, 88, 0.86) 0 17%, transparent 38%), radial-gradient(circle at 14% 7%, rgba(42, 56, 64, 0.92), transparent 34%), linear-gradient(180deg, #171b20 0%, #101318 100%)",
    gridColor: "rgba(255,255,255,0.055)",
    sparkle: "#87e7ca",
    sparkleSoft: "#a3f0dc",
    orbit: "rgba(135, 231, 202, 0.22)",
    heading: "#f7f8f4",
    body: "#f3f5ef",
    muted: "rgba(243, 245, 239, 0.66)",
    panel: "rgba(255, 255, 255, 0.08)",
    panelStrong: "rgba(255, 255, 255, 0.12)",
    divider: "rgba(255, 255, 255, 0.1)",
    numberBg: "rgba(135, 231, 202, 0.18)",
    numberText: "#a3f0dc",
    icon: "#9ae7d2",
    shadow: "rgba(0, 0, 0, 0.28)",
    searchBg: "rgba(255, 255, 255, 0.1)",
  },
  paper: {
    background:
      "radial-gradient(circle at 88% 24%, rgba(223, 215, 199, 0.72) 0 17%, transparent 38%), radial-gradient(circle at 12% 8%, rgba(255, 253, 246, 0.96), transparent 34%), linear-gradient(180deg, #fffefa 0%, #f3eee5 100%)",
    gridColor: "rgba(255,255,255,0.38)",
    sparkle: "#9a7b45",
    sparkleSoft: "#c8ad79",
    orbit: "rgba(122, 101, 66, 0.25)",
    heading: "#252018",
    body: "#2f2a22",
    muted: "#776f63",
    panel: "rgba(255, 255, 255, 0.58)",
    panelStrong: "rgba(255, 255, 255, 0.78)",
    divider: "rgba(96, 82, 60, 0.15)",
    numberBg: "#ece5d7",
    numberText: "#2f2a22",
    icon: "#806b47",
    shadow: "rgba(82, 69, 48, 0.12)",
    searchBg: "rgba(255, 255, 255, 0.9)",
  },
};

interface SharePosterCardProps {
  theme: (typeof SHARE_CARD_THEMES)[ShareCardThemeId];
  title: string;
  sourceLabel: string;
  duration: string | null;
  leadText: string;
  points: string[];
}

export const SharePosterCard = React.forwardRef<HTMLDivElement, SharePosterCardProps>(
  function SharePosterCard({ theme, title, sourceLabel, duration, leadText, points }, ref) {
    const tone = POSTER_TONES[theme.id];
    const posterPoints = points.length > 0 ? points.slice(0, 3) : ["标题、摘要和重点已经整理好。"];

    return (
      <div
        ref={ref}
        style={{
          width: SHARE_CARD_WIDTH,
          maxWidth: "100%",
          minHeight: 746,
          position: "relative",
          overflow: "hidden",
          borderRadius: 0,
          background: tone.background,
          border: "1px solid rgba(34, 91, 66, 0.08)",
          boxShadow: `0 28px 80px ${tone.shadow}`,
          padding: "40px 40px 42px",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(${tone.gridColor} 1px, transparent 1px), linear-gradient(90deg, ${tone.gridColor} 1px, transparent 1px)`,
            backgroundSize: "34px 34px",
            opacity: 0.3,
          }}
        />
        <Sparkle
          size={22}
          weight="fill"
          color={tone.sparkle}
          style={{ position: "absolute", right: 34, top: 62 }}
        />
        <Sparkle
          size={15}
          weight="fill"
          color={tone.sparkle}
          style={{ position: "absolute", right: 126, top: 142, opacity: 0.78 }}
        />
        <div
          style={{
            position: "absolute",
            right: 38,
            top: 112,
            width: 166,
            height: 236,
            border: `1.4px solid ${tone.orbit}`,
            borderRadius: "50%",
            transform: "rotate(28deg)",
          }}
        />

        <div style={{ position: "relative", zIndex: 2 }}>
          <div
            style={{
              height: 42,
              borderRadius: 999,
              background: tone.searchBg,
              boxShadow: `0 10px 28px ${tone.shadow}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 16px",
              color: "#8b8f94",
            }}
          >
            <MagnifyingGlass size={22} color="#969aa1" weight="bold" />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 14,
                fontWeight: 520,
              }}
            >
              {compactText(title, 24)}
            </span>
          </div>

          <div style={{ position: "relative", minHeight: 250, paddingTop: 44 }}>
            <div style={{ position: "relative", zIndex: 2, width: 222 }}>
              <h2
                style={{
                  margin: 0,
                  color: tone.heading,
                  fontSize: 24,
                  fontWeight: 880,
                  lineHeight: 1.18,
                  letterSpacing: 0,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {title}
              </h2>
              <p
                style={{
                  margin: "14px 0 0",
                  color: tone.muted,
                  fontSize: 12,
                  lineHeight: 1.55,
                  fontWeight: 560,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {sourceLabel}
                {duration ? ` · ${duration}` : ""}
              </p>
            </div>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                right: -58,
                top: 104,
                width: 214,
                height: 214,
                borderRadius: "50%",
                zIndex: 0,
                background:
                  "radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.98) 0 56%, rgba(255, 255, 255, 0.9) 63%, rgba(255, 255, 255, 0) 78%)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/generated/share-mascot-tablet-640.png"
              alt="品猹小助手"
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              style={{
                position: "absolute",
                right: -44,
                top: 78,
                width: 198,
                zIndex: 1,
                filter: `drop-shadow(0 18px 28px ${tone.shadow})`,
              }}
            />
          </div>

          <div
            style={{
              borderRadius: 20,
              background: tone.panelStrong,
              boxShadow: `0 16px 42px ${tone.shadow}`,
              padding: "18px 20px",
              marginBottom: 22,
              backdropFilter: "blur(10px)",
            }}
          >
            <p
              style={{
                margin: "0 0 10px",
                color: theme.accent,
                fontSize: 12,
                fontWeight: 850,
              }}
            >
              内容摘要
            </p>
            <p
              style={{
                margin: 0,
                color: tone.body,
                fontSize: 17,
                lineHeight: 1.62,
                fontWeight: 720,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
              }}
            >
              {leadText}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 0,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                background: `linear-gradient(135deg, ${theme.accent}, #bcebd8)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              ·
            </span>
            <span style={{ color: tone.body, fontSize: 15, fontWeight: 880 }}>核心总结</span>
            <span style={{ color: theme.accent, fontSize: 14, fontWeight: 760 }}>
              Key Takeaways
            </span>
          </div>

          <div
            style={{
              borderRadius: 22,
              background: tone.panel,
              boxShadow: `0 14px 46px ${tone.shadow}`,
              overflow: "hidden",
              backdropFilter: "blur(10px)",
            }}
          >
            {posterPoints.map((point, index) => {
              const Icon = POINT_ICONS[index] || ChartBar;
              return (
                <div
                  key={`${point}-${index}`}
                  style={{
                    minHeight: 72,
                    display: "grid",
                    gridTemplateColumns: "42px 1fr 36px",
                    gap: 16,
                    alignItems: "center",
                    padding: "14px 18px",
                    borderBottom:
                      index < posterPoints.length - 1
                        ? `1px solid ${tone.divider}`
                        : "none",
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: tone.numberBg,
                      color: tone.numberText,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 850,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {index + 1}
                  </span>
                  <p
                    style={{
                      margin: 0,
                      color: tone.body,
                      fontSize: 14,
                      lineHeight: 1.6,
                      fontWeight: 620,
                    }}
                  >
                    {compactText(point, 46)}
                  </p>
                  <Icon size={25} color={tone.icon} weight="duotone" />
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 28,
              minHeight: 78,
              borderRadius: 12,
              background: tone.panelStrong,
              boxShadow: `0 16px 42px ${tone.shadow}`,
              display: "grid",
              gridTemplateColumns: "62px 1fr 34px",
              gap: 16,
              alignItems: "center",
              padding: "12px 18px",
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: 4,
                background:
                  "repeating-linear-gradient(90deg, #111 0 4px, #fff 4px 8px), repeating-linear-gradient(0deg, rgba(0,0,0,0.55) 0 4px, transparent 4px 8px)",
                backgroundBlendMode: "multiply",
                border: "6px solid #fff",
                boxShadow: "0 4px 12px rgba(24, 24, 27, 0.08)",
              }}
            />
            <div>
              <p style={{ margin: 0, color: tone.body, fontSize: 14, fontWeight: 850 }}>
                品猹 · 让内容清晰 让价值沉淀
              </p>
              <p style={{ margin: "8px 0 0", color: tone.muted, fontSize: 12, fontWeight: 520 }}>
                {sourceLabel}
                {duration ? ` · ${duration}` : ""} · {PUBLIC_SITE_HOST}
              </p>
            </div>
            <Sparkle size={27} color={tone.sparkleSoft} weight="regular" />
          </div>
        </div>
      </div>
    );
  },
);

interface ShareCardProps {
  video: VideoResponse;
  videoId: string;
  onClose: () => void;
}

export function ShareCard({ video, videoId, onClose }: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [theme, setTheme] = useState<ShareCardThemeId>("mint");

  const themeConfig = SHARE_CARD_THEMES[theme];
  const displayTitle = getDisplayTitle(video);

  // 直接复用服务端 /capi/share-card 路由生成的分享图（单一设计源，
  // 含「品猹」logo、真二维码、动态高度），客户端不再自己渲染卡片。
  const previewUrl = `/capi/share-card/${videoId}?theme=${theme}&v=${SHARE_CARD_VERSION}`;
  const embedUrl = `${PUBLIC_SITE_URL}/capi/share-card/${videoId}?theme=${theme}&v=${SHARE_CARD_VERSION}`;

  useEffect(() => {
    setImgLoaded(false);
  }, [previewUrl]);

  const fetchCardBlob = useCallback(async () => {
    const res = await fetch(previewUrl);
    if (!res.ok) throw new Error("生成分享图失败");
    return res.blob();
  }, [previewUrl]);

  const handleDownload = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await fetchCardBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `品猹-${displayTitle.slice(0, 20)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [displayTitle, exporting, fetchCardBlob]);

  const handleCopyImage = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await fetchCardBlob();
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `品猹-${displayTitle.slice(0, 20)}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      // 忽略——剪贴板可能不可用
    } finally {
      setExporting(false);
    }
  }, [displayTitle, exporting, fetchCardBlob]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(embedUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // ignore — clipboard may be unavailable
    }
  }, [embedUrl]);

  return (
    <div className="flex flex-col max-h-[90vh]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-100">
        <p className="text-sm font-bold text-zinc-900">分享总结</p>
        <p className="text-xs text-zinc-400 mt-0.5">选择颜色，生成不同气质的品猹摘记卡</p>
      </div>

      {/* Theme selector */}
      <div className="px-5 py-3 border-b border-zinc-50">
        <div className="grid grid-cols-5 gap-2">
          {SHARE_CARD_THEME_IDS.map((key) => (
            <button
              key={key}
              onClick={() => setTheme(key)}
              className={`group flex min-w-0 flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-bold transition-all ${
                theme === key
                  ? "border-zinc-900 bg-white shadow-sm"
                  : "border-zinc-100 bg-zinc-50/70 text-zinc-500 hover:border-zinc-200 hover:bg-white"
              }`}
              aria-label={`选择${SHARE_CARD_THEMES[key].name}配色`}
              style={{
                color: theme === key ? SHARE_CARD_THEMES[key].accentText : undefined,
              }}
            >
              <span
                className="flex h-6 w-10 overflow-hidden rounded-full border border-white shadow-sm"
                aria-hidden="true"
              >
                {SHARE_CARD_THEMES[key].swatch.map((color) => (
                  <span key={color} className="flex-1" style={{ background: color }} />
                ))}
              </span>
              <span className="truncate">{SHARE_CARD_THEMES[key].shortName}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Card preview —— 直接用服务端生成的分享图 */}
      <div
        className="px-5 py-4 overflow-y-auto flex-1 flex justify-center"
        style={{ background: themeConfig.shellBg }}
      >
        <div className="relative flex items-center justify-center">
          {!imgLoaded && (
            <div className="flex items-center gap-2 py-12 text-sm font-bold text-zinc-500">
              <CircleNotch className="w-4 h-4 text-emerald-500 animate-spin" />
              加载中…
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={previewUrl}
            src={previewUrl}
            alt="品猹分享卡"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
            className="max-w-full rounded-xl shadow-lg transition-opacity duration-300"
            style={{ maxHeight: "70vh", opacity: imgLoaded ? 1 : 0 }}
          />
        </div>
      </div>

      {/* Embed link */}
      <div className="px-5 py-3 border-t border-zinc-100 flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-lg bg-zinc-50 px-3 py-2 font-mono text-[11px] text-zinc-500">
          {embedUrl}
        </div>
        <button
          onClick={handleCopyLink}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
        >
          {linkCopied ? (
            <Check className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <LinkSimple className="w-3.5 h-3.5" />
          )}
          {linkCopied ? "已复制" : "复制嵌入链接"}
        </button>
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
          disabled={exporting}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          style={{ background: themeConfig.accent }}
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
          disabled={exporting}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors"
          style={{
            background: themeConfig.accentSoft,
            color: themeConfig.accentText,
          }}
        >
          <DownloadSimple className="w-4 h-4" />
          下载
        </button>
      </div>
    </div>
  );
}
