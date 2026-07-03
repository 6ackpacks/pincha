"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { getWikiGraph } from "@/lib/api";
import {
  CircleNotch,
  MagnifyingGlass,
  ArrowsOutSimple,
  Crosshair,
  Minus,
  Plus,
  X,
} from "@phosphor-icons/react";
import { activeKbIdAtom } from "@/atoms/kb";
import { useAtom } from "jotai";
import { RELATION_LABELS } from "./wiki-entry-helpers";
import type { NodeObject, LinkObject } from "three-forcegraph";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RelationGraph3DProps {
  activeSlug?: string | null;
  onSelectSlug?: (slug: string) => void;
}

interface GNode extends NodeObject {
  id: string;
  title: string;
  slug: string;
  type: string;
  communityId: number | null;
  sourceCount: number;
  _degree: number;
  _tier: "hub" | "normal" | "peripheral";
  _color: string;
  _colorDim: string;
  _colorFade: string;
}

interface GLink extends LinkObject<GNode> {
  source: string | GNode;
  target: string | GNode;
  relationType: string;
  strength: number;
}

interface MiniMapNode {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  tier: GNode["_tier"];
}

interface MiniMapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/* ------------------------------------------------------------------ */
/*  Color Palette                                                      */
/* ------------------------------------------------------------------ */

const NODE_COLORS: Record<string, string> = {
  concept: "#2F6FE4",
  entity: "#6B5DE6",
  method: "#10B981",
  source: "#8FA3FF",
  insight: "#14B8A6",
};

const HOVER_ACCENT = "#F59E0B";
const LINK_DEFAULT = "rgba(143,163,196,0.42)";
const LINK_HIGHLIGHT = "rgba(16,185,129,0.58)";
const PARTICLE_COLOR = "rgba(16,185,129,0.7)";
const MINIMAP_SIZE = 132;
const MINIMAP_PADDING = 14;

function getColor(type: string): string {
  return NODE_COLORS[type] || "#3B6FE0";
}

