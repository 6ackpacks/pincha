"use client";

import type { default as SigmaConstructor } from "sigma";
import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getWikiGraph } from "@/lib/api";
import { CircleNotch, MagnifyingGlass } from "@phosphor-icons/react";
import { activeKbIdAtom } from "@/atoms/kb";
import { useAtom } from "jotai";
import { getCommunityColor } from "@/lib/constants/community-colors";
import {
  BASE_NODE_SIZE,
  LABEL_SIZE,
  mixColor,
  applyColors,
  clearPositionStorage,
  buildGraph,
  computePhysicsConfig,
  loadPhysicsPreferences,
  savePhysicsPreferences,
  DEFAULT_PHYSICS_PREFERENCES,
  computeCollisionRadius,
  computeDefaultLinkDistance,
  computeDefaultChargeStrength,
  type PhysicsPreferences,
} from "./relation-graph-utils";
import { RelationGraphControls } from "./relation-graph-controls";
import { PhysicsControls } from "./relation-graph-controls-physics";
import { RELATION_LABELS } from "./wiki-entry-helpers";

type SigmaInstance = InstanceType<typeof SigmaConstructor>;

interface RelationGraphProps {
  activeSlug?: string | null;
  onSelectSlug?: (slug: string) => void;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  weight: number;
}

// Physics simulation state held in a ref for access outside the Promise callback
interface PhysicsSimState {
  sim: Simulation<SimNode, SimLink>;
  linkForce: any;
  chargeForce: any;
  collideForce: any;
  isPaused: boolean;
  baseLinkDist: number;
  baseRepulsion: number;
  simNodes: SimNode[];
  graphCollisionRadius: number;
}

function computeTopologyKey(
  activeKbId: string,
  graphData: { nodes: { id: string }[]; edges: { from_id: string; to_id: string; strength?: number }[] },
): string {
  const nodeIds = graphData.nodes.map((n) => n.id).sort().join(",");
  const edges = [...graphData.edges]
    .sort((a, b) => a.from_id.localeCompare(b.from_id) || a.to_id.localeCompare(b.to_id))
    .map((e) => `${e.from_id}->${e.to_id}:${e.strength ?? 0.5}`)
    .join("|");
  return `${activeKbId}|${nodeIds}|${edges}`;
}

