"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Simulation } from "d3-force";
import { getLocalGraph } from "@/lib/api";
import { getNodeTypeColor } from "@/lib/constants/community-colors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocalGraphProps {
  pageId: string;
  currentSlug: string;
  onSelectSlug: (slug: string) => void;
}

interface SimNode {
  id: string;
  slug: string;
  title: string;
  type: string;
  isCenter: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  radius: number;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  relationType: string;
  strength: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEIGHT = 280;
const CENTER_RADIUS = 4;
const NODE_RADIUS = 2.5;
const CENTER_COLOR = "#34d399"; // emerald-400
const HOVER_EDGE_COLOR = "rgba(52,211,153,0.8)";
const LABEL_FONT = "11px system-ui, sans-serif";
const MAX_LABEL_CHARS = 10;
const MAX_VISIBLE_NODES = 12;

function truncLabel(title: string): string {
  return title.length > MAX_LABEL_CHARS ? title.slice(0, MAX_LABEL_CHARS) + "…" : title;
}

/** Damped spring: 0→1 with elastic overshoot, settles by 600ms */
function springScale(elapsed: number): number {
  if (elapsed > 600) return 1;
  return 1 - Math.exp(-elapsed * 0.01) * Math.cos(elapsed * 0.02);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LocalGraph({ pageId, currentSlug, onSelectSlug }: LocalGraphProps) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const d3Ref = useRef<typeof import("d3-force") | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const rafRef = useRef<number>(0);
  const hoveredRef = useRef<string | null>(null);
  const widthRef = useRef(288);

  // Effect 1: Smooth hover transition
  const hoverProgressRef = useRef(0);
  const hoverTargetRef = useRef<string | null>(null);

  // Effect 4: Node entrance spring animation
  const nodeEntryTimeRef = useRef<Map<string, number>>(new Map());

  const { data } = useQuery({
    queryKey: ["local-graph", pageId, depth],
    queryFn: () => getLocalGraph(pageId, depth),
    enabled: !!pageId,
    staleTime: 60_000,
  });

  // Build simulation when data changes
  useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    let cancelled = false;

    import("d3-force").then((d3) => {
      if (cancelled) return;
      d3Ref.current = d3;

      const w = containerRef.current?.clientWidth || 288;
      widthRef.current = w;

      // Limit visible nodes: keep center + top-N strongest connections
      let visibleNodes = data.nodes;
      let visibleEdges = data.edges;
      if (data.nodes.length > MAX_VISIBLE_NODES) {
        const centerNode = data.nodes.find((n) => n.is_center);
        const centerNodeId = centerNode?.id;
        // Score non-center nodes by edge strength to center
        const nodeScores = new Map<string, number>();
        for (const e of data.edges) {
          if (e.from_id === centerNodeId) {
            nodeScores.set(e.to_id, Math.max(nodeScores.get(e.to_id) || 0, e.strength));
          } else if (e.to_id === centerNodeId) {
            nodeScores.set(e.from_id, Math.max(nodeScores.get(e.from_id) || 0, e.strength));
          }
        }
        const sortedIds = [...nodeScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_VISIBLE_NODES - 1)
          .map(([id]) => id);
        const keepIds = new Set(centerNodeId ? [centerNodeId, ...sortedIds] : sortedIds);
        visibleNodes = data.nodes.filter((n) => keepIds.has(n.id));
        visibleEdges = data.edges.filter((e) => keepIds.has(e.from_id) && keepIds.has(e.to_id));
      }

      const nodes: SimNode[] = visibleNodes.map((n) => ({
        id: n.id,
        slug: n.slug,
        title: n.title,
        type: n.type,
        isCenter: n.is_center,
        x: (Math.random() - 0.5) * w * 0.5,
        y: (Math.random() - 0.5) * HEIGHT * 0.5,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        radius: n.is_center ? CENTER_RADIUS : NODE_RADIUS,
      }));

      // Edge pruning: only keep strong edges, guarantee each node ≥1 link
      const sortedEdges = [...visibleEdges].sort((a, b) => (b.strength || 0.5) - (a.strength || 0.5));
      const edgeStrengths = sortedEdges.map((e) => e.strength || 0.5);
      const threshold = edgeStrengths.length > 0
        ? Math.max(edgeStrengths[Math.floor(edgeStrengths.length * 0.4)], 0.3)
        : 0.3;

      const prunedEdges: typeof sortedEdges = [];
      const localEdgeCount = new Map<string, number>();
      for (const e of sortedEdges) {
        if ((e.strength || 0.5) < threshold) break;
        const fc = localEdgeCount.get(e.from_id) || 0;
        const tc = localEdgeCount.get(e.to_id) || 0;
        if (fc < 2 && tc < 2) {
          prunedEdges.push(e);
          localEdgeCount.set(e.from_id, fc + 1);
          localEdgeCount.set(e.to_id, tc + 1);
        }
      }
      // Ensure every node has at least 1 connection
      const connectedLocal = new Set<string>();
      for (const e of prunedEdges) { connectedLocal.add(e.from_id); connectedLocal.add(e.to_id); }
      for (const n of nodes) {
        if (connectedLocal.has(n.id)) continue;
        const best = sortedEdges.find((e) =>
          (e.from_id === n.id || e.to_id === n.id) && !prunedEdges.includes(e)
        );
        if (best) {
          prunedEdges.push(best);
          connectedLocal.add(best.from_id);
          connectedLocal.add(best.to_id);
        }
      }

      const links: SimLink[] = prunedEdges.map((e) => ({
        source: e.from_id,
        target: e.to_id,
        relationType: e.relation_type,
        strength: e.strength,
      }));

      nodesRef.current = nodes;
      linksRef.current = links;

      // Effect 4: Record entry times for new nodes
      const now = performance.now();
      const entryMap = nodeEntryTimeRef.current;
      for (const n of nodes) {
        if (!entryMap.has(n.id)) {
          entryMap.set(n.id, now);
        }
      }

      if (simRef.current) simRef.current.stop();

      const sim = d3
        .forceSimulation<SimNode>(nodes)
        .alphaDecay(0.06)
        .velocityDecay(0.65)
        .force(
          "link",
          d3
            .forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance(70)
            .strength(0.6),
        )
        .force("charge", d3.forceManyBody<SimNode>().strength(-150).distanceMax(200))
        .force("center", d3.forceCenter(0, 0).strength(0.12))
        .force(
          "collide",
          d3.forceCollide<SimNode>().radius((d) => d.radius + 12).strength(0.7),
        );

      simRef.current = sim;

      // Render loop
      cancelAnimationFrame(rafRef.current);
      function draw() {
        if (cancelled) return;
        if (document.hidden) {
          rafRef.current = requestAnimationFrame(draw);
          return;
        }
        render();
        rafRef.current = requestAnimationFrame(draw);
      }
      rafRef.current = requestAnimationFrame(draw);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (simRef.current) {
        simRef.current.stop();
        simRef.current = null;
      }
    };
  }, [data]);

