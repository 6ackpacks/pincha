import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 分享卡片缓存版本号。
 * 每次改动 /capi/share-card 路由的渲染逻辑或素材后递增，
 * 用于拼接在分享卡 URL 上穿透微信/浏览器/CDN 的旧图缓存。
 */
export const SHARE_CARD_VERSION = "20260703f";

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function extractKeyPoints(markdown: string, maxPoints = 5): string[] {
  const lines = markdown.split("\n").filter((l) => l.trim());
  const points: string[] = [];

  for (const line of lines) {
    if (points.length >= maxPoints) break;
    const cleaned = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*[-*]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .trim();
    if (cleaned.length > 8 && cleaned.length < 120) {
      points.push(cleaned);
    }
  }

  if (points.length === 0) {
    const plain = markdown.replace(/[#*_\->\[\]()]/g, "").trim();
    const first = plain.slice(0, 80);
    if (first) points.push(first + (plain.length > 80 ? "…" : ""));
  }

  return points;
}

export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*{1,3}/g, "")
    .replace(/_{1,2}/g, "")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .trim();
}

function walkReadableText(node: unknown, parts: string[]) {
  if (typeof node === "string") {
    const value = node.trim();
    if (value) parts.push(value);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walkReadableText(child, parts);
    return;
  }
  if (!node || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  if (typeof record.text === "string" && record.text.trim()) {
    parts.push(record.text.trim());
  }
  if (Array.isArray(record.content)) {
    for (const child of record.content) walkReadableText(child, parts);
  }
}

export function extractReadableText(text: string | null | undefined): string {
  if (!text) return "";
  const stripped = text.trim();
  if (!stripped) return "";
  if (stripped.startsWith("{") || stripped.startsWith("[")) {
    try {
      const parsed = JSON.parse(stripped);
      const parts: string[] = [];
      walkReadableText(parsed, parts);
      if (parts.length > 0) return parts.join("\n");
    } catch {
      return stripped;
    }
  }
  return stripped;
}

export function sanitizeUserFacingError(
  message: string | null | undefined,
  fallback = "处理失败，请稍后重试",
): string {
  if (!message) return fallback;
  const trimmed = message.trim();
  if (!trimmed) return fallback;

  const lower = trimmed.toLowerCase();
  const unsafePatterns = [
    "traceback",
    "exception",
    "future pending",
    "attached to a different loop",
    "task <task",
    "sql",
    "asyncpg",
    "runtimeerror",
    "valueerror",
    "internal server error",
    "http error",
    "error:",
  ];

  if (unsafePatterns.some((pattern) => lower.includes(pattern))) {
    return fallback;
  }

  return trimmed;
}
