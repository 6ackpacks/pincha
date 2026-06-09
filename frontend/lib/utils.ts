import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