  // Canvas render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = widthRef.current;
    const h = HEIGHT;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const nodes = nodesRef.current;
    const links = linksRef.current;
    const hovered = hoveredRef.current;

    // --- Effect 1: Smooth hover transition ---
    if (hovered !== hoverTargetRef.current) {
      hoverTargetRef.current = hovered;
    }
    if (hoverTargetRef.current !== null) {
      hoverProgressRef.current = Math.min(1, hoverProgressRef.current + 0.14);
    } else {
      hoverProgressRef.current = Math.max(0, hoverProgressRef.current - 0.05);
    }
    const progress = hoverProgressRef.current;

    // Animation time for breathing
    const t = performance.now();

    const ox = w / 2;
    const oy = h / 2;

    // Build adjacency for hover highlight
    const adjSet = new Set<string>();
    if (hovered) {
      for (const l of links) {
        const sid = typeof l.source === "string" ? l.source : l.source.id;
        const tid = typeof l.target === "string" ? l.target : l.target.id;
        if (sid === hovered || tid === hovered) {
          adjSet.add(sid);
          adjSet.add(tid);
        }
      }
    }

    // --- Effect 4: Clean up settled entries (>600ms) ---
    const entryMap = nodeEntryTimeRef.current;
    for (const [nid, entryTime] of entryMap) {
      if (t - entryTime > 600) entryMap.delete(nid);
    }

    // Draw edges with subtle curves
    for (const l of links) {
      const s = typeof l.source === "string" ? nodes.find((n) => n.id === l.source) : l.source;
      const tgt = typeof l.target === "string" ? nodes.find((n) => n.id === l.target) : l.target;
      if (!s || !tgt) continue;

      const sid = s.id;
      const tid = tgt.id;
      const isHighlighted = hovered && (sid === hovered || tid === hovered);
      const isDimmed = hovered && !isHighlighted;

      const sx = ox + s.x;
      const sy = oy + s.y;
      const tx = ox + tgt.x;
      const ty = oy + tgt.y;

      // Quadratic bezier curve — offset control point perpendicular to edge
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const dx = tx - sx;
      const dy = ty - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      const curvature = 0.15;
      const cpx = mx + (-dy / len) * len * curvature;
      const cpy = my + (dx / len) * len * curvature;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cpx, cpy, tx, ty);

