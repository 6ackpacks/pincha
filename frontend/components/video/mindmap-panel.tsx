"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { TreeStructure } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { getMindmap, regenerateMindmap, type MindmapResponse, type TranscriptSegment } from "@/lib/api";
import { seekFnAtom } from "@/atoms/player";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import type { Transformer as TransformerClass } from "markmap-lib";
import type { Markmap } from "markmap-view";

// Lazy-loaded markmap modules (module-level cache so they're only imported once)
let Transformer: typeof TransformerClass | null = null;
let MarkmapView: typeof Markmap | null = null;

// Parse [MM:SS] timestamp from a markdown line, return seconds or null
const TS_RE = /\[(\d{1,3}):(\d{2})\]/;

function parseTimestamp(text: string): number | null {
  const match = text.match(TS_RE);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

// Build a map: cleaned text → seconds from raw markdown
function buildTimestampMap(markdown: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of markdown.split("\n")) {
    const seconds = parseTimestamp(line);
    if (seconds === null) continue;
    const cleaned = line
      .replace(/^[#\-\*\s]+/, "")
      .replace(/\s*\[\d{1,3}:\d{2}\]\s*/, "")
      .trim();
    if (cleaned) {
      map.set(cleaned, seconds);
    }
  }
  return map;
}

// Remove all [MM:SS] from markdown so markmap renders clean text
function stripAllTimestamps(markdown: string): string {
  return markdown.replace(/\s*\[\d{1,3}:\d{2}\]/g, "");
}

interface MindmapPanelProps {
  videoId: string;
  isDone?: boolean;
  segments?: TranscriptSegment[];
}

export default function MindmapPanel({ videoId, isDone, segments }: MindmapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);
  const tsMapRef = useRef<Map<string, number>>(new Map());
  // Track the latest markdown so we can re-render if container wasn't ready
  const pendingMarkdownRef = useRef<string | null>(null);
  // Whether we have already successfully rendered (prevents double-render)
  const renderedRef = useRef(false);
  // AbortController to remove all event listeners before re-attaching
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const seekFn = useAtomValue(seekFnAtom);
  const [loadError, setLoadError] = useState<string | null>(null);

  const {
    data: mindmap,
    isLoading,
    isError,
    error,
  } = useQuery<MindmapResponse>({
    queryKey: ["mindmap", videoId],
    queryFn: () => getMindmap(videoId),
    enabled: isDone === true,
  });

  const regenerate = useMutation({
    mutationFn: () => regenerateMindmap(videoId),
    onSuccess: (data) => {
      // Force a full re-render on regeneration
      renderedRef.current = false;
      queryClient.setQueryData(["mindmap", videoId], data);
    },
  });

  // Match node text to timestamp and attach click handlers
  const attachClickHandlers = useCallback(() => {
    if (!svgRef.current || !seekFn || tsMapRef.current.size === 0) return;

    // Abort previous listeners to prevent accumulation (memory leak fix)
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const tsMap = tsMapRef.current;

    const nodes: HTMLElement[] = [];
    svgRef.current.querySelectorAll("foreignObject").forEach((fo) => {
      const el = fo.querySelector("div, span") as HTMLElement | null;
      if (el) nodes.push(el);
    });
    if (nodes.length === 0) {
      svgRef.current.querySelectorAll("text").forEach((t) => nodes.push(t as unknown as HTMLElement));
    }

    nodes.forEach((el) => {
      const text = (el.textContent || "").trim();
      let seconds: number | undefined;
      seconds = tsMap.get(text);
      if (seconds === undefined) {
        for (const [key, val] of tsMap) {
          if (text.includes(key) || key.includes(text)) {
            seconds = val;
            break;
          }
        }
      }
      if (seconds === undefined) return;

      const secs = seconds;
      el.style.cursor = "pointer";
      el.style.transition = "color 0.15s";

      el.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        seekFn(secs);
      }, { signal });
      el.addEventListener("mouseenter", () => { el.style.color = "#10b981"; }, { signal });
      el.addEventListener("mouseleave", () => { el.style.color = ""; }, { signal });
    });
  }, [seekFn]);

  const renderMarkmap = useCallback(async (markdown: string) => {
    if (!svgRef.current || !containerRef.current) return;

    // Read actual rendered dimensions from the container DOM element
    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width || containerRef.current.offsetWidth;
    const height = rect.height || containerRef.current.offsetHeight;

    // Container not yet in the layout (e.g. parent tab is display:none) — save
    // for later so ResizeObserver can flush it once the tab becomes visible.
    // Still fall through with a safe default size so markmap can pre-build its
    // internal layout; the fit() call in ResizeObserver will correct positioning.
    const effectiveWidth = width > 0 ? width : 600;
    const effectiveHeight = height > 0 ? height : 500;

    if (width <= 0 || height <= 0) {
      pendingMarkdownRef.current = markdown;
      // Don't return — fall through and render with fallback dimensions so the
      // SVG content is ready before the tab is revealed.
    }

    try {
      if (!Transformer) {
        const lib = await import("markmap-lib");
        Transformer = lib.Transformer;
      }
      if (!MarkmapView) {
        const view = await import("markmap-view");
        MarkmapView = view.Markmap;
      }

      // Build timestamp map from raw markdown before stripping
      tsMapRef.current = buildTimestampMap(markdown);

      // Strip timestamps so markmap renders clean text
      const cleanMarkdown = stripAllTimestamps(markdown);

      // Re-check ref after async imports — component may have unmounted during await
      if (!svgRef.current) return;

      // Set explicit pixel dimensions on SVG — required by markmap to calculate layout
      svgRef.current.setAttribute("width", String(effectiveWidth));
      svgRef.current.setAttribute("height", String(effectiveHeight));

      const transformer = new Transformer();
      // 禁用 HTML 解析，防止 LLM 生成的内容注入脚本（存储型 XSS）
      const md = transformer.md as { set?: (opts: { html: boolean }) => void };
      md?.set?.({ html: false });
      const { root } = transformer.transform(cleanMarkdown);

      // Destroy previous instance and clear SVG children
      if (mmRef.current) {
        try { mmRef.current.destroy(); } catch {}
        mmRef.current = null;
      }
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }

      mmRef.current = MarkmapView.create(svgRef.current, {
        maxWidth: 300,
        paddingX: 16,
        spacingVertical: 8,
        spacingHorizontal: 80,
        autoFit: true,
        duration: 300,
        initialExpandLevel: 3,
      });

      mmRef.current.setData(root);
      renderedRef.current = true;
      pendingMarkdownRef.current = null;

      // Give markmap one animation frame to paint before fitting + wiring clicks
      setTimeout(() => {
        if (mmRef.current) {
          // Re-sync SVG size in case the container shifted during async import
          if (svgRef.current && containerRef.current) {
            const r = containerRef.current.getBoundingClientRect();
            if (r.width > 0) {
              svgRef.current.setAttribute("width", String(r.width));
              svgRef.current.setAttribute("height", String(r.height));
            }
          }
          mmRef.current.fit();
        }
        attachClickHandlers();
      }, 350);
    } catch (err) {
      console.error("Mindmap render failed:", err);
    }
  }, [attachClickHandlers]);

  // ResizeObserver: keep SVG in sync with container, and flush pending renders
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width <= 0 || height <= 0) return;

      if (svgRef.current) {
        svgRef.current.setAttribute("width", String(width));
        svgRef.current.setAttribute("height", String(height));
      }

      if (mmRef.current) {
        // Already rendered — just refit to new size
        mmRef.current.fit();
      } else if (pendingMarkdownRef.current) {
        // Data arrived before layout was ready — render now
        const md = pendingMarkdownRef.current;
        pendingMarkdownRef.current = null;
        renderMarkmap(md);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [renderMarkmap]);

  // Trigger render whenever markdown data changes
  useEffect(() => {
    if (!mindmap?.markdown) return;
    // Always re-render when markdown changes (covers initial load + regeneration)
    renderedRef.current = false;
    renderMarkmap(mindmap.markdown);
  }, [mindmap?.markdown, renderMarkmap]);

  // Re-attach click handlers when seekFn becomes available after render
  useEffect(() => {
    if (mmRef.current && seekFn && tsMapRef.current.size > 0) {
      attachClickHandlers();
    }
  }, [seekFn, attachClickHandlers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (mmRef.current) {
        try { mmRef.current.destroy(); } catch {}
        mmRef.current = null;
      }
    };
  }, []);

  if (!isDone) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <TreeStructure size={36} weight="bold" className="text-zinc-300" />
        <p className="text-sm text-zinc-400 font-medium">内容整理完成后即可查看脉络图</p>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingPlaceholder message="思维导图生成中..." />;
  }

  if (isError || loadError) {
    return (
      <div className="flex flex-col items-center gap-3 h-full justify-center px-6">
        <TreeStructure size={36} weight="bold" className="text-red-300" />
        <div className="text-center">
          <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
            加载失败
          </p>
          <p className="text-xs text-red-500 dark:text-red-500">
            {loadError || (error as Error)?.message || "未知错误"}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoadError(null);
            queryClient.invalidateQueries({ queryKey: ["mindmap", videoId] });
          }}
        >
          重试
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col h-full"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 shrink-0 px-4 py-2.5 border-b border-zinc-100">
        {mindmap?.cached && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-600 px-2.5 py-1 text-[11px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            已缓存
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          {regenerate.isPending ? "生成中..." : "重新生成"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => mmRef.current?.fit()}>
          适应画布
        </Button>
        <span className="ml-auto text-[11px] text-emerald-600/70">
          点击节点回到对应片段
        </span>
      </div>

      {/* Markmap canvas — fills remaining height */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden bg-white/60"
      >
        <svg ref={svgRef} style={{ display: "block", width: "100%", height: "100%" }} />
      </div>

      {mindmap && (
        <div className="shrink-0 px-4 py-1.5 border-t border-zinc-100">
          <p className="text-[10px] text-zinc-400">
            模型: {mindmap.model_used} · 生成于 {new Date(mindmap.created_at).toLocaleString("zh-CN")}
          </p>
        </div>
      )}
    </motion.div>
  );
}
