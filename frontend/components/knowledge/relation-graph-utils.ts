import type { GraphData } from "@/lib/api";
import {
  getCommunityColor,
  getNodeTypeColor,
} from "@/lib/constants/community-colors";

export const BASE_NODE_SIZE = 4;
export const MAX_NODE_SIZE = 14;
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

const STORAGE_KEY = "pingcha_graph_positions";
const POSITION_CACHE_LIMIT = 500;

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

export function clearPositionStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function applyColors(graph: any, colorMode: "type" | "community"): void {
  graph.forEachNode((nodeId: string) => {
    const color = colorMode === "community"
      ? getCommunityColor(graph.getNodeAttribute(nodeId, "communityId"))
      : getNodeTypeColor(graph.getNodeAttribute(nodeId, "nodeType"));
    graph.setNodeAttribute(nodeId, "color", color);
    graph.setNodeAttribute(nodeId, "originalColor", color);
  });
}

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function buildGraph(
  Graph: any,
  forceAtlas2: any,
  graphData: GraphData,
  positionCache: Map<string, { x: number; y: number }>,
  lastLayoutDataKey: string,
): { graph: any; allCached: boolean; isNewLayout: boolean; newLayoutDataKey: string; graphExtent: { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number } } {
  const graph = new Graph();

  // Merge persisted positions into the provided instance-level cache
  const storedPositions = loadPositionsFromStorage();
  storedPositions.forEach((v, k) => { if (!positionCache.has(k)) positionCache.set(k, v); });

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
  let maxDegree = 1;
  graph.forEachNode((nodeId: string) => {
    const d = graph.degree(nodeId);
    if (d > maxDegree) maxDegree = d;
  });

  graph.forEachNode((nodeId: string) => {
    const linkCount = graph.degree(nodeId);
    const ratio = linkCount / maxDegree;
    const size = BASE_NODE_SIZE + Math.sqrt(ratio) * (MAX_NODE_SIZE - BASE_NODE_SIZE);
    graph.setNodeAttribute(nodeId, "size", size);
    graph.setNodeAttribute(nodeId, "originalSize", size);
  });

  // ── Edge visual: subtle by default, stronger edges slightly more visible ──
  graph.forEachEdge((edge: string, attrs: any) => {
    const w = attrs.weight || 0.5;
    const edgeSize = w > 0.7 ? 0.6 : 0.4;
    const alpha = w > 0.7 ? 0.25 : 0.12;
    const color = `rgba(180,190,200,${alpha.toFixed(2)})`;
    graph.setEdgeAttribute(edge, "size", edgeSize);
    graph.setEdgeAttribute(edge, "color", color);
    graph.setEdgeAttribute(edge, "originalSize", edgeSize);
    graph.setEdgeAttribute(edge, "originalColor", color);
  });

  // ── ForceAtlas2 layout ─────────────────────────────────────────────
  const dataKey = graphData.nodes.map((n) => n.id).sort().join(",") + "|" + graphData.edges.length;
  const isNewLayout = dataKey !== lastLayoutDataKey;

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

  // Compute graph extent for d3-force adaptive parameters
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cx = 0, cy = 0, count = 0;
  graph.forEachNode((nodeId: string, attrs: any) => {
    if (attrs.x < minX) minX = attrs.x;
    if (attrs.x > maxX) maxX = attrs.x;
    if (attrs.y < minY) minY = attrs.y;
    if (attrs.y > maxY) maxY = attrs.y;
    cx += attrs.x; cy += attrs.y; count++;
  });
  cx /= count || 1; cy /= count || 1;
  const graphExtent = { minX, maxX, minY, maxY, centerX: cx, centerY: cy };

  // Cache final positions back into the instance-level positionCache
  graph.forEachNode((nodeId: string, attrs: any) => {
    positionCache.set(nodeId, { x: attrs.x, y: attrs.y });
  });
  if (positionCache.size > POSITION_CACHE_LIMIT) {
    const toRemove = [...positionCache.keys()].slice(0, positionCache.size - POSITION_CACHE_LIMIT);
    for (const k of toRemove) positionCache.delete(k);
  }
  savePositionsToStorage(positionCache);

  return { graph, allCached, isNewLayout, newLayoutDataKey: dataKey, graphExtent };
}

