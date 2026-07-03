import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractKeyPoints } from "@/lib/utils";

export const runtime = "nodejs";
// 分享卡片 60 秒后台再生成；下游缓存也保持短缓存，避免微信/CDN 长期持有旧图。
export const revalidate = 60;

/**
 * 服务端分享卡片路由
 *
 * 用法：
 *   /capi/share-card/demo?theme=mint            —— 示例数据
 *   /capi/share-card/{videoId}?theme=ink        —— 拉取真实公开视频数据
 *   ?title=&source=&duration=&lead=&points=a|b|c&url=  —— query 覆盖（测试/定制）
 *
 * 数据源：后端公开端点 GET /api/v1/videos/public/{id}/full（免鉴权，仅 done 且非隐藏）。
 * 输出 PNG，可直接 <img src="..."> 嵌入任意页面。
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const PUBLIC_SITE_HOST = (() => {
  try {
    return new URL(PUBLIC_SITE_URL).hostname;
  } catch {
    return "localhost";
  }
})();

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  podcast: "播客",
};

function isUrlLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/|\?|$)/i.test(value.trim());
}

interface PublicVideoPayload {
  video: {
    id: string;
    title: string | null;
    platform: string;
    duration: string | null;
    show_name: string | null;
    host: string | null;
    description: string | null;
  };
  summaries?: { level: string; content: string }[];
}

async function fetchPublicVideo(videoId: string): Promise<PublicVideoPayload | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/videos/public/${encodeURIComponent(videoId)}/full`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as PublicVideoPayload;
  } catch {
    return null;
  }
}

function buildTitle(v: PublicVideoPayload["video"]): string {
  if (v.title && !isUrlLike(v.title)) return v.title;
  if (v.description && !isUrlLike(v.description)) return v.description;
  if (v.show_name) return `${v.show_name} 的内容摘记`;
  return `${PLATFORM_LABELS[v.platform] || "内容"}摘记`;
}

function buildSource(v: PublicVideoPayload["video"]): string {
  const platform = PLATFORM_LABELS[v.platform] || v.platform || "内容来源";
  if (v.show_name && !isUrlLike(v.show_name)) return `${platform} · ${v.show_name}`;
  if (v.host && !isUrlLike(v.host)) return `${platform} · ${v.host}`;
  return platform;
}

type ToneId = "mint" | "ink" | "citrus" | "night" | "paper";

interface Tone {
  background: string;
  gridColor: string;
  dotColor: string;
  heading: string;
  body: string;
  muted: string;
  panel: string;
  panelStrong: string;
  divider: string;
  numberBg: string;
  numberText: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  sparkle: string;
  border: string;
  shell: string;
  shadow: string;
  qrFrame: string;
}

const TONES: Record<ToneId, Tone> = {
  mint: {
    background:
      "radial-gradient(circle at 83% 16%, rgba(199,247,229,0.86) 0 16%, transparent 39%), radial-gradient(circle at 10% 8%, rgba(242,255,249,0.94), transparent 35%), linear-gradient(180deg, #f8fffb 0%, #edf9f2 100%)",
    gridColor: "rgba(27,132,95,0.055)",
    dotColor: "rgba(32,180,134,0.08)",
    heading: "#074424",
    body: "#14241c",
    muted: "#6f8079",
    panel: "rgba(255,255,255,0.76)",
    panelStrong: "#ffffff",
    divider: "rgba(113,184,154,0.24)",
    numberBg: "#d9f5e8",
    numberText: "#0f6d45",
    accent: "#20b486",
    accentText: "#08795c",
    accentSoft: "#e7fff5",
    sparkle: "#71c6aa",
    border: "rgba(32,180,134,0.14)",
    shell: "#f2fbf7",
    shadow: "rgba(48,117,88,0.16)",
    qrFrame: "#ffffff",
  },
  ink: {
    background:
      "radial-gradient(circle at 83% 16%, rgba(207,223,255,0.9) 0 16%, transparent 39%), radial-gradient(circle at 10% 8%, rgba(244,248,255,0.95), transparent 35%), linear-gradient(180deg, #f8fbff 0%, #edf4ff 100%)",
    gridColor: "rgba(53,104,212,0.055)",
    dotColor: "rgba(53,104,212,0.08)",
    heading: "#112350",
    body: "#17213c",
    muted: "#67738e",
    panel: "rgba(255,255,255,0.78)",
    panelStrong: "#ffffff",
    divider: "rgba(84,124,207,0.22)",
    numberBg: "#dfe9ff",
    numberText: "#244f9f",
    accent: "#3568d4",
    accentText: "#244f9f",
    accentSoft: "#e8f0ff",
    sparkle: "#6d8ed9",
    border: "rgba(53,104,212,0.14)",
    shell: "#f3f7ff",
    shadow: "rgba(55,83,150,0.16)",
    qrFrame: "#ffffff",
  },
  citrus: {
    background:
      "radial-gradient(circle at 84% 15%, rgba(255,225,166,0.76) 0 17%, transparent 40%), radial-gradient(circle at 8% 8%, rgba(255,250,238,0.98), transparent 34%), linear-gradient(180deg, #fffaf0 0%, #fff2db 100%)",
    gridColor: "rgba(198,128,42,0.058)",
    dotColor: "rgba(229,137,34,0.09)",
    heading: "#3a250f",
    body: "#34291d",
    muted: "#806d59",
    panel: "rgba(255,255,255,0.78)",
    panelStrong: "#ffffff",
    divider: "rgba(217,149,61,0.25)",
    numberBg: "#ffedcf",
    numberText: "#965110",
    accent: "#e58922",
    accentText: "#965110",
    accentSoft: "#fff2d4",
    sparkle: "#d9953d",
    border: "rgba(229,137,34,0.16)",
    shell: "#fff8e8",
    shadow: "rgba(159,103,37,0.15)",
    qrFrame: "#ffffff",
  },
  night: {
    background:
      "radial-gradient(circle at 84% 16%, rgba(67,102,92,0.7) 0 17%, transparent 40%), radial-gradient(circle at 12% 8%, rgba(42,56,64,0.8), transparent 36%), linear-gradient(180deg, #171b20 0%, #0f1217 100%)",
    gridColor: "rgba(255,255,255,0.05)",
    dotColor: "rgba(135,231,202,0.07)",
    heading: "#f7f8f4",
    body: "#f3f5ef",
    muted: "rgba(243,245,239,0.66)",
    panel: "rgba(255,255,255,0.08)",
    panelStrong: "rgba(255,255,255,0.12)",
    divider: "rgba(255,255,255,0.1)",
    numberBg: "rgba(135,231,202,0.18)",
    numberText: "#a3f0dc",
    accent: "#76e0c0",
    accentText: "#a2f1dc",
    accentSoft: "rgba(118,224,192,0.16)",
    sparkle: "#87e7ca",
    border: "rgba(255,255,255,0.1)",
    shell: "#111318",
    shadow: "rgba(0,0,0,0.34)",
    qrFrame: "#f7f8f4",
  },
  paper: {
    background:
      "radial-gradient(circle at 84% 16%, rgba(226,218,200,0.6) 0 17%, transparent 42%), radial-gradient(circle at 10% 8%, rgba(255,253,246,0.95), transparent 36%), linear-gradient(180deg, #fffefa 0%, #f4efe6 100%)",
    gridColor: "rgba(47,42,34,0.05)",
    dotColor: "rgba(122,101,66,0.065)",
    heading: "#252018",
    body: "#2f2a22",
    muted: "#776f63",
    panel: "rgba(255,255,255,0.64)",
    panelStrong: "#fffefa",
    divider: "rgba(96,82,60,0.16)",
    numberBg: "#ece5d7",
    numberText: "#2f2a22",
    accent: "#9a7b45",
    accentText: "#2f2a22",
    accentSoft: "#ebe5d7",
    sparkle: "#9a7b45",
    border: "rgba(47,42,34,0.1)",
    shell: "#f6f5ef",
    shadow: "rgba(82,69,48,0.14)",
    qrFrame: "#ffffff",
  },
};

const THEME_IDS: ToneId[] = ["mint", "ink", "citrus", "night", "paper"];

const SAMPLE = {
  title: "Inside YC's AI Playbook：早期创业团队如何用 AI 做决策",
  source: "YouTube · YC",
  duration: "38:12",
  lead:
    "拆解 YC 的 AI 方法论与实践，洞察早期创业团队如何把信息转化为可执行判断，让长内容的价值被快速沉淀。",
  points: [
    "数据统一后，非技术成员也能直接围绕同一份材料提问。",
    "摘要不只是压缩文字，而是帮用户快速判断内容是否值得深读。",
    "实体、关系和来源被沉淀下来，每次分享都能回到原始上下文。",
    "从观看到复盘形成闭环，降低团队二次整理和传播成本。",
    "分享图承载标题、摘要、重点和回看入口，适合社群快速转发。",
  ],
  url: PUBLIC_SITE_URL,
};

const fontCache: Record<string, ArrayBuffer> = {};
function getFont(weight: 400 | 700): ArrayBuffer {
  if (fontCache[weight]) return fontCache[weight];
  // 用 GB2312 子集字体（1.5MB）而非全量 OTF（8.3MB），Satori 解析提速数倍。
  const file =
    weight === 700 ? "noto-sans-sc-700.otf" : "noto-sans-sc-400.otf";
  const buf = readFileSync(join(process.cwd(), "fonts", file));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  fontCache[weight] = arrayBuffer;
  return arrayBuffer;
}

/** 读取 public 下图片为 data URL，供 Satori <img src> 内嵌（无运行时网络依赖）。 */
const imgCache: Record<string, string> = {};
function getImageDataUrl(relPath: string, mime = "image/png"): string {
  if (imgCache[relPath]) return imgCache[relPath];
  const buf = readFileSync(join(process.cwd(), "public", relPath));
  const url = `data:${mime};base64,${buf.toString("base64")}`;
  imgCache[relPath] = url;
  return url;
}

