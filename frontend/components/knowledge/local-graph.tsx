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
const CENTER_RADIUS = 5;
const NODE_RADIUS = 3;
const CENTER_COLOR = "#34d399"; // emerald-400
const HOVER_EDGE_COLOR = "rgba(52,211,153,0.8)";
const LABEL_FONT = "11px system-ui, sans-serif";
const MAX_LABEL_CHARS = 8;
const MAX_VISIBLE_NODES = 12;
const LABEL_BUDGET = 8;

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
  const [transitioning, setTransitioning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const d3Ref = useRef<typeof import("d3-force") | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);
  const hoveredRef = useRef<string | null>(null);
  const widthRef = useRef(288);

  // Effect 1: Smooth hover transition
  const hoverProgressRef = useRef(0);
  const hoverTargetRef = useRef<string | null>(null);

  // Effect 4: Node entrance spring animation
  const nodeEntryTimeRef = useRef<Map<string, number>>(new Map());

  // Keeps a stable handle to the latest render fn for use in the resize observer
  const renderRef = useRef<() => void>(() => {});

  const { data, isLoading, isError, refetch } = useQuery({
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
        .alphaDecay(0.04)
        .alphaMin(0.005)
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
        )
        .stop();

      simRef.current = sim;

      // Start/stop RAF loop — stops when simulation cools
      cancelAnimationFrame(rafRef.current);
      runningRef.current = false;

      function startLoop() {
        if (runningRef.current || cancelled) return;
        runningRef.current = true;
        function tick() {
          if (cancelled || !runningRef.current) { runningRef.current = false; return; }
          if (document.hidden) { rafRef.current = requestAnimationFrame(tick); return; }
          sim.tick();
          renderRef.current();
          if (sim.alpha() < sim.alphaMin()) {
            runningRef.current = false;
            renderRef.current();
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        }
        rafRef.current = requestAnimationFrame(tick);
      }

      sim.alpha(1);
      startLoop();
    });

    return () => {
      cancelled = true;
      runningRef.current = false;
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

    // --- Label budget: only the most important nodes get labels ---
    // Priority: center → hovered → adjacent → by degree descending.
    const degree = new Map<string, number>();
    for (const l of links) {
      const sid = typeof l.source === "string" ? l.source : l.source.id;
      const tid = typeof l.target === "string" ? l.target : l.target.id;
      degree.set(sid, (degree.get(sid) || 0) + 1);
      degree.set(tid, (degree.get(tid) || 0) + 1);
    }
    const labelSet = new Set<string>();
    for (const n of nodes) {
      if (n.isCenter) labelSet.add(n.id);
    }
    if (hovered) {
      labelSet.add(hovered);
      // Adjacent nodes always get labels regardless of budget.
      for (const id of adjSet) labelSet.add(id);
    }
    const ranked = [...nodes].sort(
      (a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0),
    );
    for (const n of ranked) {
      if (labelSet.size >= LABEL_BUDGET) break;
      labelSet.add(n.id);
    }

    // --- Draw a single edge as a curved path ---
    const drawEdge = (l: SimLink) => {
      const s = typeof l.source === "string" ? nodes.find((n) => n.id === l.source) : l.source;
      const tgt = typeof l.target === "string" ? nodes.find((n) => n.id === l.target) : l.target;
      if (!s || !tgt) return;

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
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const curvature = 0.15;
      const cpx = mx + (-dy / len) * len * curvature;
      const cpy = my + (dx / len) * len * curvature;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cpx, cpy, tx, ty);

      // Dimmed edges fade out via globalAlpha instead of baked-in string alpha.
      ctx.globalAlpha = isDimmed ? 1 - 0.6 * progress : 1;

      if (l.relationType === "contradicts") {
        ctx.setLineDash(isHighlighted ? [4, 3] : [3, 3]);
        ctx.lineDashOffset = isHighlighted ? -(t * 0.04) % 14 : -(t * 0.02) % 20;
        ctx.strokeStyle = "rgba(239,68,68,0.45)";
      } else if (isHighlighted) {
        ctx.setLineDash([]);
        ctx.strokeStyle = HOVER_EDGE_COLOR;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(180,190,200,0.18)";
      }
      ctx.lineWidth = isHighlighted ? 2 : 0.7;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };

    // Draw non-highlighted edges first, highlighted edges last (on top).
    for (const l of links) {
      const sid = typeof l.source === "string" ? l.source : l.source.id;
      const tid = typeof l.target === "string" ? l.target : l.target.id;
      if (hovered && (sid === hovered || tid === hovered)) continue;
      drawEdge(l);
    }
    if (hovered) {
      for (const l of links) {
        const sid = typeof l.source === "string" ? l.source : l.source.id;
        const tid = typeof l.target === "string" ? l.target : l.target.id;
        if (sid === hovered || tid === hovered) drawEdge(l);
      }
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

      // --- Center node: subtle pulsing ring ---
      if (n.isCenter) {
        const pulse = Math.sin(t * 0.003) * 0.15 + 0.85;
        ctx.beginPath();
        ctx.arc(nx, ny, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = mixAlpha(color, 0.4 * pulse);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Main node circle
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      const nodeAlpha = isDimmed ? (1 - 0.7 * progress) : 1;
      ctx.fillStyle = nodeAlpha < 1 ? mixAlpha(color, nodeAlpha) : color;
      ctx.fill();
      // Subtle white stroke for separation from background.
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = `rgba(255,255,255,${(0.9 * nodeAlpha).toFixed(2)})`;
      ctx.stroke();

      // Label — only nodes within the label budget get one.
      if (!labelSet.has(n.id)) continue;
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

  // Keep renderRef pointed at the latest render fn so the resize observer can
  // trigger an immediate redraw without re-subscribing.
  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  // Brief opacity fade when switching depth (1 ↔ 2)
  useEffect(() => {
    setTransitioning(true);
    const id = window.setTimeout(() => setTransitioning(false), 150);
    return () => window.clearTimeout(id);
  }, [depth]);

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
      if (hit.isCenter) return; // Don't allow dragging the root node
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
        simRef.current.alphaTarget(0.3).alpha(0.3);
        if (!runningRef.current) {
          runningRef.current = true;
          const sim = simRef.current;
          function tick() {
            if (!runningRef.current) return;
            if (document.hidden) { rafRef.current = requestAnimationFrame(tick); return; }
            sim.tick();
            renderRef.current();
            if (sim.alpha() < sim.alphaMin() && sim.alphaTarget() === 0) {
              runningRef.current = false;
              renderRef.current();
              return;
            }
            rafRef.current = requestAnimationFrame(tick);
          }
          rafRef.current = requestAnimationFrame(tick);
        }
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
        if (!hasDragged && !dragNode.isCenter && dragNode.slug !== currentSlug) {
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
  }, [onSelectSlug, currentSlug]);

  // Resize observer (debounced, with immediate canvas resize + redraw)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer = 0;
    const ro = new ResizeObserver((entries) => {
      let nextWidth = widthRef.current;
      for (const entry of entries) {
        nextWidth = entry.contentRect.width;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (nextWidth === widthRef.current) return;
        widthRef.current = nextWidth;
        const canvas = canvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          canvas.width = nextWidth * dpr;
          canvas.height = HEIGHT * dpr;
          canvas.style.width = `${nextWidth}px`;
          canvas.style.height = `${HEIGHT}px`;
        }
        renderRef.current();
      }, 100);
    });
    ro.observe(container);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  if (isLoading) {
    return (
      <div
        className="w-full rounded-lg border border-zinc-100 bg-zinc-50/50 animate-pulse"
        style={{ height: 280 }}
      />
    );
  }

  if (isError) {
    return (
      <div className="w-full rounded-lg border border-red-100 bg-red-50/50 flex flex-col items-center justify-center gap-2 py-6" style={{ height: HEIGHT }}>
        <p className="text-[11px] text-red-400">关系图加载失败</p>
        <button onClick={() => refetch()} className="text-[10px] px-3 py-1 rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
          重试
        </button>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="text-xs text-zinc-400 text-center py-4">暂无关联节点</div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className={`w-full rounded-lg border border-zinc-100 bg-zinc-50/50 transition-opacity duration-150 ${
          transitioning ? "opacity-50" : ""
        }`}
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