// ── Physics parameter mapping (Phase 2C) ────────────────────────────────

export interface PhysicsPreferences {
  density: number;   // 0–100
  repulsion: number; // 0–100
  tension: number;   // 0–100
}

export interface ResolvedPhysicsConfig {
  linkDistance: number;
  linkStrength: number;
  chargeStrength: number;
  collisionRadius: number;
}

export const PHYSICS_STORAGE_KEY = "pingcha_graph_physics_preferences_v1";

export const DEFAULT_PHYSICS_PREFERENCES: PhysicsPreferences = {
  density: 50,
  repulsion: 50,
  tension: 50,
};

/**
 * Convert user 0–100 preference to D3 force linkDistance.
 * density 50 → baseLinkDist (from buildGraph adaptive calculation)
 * density 0  → baseLinkDist × 0.70 (compact)
 * density 100 → baseLinkDist × 1.55 (spread)
 */
export function resolveLinkDistance(density: number, baseLinkDist: number): number {
  const clamped = Math.max(0, Math.min(100, density));
  const ratio = 0.70 + (clamped / 100) * (1.55 - 0.70);
  return Math.max(10, baseLinkDist * ratio);
}

/**
 * Convert user 0–100 preference to D3 forceManyBody strength.
 * repulsion 50 → baseRepulsion (from buildGraph adaptive calculation: -sqrt(N)*8)
 * repulsion 0  → baseRepulsion × 0.55 (weaker)
 * repulsion 100 → baseRepulsion × 1.80 (stronger)
 */
export function resolveChargeStrength(repulsion: number, baseRepulsion: number): number {
  const clamped = Math.max(0, Math.min(100, repulsion));
  const ratio = 0.55 + (clamped / 100) * (1.80 - 0.55);
  return baseRepulsion * ratio;
}

/**
 * Convert user 0–100 preference to D3 forceLink strength.
 * tension 50 → 0.35 (Phase 2B default)
 * tension 0  → 0.35 × 0.55 (loose)
 * tension 100 → 0.35 × 1.50 (tight)
 */
export function resolveLinkStrength(tension: number): number {
  const clamped = Math.max(0, Math.min(100, tension));
  const ratio = 0.55 + (clamped / 100) * (1.50 - 0.55);
  return Math.max(0.01, 0.35 * ratio);
}

/**
 * Compute all resolved physics config from user preferences and graph metrics.
 */
export function computePhysicsConfig(
  prefs: PhysicsPreferences,
  baseLinkDist: number,
  baseRepulsion: number,
  collisionRadius: number,
): ResolvedPhysicsConfig {
  return {
    linkDistance: resolveLinkDistance(prefs.density, baseLinkDist),
    chargeStrength: resolveChargeStrength(prefs.repulsion, baseRepulsion),
    linkStrength: resolveLinkStrength(prefs.tension),
    collisionRadius,
  };
}

/**
 * Load physics preferences from localStorage. SSR-safe.
 */
export function loadPhysicsPreferences(): PhysicsPreferences {
  try {
    const raw = localStorage.getItem(PHYSICS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PHYSICS_PREFERENCES };
    const obj = JSON.parse(raw) as Partial<PhysicsPreferences>;
    return {
      density: typeof obj.density === "number" ? Math.max(0, Math.min(100, obj.density)) : DEFAULT_PHYSICS_PREFERENCES.density,
      repulsion: typeof obj.repulsion === "number" ? Math.max(0, Math.min(100, obj.repulsion)) : DEFAULT_PHYSICS_PREFERENCES.repulsion,
      tension: typeof obj.tension === "number" ? Math.max(0, Math.min(100, obj.tension)) : DEFAULT_PHYSICS_PREFERENCES.tension,
    };
  } catch {
    return { ...DEFAULT_PHYSICS_PREFERENCES };
  }
}

