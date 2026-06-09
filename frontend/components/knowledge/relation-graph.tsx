"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getWikiGraph } from "@/lib/api";
import { CircleNotch } from "@phosphor-icons/react";
import { activeKbIdAtom } from "@/atoms/kb";
import { useAtom } from "jotai";
import { getCommunityColor } from "@/lib/constants/community-colors";
import {
  BASE_NODE_SIZE,
  LABEL_SIZE,
  mixColor,
  positionCache,
  clearPositionCache,
  buildGraph,
} from "./relation-graph-utils";
import { RelationGraphControls } from "./relation-graph-controls";

interface RelationGraphProps {
  onSelectSlug?: (slug: string) => void;
}

export function RelationGraph({ onSelectSlug }: RelationGraphProps = {}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const hiddenNodeIdsRef = useRef<Set<string>>(new Set());
  const hoverAnimRef = useRef<{ target: string | null; prevTarget: string | null; progress: number }>({
    target: null, prevTarget: null, progress: 0,
  });
  const filterAnimRef = useRef<Map<string, number>>(new Map());
  const [colorMode, setColorMode] = useState<"type" | "community">("type");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hideOrphans, setHideOrphans] = useState(false);
  const [activeKbId] = useAtom(activeKbIdAtom);
  const prevKbIdRef = useRef<string | null | undefined>(undefined);

  // Clear position cache when KB changes
  useEffect(() => {
    if (prevKbIdRef.current === undefined) {
      prevKbIdRef.current = activeKbId;
      return;
    }
    if (prevKbIdRef.current !== activeKbId) {
      prevKbIdRef.current = activeKbId;
      clearPositionCache();
    }
  }, [activeKbId]);

  const { data: graphData, isLoading, isError } = useQuery({
    queryKey: ["wiki-graph", activeKbId],
    queryFn: getWikiGraph,
    refetchOnWindowFocus: true,
  });

  const handleClick = useCallback(
    (slug: string) => {
      if (onSelectSlug) onSelectSlug(slug);
      else router.push(`/knowledge/${slug}`);
    },
    [router, onSelectSlug],
  );

  useEffect(() => {
    if (!graphData || graphData.nodes.length === 0 || !containerRef.current) return;

    let cancelled = false;

    Promise.all([
      import("graphology").then((m) => m.default),
      import("sigma").then((m) => m.default),
      import("graphology-layout-forceatlas2"),
    ]).then(([Graph, Sigma, fa2Module]) => {
      if (cancelled || !containerRef.current) return;

      const forceAtlas2 = (fa2Module as any).default || fa2Module;

      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);

      // Build graph using extracted utility
      const { graph, allCached, isNewLayout } = buildGraph(Graph, forceAtlas2, graphData, colorMode);

      // ── Filter animation RAF loop ─────────────────────────────────────
      const nodeIds = graph.nodes();

      function updateFilters() {
        if (cancelled) return;
        const filterAnim = filterAnimRef.current;
        const hiddenSet = hiddenNodeIdsRef.current;
        let needsRefresh = false;

        for (const nodeId of nodeIds) {
          const shouldHide = hiddenSet.has(nodeId);
          const currentVis = filterAnim.get(nodeId) ?? (shouldHide ? 0 : 1);
          let nextVis = currentVis;
          if (shouldHide && currentVis > 0) { nextVis = Math.max(0, currentVis - 0.1); needsRefresh = true; }
          else if (!shouldHide && currentVis < 1) { nextVis = Math.min(1, currentVis + 0.1); needsRefresh = true; }
          if (nextVis !== currentVis) {
            filterAnim.set(nodeId, nextVis);
            graph.setNodeAttribute(nodeId, "filterVis", nextVis);
          }
        }

        if (needsRefresh && sigmaRef.current) sigmaRef.current.refresh({ skipIndexation: true });
        rafRef.current = requestAnimationFrame(updateFilters);
      }
      rafRef.current = requestAnimationFrame(updateFilters);

      // ── Label collision avoidance ─────────────────────────────────────
      let labelRects: { x: number; y: number; w: number; h: number }[] = [];
      let lastLabelFrame = 0;

      function rectsOverlap(
        a: { x: number; y: number; w: number; h: number },
        b: { x: number; y: number; w: number; h: number },
      ): boolean {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      }

      // ── Sigma renderer ────────────────────────────────────────────────
      const sigma = new Sigma(graph, containerRef.current, {
        allowInvalidContainer: true,
        labelSize: LABEL_SIZE,
        labelWeight: "bold",
        labelColor: { color: "#1e293b" },
        labelDensity: 0.4,
        labelRenderedSizeThreshold: 6,
        stagePadding: 50,
        defaultEdgeType: "line",
        defaultDrawNodeLabel: (context, data, settings) => {
          if (!data.label) return;

          const size = settings.labelSize;
          const isHovered = data.highlighted || (data as any).forceLabel;
          const fontSize = isHovered ? size + 4 : size;
          const font = `${isHovered ? "700" : "bold"} ${fontSize}px sans-serif`;

          context.font = font;
          const textWidth = context.measureText(data.label).width;

          const nodeSize = data.size || 4;
          const x = data.x + nodeSize + 4;
          const y = data.y + fontSize / 3;

          const now = performance.now();
          if (now - lastLabelFrame > 10) {
            labelRects = [];
            lastLabelFrame = now;
          }

          const rect = { x, y: data.y - fontSize / 2, w: textWidth + 8, h: fontSize + 4 };

          if (!isHovered) {
            for (const existing of labelRects) {
              if (rectsOverlap(rect, existing)) return;
            }
          }
          labelRects.push(rect);

          if (isHovered) {
            const padding = 4;
            const bgX = x - padding;
            const bgY = data.y - fontSize / 2 - padding + 2;
            const bgW = textWidth + padding * 2;
            const bgH = fontSize + padding * 2;

            context.beginPath();
            context.roundRect(bgX, bgY, bgW, bgH, 4);
            context.fillStyle = "rgba(255,255,255,0.95)";
            context.fill();

            context.fillStyle = "#1e293b";
            context.fillText(data.label, x, y);
          } else {
            context.fillStyle = "#1e293b";
            context.fillText(data.label, x, y);
          }
        },
        defaultDrawNodeHover: (context, data) => {
          if (!data.label) return;
          const fontSize = LABEL_SIZE + 5;
          context.font = `700 ${fontSize}px sans-serif`;
          const textWidth = context.measureText(data.label).width;
          const nodeSize = data.size || 4;
          const x = data.x + nodeSize + 5;
          const y = data.y + fontSize / 3;
          const padding = 5;

          context.beginPath();
          context.roundRect(x - padding, data.y - fontSize / 2 - padding + 2, textWidth + padding * 2, fontSize + padding * 2, 5);
          context.fillStyle = "rgba(255,255,255,0.95)";
          context.fill();
          context.fillStyle = "#1e293b";
          context.fillText(data.label, x, y);
        },
        renderLabels: true,
        zoomingRatio: 1.3,
        minCameraRatio: 0.08,
        maxCameraRatio: 8,
        nodeReducer: (node, data) => {
          const res = { ...data };
          const originalColor = data.originalColor || data.color || "#94a3b8";
          const originalSize = data.originalSize || data.size || BASE_NODE_SIZE;
          const filterVis = data.filterVis ?? 1;

          if (filterVis <= 0) { res.hidden = true; return res; }
          if (filterVis < 1) {
            res.size = originalSize * filterVis;
            res.color = mixColor(originalColor, "#f8fafc", 1 - filterVis);
          }

          if (res.label && res.label.length > 12) {
            res.label = res.label.slice(0, 12) + "\u2026";
          }

          const hoveredNode = (containerRef.current as any)?.__hoveredNode ?? null;

          if (hoveredNode && graph.hasNode(hoveredNode)) {
            if (node === hoveredNode) {
              res.size = originalSize * 1.4;
              res.zIndex = 10;
              res.forceLabel = true;
              res.highlighted = true;
              res.label = graph.getNodeAttribute(node, "label") || res.label;
            } else if (graph.areNeighbors(node, hoveredNode)) {
              res.forceLabel = true;
              res.highlighted = true;
              res.label = graph.getNodeAttribute(node, "label") || res.label;
            } else {
              res.color = mixColor(originalColor, "#e2e8f0", 0.75);
              res.label = "";
              res.size = originalSize * 0.6;
            }
          }

          return res;
        },
        edgeReducer: (edge, data) => {
          const res = { ...data };
          const [source, target] = graph.extremities(edge);

          const srcVis = graph.hasNode(source) ? (graph.getNodeAttribute(source, "filterVis") ?? 1) : 1;
          const tgtVis = graph.hasNode(target) ? (graph.getNodeAttribute(target, "filterVis") ?? 1) : 1;
          const minVis = Math.min(srcVis, tgtVis);
          if (minVis <= 0) { res.hidden = true; return res; }
          if (minVis < 1) {
            res.size = (data.originalSize || data.size || 0.5) * minVis;
            res.color = `rgba(100,116,139,${(minVis * 0.3).toFixed(2)})`;
          }

          const hoveredNode = (containerRef.current as any)?.__hoveredNode ?? null;

          if (hoveredNode) {
            if (source === hoveredNode || target === hoveredNode) {
              res.color = "#1e293b";
              res.size = Math.max(2, (data.originalSize || 0.5) * 1.5);
            } else {
              res.color = "#f1f5f9";
              res.size = 0.3;
            }
          }
          return res;
        },
      });

      // ── Hover events ──────────────────────────────────────────────────
      sigma.on("enterNode", ({ node }) => {
        if (containerRef.current) {
          (containerRef.current as any).__hoveredNode = node;
          containerRef.current.style.cursor = "pointer";
        }
        sigma.refresh();
      });

      sigma.on("leaveNode", () => {
        if (containerRef.current) {
          (containerRef.current as any).__hoveredNode = null;
          containerRef.current.style.cursor = "default";
        }
        sigma.refresh();
      });

      // ── Drag: move node position directly ────────────────────────────
      let draggedNodeId: string | null = null;
      let dragStartPos = { x: 0, y: 0 };
      let isDragMove = false;

      sigma.on("downNode", ({ node, event }) => {
        draggedNodeId = node;
        isDragMove = false;
        const orig = event.original;
        if ("clientX" in orig) {
          dragStartPos = { x: (orig as MouseEvent).clientX, y: (orig as MouseEvent).clientY };
        } else if ("touches" in orig && (orig as TouchEvent).touches.length > 0) {
          dragStartPos = { x: (orig as TouchEvent).touches[0].clientX, y: (orig as TouchEvent).touches[0].clientY };
        }
        event.preventSigmaDefault();
        event.original.preventDefault();
      });

      sigma.getMouseCaptor().on("mousemovebody", (e) => {
        if (!draggedNodeId) return;
        const orig = e.original;
        let cx = 0, cy = 0;
        if ("clientX" in orig) {
          cx = (orig as MouseEvent).clientX;
          cy = (orig as MouseEvent).clientY;
        } else if ("touches" in orig && (orig as TouchEvent).touches.length > 0) {
          cx = (orig as TouchEvent).touches[0].clientX;
          cy = (orig as TouchEvent).touches[0].clientY;
        }
        const dx = cx - dragStartPos.x;
        const dy = cy - dragStartPos.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragMove = true;
        const pos = sigma.viewportToGraph({ x: e.x, y: e.y });
        graph.setNodeAttribute(draggedNodeId, "x", pos.x);
        graph.setNodeAttribute(draggedNodeId, "y", pos.y);
        positionCache.set(draggedNodeId, { x: pos.x, y: pos.y });
      });

      const endDrag = () => {
        if (!draggedNodeId) return;
        const nodeId = draggedNodeId;
        if (!isDragMove) {
          const slug = graph.getNodeAttribute(nodeId, "slug");
          if (slug) handleClick(slug);
        }
        draggedNodeId = null;
        isDragMove = false;
      };

      sigma.getMouseCaptor().on("mouseup", endDrag);
      sigma.getMouseCaptor().on("mouseleave", endDrag);

      // Camera auto-fit after layout
      if (!(allCached && !isNewLayout)) {
        setTimeout(() => {
          if (cancelled || !sigmaRef.current) return;
          const camera = sigmaRef.current.getCamera();
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          graph.forEachNode((_nodeId: string, attrs: any) => {
            if (attrs.x < minX) minX = attrs.x;
            if (attrs.x > maxX) maxX = attrs.x;
            if (attrs.y < minY) minY = attrs.y;
            if (attrs.y > maxY) maxY = attrs.y;
          });
          if (minX === Infinity) {
            camera.animatedReset({ duration: 400 });
            return;
          }
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const graphToCamera = sigmaRef.current.graphToViewport({ x: cx, y: cy });
          const dims = sigmaRef.current.getDimensions();
          const graphWidth = maxX - minX || 1;
          const graphHeight = maxY - minY || 1;
          const topLeft = sigmaRef.current.graphToViewport({ x: minX, y: minY });
          const bottomRight = sigmaRef.current.graphToViewport({ x: maxX, y: maxY });
          const viewWidth = Math.abs(bottomRight.x - topLeft.x);
          const viewHeight = Math.abs(bottomRight.y - topLeft.y);
          const padding = 0.85;
          const ratioX = viewWidth / (dims.width * padding);
          const ratioY = viewHeight / (dims.height * padding);
          const newRatio = Math.max(ratioX, ratioY, 0.08);
          camera.animate(
            { x: 0.5, y: 0.5, ratio: newRatio },
            { duration: 400 },
          );
        }, 100);
      }

      sigmaRef.current = sigma;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [graphData, colorMode, handleClick]);

  // Compute available node types from graph data
  const availableTypes = useMemo(() => {
    if (!graphData) return [];
    const types = new Set<string>();
    for (const n of graphData.nodes) {
      types.add(n.type || "concept");
    }
    return [...types];
  }, [graphData]);

  // Compute which nodes should be hidden by filters
  const hiddenNodeIds = useMemo(() => {
    if (!graphData) return new Set<string>();
    const hidden = new Set<string>();

    const connCount = new Map<string, number>();
    for (const n of graphData.nodes) connCount.set(n.id, 0);
    for (const e of graphData.edges) {
      const fromType = graphData.nodes.find((n) => n.id === e.from_id)?.type || "concept";
      const toType = graphData.nodes.find((n) => n.id === e.to_id)?.type || "concept";
      if (!hiddenTypes.has(fromType) && !hiddenTypes.has(toType)) {
        connCount.set(e.from_id, (connCount.get(e.from_id) || 0) + 1);
        connCount.set(e.to_id, (connCount.get(e.to_id) || 0) + 1);
      }
    }

    for (const n of graphData.nodes) {
      const nodeType = n.type || "concept";
      if (hiddenTypes.has(nodeType)) {
        hidden.add(n.id);
        continue;
      }
      if (hideOrphans && (connCount.get(n.id) || 0) === 0) {
        hidden.add(n.id);
      }
    }
    return hidden;
  }, [graphData, hiddenTypes, hideOrphans]);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Keep ref in sync and refresh sigma when filters change
  useEffect(() => {
    hiddenNodeIdsRef.current = hiddenNodeIds;
    if (sigmaRef.current) sigmaRef.current.refresh();
  }, [hiddenNodeIds]);

  const communityLegend = useMemo(() => {
    if (!graphData) return [];
    const seen = new Map<number, string>();
    for (const n of graphData.nodes) {
      if (n.community_id != null && !seen.has(n.community_id)) {
        seen.set(n.community_id, getCommunityColor(n.community_id));
      }
    }
    return [...seen.entries()].map(([id, color]) => ({ id, color }));
  }, [graphData]);

  if (isLoading && !isError) {
    return (
      <div className="flex justify-center py-20">
        <CircleNotch size={24} weight="bold" className="animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-zinc-500 font-bold mb-1">暂无关系图谱</p>
        <p className="text-zinc-400 text-sm">加入更多视频后，知识词条之间的关系将在这里展示</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 overflow-hidden h-full flex flex-col bg-slate-50">
      <div ref={containerRef} className="flex-1 min-h-0 relative" style={{ background: "#f8fafc" }} />
      <RelationGraphControls
        colorMode={colorMode}
        setColorMode={setColorMode}
        hiddenTypes={hiddenTypes}
        toggleType={toggleType}
        hideOrphans={hideOrphans}
        setHideOrphans={setHideOrphans}
        communityLegend={communityLegend}
        onReset={() => { setHiddenTypes(new Set()); setHideOrphans(false); }}
      />
    </div>
  );
}