      if (l.relationType === "contradicts") {
        ctx.setLineDash(isHighlighted ? [4, 3] : [3, 3]);
        ctx.lineDashOffset = isHighlighted ? -(t * 0.04) % 14 : -(t * 0.02) % 20;
        const baseAlpha = isDimmed ? (0.3 - 0.25 * progress) : 0.4;
        ctx.strokeStyle = `rgba(239,68,68,${baseAlpha})`;
      } else if (isHighlighted) {
        ctx.setLineDash([]);
        ctx.strokeStyle = HOVER_EDGE_COLOR;
      } else {
        ctx.setLineDash([]);
        const baseAlpha = isDimmed ? (0.2 - 0.15 * progress) : 0.25;
        ctx.strokeStyle = `rgba(148,163,184,${baseAlpha})`;
      }
      ctx.lineWidth = isHighlighted ? 1.5 : 0.7;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw nodes
    for (const n of nodes) {
      const nx = ox + n.x;
      const ny = oy + n.y;
      const isHovered = n.id === hovered;
      const isAdj = adjSet.has(n.id);
      const isDimmed = hovered && !isHovered && !isAdj;

      const color = n.isCenter ? CENTER_COLOR : getNodeTypeColor(n.type);

      // --- Effect 4: Node entrance spring ---
      const entryTime = entryMap.get(n.id);
      const entryScale = entryTime !== undefined ? springScale(t - entryTime) : 1;

      // --- Effect 1: Smooth hover size ---
      const hoverScale = isHovered ? (1 + 0.4 * progress) : 1;

      const r = n.radius * hoverScale * entryScale;

      // --- Glow ring on hover or center node ---
      if ((isHovered && progress > 0) || n.isCenter) {
        const glowAlpha = isHovered ? 0.3 * progress : 0.15;
        const glowRadius = isHovered ? r + 6 : r + 3;
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = isHovered ? 14 * progress : 6;
        ctx.beginPath();
        ctx.arc(nx, ny, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = mixAlpha(color, glowAlpha);
        ctx.fill();
        ctx.restore();
      }

      // Main node circle
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      const nodeAlpha = isDimmed ? (1 - 0.7 * progress) : 1;
      ctx.fillStyle = nodeAlpha < 1 ? mixAlpha(color, nodeAlpha) : color;
      ctx.fill();

      // Label
      const labelAlpha = isDimmed ? (1 - 0.7 * progress) : 1;
      const labelEntryAlpha = entryTime !== undefined ? Math.min(1, springScale(t - entryTime)) : 1;
      const finalLabelAlpha = labelAlpha * labelEntryAlpha;
      if (finalLabelAlpha > 0.05) {
        ctx.font = isHovered ? `bold ${LABEL_FONT}` : LABEL_FONT;
        ctx.fillStyle = isHovered
          ? `rgba(15,23,42,${(0.95 * finalLabelAlpha).toFixed(2)})`
          : `rgba(51,65,85,${(0.8 * finalLabelAlpha).toFixed(2)})`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(truncLabel(n.title), nx, ny + r + 3);
      }
    }
  }, []);

  // Mouse interaction (drag + click distinction)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function hitTest(e: MouseEvent): SimNode | null {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left - widthRef.current / 2;
      const my = e.clientY - rect.top - HEIGHT / 2;
      const nodes = nodesRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = n.x - mx;
        const dy = n.y - my;
        if (dx * dx + dy * dy < (n.radius + 6) ** 2) return n;
      }
      return null;
    }

    let dragNode: SimNode | null = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let hasDragged = false;

    function onDown(e: MouseEvent) {
      const hit = hitTest(e);
      if (!hit) return;
      dragNode = hit;
      hasDragged = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      // Fix ALL nodes so only the dragged one moves
      const nodes = nodesRef.current;
      for (const n of nodes) {
        n.fx = n.x;
        n.fy = n.y;
      }
      if (simRef.current) {
        simRef.current.alphaTarget(0.3).restart();
      }
      e.preventDefault();
    }

    function onMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left - widthRef.current / 2;
      const my = e.clientY - rect.top - HEIGHT / 2;

      if (dragNode) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          hasDragged = true;
        }
        // Move pinned node to mouse position
        dragNode.fx = mx;
        dragNode.fy = my;
        canvas!.style.cursor = "grabbing";
        return; // skip hover hit test during drag
      }

      // Normal hover hit test
      const hit = hitTest(e);
      const newId = hit?.id ?? null;
      if (newId !== hoveredRef.current) {
        hoveredRef.current = newId;
        canvas!.style.cursor = newId ? "pointer" : "default";
      }
    }

    function onUp(_e: MouseEvent) {
      if (dragNode) {
        if (!hasDragged) {
          onSelectSlug(dragNode.slug);
        }
        // Release ALL nodes
        const nodes = nodesRef.current;
        for (const n of nodes) {
          n.fx = null;
          n.fy = null;
        }
        if (simRef.current && d3Ref.current) {
          simRef.current.alphaTarget(0);
        }
        dragNode = null;
        hasDragged = false;
        canvas!.style.cursor = "default";
      }
    }

    function onLeave() {
      if (dragNode) {
        const nodes = nodesRef.current;
        for (const n of nodes) {
          n.fx = null;
          n.fy = null;
        }
        if (simRef.current && d3Ref.current) {
          simRef.current.alphaTarget(0);
        }
        dragNode = null;
        hasDragged = false;
      }
      hoveredRef.current = null;
      canvas!.style.cursor = "default";
    }

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [onSelectSlug]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        widthRef.current = entry.contentRect.width;
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  if (!data || data.nodes.length === 0) {
    return (
      <div className="text-xs text-zinc-400 text-center py-4">暂无关联节点</div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-zinc-100 bg-zinc-50/50"
        style={{ height: HEIGHT }}
      />
      <div className="flex gap-1 mt-1.5 justify-center">
        {([1, 2] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDepth(d)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${
              depth === d
                ? "bg-zinc-800 text-white font-bold"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {d} 跳
          </button>
        ))}
      </div>
    </div>
  );
}

function mixAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