/**
 * Save physics preferences to localStorage. Debounced by caller.
 */
export function savePhysicsPreferences(prefs: PhysicsPreferences): void {
  try {
    localStorage.setItem(PHYSICS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

/**
 * Human-readable label for density value.
 */
export function densityLabel(value: number): string {
  if (value < 30) return "紧凑";
  if (value < 70) return "标准";
  return "舒展";
}

/**
 * Human-readable label for repulsion value.
 */
export function repulsionLabel(value: number): string {
  if (value < 30) return "弱";
  if (value < 70) return "标准";
  return "强";
}

/**
 * Human-readable label for tension value.
 */
export function tensionLabel(value: number): string {
  if (value < 30) return "松";
  if (value < 70) return "标准";
  return "紧";
}

// ── Layout calibration helpers (Phase 2D: unit mismatch fix) ───────────────

/**
 * Compute D3-compatible collision radius in graph coordinate space.
 * Sigma renders node size in pixels, but D3 operates in graph coordinate space.
 * We derive the collision radius by:
 *   1. Computing avg node size in pixels
 *   2. Computing pixel-to-graph ratio from graphExtent and a reference viewport (800px wide)
 *   3. Adding padding proportional to the graph scale
 */
export function computeCollisionRadius(
  graphExtent: { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number },
  nodeSizes: number[],
  avgPixelNodeSize: number,
): number {
  const graphWidth = graphExtent.maxX - graphExtent.minX || 1;
  const graphHeight = graphExtent.maxY - graphExtent.minY || 1;
  const extentSpan = Math.sqrt(graphWidth * graphHeight);

  // Reference viewport: assume ~800px wide graph area
  const REF_VIEWPORT = 800;
  const pixelPerGraphUnit = REF_VIEWPORT / extentSpan;

  // Collision radius in graph units: avg pixel size → graph units + padding
  const pixelPadding = 8; // breathing room in pixels
  const totalPixelRadius = avgPixelNodeSize / 2 + pixelPadding;
  const graphCollisionRadius = totalPixelRadius / pixelPerGraphUnit;

  // Also scale with avg node size variation
  const avgSize = nodeSizes.reduce((a, b) => a + b, 0) / (nodeSizes.length || 1);
  const sizeRatio = avgSize / BASE_NODE_SIZE;
  const finalRadius = graphCollisionRadius * Math.sqrt(sizeRatio);

  // Clamp: minimum meaningful separation, maximum to avoid pushing everything outward
  return Math.max(extentSpan * 0.005, Math.min(finalRadius, extentSpan * 0.05));
}

/**
 * Compute a more aggressive default link distance for D3 forceLink.
 * Returns distance in graph coordinate units.
 */
export function computeDefaultLinkDistance(
  graphExtent: { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number },
  N: number,
): number {
  const graphWidth = graphExtent.maxX - graphExtent.minX || 1;
  const graphHeight = graphExtent.maxY - graphExtent.minY || 1;
  const extentSpan = Math.sqrt(graphWidth * graphHeight);
  // Phase 2B default was: max(30, min((extentSpan/√N)*1.2, 120))
  // This returns a graph-coordinate distance — for N~67, extentSpan~500: ~73
  return Math.max(extentSpan * 0.08, Math.min(extentSpan * 0.18, extentSpan * 0.25));
}

/**
 * Compute stronger default charge strength for D3 forceManyBody.
 */
export function computeDefaultChargeStrength(
  N: number,
  graphExtent: { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number },
): number {
  const graphWidth = graphExtent.maxX - graphExtent.minX || 1;
  const graphHeight = graphExtent.maxY - graphExtent.minY || 1;
  const extentSpan = Math.sqrt(graphWidth * graphHeight);
  // Much stronger than Phase 2B's -sqrt(N)*8
  // Use extentSpan-normalized strength so it works across different graph scales
  return -extentSpan * 0.15; // ~-75 for extentSpan=500
}
