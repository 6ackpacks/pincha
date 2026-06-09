import type { Chapter } from "@/components/video/chapter-bar";

/**
 * Parse "MM:SS" or "H:MM:SS" duration string to seconds.
 */
export function parseDurationToSeconds(duration: string | null | undefined): number {
  if (!duration) return 0;
  const parts = duration.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/**
 * Extract ## level nodes from mindmap markdown as chapters.
 */
export function extractChapters(markdown: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("## ")) continue;
    const match = line.match(/^##\s+(.+?)\s*\[(\d{1,3}):(\d{2})\]\s*$/);
    if (!match) continue;
    chapters.push({
      title: match[1].trim(),
      seconds: parseInt(match[2], 10) * 60 + parseInt(match[3], 10),
    });
  }
  return chapters;
}