function hexToRgba(hex: string, alpha: number): string {
  const h = (c: string) => parseInt(c, 16);
  return `rgba(${h(hex.slice(1, 3))},${h(hex.slice(3, 5))},${h(hex.slice(5, 7))},${alpha})`;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function nodeId(n: string | GNode): string {
  return typeof n === "string" ? n : n.id;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function RelationGraph3D({
  activeSlug,
  onSelectSlug,
}: RelationGraph3DProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [activeKbId] = useAtom(activeKbIdAtom);

  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHighlightIdx, setSearchHighlightIdx] = useState(-1);
  const [miniMapNodes, setMiniMapNodes] = useState<MiniMapNode[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const highlightNodes = useRef(new Set<string>());
  const highlightLinks = useRef(new Set<GLink>());
  const hoveredNodeRef = useRef<GNode | null>(null);
  const nodesMapRef = useRef(new Map<string, GNode>());
  const neighborsMapRef = useRef(new Map<string, Set<string>>());
  const nodeLinkMapRef = useRef(new Map<string, Set<GLink>>());
  const miniMapBoundsRef = useRef<MiniMapBounds | null>(null);
  const miniMapFrameRef = useRef(0);
  // Cache SpriteText objects — never recreate during highlight updates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spriteCache = useRef(new Map<string, any>());

  const {
    data: rawData,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["wiki-graph", activeKbId],
    queryFn: getWikiGraph,
    refetchOnWindowFocus: true,
  });

  /* ── Transform API data (pre-compute colors) ────────────────────── */

  const transformed = useMemo(() => {
    if (!rawData || rawData.nodes.length === 0) return null;

    const degreeMap = new Map<string, number>();
    for (const n of rawData.nodes) degreeMap.set(n.id, 0);
    for (const e of rawData.edges) {
      degreeMap.set(e.from_id, (degreeMap.get(e.from_id) ?? 0) + 1);
      degreeMap.set(e.to_id, (degreeMap.get(e.to_id) ?? 0) + 1);
    }

    const degrees = [...degreeMap.values()].sort((a, b) => a - b);
    const p30 = degrees[Math.floor(degrees.length * 0.3)] ?? 0;
    const p90 = degrees[Math.floor(degrees.length * 0.9)] ?? 2;

    const nodes: GNode[] = rawData.nodes.map((n) => {
      const d = degreeMap.get(n.id) ?? 0;
      const tier = d >= p90 ? "hub" : d <= p30 ? "peripheral" : "normal";
      const base = getColor(n.type || "concept");
      return {
        id: n.id,
        title: n.title,
        slug: n.slug,
        type: n.type || "concept",
        communityId: n.community_id,
        sourceCount: n.source_count || 0,
        _degree: d,
        _tier: tier,
        _color: tier === "hub" ? base : tier === "peripheral" ? hexToRgba(base, 0.4) : hexToRgba(base, 0.7),
        _colorDim: hexToRgba(base, 0.12),
        _colorFade: base,
      };
    });

    const links: GLink[] = rawData.edges.map((e) => ({
      source: e.from_id,
      target: e.to_id,
      relationType: e.relation_type || "related",
      strength: e.strength || 0.5,
    }));

    const nMap = new Map<string, GNode>();
    for (const n of nodes) nMap.set(n.id, n);

    const nbMap = new Map<string, Set<string>>();
    const nlMap = new Map<string, Set<GLink>>();
    for (const n of nodes) {
      nbMap.set(n.id, new Set());
      nlMap.set(n.id, new Set());
    }
    for (const l of links) {
      const src = typeof l.source === "string" ? l.source : l.source.id;
      const tgt = typeof l.target === "string" ? l.target : l.target.id;
      nbMap.get(src)?.add(tgt);
      nbMap.get(tgt)?.add(src);
      nlMap.get(src)?.add(l);
      nlMap.get(tgt)?.add(l);
    }

    return { nodes, links, nMap, nbMap, nlMap };
  }, [rawData]);

  /* ── Navigation helpers ─────────────────────────────────────────── */

  const handleClick = useCallback(
    (slug: string) => {
      if (onSelectSlug) onSelectSlug(slug);
      else router.push(`/knowledge/${slug}`);
    },
    [router, onSelectSlug],
  );

  const focusOnNode = useCallback((node: GNode) => {
    const graph = graphRef.current;
    if (!graph || node.x == null) return;
    const distance = 100;
    const distRatio =
      1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
    graph.cameraPosition(
      {
        x: (node.x || 0) * distRatio,
        y: (node.y || 0) * distRatio,
        z: (node.z || 0) * distRatio,
      },
      { x: node.x, y: node.y, z: node.z },
      800,
    );
  }, []);

  const resetCamera = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.zoomToFit(800, 40);
    setFocusedNodeId(null);
  }, []);

  const zoomCamera = useCallback((direction: "in" | "out") => {
    const graph = graphRef.current;
    if (!graph) return;
    try {
      const camera = graph.camera();
      const controls = graph.controls();
      const target = controls?.target ?? { x: 0, y: 0, z: 0 };
      const factor = direction === "in" ? 0.72 : 1.38;
      graph.cameraPosition(
        {
          x: target.x + (camera.position.x - target.x) * factor,
          y: target.y + (camera.position.y - target.y) * factor,
          z: target.z + (camera.position.z - target.z) * factor,
        },
        { x: target.x, y: target.y, z: target.z },
        260,
      );
    } catch {
      // The graph may still be mounting.
    }
  }, []);

  const updateMiniMap = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    try {
      const nodes = (graph.graphData().nodes as GNode[]).filter(
        (n) => typeof n.x === "number" && typeof n.y === "number",
      );
      if (nodes.length === 0) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const spanX = Math.max(maxX - minX, 1);
      const spanY = Math.max(maxY - minY, 1);
      miniMapBoundsRef.current = { minX, maxX, minY, maxY };
      setMiniMapNodes(
        nodes.map((n) => ({
          id: n.id,
          x: MINIMAP_PADDING + ((n.x ?? 0) - minX) / spanX * (MINIMAP_SIZE - MINIMAP_PADDING * 2),
          y: MINIMAP_PADDING + ((n.y ?? 0) - minY) / spanY * (MINIMAP_SIZE - MINIMAP_PADDING * 2),
          r: n._tier === "hub" ? 3.8 : n._tier === "normal" ? 2.6 : 1.8,
          color: n._colorFade,
          tier: n._tier,
        })),
      );
    } catch {
      // Mini-map is best effort and should never affect graph interaction.
    }
  }, []);

  const handleMiniMapClick = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const graph = graphRef.current;
    const bounds = miniMapBoundsRef.current;
    if (!graph || !bounds) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = Math.min(Math.max(event.clientX - rect.left, MINIMAP_PADDING), MINIMAP_SIZE - MINIMAP_PADDING);
    const py = Math.min(Math.max(event.clientY - rect.top, MINIMAP_PADDING), MINIMAP_SIZE - MINIMAP_PADDING);
    const graphX = bounds.minX + ((px - MINIMAP_PADDING) / (MINIMAP_SIZE - MINIMAP_PADDING * 2)) * (bounds.maxX - bounds.minX);
    const graphY = bounds.minY + ((py - MINIMAP_PADDING) / (MINIMAP_SIZE - MINIMAP_PADDING * 2)) * (bounds.maxY - bounds.minY);
    try {
      const camera = graph.camera();
      const controls = graph.controls();
      const target = controls?.target ?? { x: 0, y: 0, z: 0 };
      graph.cameraPosition(
        {
          x: graphX + (camera.position.x - target.x),
          y: graphY + (camera.position.y - target.y),
          z: camera.position.z,
        },
        { x: graphX, y: graphY, z: 0 },
        420,
      );
      setFocusedNodeId(null);
    } catch {
      // Ignore click while the Three camera is not available.
    }
  }, []);

  /* ── Search ─────────────────────────────────────────────────────── */

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !transformed) return [];
    const q = searchQuery.toLowerCase();
    return transformed.nodes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.slug.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [searchQuery, transformed]);

  const selectSearchResult = useCallback(
    (node: GNode) => {
      focusOnNode(node);
      setFocusedNodeId(node.id);
      handleClick(node.slug);
      setShowSearch(false);
      setSearchQuery("");
      setSearchHighlightIdx(-1);
    },
    [focusOnNode, handleClick],
  );

  /* ── Focus card data ────────────────────────────────────────────── */

  const focusedNode = useMemo(() => {
    if (!focusedNodeId || !transformed) return null;
    return transformed.nMap.get(focusedNodeId) ?? null;
  }, [focusedNodeId, transformed]);

  const focusedNeighbors = useMemo(() => {
    if (!focusedNodeId || !transformed) return [];
    const ids = transformed.nbMap.get(focusedNodeId);
    if (!ids) return [];
    return [...ids]
      .map((id) => {
        const n = transformed.nMap.get(id);
        if (!n) return null;
        const link = [...(transformed.nlMap.get(focusedNodeId) ?? [])].find(
          (l) => nodeId(l.source) === id || nodeId(l.target) === id,
        );
        return { node: n, relationType: link?.relationType || "related" };
      })
      .filter(Boolean)
      .slice(0, 8) as { node: GNode; relationType: string }[];
  }, [focusedNodeId, transformed]);

  /* ── Initialize 3d-force-graph ──────────────────────────────────── */

  useEffect(() => {
    if (!transformed || !containerRef.current) return;

    nodesMapRef.current = transformed.nMap;
    neighborsMapRef.current = transformed.nbMap;
    nodeLinkMapRef.current = transformed.nlMap;
    spriteCache.current.clear();
    setMiniMapNodes([]);
    miniMapBoundsRef.current = null;
    miniMapFrameRef.current = 0;

    const containerEl = containerRef.current;
    let destroyed = false;

    Promise.all([
      import("3d-force-graph"),
      import("three-spritetext"),
    ]).then(([fgMod, spriteMod]) => {
      if (destroyed || !containerEl) return;

      const ForceGraph3D = fgMod.default;
      const SpriteText = spriteMod.default;

      if (graphRef.current) {
        graphRef.current._destructor();
        graphRef.current = null;
      }

      const { width, height } = containerEl.getBoundingClientRect();

      const hlNodes = highlightNodes.current;
      const hlLinks = highlightLinks.current;
      const cache = spriteCache.current;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const graph = (ForceGraph3D as any)({
        rendererConfig: { antialias: true, alpha: true },
      })(containerEl)
        .backgroundColor("rgba(255,255,255,0)")
        .width(width)
        .height(height)
        .showNavInfo(false)

        /* ── Nodes ─────────────────────────────────────────────── */
        .nodeRelSize(4.4)
        .nodeResolution(7)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .nodeVal((obj: any) => {
          const n = obj as GNode;
          const d = n._degree ?? 0;
          if (n._tier === "hub") return Math.max(3, d * 1.5);
          if (n._tier === "peripheral") return Math.max(1, d * 0.5);
          return Math.max(1.5, d * 0.8);
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .nodeColor((obj: any) => {
          const n = obj as GNode;
          if (hlNodes.size > 0) {
            if (n === hoveredNodeRef.current) return HOVER_ACCENT;
            if (hlNodes.has(n.id)) return n._colorFade;
            return n._colorDim;
          }
          return n._color;
        })
        .nodeOpacity(0.9)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .nodeLabel((obj: any) => {
          const n = obj as GNode;
          return `<div style="background:rgba(255,255,255,0.94);color:#12201b;padding:7px 12px;border-radius:8px;font-size:13px;font-weight:700;border:1px solid rgba(16,185,129,0.18);box-shadow:0 12px 30px rgba(15,23,42,0.11);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.title}</div>`;
        })

        /* ── Text labels for hub nodes (cached) ────────────────── */
        .nodeThreeObjectExtend(true)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .nodeThreeObject((obj: any) => {
          const n = obj as GNode;
          if (n._tier !== "hub") return null;
          const cached = cache.get(n.id);
          if (cached) return cached;
          const sprite = new SpriteText(n.title);
          sprite.color = "#10201a";
          sprite.textHeight = 3.2;
          sprite.fontFace = "system-ui, -apple-system, sans-serif";
          sprite.fontWeight = "700";
          sprite.backgroundColor = "rgba(255,255,255,0.86)";
          sprite.padding = 1.2;
          sprite.borderRadius = 1.5;
          const val = Math.max(3, (n._degree ?? 0) * 1.5);
          const radius = Math.cbrt(val) * 4;
          sprite.position.set(0, radius + 3, 0);
          cache.set(n.id, sprite);
          return sprite;
        })

        /* ── Links ─────────────────────────────────────────────── */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .linkWidth((obj: any) => {
          const l = obj as GLink;
          if (hlLinks.has(l)) return 1.5;
          return 0.3;
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .linkColor((obj: any) => {
          const l = obj as GLink;
          return hlLinks.has(l) ? LINK_HIGHLIGHT : LINK_DEFAULT;
        })
        .linkOpacity(0.72)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .linkDirectionalParticles((obj: any) => {
          const l = obj as GLink;
          return hlLinks.has(l) ? 2 : 0;
        })
        .linkDirectionalParticleWidth(2)
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleColor(() => PARTICLE_COLOR)

        /* ── Interactions ──────────────────────────────────────── */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onNodeClick((obj: any) => {
          const n = obj as GNode;
          if (n.slug) handleClick(n.slug);
          setFocusedNodeId(n.id);
          focusOnNode(n);
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onNodeHover((obj: any) => {
          const n = obj as GNode | null;
          if (
            (!n && !hlNodes.size) ||
            (n && hoveredNodeRef.current === n)
          )
            return;

          hlNodes.clear();
          hlLinks.clear();

          if (n) {
            hlNodes.add(n.id);
            const nbs = neighborsMapRef.current.get(n.id);
            if (nbs) nbs.forEach((id) => hlNodes.add(id));
            const nLinks = nodeLinkMapRef.current.get(n.id);
            if (nLinks) nLinks.forEach((l) => hlLinks.add(l));
          }

          hoveredNodeRef.current = n;
          containerEl.style.cursor = n ? "pointer" : "grab";

          graph
            .nodeColor(graph.nodeColor())
            .linkWidth(graph.linkWidth())
            .linkColor(graph.linkColor())
            .linkDirectionalParticles(graph.linkDirectionalParticles());
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onLinkHover((obj: any) => {
          const l = obj as GLink | null;
          hlNodes.clear();
          hlLinks.clear();
          if (l) {
            hlLinks.add(l);
            hlNodes.add(nodeId(l.source));
            hlNodes.add(nodeId(l.target));
          }
          hoveredNodeRef.current = null;

          graph
            .nodeColor(graph.nodeColor())
            .linkWidth(graph.linkWidth())
            .linkColor(graph.linkColor())
            .linkDirectionalParticles(graph.linkDirectionalParticles());
        })
        .onBackgroundClick(() => {
          resetCamera();
        })
        .onEngineTick(() => {
          miniMapFrameRef.current += 1;
          if (miniMapFrameRef.current % 8 === 0) updateMiniMap();
        })
        .onEngineStop(() => {
          updateMiniMap();
        })

        /* ── Force config — compact cluster ────────────────────── */
        .warmupTicks(60)
        .cooldownTime(3000)
        .cooldownTicks(100)
        .d3AlphaDecay(0.03)
        .d3VelocityDecay(0.4)

        /* ── Data ──────────────────────────────────────────────── */
        .graphData({
          nodes: [...transformed.nodes],
          links: [...transformed.links],
        });

      // D3 force tuning — compact layout
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const charge = graph.d3Force("charge") as any;
        if (charge) {
          charge.strength(-60);
          charge.distanceMax(200);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const link = graph.d3Force("link") as any;
        if (link) {
          link.distance(20);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const center = graph.d3Force("center") as any;
        if (center) {
          center.strength(0.1);
        }
      } catch {
        // d3 forces may not be ready
      }

      // Limit pixel ratio for performance
      try {
        const renderer = graph.renderer();
        if (renderer) {
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        }
        const scene = graph.scene();
        if (scene) {
          scene.fog = null;
        }
      } catch {
        // renderer may not be ready
      }

      // Auto zoom to fit after simulation settles
      setTimeout(() => {
        if (!destroyed && graph) {
          graph.zoomToFit(1000, 40);
          updateMiniMap();
        }
      }, 400);

      graphRef.current = graph;

      // ResizeObserver — throttled
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver((entries) => {
        if (destroyed || !graphRef.current) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          for (const entry of entries) {
            const { width: w, height: h } = entry.contentRect;
            if (w > 0 && h > 0) {
              graphRef.current?.width(w).height(h);
            }
          }
        }, 100);
      });
      ro.observe(containerEl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (containerEl as any)._ro = ro;
    });

    return () => {
      destroyed = true;
      if (graphRef.current) {
        graphRef.current._destructor();
        graphRef.current = null;
      }
      if (containerEl) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ro = (containerEl as any)._ro as ResizeObserver | undefined;
        if (ro) {
          ro.disconnect();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (containerEl as any)._ro;
        }
      }
    };
  }, [transformed, handleClick, focusOnNode, resetCamera, updateMiniMap]);

  /* ── Keyboard ───────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showSearch) {
          setShowSearch(false);
          setSearchQuery("");
          setSearchHighlightIdx(-1);
        } else if (focusedNodeId) {
          resetCamera();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSearch, focusedNodeId, resetCamera]);

  /* ── Loading / Error / Empty ────────────────────────────────────── */

  if (isLoading && !isError) {
    return (
      <div className="flex justify-center items-center h-full py-20">
        <CircleNotch
          size={24}
          weight="bold"
          className="animate-spin text-blue-400"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center">
        <p className="text-red-500 font-bold mb-1">加载图谱失败</p>
        <p className="text-zinc-400 text-sm mb-3">请稍后重试</p>
        <button
          onClick={() => refetch()}
          className="px-4 py-1.5 text-xs rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  if (!rawData || rawData.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center">
        <p className="text-zinc-500 font-bold mb-1">暂无关系图谱</p>
        <p className="text-zinc-400 text-sm">
          加入更多视频后，知识词条之间的关系将在这里展示
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative overflow-hidden rounded-2xl border border-emerald-100/70 bg-[linear-gradient(135deg,#fbfffd_0%,#f4fbf8_42%,#f7f9ff_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.42] [background-image:linear-gradient(rgba(16,185,129,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(47,111,228,0.045)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/80 to-transparent" />
      {/* 3D Canvas container */}
      <div
        ref={containerRef}
        className="absolute inset-0"
      />

      {/* ── Search overlay (top-right) ──────────────────────────── */}
      <div className="absolute top-3 right-3 z-10 flex flex-col items-end">
        {!showSearch ? (
          <button
            onClick={() => {
              setShowSearch(true);
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            className="p-2 rounded-xl bg-white/82 backdrop-blur-md text-zinc-500 hover:bg-white hover:text-emerald-600 transition-colors shadow-sm border border-emerald-100/80"
            title="搜索节点"
          >
            <MagnifyingGlass size={16} weight="bold" />
          </button>
        ) : (
          <div className="w-64">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/92 backdrop-blur-md border border-emerald-100 shadow-sm">
              <MagnifyingGlass
                size={14}
                weight="bold"
                className="text-emerald-500 shrink-0"
              />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchHighlightIdx(-1);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSearchHighlightIdx((i) =>
                      Math.min(i + 1, searchResults.length - 1),
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSearchHighlightIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && searchResults.length > 0) {
                    e.preventDefault();
                    const idx = searchHighlightIdx >= 0 ? searchHighlightIdx : 0;
                    selectSearchResult(searchResults[idx]);
                  } else if (e.key === "Escape") {
                    setShowSearch(false);
                    setSearchQuery("");
                    setSearchHighlightIdx(-1);
                  }
                }}
                placeholder="搜索知识词条…"
                className="flex-1 bg-transparent text-zinc-800 text-sm placeholder:text-zinc-300 outline-none"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                  setSearchHighlightIdx(-1);
                }}
                className="text-zinc-300 hover:text-zinc-500"
              >
                <X size={14} weight="bold" />
              </button>
            </div>

            {/* Search results */}
            {searchQuery.trim() && (
              <div className="mt-1 rounded-xl bg-white/95 backdrop-blur-md border border-emerald-100 shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-zinc-400 text-center">
                    未找到相关知识词条
                  </div>
                ) : (
                  searchResults.map((r, i) => (
                    <button
                      key={r.id}
                      onMouseEnter={() => setSearchHighlightIdx(i)}
                      onClick={() => selectSearchResult(r)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        i === searchHighlightIdx
                          ? "bg-emerald-50 text-emerald-700"
                          : "text-zinc-700 hover:bg-emerald-50/60"
                      }`}
                    >
                      <div className="font-medium truncate">{r.title}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {r.type}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Focus info card (top-left) ──────────────────────────── */}
      {focusedNode && (
        <div className="absolute top-3 left-3 z-10 w-56 rounded-xl bg-white/92 backdrop-blur-md border border-emerald-100 shadow-[0_18px_45px_rgba(15,23,42,0.12)] p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-zinc-800 truncate">
                {focusedNode.title}
              </h3>
              <span className="text-[10px] text-zinc-400">{focusedNode.type}</span>
            </div>
            <button
              onClick={() => {
                handleClick(focusedNode.slug);
              }}
              className="shrink-0 px-2 py-1 text-[10px] rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors font-medium"
            >
              打开词条
            </button>
          </div>

          {focusedNeighbors.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-zinc-400 mb-1">
                {focusedNeighbors.length} 个关联词条
              </p>
              {focusedNeighbors.map(({ node: nb, relationType }) => (
                <button
                  key={nb.id}
                  onClick={() => {
                    setFocusedNodeId(nb.id);
                    focusOnNode(nb);
                    handleClick(nb.slug);
                  }}
                  className="w-full flex items-center justify-between gap-1 px-2 py-1 rounded-lg text-xs text-zinc-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                >
                  <span className="truncate">{nb.title}</span>
                  <span className="shrink-0 text-[10px] text-zinc-300">
                    {RELATION_LABELS[relationType] || relationType}
                  </span>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={resetCamera}
            className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors border border-emerald-100"
          >
            <ArrowsOutSimple size={12} weight="bold" />
            回到全图
          </button>
        </div>
      )}

      <div className="absolute bottom-3 left-3 z-10 rounded-xl bg-white/88 backdrop-blur-md border border-emerald-100/90 px-3 py-2 shadow-sm">
        <div className="grid gap-1.5 text-[11px] text-zinc-500">
          {[
            { label: "核心主题", color: "#2F6FE4" },
            { label: "相关主题", color: "#10B981" },
            { label: "来源线索", color: "#8FA3FF" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shadow-[0_0_10px_currentColor]"
                style={{ backgroundColor: item.color, color: item.color }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-3 right-3 z-10 flex items-end gap-2">
        <div className="rounded-xl border border-emerald-100/90 bg-white/86 p-2 shadow-[0_18px_45px_rgba(15,23,42,0.12)] backdrop-blur-md">
          <svg
            width={MINIMAP_SIZE}
            height={MINIMAP_SIZE}
            viewBox={`0 0 ${MINIMAP_SIZE} ${MINIMAP_SIZE}`}
            onClick={handleMiniMapClick}
            className="block cursor-crosshair rounded-lg border border-emerald-100 bg-[linear-gradient(135deg,rgba(240,253,244,0.95),rgba(248,250,252,0.95))]"
            role="button"
            aria-label="缩略图定位"
          >
            <rect
              x="10"
              y="10"
              width={MINIMAP_SIZE - 20}
              height={MINIMAP_SIZE - 20}
              rx="8"
              fill="none"
              stroke="rgba(16,185,129,0.18)"
              strokeDasharray="3 4"
            />
            {miniMapNodes.map((node) => (
              <circle
                key={node.id}
                cx={node.x}
                cy={node.y}
                r={node.id === focusedNodeId ? node.r + 2 : node.r}
                fill={node.color}
                opacity={node.tier === "peripheral" ? 0.48 : 0.82}
                stroke={node.id === focusedNodeId ? "#0f766e" : "rgba(255,255,255,0.75)"}
                strokeWidth={node.id === focusedNodeId ? 1.8 : 0.6}
              />
            ))}
            {miniMapNodes.length === 0 && (
              <text x="66" y="70" textAnchor="middle" className="fill-zinc-300 text-[10px]">
                loading
              </text>
            )}
          </svg>
        </div>

        <div className="flex flex-col overflow-hidden rounded-xl border border-emerald-100/90 bg-white/88 shadow-[0_18px_45px_rgba(15,23,42,0.12)] backdrop-blur-md">
          <button
            onClick={() => zoomCamera("in")}
            className="grid h-10 w-10 place-items-center text-zinc-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
            title="放大"
          >
            <Plus size={17} weight="bold" />
          </button>
          <div className="h-px bg-emerald-100/90" />
          <button
            onClick={() => zoomCamera("out")}
            className="grid h-10 w-10 place-items-center text-zinc-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
            title="缩小"
          >
            <Minus size={17} weight="bold" />
          </button>
          <div className="h-px bg-emerald-100/90" />
          <button
            onClick={resetCamera}
            className="grid h-10 w-10 place-items-center text-zinc-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
            title="定位到全图"
          >
            <Crosshair size={17} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