/** 读取「品猹」文字 logo SVG，按主题色着色后返回 data URL（适配深/浅主题）。 */
const scriptLogoCache: Record<string, string> = {};
function getScriptLogoDataUrl(color: string): string {
  if (scriptLogoCache[color]) return scriptLogoCache[color];
  const raw = readFileSync(
    join(process.cwd(), "public", "brand", "pincha-script.svg"),
    "utf8"
  );
  const themed = raw.replace(/#000000/gi, color);
  const url = `data:image/svg+xml;base64,${Buffer.from(themed).toString("base64")}`;
  scriptLogoCache[color] = url;
  return url;
}

function truncate(value: string, max: number): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function pickTone(theme: string | null): Tone {
  const id = (THEME_IDS.includes(theme as ToneId) ? theme : "mint") as ToneId;
  return TONES[id];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { searchParams } = new URL(request.url);
  const { id } = await params;
  const tone = pickTone(searchParams.get("theme"));
  const t0 = Date.now();

  // 数据解析优先级：query 覆盖 > 真实公开视频 > demo 示例
  let title = SAMPLE.title;
  let source = SAMPLE.source;
  let duration: string | null = SAMPLE.duration;
  let lead = SAMPLE.lead;
  let points: string[] = SAMPLE.points;
  let targetUrl = `${PUBLIC_SITE_URL}/videos/public/${encodeURIComponent(id)}`;

  if (id !== "demo") {
    const payload = await fetchPublicVideo(id);
    if (payload?.video) {
      const v = payload.video;
      title = buildTitle(v);
      source = buildSource(v);
      duration = v.duration ?? null;

      const express =
        payload.summaries?.find((s) => s.level === "express") ??
        payload.summaries?.[0];
      if (express?.content) {
        const keyPoints = extractKeyPoints(express.content, 6);
        lead =
          keyPoints[0] ||
          (v.description && !isUrlLike(v.description)
            ? v.description
            : "品猹已经把这条长内容拆成标题、摘要和关键分点。");
        points = keyPoints.length > 0 ? keyPoints : points;
      }
    }
  }

  // query 参数覆盖（用于测试 / 定制单张卡片）
  if (searchParams.get("title")) title = searchParams.get("title")!;
  if (searchParams.get("source")) source = searchParams.get("source")!;
  duration = searchParams.get("duration") ?? duration;
  if (searchParams.get("lead")) lead = searchParams.get("lead")!;
  const pointsParam = searchParams.get("points");
  if (pointsParam) points = pointsParam.split("|").filter(Boolean);
  if (searchParams.get("url")) targetUrl = searchParams.get("url")!;

  const tFetch = Date.now();
  const font400 = getFont(400);
  const font700 = getFont(700);
  const scriptLogoUrl = getScriptLogoDataUrl(tone.heading);
  const mascotUrl = getImageDataUrl("generated/share-mascot-tablet-640.png");
  const qrDataUrl = await QRCode.toDataURL(targetUrl, {
    margin: 1,
    width: 240,
    color: { dark: "#0b0b0b", light: "#ffffff" },
  });
  const tPrep = Date.now();

  const titleText = truncate(title, 46);
  const leadText = truncate(lead, 68);
  const pointList = points.length > 0 ? points.slice(0, 5) : ["标题、摘要和重点已经整理好。"];
  const fallbackPoints = [
    "更多脉络已在品猹中整理，可回到原文继续深读。",
    "关键内容、来源和上下文已合并为一张可转发摘要。",
    "扫码即可查看完整摘记，继续追踪视频中的关键判断。",
  ];
  while (pointList.length < 5) {
    pointList.push(fallbackPoints[(pointList.length - points.length) % fallbackPoints.length]);
  }

  const width = 1080;
  const height = 1350;
  const frame = 34;
  const cardW = width - frame * 2;
  const cardH = height - frame * 2;

  const resp = new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          backgroundColor: tone.shell,
          padding: frame,
          fontFamily: "Noto Sans SC",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -160,
            top: -120,
            width: 520,
            height: 520,
            borderRadius: 999,
            display: "flex",
            background: tone.accentSoft,
            opacity: 0.58,
          }}
        />

        <div
          style={{
            width: cardW,
            height: cardH,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: 34,
            border: `1px solid ${tone.border}`,
            backgroundImage: tone.background,
            boxShadow: `0 28px 82px ${tone.shadow}`,
            padding: "84px 64px 56px",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              backgroundImage: `linear-gradient(${tone.gridColor} 1px, transparent 1px), linear-gradient(90deg, ${tone.gridColor} 1px, transparent 1px)`,
              backgroundSize: "76px 76px",
              opacity: 0.62,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 96,
              top: 38,
              width: 360,
              height: 230,
              display: "flex",
              backgroundImage: `radial-gradient(${tone.dotColor} 1.35px, transparent 1.35px)`,
              backgroundSize: "12px 12px",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 92,
              top: 44,
              width: 372,
              height: 372,
              borderRadius: 999,
              display: "flex",
              border: `1px solid ${tone.border}`,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 98,
              top: 92,
              width: 26,
              height: 26,
              display: "flex",
              border: `3px solid ${tone.sparkle}`,
              transform: "rotate(45deg)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 346,
              top: 190,
              width: 22,
              height: 22,
              display: "flex",
              border: `2px solid ${tone.sparkle}`,
              transform: "rotate(45deg)",
              opacity: 0.76,
            }}
          />

          <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ display: "flex", flexDirection: "row", minHeight: 282 }}>
              <div style={{ display: "flex", flexDirection: "column", width: 610 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div style={{ width: 44, height: 5, borderRadius: 999, background: tone.accent, display: "flex" }} />
                  <div style={{ fontSize: 18, fontWeight: 700, color: tone.accentText, letterSpacing: 3, display: "flex" }}>
                    KEY NOTE
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 32,
                    fontSize: 52,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    color: tone.heading,
                    letterSpacing: -1,
                    display: "flex",
                  }}
                >
                  {titleText}
                </div>
                <div style={{ display: "flex", flexDirection: "row", marginTop: 24, gap: 12, alignItems: "center" }}>
                  <div style={{ fontSize: 20, color: tone.muted, fontWeight: 400, display: "flex" }}>{source}</div>
                  {duration ? (
                    <>
                      <div style={{ fontSize: 20, color: tone.muted, display: "flex" }}>·</div>
                      <div style={{ fontSize: 20, color: tone.muted, fontWeight: 400, display: "flex" }}>{duration}</div>
                    </>
                  ) : null}
                </div>
              </div>
              <div style={{ display: "flex", flex: 1, position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    right: 38,
                    bottom: 4,
                    width: 280,
                    height: 68,
                    borderRadius: "50%",
                    display: "flex",
                    background: "rgba(255,255,255,0.42)",
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mascotUrl}
                  width={270}
                  height={360}
                  alt="品猹小助手"
                  style={{ position: "absolute", right: 8, top: -24, objectFit: "contain" }}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 28,
                padding: "26px 42px 28px",
                borderRadius: 28,
                background: tone.panelStrong,
                border: `1px solid ${tone.border}`,
                boxShadow: `0 22px 50px ${tone.shadow}`,
              }}
            >
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 999,
                    background: `linear-gradient(135deg, ${tone.accent}, ${tone.accentSoft})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tone.qrFrame,
                    fontSize: 26,
                    fontWeight: 700,
                  }}
                >
                  ≡
                </div>
                <div style={{ marginLeft: 20, fontSize: 28, fontWeight: 700, color: tone.body, display: "flex" }}>
                  内容摘要
                </div>
                <div style={{ marginLeft: 30, flex: 1, height: 1, display: "flex", borderTop: `2px dashed ${tone.divider}` }} />
              </div>
              <div style={{ fontSize: 27, lineHeight: 1.58, color: tone.body, fontWeight: 400, display: "flex" }}>
                {leadText}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                marginTop: 42,
                marginBottom: 18,
                gap: 18,
              }}
            >
              <div style={{ fontSize: 27, fontWeight: 700, color: tone.body, display: "flex" }}>
                核心总结
              </div>
              <div style={{ fontSize: 18, color: tone.accent, fontWeight: 400, display: "flex" }}>
                Key Takeaways
              </div>
              <div style={{ display: "flex", flex: 1, height: 1, background: tone.divider }} />
              <div style={{ width: 8, height: 8, borderRadius: 999, background: tone.accent, display: "flex" }} />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: 326,
                borderRadius: 28,
                background: tone.panel,
                border: `1px solid ${tone.border}`,
                overflow: "hidden",
              }}
            >
              {pointList.map((point, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 30,
                    height: 65.2,
                    padding: "0 34px",
                    borderTop: i === 0 ? "none" : `1px solid ${tone.divider}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 52,
                      height: 42,
                      borderRadius: 13,
                      background: tone.numberBg,
                      color: tone.numberText,
                      fontSize: 22,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: 23,
                      color: tone.body,
                      lineHeight: 1.42,
                      fontWeight: 400,
                    }}
                  >
                    {truncate(point, 46)}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 30,
                marginTop: 22,
                padding: "18px 34px",
                height: 136,
                borderRadius: 28,
                background: tone.panelStrong,
                border: `1px solid ${tone.border}`,
                boxShadow: `0 20px 52px ${tone.shadow}`,
              }}
            >
              <div
                style={{
                  width: 116,
                  height: 116,
                  padding: 8,
                  borderRadius: 12,
                  background: tone.qrFrame,
                  display: "flex",
                  boxShadow: `0 10px 28px ${tone.shadow}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} width={100} height={100} alt="QR" style={{ borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 14 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={scriptLogoUrl} height={28} alt="品猹" style={{ objectFit: "contain" }} />
                  <div style={{ fontSize: 23, fontWeight: 700, color: tone.body, display: "flex" }}>
                    让内容清晰 让价值沉淀
                  </div>
                </div>
                <div style={{ fontSize: 19, color: tone.muted, marginTop: 18, display: "flex" }}>
                  {source}
                  {duration ? ` · ${duration}` : ""} · {PUBLIC_SITE_HOST}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width,
      height,
      // ISR revalidate 在 Zeabur 上未生效，改用显式 CDN 长缓存：浏览器 1h、
      // 边缘 24h、stale 7d。字体已换 GB2312 子集（1.5MB），首屏生成从 ~8s
      // 降到 ~2-3s。代码/素材变更靠 SHARE_CARD_VERSION 版本号穿透缓存。
      headers: {
        "cache-control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
      fonts: [
        { name: "Noto Sans SC", data: font400, weight: 400, style: "normal" },
        { name: "Noto Sans SC", data: font700, weight: 700, style: "normal" },
      ],
    }
  );
  // 各阶段耗时写入响应头，便于诊断（fetch / prep / render / total）
  const tRenderEnd = Date.now();
  resp.headers.set("x-timing-fetch", `${tFetch - t0}ms`);
  resp.headers.set("x-timing-prep", `${tPrep - tFetch}ms`);
  resp.headers.set("x-timing-render", `${tRenderEnd - tPrep}ms`);
  resp.headers.set("x-timing-total", `${tRenderEnd - t0}ms`);
  return resp;
}