export function RelationGraph({ activeSlug, onSelectSlug }: RelationGraphProps = {}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<SigmaInstance | null>(null);
  const rafRef = useRef<number>(0);
  const filterRafRef = useRef<number>(0);
  const hoveredNodeRef = useRef<string | null>(null);
  const hiddenNodeIdsRef = useRef<Set<string>>(new Set());
  const filterAnimRef = useRef<Map<string, number>>(new Map());
  const positionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const lastLayoutDataKeyRef = useRef<string>("");
  const lastTopologyKeyRef = useRef<string>("");
  const physicsSimRef = useRef<PhysicsSimState | null>(null);
  const colorModeRef = useRef<"type" | "community">("type");
  const physicsPrefsRef = useRef<PhysicsPreferences>(loadPhysicsPreferences());
  const initialSeedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const cameraRatioRef = useRef<number>(1);
  const [colorMode, setColorMode] = useState<"type" | "community">("type");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hideOrphans, setHideOrphans] = useState(false);
  const [activeKbId] = useAtom(activeKbIdAtom);
  const prevKbIdRef = useRef<string | null | undefined>(undefined);
  const [physicsPrefs, setPhysicsPrefs] = useState<PhysicsPreferences>(() => loadPhysicsPreferences());
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; title: string; slug: string; type: string }[]>([]);
  const [searchHighlightIdx, setSearchHighlightIdx] = useState(-1);
  const focusedNodeIdRef = useRef<string | null>(null);
  const neighborIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const edgeMetaRef = useRef<Map<string, { weight: number; source: string; target: string }>>(new Map());

  // Sync colorMode to ref
  useEffect(() => {
    colorModeRef.current = colorMode;
  }, [colorMode]);

  // Sync physicsPrefs to ref
  useEffect(() => {
    physicsPrefsRef.current = physicsPrefs;
  }, [physicsPrefs]);

  // Clear state when KB changes
  useEffect(() => {
    if (prevKbIdRef.current === undefined) {
      prevKbIdRef.current = activeKbId;
      return;
    }
    if (prevKbIdRef.current !== activeKbId) {
      prevKbIdRef.current = activeKbId;
      clearPositionStorage();
      positionCacheRef.current.clear();
      lastLayoutDataKeyRef.current = "";
      lastTopologyKeyRef.current = "";
      initialSeedPositionsRef.current.clear();
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

  // ── Physics control handlers ──────────────────────────────────────────
  const updatePhysicsParams = useCallback((prefs: PhysicsPreferences) => {
    const state = physicsSimRef.current;
    if (!state) return;
    const config = computePhysicsConfig(prefs, state.baseLinkDist, state.baseRepulsion, state.graphCollisionRadius);
    state.linkForce.distance(config.linkDistance);
    state.linkForce.strength(config.linkStrength);
    state.chargeForce.strength(config.chargeStrength);
    if (!state.isPaused) {
      state.sim.alpha(Math.max(state.sim.alpha(), 0.18)).alphaTarget(0).restart();
    }
  }, []);

  const handlePause = useCallback(() => {
    const state = physicsSimRef.current;
    if (!state || state.isPaused) return;
    state.isPaused = true;
    state.sim.stop();
    cancelAnimationFrame(rafRef.current);
  }, []);

  const handleResume = useCallback(() => {
    const state = physicsSimRef.current;
    if (!state || !state.isPaused) return;
    state.isPaused = false;
    state.sim.alpha(Math.max(state.sim.alpha(), 0.16)).alphaTarget(0).restart();
  }, []);

  const handleRelayout = useCallback(() => {
    const state = physicsSimRef.current;
    if (!state) return;
    // Restore seed positions
    initialSeedPositionsRef.current.forEach((pos, nodeId) => {
      state.simNodes.forEach((sn) => {
        if (sn.id === nodeId) {
          sn.x = pos.x; sn.y = pos.y; sn.fx = null; sn.fy = null;
        }
      });
      positionCacheRef.current.delete(nodeId);
    });
    // Reload from seed
    if (sigmaRef.current) {
      const g = sigmaRef.current.getGraph();
      initialSeedPositionsRef.current.forEach((pos, nodeId) => {
        if (g.hasNode(nodeId)) {
          g.setNodeAttribute(nodeId, "x", pos.x);
          g.setNodeAttribute(nodeId, "y", pos.y);
        }
      });
      sigmaRef.current.refresh();
    }
    if (!state.isPaused) {
      state.sim.alpha(0.65).alphaTarget(0).restart();
    }
  }, []);

  const handleResetParams = useCallback(() => {
    setPhysicsPrefs(DEFAULT_PHYSICS_PREFERENCES);
    savePhysicsPreferences(DEFAULT_PHYSICS_PREFERENCES);
    updatePhysicsParams(DEFAULT_PHYSICS_PREFERENCES);
  }, [updatePhysicsParams]);

  // ── Search ──────────────────────────────────────────────────────────────
  const performSearch = useCallback((query: string) => {
    if (!query.trim() || !graphData) {
      setSearchResults([]);
      return;
    }
    const q = query.trim().toLowerCase();
    const results: { id: string; title: string; slug: string; type: string; score: number }[] = [];
    for (const node of graphData.nodes) {
      const title = (node.title || "").toLowerCase();
      const slug = (node.slug || "").toLowerCase();
      const type = (node.type || "concept").toLowerCase();
      const degree = graphData.edges.filter(e => e.from_id === node.id || e.to_id === node.id).length;
      let score = 0;
      if (title.startsWith(q)) score = 100 - results.length;
      else if (title.includes(q)) score = 50 - results.length;
      else if (slug.includes(q) || type.includes(q)) score = 25 - results.length;
      else continue;
      score += degree * 2 + (node.source_count || 0) * 0.5;
      results.push({ ...node, score });
    }
    results.sort((a, b) => b.score - a.score);
    setSearchResults(results.slice(0, 8));
    setSearchHighlightIdx(-1);
  }, [graphData]);

  // Sync focusedNodeId to ref and trigger Sigma refresh + camera animation
  const handleFocusNode = useCallback((nodeId: string | null) => {
    const prev = focusedNodeIdRef.current;
    focusedNodeIdRef.current = nodeId;
    setFocusedNodeId(nodeId);
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    if (nodeId && (graph as any).hasNode(nodeId)) {
      const nx = (graph as any).getNodeAttribute(nodeId, "x") as number;
      const ny = (graph as any).getNodeAttribute(nodeId, "y") as number;
      const camera = sigma.getCamera();
      const neighbors = neighborIdsRef.current.get(nodeId) ?? new Set<string>();
      let minX = nx, maxX = nx, minY = ny, maxY = ny;
      for (const nid of neighbors) {
        if (!(graph as any).hasNode(nid)) continue;
        const nx2 = (graph as any).getNodeAttribute(nid, "x") as number;
        const ny2 = (graph as any).getNodeAttribute(nid, "y") as number;
        if (nx2 < minX) minX = nx2; if (nx2 > maxX) maxX = nx2;
        if (ny2 < minY) minY = ny2; if (ny2 > maxY) maxY = ny2;
      }
      const padding = 80;
      const spanX = Math.max(maxX - minX + padding * 2, 100);
      const spanY = Math.max(maxY - minY + padding * 2, 100);
      const dims = sigma.getDimensions();
      const ratioX = spanX / (dims.width * 0.65);
      const ratioY = spanY / (dims.height * 0.65);
      const targetRatio = Math.max(ratioX, ratioY, 0.2);
      camera.animate(
        { x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio: targetRatio },
        { duration: 350 }
      );
    } else {
      // Back to overview: reset camera to fit all nodes
      const camera = sigma.getCamera();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      (graph as any).forEachNode((_id: string, attrs: Record<string, unknown>) => {
        if ((attrs.x as number) < minX) minX = attrs.x as number;
        if ((attrs.x as number) > maxX) maxX = attrs.x as number;
        if ((attrs.y as number) < minY) minY = attrs.y as number;
        if ((attrs.y as number) > maxY) maxY = attrs.y as number;
      });
      if (minX !== Infinity) {
        const dims = sigma.getDimensions();
        const ratioX = Math.abs(maxX - minX) / (dims.width * 0.85);
        const ratioY = Math.abs(maxY - minY) / (dims.height * 0.85);
        camera.animate(
          { x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio: Math.max(ratioX, ratioY, 0.08) },
          { duration: 400 }
        );
      }
    }
    sigma.refresh();
  }, []);

  const handleBackToOverview = useCallback(() => {
    handleFocusNode(null);
  }, [handleFocusNode]);

  // Sync sidebar activeSlug selection with graph focus
  useEffect(() => {
    if (!activeSlug || !graphData) return;
    const matchedNode = graphData.nodes.find(n => n.slug === activeSlug);
    if (matchedNode && matchedNode.id !== focusedNodeIdRef.current) {
      const timer = setTimeout(() => handleFocusNode(matchedNode.id), 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlug, graphData]);

  // ── Main effect: graph + Sigma + D3-force ──────────────────────────
  useEffect(() => {
    if (!graphData || graphData.nodes.length === 0 || !containerRef.current) return;

    const currentTopologyKey = computeTopologyKey(activeKbId ?? "", graphData);

    // Same topology — only update color and restore filterVis, no rebuild
    if (currentTopologyKey === lastTopologyKeyRef.current && sigmaRef.current) {
      const graph = sigmaRef.current.getGraph();
      applyColors(graph as Parameters<typeof applyColors>[0], colorModeRef.current);
      sigmaRef.current.refresh({ skipIndexation: true });
      filterAnimRef.current.clear();
      graph.forEachNode((nodeId: string) => {
        filterAnimRef.current.set(nodeId, hiddenNodeIdsRef.current.has(nodeId) ? 0 : 1);
        graph.setNodeAttribute(nodeId, "filterVis", hiddenNodeIdsRef.current.has(nodeId) ? 0 : 1);
      });
      sigmaRef.current.refresh();
      return;
    }

    let cancelled = false;
    const isStaleRef = { value: false };
    const pendingSaveTimeout: { id: ReturnType<typeof setTimeout> | null } = { id: null };

    Promise.all([
      import("graphology").then((m) => m.default),
      import("sigma").then((m) => m.default),
      import("graphology-layout-forceatlas2"),
      import("d3-force"),
    ]).then(([Graph, Sigma, fa2Module, d3Force]) => {
      if (cancelled || isStaleRef.value || !containerRef.current) return;

      // Cleanup old simulation handlers and instance
      if (physicsSimRef.current) {
        physicsSimRef.current.sim.on("tick", null);
        physicsSimRef.current.sim.on("end", null);
        physicsSimRef.current.sim.stop();
        physicsSimRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(filterRafRef.current);
      if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null; }

      const forceAtlas2 = (fa2Module as { default?: unknown }).default ?? fa2Module;

      const { graph, allCached, isNewLayout, newLayoutDataKey, graphExtent } = buildGraph(
        Graph as { new (): unknown },
        forceAtlas2,
        graphData,
        positionCacheRef.current,
        lastLayoutDataKeyRef.current,
      );
      lastLayoutDataKeyRef.current = newLayoutDataKey;

      // Save initial seed positions for relayout
      initialSeedPositionsRef.current.clear();
      graph.forEachNode((nodeId: string) => {
        initialSeedPositionsRef.current.set(nodeId, {
          x: graph.getNodeAttribute(nodeId, "x") as number,
          y: graph.getNodeAttribute(nodeId, "y") as number,
        });
      });

      applyColors(graph as Parameters<typeof applyColors>[0], colorModeRef.current);

      filterAnimRef.current.clear();
      graph.forEachNode((nodeId: string) => {
        filterAnimRef.current.set(nodeId, hiddenNodeIdsRef.current.has(nodeId) ? 0 : 1);
        graph.setNodeAttribute(nodeId, "filterVis", hiddenNodeIdsRef.current.has(nodeId) ? 0 : 1);
      });

      // Declared early: needed for label priority computation before D3 sim setup
      const nodeIds = (graph as any).nodes();
      const N = (graph as any).order;

      // Compute degree distribution for 4-tier visual hierarchy
      const nodeDegrees = new Map<string, number>();
      for (const id of nodeIds) {
        nodeDegrees.set(id, (graph as any).degree(id));
      }
      const sortedDegrees = [...nodeDegrees.values()].sort((a, b) => a - b);
      const hub10Threshold = sortedDegrees[Math.floor(sortedDegrees.length * 0.9)] ?? 1;
      const peripheral30Threshold = sortedDegrees[Math.floor(sortedDegrees.length * 0.3)] ?? 0;

      // Compute label priority
      const labelPriorityMap = new Map<string, number>();
      for (const id of nodeIds) {
        const degree = nodeDegrees.get(id) ?? 0;
        const sourceCount = (graph as any).getNodeAttribute(id, "sourceCount") as number ?? 0;
        const size = (graph as any).getNodeAttribute(id, "size") as number;
        const maxDegree = (graph as any).size;
        const score = (degree / Math.max(1, maxDegree)) * 0.5
                    + (sourceCount / 50) * 0.3
                    + (size / 28) * 0.2;
        labelPriorityMap.set(id, score);
      }
      const prioritySortedIds = [...nodeIds].sort((a, b) =>
        (labelPriorityMap.get(b) ?? 0) - (labelPriorityMap.get(a) ?? 0)
      );

      // Precompute neighbor and edge maps for focus mode (O(nodes + edges))
      const neighborMap = new Map<string, Set<string>>();
      const edgeMetaMap = new Map<string, { weight: number; source: string; target: string }>();
      for (const id of nodeIds) neighborMap.set(id, new Set((graph as any).neighbors(id)));
      const edgeIds = (graph as any).edges();
      for (const e of edgeIds) {
        const [s, t] = (graph as any).extremities(e);
        edgeMetaMap.set(e, { weight: (graph as any).getEdgeAttribute(e, "weight") ?? 0.5, source: s, target: t });
      }
      neighborIdsRef.current = neighborMap;
      edgeMetaRef.current = edgeMetaMap;

      let labelRects: { x: number; y: number; w: number; h: number }[] = [];
      let lastLabelFrame = 0;

      function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      }

      const sigma = new Sigma(graph, containerRef.current!, {
        allowInvalidContainer: true,
        labelSize: LABEL_SIZE,
        labelWeight: "bold",
        labelColor: { color: "#1e293b" },
        labelDensity: 0.05,
        labelRenderedSizeThreshold: 10,
        stagePadding: 50,
        defaultEdgeType: "line",
        defaultDrawNodeLabel: (context: CanvasRenderingContext2D, data: Record<string, unknown>, settings: unknown) => {
          if (!data.label) return;
          const labelSize = ((settings as Record<string, unknown>).labelSize as number) ?? LABEL_SIZE;
          const isHovered = (data.highlighted as boolean) || (data as Record<string, unknown>).forceLabel;
          const fontSize = isHovered ? labelSize + 4 : labelSize;
          context.font = `${isHovered ? "700" : "bold"} ${fontSize}px sans-serif`;
          const textWidth = context.measureText(data.label as string).width;
          const nodeSize = (data.size as number) || 4;
          const x = (data.x as number) + nodeSize + 4;
          const y = (data.y as number) + fontSize / 3;
          const now = performance.now();
          if (now - lastLabelFrame > 10) { labelRects = []; lastLabelFrame = now; }
          const rect = { x, y: (data.y as number) - fontSize / 2, w: textWidth + 8, h: fontSize + 4 };
          if (!isHovered) { for (const existing of labelRects) { if (rectsOverlap(rect, existing)) return; } }
          labelRects.push(rect);
          if (isHovered) {
            const pad = 4;
            context.beginPath();
            context.roundRect(x - pad, (data.y as number) - fontSize / 2 - pad + 2, textWidth + pad * 2, fontSize + pad * 2, 4);
            context.fillStyle = "rgba(255,255,255,0.95)";
            context.fill();
            context.fillStyle = "#1e293b";
            context.fillText(data.label as string, x, y);
          } else {
            context.fillStyle = "#1e293b";
            context.fillText(data.label as string, x, y);
          }
        },
        defaultDrawNodeHover: (context: CanvasRenderingContext2D, data: Record<string, unknown>) => {
          if (!data.label) return;
          const fontSize = LABEL_SIZE + 5;
          context.font = `700 ${fontSize}px sans-serif`;
          const textWidth = context.measureText(data.label as string).width;
          const nodeSize = (data.size as number) || 4;
          const x = (data.x as number) + nodeSize + 5;
          const y = (data.y as number) + fontSize / 3;
          const pad = 5;
          context.beginPath();
          context.roundRect(x - pad, (data.y as number) - fontSize / 2 - pad + 2, textWidth + pad * 2, fontSize + pad * 2, 5);
          context.fillStyle = "rgba(255,255,255,0.95)";
          context.fill();
          context.fillStyle = "#1e293b";
          context.fillText(data.label as string, x, y);
        },
        renderLabels: true,
        zoomingRatio: 1.3,
        minCameraRatio: 0.08,
        maxCameraRatio: 8,
        nodeReducer: (node: string, data: Record<string, unknown>) => {
          const res = { ...data };
          const originalColor = (data.originalColor as string) || (data.color as string) || "#94a3b8";
          const originalSize = (data.originalSize as number) || (data.size as number) || BASE_NODE_SIZE;
          const filterVis = (data.filterVis as number) ?? 1;
          if (filterVis <= 0) { res.hidden = true; return res; }
          if (filterVis < 1) {
            res.size = originalSize * filterVis;
            res.color = mixColor(originalColor, "#fafafa", 1 - filterVis);
          }
          if (res.label && (res.label as string).length > 16) {
            res.label = (res.label as string).slice(0, 16) + "…";
          }

          // 4-tier visual hierarchy based on degree
          const degree = nodeDegrees.get(node) ?? 0;
          const isHub = degree >= hub10Threshold && hub10Threshold > 0;
          const isPeripheral = degree <= peripheral30Threshold;

          if (isPeripheral) {
            // Peripheral: smaller, more transparent, no label by default
            res.color = mixColor(originalColor, "#fafafa", 0.4);
            res.size = originalSize * 0.85;
          } else if (!isHub) {
            // Normal: slightly desaturated
            res.color = mixColor(originalColor, "#fafafa", 0.15);
          }
          // Hub: full color, size as computed (no change needed)

          // Label budget: scales with camera zoom
          const currentRatio = cameraRatioRef.current;
          const LABEL_BUDGET = Math.floor(8 + 20 * (1 / Math.max(currentRatio, 0.3)));
          const priorityRank = prioritySortedIds.indexOf(node);
          // Hub nodes always show labels; peripheral never by default
          if (isHub) {
            // Always show label for hub nodes
            res.labelBackgroundColor = "rgba(255,255,255,0.75)";
          } else if (isPeripheral) {
            // Peripheral: no label unless hovered
            if (node !== hoveredNodeRef.current) {
              res.label = "";
            }
          } else {
            // Normal: show label if within budget
            if (priorityRank === -1 || priorityRank > LABEL_BUDGET) {
              if (node !== hoveredNodeRef.current) {
                res.label = "";
              }
            } else {
              res.labelBackgroundColor = "rgba(255,255,255,0.75)";
            }
          }

          const hoveredNode = hoveredNodeRef.current;
          if (hoveredNode && (graph as any).hasNode(hoveredNode)) {
            if (node === hoveredNode) {
              res.size = originalSize * 1.4;
              res.zIndex = 10;
              (res as Record<string, unknown>).forceLabel = true;
              res.highlighted = true;
              res.label = (graph as any).getNodeAttribute(node, "label") || res.label;
            } else if ((graph as any).hasNode(node) && (graph as any).areNeighbors(node, hoveredNode)) {
              (res as Record<string, unknown>).forceLabel = true;
              res.highlighted = true;
              res.label = (graph as any).getNodeAttribute(node, "label") || res.label;
            } else {
              res.color = mixColor(originalColor, "#e2e8f0", 0.75);
              res.label = "";
              res.size = originalSize * 0.6;
            }
          }
          // Focus mode: dim non-focused/non-neighbor nodes
          const focusedNode = focusedNodeIdRef.current;
          if (focusedNode && (graph as any).hasNode(focusedNode)) {
            const neighbors = neighborIdsRef.current.get(focusedNode) ?? new Set<string>();
            const isFocused = node === focusedNode;
            const isNeighbor = neighbors.has(node);
            if (isFocused) {
              // Focused node: ring outline, 1.3x size, full label
              res.size = originalSize * 1.3;
              res.zIndex = 10;
              res.borderColor = originalColor;
              res.borderSize = 2;
              (res as Record<string, unknown>).forceLabel = true;
              (res as Record<string, unknown>).isFocused = true;
              res.label = (graph as any).getNodeAttribute(node, "label") || res.label;
              res.labelBackgroundColor = "rgba(255,255,255,0.75)";
            } else if (isNeighbor) {
              // Neighbor: show normally but with label
              (res as Record<string, unknown>).forceLabel = true;
              res.label = (graph as any).getNodeAttribute(node, "label") || res.label;
              res.labelBackgroundColor = "rgba(255,255,255,0.75)";
            } else {
              // Non-neighbor: dim significantly
              const dimmedColor = mixColor(originalColor, "#fafafa", 0.82);
              res.color = dimmedColor;
              res.size = originalSize * 0.65;
              res.label = "";
            }
          }
          return res;
        },
        edgeReducer: (edge: string, data: Record<string, unknown>) => {
          const res = { ...data };
          const [source, target] = (graph as any).extremities(edge);
          const srcVis = (graph as any).hasNode(source) ? (((graph as any).getNodeAttribute(source, "filterVis") as number) ?? 1) : 1;
          const tgtVis = (graph as any).hasNode(target) ? (((graph as any).getNodeAttribute(target, "filterVis") as number) ?? 1) : 1;
          const minVis = Math.min(srcVis, tgtVis);
          if (minVis <= 0) { res.hidden = true; return res; }
          if (minVis < 1) {
            res.size = ((data.originalSize as number) || (data.size as number) || 0.4) * minVis;
            res.color = `rgba(180,190,200,${(minVis * 0.12).toFixed(2)})`;
          }
          const hoveredNode = hoveredNodeRef.current;
          if (hoveredNode) {
            if (source === hoveredNode || target === hoveredNode) {
              res.color = "rgba(100,116,139,0.6)";
              res.size = 1.5;
            } else {
              res.color = "rgba(200,205,210,0.06)";
              res.size = 0.2;
            }
          }
          // Focus mode: dim edges not connected to focused node
          const focusedNode = focusedNodeIdRef.current;
          if (focusedNode && edgeMetaRef.current.has(edge)) {
            const meta = edgeMetaRef.current.get(edge)!;
            const isFocusedEdge = meta.source === focusedNode || meta.target === focusedNode;
            if (!isFocusedEdge) {
              res.color = "rgba(200,205,210,0.06)";
              res.size = 0.15;
            } else {
              // Focused node's edges: prominent but not harsh
              res.color = "rgba(100,116,139,0.5)";
              res.size = 1.2;
            }
          }
          return res;
        },
      });

      sigma.on("enterNode", ({ node }: { node: string }) => {
        hoveredNodeRef.current = node;
        if (containerRef.current) containerRef.current.style.cursor = "pointer";
        sigma.refresh();
      });
      sigma.on("leaveNode", () => {
        hoveredNodeRef.current = null;
        if (containerRef.current) containerRef.current.style.cursor = "default";
        sigma.refresh();
      });

      // Keep camera ratio ref in sync for label budget calculation
      sigma.getCamera().on("updated", () => {
        cameraRatioRef.current = sigma.getCamera().ratio;
        sigma.refresh();
      });

      // D3-force simulation
      // nodeIds and N are declared earlier (needed for label priority computation)
      // edgeIds is also declared earlier (precomputation block)
      const simNodes: SimNode[] = nodeIds.map((id: string) => ({
        id,
        x: (graph as any).getNodeAttribute(id, "x") as number,
        y: (graph as any).getNodeAttribute(id, "y") as number,
      }));
      const simLinks: SimLink[] = edgeIds.map((e: string) => {
        const [s, t] = (graph as any).extremities(e);
        return {
          source: s,
          target: t,
          weight: ((graph as any).getEdgeAttribute(e, "weight") as number) ?? 0.5,
        };
      });

      // Compute graph-coordinate collision radius
      const nodeSizes: number[] = [];
      for (const id of nodeIds) nodeSizes.push((graph as any).getNodeAttribute(id, "size") as number);
      const avgPixelNodeSize = nodeSizes.reduce((a, b) => a + b, 0) / (nodeSizes.length || 1);
      const graphCollisionRadius = computeCollisionRadius(graphExtent, nodeSizes, avgPixelNodeSize);

      const baseLinkDist = computeDefaultLinkDistance(graphExtent, N);
      const baseRepulsion = computeDefaultChargeStrength(N, graphExtent);
      const startAlpha = allCached && !isNewLayout ? 0.05 : 0.15;

      // Load user physics preferences
      const prefs = physicsPrefsRef.current;

      const d3Sim = (d3Force as any).forceSimulation(simNodes)
        .alpha(startAlpha)
        .alphaMin(0.0005)
        .alphaDecay(0.015)
        .velocityDecay(0.3);

      const linkForce = (d3Force as any).forceLink(simLinks).id((d: SimNode) => d.id);
      const chargeForce = (d3Force as any).forceManyBody().distanceMax((graphExtent.maxX - graphExtent.minX) * 2);
      const collideForce = (d3Force as any).forceCollide(graphCollisionRadius)
        .strength(0.9)
        .iterations(3);

      const config = computePhysicsConfig(prefs, baseLinkDist, baseRepulsion, graphCollisionRadius);
      linkForce.distance(config.linkDistance).strength(config.linkStrength);
      chargeForce.strength(config.chargeStrength);

      d3Sim
        .force("link", linkForce)
        .force("charge", chargeForce)
        .force("collide", collideForce)
        .force("center", (d3Force as any).forceCenter(graphExtent.centerX, graphExtent.centerY).strength(0.8));

      physicsSimRef.current = {
        sim: d3Sim,
        linkForce,
        chargeForce,
        collideForce,
        isPaused: false,
        baseLinkDist,
        baseRepulsion,
        simNodes,
        graphCollisionRadius,
      };

      lastTopologyKeyRef.current = currentTopologyKey;

      let pendingRaf = false;
      function scheduleRefresh() {
        if (pendingRaf || cancelled || isStaleRef.value) return;
        pendingRaf = true;
        rafRef.current = requestAnimationFrame(() => {
          pendingRaf = false;
          if (!cancelled && !isStaleRef.value && sigmaRef.current) {
            sigmaRef.current.refresh();
          }
        });
      }

      d3Sim.on("tick", () => {
        if (cancelled || isStaleRef.value) return;
        for (const sn of simNodes) {
          (graph as any).setNodeAttribute(sn.id, "x", sn.x);
          (graph as any).setNodeAttribute(sn.id, "y", sn.y);
        }
        scheduleRefresh();
      });

      d3Sim.on("end", () => {
        if (cancelled || isStaleRef.value) return;
        cancelAnimationFrame(rafRef.current);
        for (const sn of simNodes) {
          positionCacheRef.current.set(sn.id, { x: sn.x, y: sn.y });
        }
        import("./relation-graph-utils").then(({ savePositionsToStorage }) => {
          savePositionsToStorage(positionCacheRef.current);
        });
      });

      // Drag
      let draggedNodeId: string | null = null;
      let dragStartPos = { x: 0, y: 0 };
      let isDragMove = false;

      sigma.on("downNode", ({ node, event }: { node: string; event: { original: MouseEvent | TouchEvent; preventSigmaDefault: () => void } }) => {
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
        const state = physicsSimRef.current;
        if (state && !state.isPaused) {
          state.sim.alphaTarget(0.15).restart();
        }
      });

      sigma.getMouseCaptor().on("mousemovebody", (e: { x: number; y: number; original: MouseEvent | TouchEvent }) => {
        if (!draggedNodeId) return;
        const orig = e.original;
        let cx = 0, cy = 0;
        if ("clientX" in orig) {
          cx = (orig as MouseEvent).clientX; cy = (orig as MouseEvent).clientY;
        } else if ("touches" in orig && (orig as TouchEvent).touches.length > 0) {
          cx = (orig as TouchEvent).touches[0].clientX; cy = (orig as TouchEvent).touches[0].clientY;
        }
        const dx = cx - dragStartPos.x; const dy = cy - dragStartPos.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragMove = true;
        const pos = sigma.viewportToGraph({ x: e.x, y: e.y });
        (graph as any).setNodeAttribute(draggedNodeId, "x", pos.x);
        (graph as any).setNodeAttribute(draggedNodeId, "y", pos.y);
        const sn = simNodes.find((n) => n.id === draggedNodeId);
        if (sn) { sn.x = pos.x; sn.y = pos.y; sn.fx = pos.x; sn.fy = pos.y; }
        positionCacheRef.current.set(draggedNodeId, { x: pos.x, y: pos.y });
        scheduleRefresh();
      });

      const endDrag = () => {
        if (!draggedNodeId) return;
        const nodeId = draggedNodeId;
        if (!isDragMove) {
          // Focus the node and open the detail panel
          const slug = (graph as any).getNodeAttribute(nodeId, "slug") as string | undefined;
          if (slug) {
            handleFocusNode(nodeId);
            handleClick(slug);
          }
        }
        draggedNodeId = null; isDragMove = false;
        const state = physicsSimRef.current;
        if (state) { state.sim.alphaTarget(0); }
        const sn = simNodes.find((n) => n.id === nodeId);
        if (sn) { sn.fx = null; sn.fy = null; }
        if (pendingSaveTimeout.id) clearTimeout(pendingSaveTimeout.id);
        pendingSaveTimeout.id = setTimeout(() => {
          import("./relation-graph-utils").then(({ savePositionsToStorage }) => {
            savePositionsToStorage(positionCacheRef.current);
          });
        }, 1000);
      };

      sigma.getMouseCaptor().on("mouseup", endDrag);
      sigma.getMouseCaptor().on("mouseleave", endDrag);

      // Camera auto-fit
      if (!(allCached && !isNewLayout)) {
        setTimeout(() => {
          if (cancelled || isStaleRef.value || !sigmaRef.current) return;
          const camera = sigmaRef.current.getCamera();
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          (graph as any).forEachNode((_id: string, attrs: Record<string, unknown>) => {
            if ((attrs.x as number) < minX) minX = attrs.x as number;
            if ((attrs.x as number) > maxX) maxX = attrs.x as number;
            if ((attrs.y as number) < minY) minY = attrs.y as number;
            if ((attrs.y as number) > maxY) maxY = attrs.y as number;
          });
          if (minX === Infinity) { camera.animatedReset({ duration: 400 }); return; }
          const dims = sigmaRef.current.getDimensions();
          const topLeft = sigmaRef.current.graphToViewport({ x: minX, y: minY });
          const bottomRight = sigmaRef.current.graphToViewport({ x: maxX, y: maxY });
          const ratioX = Math.abs(bottomRight.x - topLeft.x) / (dims.width * 0.85);
          const ratioY = Math.abs(bottomRight.y - topLeft.y) / (dims.height * 0.85);
          const newRatio = Math.max(ratioX, ratioY, 0.08);
          camera.animate({ x: 0.5, y: 0.5, ratio: newRatio }, { duration: 400 });
        }, 100);
      }

      sigmaRef.current = sigma;

      // Gentle fade-in: avoid jarring first-frame layout snap
      if (containerRef.current) {
        containerRef.current.style.opacity = "0";
        containerRef.current.style.transition = "opacity 0.8s ease-out";
        requestAnimationFrame(() => {
          if (containerRef.current) containerRef.current.style.opacity = "1";
        });
      }
    });

    return () => {
      cancelled = true;
      isStaleRef.value = true;
      if (pendingSaveTimeout.id) clearTimeout(pendingSaveTimeout.id);
      if (physicsSimRef.current) {
        physicsSimRef.current.sim.on("tick", null);
        physicsSimRef.current.sim.on("end", null);
        physicsSimRef.current.sim.stop();
        physicsSimRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(filterRafRef.current);
      if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null; }
    };
  }, [graphData, handleClick, handleFocusNode, activeKbId]);

  // colorMode: separate effect, no rebuild
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    applyColors(graph as Parameters<typeof applyColors>[0], colorMode);
    sigma.refresh({ skipIndexation: true });
  }, [colorMode]);

  // Physics preferences change → update simulation
  useEffect(() => {
    savePhysicsPreferences(physicsPrefs);
    updatePhysicsParams(physicsPrefs);
  }, [physicsPrefs, updatePhysicsParams]);

  // Escape key: layered dismiss — search results → search query → focus mode
  useEffect(() => {
    const handlerRef = { current: handleFocusNode };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't handle if the search input is focused (it has its own onKeyDown)
      const active = document.activeElement;
      if (active && active.tagName === "INPUT") return;
      if (focusedNodeIdRef.current) {
        handlerRef.current(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleFocusNode]);

  const availableTypes = useMemo(() => {
    if (!graphData) return [];
    return [...new Set(graphData.nodes.map((n) => n.type || "concept"))];
  }, [graphData]);

  const hiddenNodeIds = useMemo(() => {
    if (!graphData) return new Set<string>();
    const nodeTypeMap = new Map<string, string>();
    for (const n of graphData.nodes) nodeTypeMap.set(n.id, n.type || "concept");
    const connCount = new Map<string, number>();
    for (const n of graphData.nodes) connCount.set(n.id, 0);
    for (const e of graphData.edges) {
      const ft = nodeTypeMap.get(e.from_id) || "concept";
      const tt = nodeTypeMap.get(e.to_id) || "concept";
      if (!hiddenTypes.has(ft) && !hiddenTypes.has(tt)) {
        connCount.set(e.from_id, (connCount.get(e.from_id) || 0) + 1);
        connCount.set(e.to_id, (connCount.get(e.to_id) || 0) + 1);
      }
    }
    const hidden = new Set<string>();
    for (const n of graphData.nodes) {
      const t = nodeTypeMap.get(n.id) || "concept";
      if (hiddenTypes.has(t)) { hidden.add(n.id); continue; }
      if (hideOrphans && (connCount.get(n.id) || 0) === 0) hidden.add(n.id);
    }
    return hidden;
  }, [graphData, hiddenTypes, hideOrphans]);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }, []);

  // Filter animation
  useEffect(() => {
    hiddenNodeIdsRef.current = hiddenNodeIds;
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    cancelAnimationFrame(filterRafRef.current);
    const startVis = new Map<string, number>();
    let needsAnim = false;
    (graph as any).forEachNode((nodeId: string) => {
      const current = filterAnimRef.current.get(nodeId) ?? 1;
      const target = hiddenNodeIds.has(nodeId) ? 0 : 1;
      startVis.set(nodeId, current);
      if (Math.abs(current - target) > 0.001) needsAnim = true;
    });
    if (!needsAnim) {
      (graph as any).forEachNode((nodeId: string) => {
        const target = hiddenNodeIds.has(nodeId) ? 0 : 1;
        filterAnimRef.current.set(nodeId, target);
        graph.setNodeAttribute(nodeId, "filterVis", target);
      });
      sigma.refresh({ skipIndexation: true });
      return;
    }
    const DURATION = 220;
    const startTime = performance.now();
    function animateFilter() {
      const t = Math.min((performance.now() - startTime) / DURATION, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      (graph as any).forEachNode((nodeId: string) => {
        const sv = startVis.get(nodeId) ?? 1;
        const tv = hiddenNodeIds.has(nodeId) ? 0 : 1;
        const vis = sv + (tv - sv) * eased;
        filterAnimRef.current.set(nodeId, vis);
        graph.setNodeAttribute(nodeId, "filterVis", vis);
      });
      if (sigma) sigma.refresh({ skipIndexation: true });
      if (t < 1) filterRafRef.current = requestAnimationFrame(animateFilter);
    }
    filterRafRef.current = requestAnimationFrame(animateFilter);
    return () => { cancelAnimationFrame(filterRafRef.current); };
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

  const isPaused = physicsSimRef.current?.isPaused ?? false;

  return (
    <div className="rounded-2xl border border-zinc-200 h-full flex flex-col" style={{ background: "#fafafa" }}>
      <div className="flex-1 min-h-0 relative" style={{ overflow: "hidden" }}>
        <div ref={containerRef} className="absolute inset-0" style={{ background: "#fafafa" }}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target === containerRef.current || target.tagName === "CANVAS") {
              if (focusedNodeIdRef.current) handleFocusNode(null);
            }
          }}
        />
        {/* Top-right search */}
        <div className="absolute top-3 right-3 z-20">
          <div className="relative">
            <MagnifyingGlass size={12} weight="bold" className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                const q = e.target.value;
                setSearchQuery(q);
                performSearch(q);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSearchHighlightIdx(prev =>
                    prev < searchResults.length - 1 ? prev + 1 : 0
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSearchHighlightIdx(prev =>
                    prev > 0 ? prev - 1 : searchResults.length - 1
                  );
                } else if (e.key === "Enter" && searchResults.length > 0) {
                  e.preventDefault();
                  const idx = searchHighlightIdx >= 0 ? searchHighlightIdx : 0;
                  const r = searchResults[idx];
                  if (r) {
                    handleFocusNode(r.id);
                    handleClick(r.slug);
                    setSearchQuery("");
                    setSearchResults([]);
                    setSearchHighlightIdx(-1);
                  }
                } else if (e.key === "Escape") {
                  if (searchResults.length > 0) {
                    setSearchResults([]);
                    setSearchHighlightIdx(-1);
                  } else if (searchQuery) {
                    setSearchQuery("");
                  } else if (focusedNodeIdRef.current) {
                    handleFocusNode(null);
                  }
                }
              }}
              placeholder="搜索图谱…"
              className="pl-7 pr-3 py-1.5 text-[11px] rounded-full border border-zinc-200 bg-white/95 backdrop-blur-sm w-36 focus:w-48 focus:outline-none focus:ring-1 focus:ring-zinc-300 transition-all placeholder:text-zinc-400 shadow-sm"
              aria-label="搜索图谱节点"
            />
            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl border border-zinc-200 shadow-lg py-1 z-50 max-h-60 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      handleFocusNode(r.id);
                      handleClick(r.slug);
                      setSearchQuery("");
                      setSearchResults([]);
                      setSearchHighlightIdx(-1);
                    }}
                    onMouseEnter={() => setSearchHighlightIdx(i)}
                    className={`w-full text-left px-3 py-2 text-[11px] transition-colors ${
                      i === searchHighlightIdx ? "bg-zinc-100" : "hover:bg-zinc-50"
                    }`}
                  >
                    <span className="text-zinc-800 font-medium truncate block">{r.title}</span>
                    <span className="text-zinc-400 text-[10px]">{r.type}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Empty search result */}
            {searchQuery.trim() && searchResults.length === 0 && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl border border-zinc-200 shadow-lg py-3 px-4 z-50">
                <p className="text-[11px] text-zinc-400">未找到相关知识词条</p>
              </div>
            )}
          </div>
        </div>
        {/* Focus info card — top-left */}
        {focusedNodeId && (() => {
          const nodeData = graphData?.nodes.find(n => n.id === focusedNodeId);
          if (!nodeData) return null;
          const neighborSet = neighborIdsRef.current.get(focusedNodeId) ?? new Set<string>();
          const visibleNeighborIds = [...neighborSet].filter(id => !hiddenNodeIdsRef.current.has(id));
          const neighborCount = visibleNeighborIds.length;
          const neighbors = visibleNeighborIds
            .map(id => graphData?.nodes.find(n => n.id === id))
            .filter(Boolean)
            .slice(0, 6) as typeof graphData.nodes;
          return (
            <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm rounded-xl border border-zinc-200 shadow-lg px-4 py-3 w-56 z-20 max-h-48 overflow-y-auto">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-zinc-900 leading-tight truncate">{nodeData.title}</p>
                  <span className="text-[10px] text-zinc-400 capitalize">{nodeData.type || "concept"}</span>
                </div>
                <button
                  onClick={() => handleFocusNode(null)}
                  className="text-zinc-400 hover:text-zinc-700 shrink-0"
                  aria-label="退出聚焦"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <p className="text-[10px] text-zinc-500 mb-2">
                {neighborCount} 个关联词条
              </p>
              {neighbors.length > 0 && (
                <div className="space-y-1 mb-2">
                  {neighbors.map(n => {
                    const edgeInfo = graphData?.edges.find(
                      e => (e.from_id === focusedNodeId && e.to_id === n.id) ||
                           (e.from_id === n.id && e.to_id === focusedNodeId)
                    );
                    const relationType = edgeInfo?.relation_type;
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          handleFocusNode(n.id);
                          if (n.slug) handleClick(n.slug);
                        }}
                        className="w-full text-left px-2 py-1 rounded text-[10px] text-zinc-600 hover:bg-zinc-100 transition-colors flex items-center justify-between gap-1"
                      >
                        <span className="truncate">{n.title}</span>
                        {relationType && (
                          <span className="text-[9px] text-zinc-400 shrink-0">
                            {RELATION_LABELS[relationType] || "相关"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {neighborCount > 6 && (
                    <p className="text-[10px] text-zinc-400 px-2">还有 {neighborCount - 6} 个…</p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleClick(nodeData.slug)}
                  className="flex-1 text-[11px] py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors text-center font-medium"
                >
                  打开词条
                </button>
              </div>
            </div>
          );
        })()}
        {/* Bottom bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-3 pb-3 pointer-events-none">
          <div className="pointer-events-auto">
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
          <div className="pointer-events-auto flex items-center gap-2">
            {focusedNodeId && (
              <button
                onClick={handleBackToOverview}
                className="text-[11px] px-2.5 py-1 rounded-full border border-zinc-300 bg-white/90 backdrop-blur-sm text-zinc-500 hover:text-zinc-700 hover:border-zinc-400 transition-all shadow-sm"
                title="恢复完整图谱视角"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="inline mr-1">
                  <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <circle cx="6" cy="6" r="2" fill="currentColor" />
                </svg>
                回到全图
              </button>
            )}
            <PhysicsControls
              preferences={physicsPrefs}
              onChange={setPhysicsPrefs}
              isPaused={isPaused}
              onPause={handlePause}
              onResume={handleResume}
              onRelayout={handleRelayout}
              onResetParams={handleResetParams}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
