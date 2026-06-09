import type { GraphData } from "@/lib/api";
import {
  getCommunityColor,
  getNodeTypeColor,
} from "@/lib/constants/community-colors";

export const BASE_NODE_SIZE = 8;
export const MAX_NODE_SIZE = 28;
export const LABEL_SIZE = 13;

export function mixColor(a: string, b: string, ratio: number): string {
  const parseHex = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const parseRgba = (s: string): [number, number, number] | null => {
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const parse = (c: string) => c.startsWith("#") ? parseHex(c) : (parseRgba(c) ?? [148, 163, 184]);
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const mix = (c1: number, c2: number) => Math.round(c1 + (c2 - c1) * ratio);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(r1, r2))}${toHex(mix(g1, g2))}${toHex(mix(b1, b2))}`;
}

export const positionCache = new Map<string, { x: number; y: number }>();
export const POSITION_CACHE_LIMIT = 500;
export let lastLayoutDataKey = "";

export function setLastLayoutDataKey(key: string) {
  lastLayoutDataKey = key;
}

const STORAGE_KEY = "pingcha_graph_positions";

export function savePositionsToStorage(positions: Map<string, { x: number; y: number }>) {
  try {
    const obj: Record<string, { x: number; y: number }> = {};
    positions.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

export function loadPositionsFromStorage(): Map<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, { x: number; y: number }>;
    const map = new Map<string, { x: number; y: number }>();
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
    return map;
  } catch { return new Map(); }
}

export function clearPositionCache() {
  positionCache.clear();
  setLastLayoutDataKey("");
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Build a graphology graph from GraphData, apply edge pruning, node sizing,
 * coloring, and ForceAtlas2 layout. Returns the constructed graph instance.
 */
export function buildGraph(
  Graph: any,
  forceAtlas2: any,
  graphData: GraphData,
  colorMode: "type" | "community",
) {
  const graph = new Graph();

  // Load persisted positions from localStorage
  const storedPositions = loadPositionsFromStorage();
  storedPositions.forEach((v, k) => positionCache.set(k, v));

  // Pre-compute degree for deterministic initial layout
  const degreeMap = new Map<string, number>();
  for (const n of graphData.nodes) degreeMap.set(n.id, 0);
  for (const e of graphData.edges) {
    degreeMap.set(e.from_id, (degreeMap.get(e.from_id) || 0) + 1);
    degreeMap.set(e.to_id, (degreeMap.get(e.to_id) || 0) + 1);
  }

  // Sort nodes by degree descending — highest degree first (hub at center)
  const sortedNodes = [...graphData.nodes].sort(
    (a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0)
  );

  // Deterministic concentric circle initialization
  for (let i = 0; i < sortedNodes.length; i++) {
    const n = sortedNodes[i];
    const cached = positionCache.get(n.id);
    let x: number, y: number;

    if (cached) {
      x = cached.x;
      y = cached.y;
    } else if (i === 0) {
      x = 0;
      y = 0;
    } else {
      const ring = Math.ceil(Math.sqrt(i));
      const nodesInRing = Math.min(ring * 6, sortedNodes.length - i);
      const indexInRing = (i - 1) % (ring * 6);
      const angle = (indexInRing / nodesInRing) * 2 * Math.PI + (hashString(n.id) % 100) * 0.001;
      const radius = ring * 30;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
    }

    graph.addNode(n.id, {
      x,
      y,
      size: BASE_NODE_SIZE,
      label: n.title,
      nodeType: n.type || "concept",
      communityId: n.community_id,
      slug: n.slug,
      sourceCount: n.source_count,
    });
  }

  // ── Edge strategy: EXTREME pruning ──────────────────────────────────
  const nodeCommunity = new Map<string, number | null | undefined>();
  for (const n of graphData.nodes) nodeCommunity.set(n.id, n.community_id);

  const edgeCandidates = graphData.edges
    .filter((e) => graph.hasNode(e.from_id) && graph.hasNode(e.to_id))
    .sort((a, b) => (b.strength || 0.5) - (a.strength || 0.5));

  const keepCount = Math.max(
    graphData.nodes.length,
    Math.ceil(edgeCandidates.length * 0.2)
  );

  const MAX_INTRA = 3;
  const MAX_INTER = 1;
  const nodeIntra = new Map<string, number>();
  const nodeInter = new Map<string, number>();
  let edgesAdded = 0;

  for (const e of edgeCandidates) {
    if (edgesAdded >= keepCount) break;
    const fc = nodeCommunity.get(e.from_id);
    const tc = nodeCommunity.get(e.to_id);
    const same = fc != null && tc != null && fc === tc;

    if (same) {
      const a = nodeIntra.get(e.from_id) || 0;
      const b = nodeIntra.get(e.to_id) || 0;
      if (a < MAX_INTRA && b < MAX_INTRA) {
        if (!graph.hasEdge(e.from_id, e.to_id)) {
          graph.addEdge(e.from_id, e.to_id, { weight: e.strength || 0.5 });
          edgesAdded++;
        }
        nodeIntra.set(e.from_id, a + 1);
        nodeIntra.set(e.to_id, b + 1);
      }
    } else {
      const a = nodeInter.get(e.from_id) || 0;
      const b = nodeInter.get(e.to_id) || 0;
      if (a < MAX_INTER && b < MAX_INTER) {
        if (!graph.hasEdge(e.from_id, e.to_id)) {
          graph.addEdge(e.from_id, e.to_id, { weight: e.strength || 0.5 });
          edgesAdded++;
        }
        nodeInter.set(e.from_id, a + 1);
        nodeInter.set(e.to_id, b + 1);
      }
    }
  }

  // Ensure every node has at least 1 connection
  graph.forEachNode((nodeId: string) => {
    if (graph.degree(nodeId) === 0) {
      const best = edgeCandidates.find(
        (e) => (e.from_id === nodeId || e.to_id === nodeId) && !graph.hasEdge(e.from_id, e.to_id)
      );
      if (best) graph.addEdge(best.from_id, best.to_id, { weight: best.strength || 0.5 });
    }
  });

  // ── Node size: sqrt(linkCount) ─────────────────────────────────────
  const maxDegree = Math.max(...Array.from({ length: graph.order }, (_, i) => graph.degree(graph.nodes()[i])), 1);

  graph.forEachNode((nodeId: string) => {
    const linkCount = graph.degree(nodeId);
    const ratio = linkCount / maxDegree;
    const size = BASE_NODE_SIZE + Math.sqrt(ratio) * (MAX_NODE_SIZE - BASE_NODE_SIZE);

    const color = colorMode === "community"
      ? getCommunityColor(graph.getNodeAttribute(nodeId, "communityId"))
      : getNodeTypeColor(graph.getNodeAttribute(nodeId, "nodeType"));

    graph.setNodeAttribute(nodeId, "size", size);
    graph.setNodeAttribute(nodeId, "color", color);
    graph.setNodeAttribute(nodeId, "originalColor", color);
    graph.setNodeAttribute(nodeId, "originalSize", size);
  });

  // ── Edge visual: slate-500 with weight-based opacity ───────────────
  graph.forEachEdge((edge: string, attrs: any) => {
    const w = attrs.weight || 0.5;
    const edgeSize = 0.5 + w * 3.5;
    const alpha = (40 + w * 180) / 255;
    graph.setEdgeAttribute(edge, "size", edgeSize);
    graph.setEdgeAttribute(edge, "color", `rgba(100,116,139,${alpha.toFixed(2)})`);
    graph.setEdgeAttribute(edge, "originalSize", edgeSize);
    graph.setEdgeAttribute(edge, "originalColor", `rgba(100,116,139,${alpha.toFixed(2)})`);
  });

  // ── ForceAtlas2 layout ─────────────────────────────────────────────
  const dataKey = graphData.nodes.map((n) => n.id).sort().join(",") + "|" + graphData.edges.length;
  const isNewLayout = dataKey !== lastLayoutDataKey;
  setLastLayoutDataKey(dataKey);

  const allCached = graphData.nodes.every((n) => positionCache.has(n.id));

  const fa2Settings = {
    gravity: 1,
    scalingRatio: 2,
    strongGravityMode: true,
    slowDown: 3,
    barnesHutOptimize: graphData.nodes.length > 50,
    barnesHutTheta: 0.5,
    linLogMode: false,
    outboundAttractionDistribution: false,
    adjustSizes: true,
    edgeWeightInfluence: 1,
  };

  const baseIterations = Math.min(150, graphData.nodes.length * 10);

  if (allCached && !isNewLayout) {
    // All positions restored from cache — no layout needed
  } else if (isNewLayout) {
    forceAtlas2.assign(graph, { iterations: baseIterations * 2, settings: fa2Settings });
  } else {
    forceAtlas2.assign(graph, { iterations: Math.min(50, baseIterations), settings: fa2Settings });
  }

  // ── Post-layout: degree-based radial ordering ──────────────────────
  if (!(allCached && !isNewLayout)) {
    const degrees = new Map<string, number>();
    let maxDeg = 0;
    graph.forEachNode((nodeId: string) => {
      const d = graph.degree(nodeId);
      degrees.set(nodeId, d);
      if (d > maxDeg) maxDeg = d;
    });

    if (maxDeg > 0) {
      let cx = 0, cy = 0, count = 0;
      graph.forEachNode((_nodeId: string, attrs: any) => { cx += attrs.x; cy += attrs.y; count++; });
      cx /= count || 1;
      cy /= count || 1;

      graph.forEachNode((nodeId: string, attrs: any) => {
        const d = degrees.get(nodeId) || 0;
        const normalizedDegree = d / maxDeg;
        const dx = attrs.x - cx;
        const dy = attrs.y - cy;

        const factor = 1 - (normalizedDegree * 0.15) + ((1 - normalizedDegree) * 0.08);
        graph.setNodeAttribute(nodeId, "x", cx + dx * factor);
        graph.setNodeAttribute(nodeId, "y", cy + dy * factor);
      });

      forceAtlas2.assign(graph, { iterations: 30, settings: { ...fa2Settings, gravity: 0.05 } });
    }
  }

  // Cache positions and persist to localStorage
  graph.forEachNode((nodeId: string, attrs: any) => {
    positionCache.set(nodeId, { x: attrs.x, y: attrs.y });
  });
  if (positionCache.size > POSITION_CACHE_LIMIT) {
    const entries = [...positionCache.entries()];
    const toRemove = entries.slice(0, entries.length - POSITION_CACHE_LIMIT);
    for (const [key] of toRemove) positionCache.delete(key);
  }
  savePositionsToStorage(positionCache);

  return { graph, allCached, isNewLayout };
}
