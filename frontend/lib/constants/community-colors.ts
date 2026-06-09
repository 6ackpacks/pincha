// Community colors — Tailwind 400 palette (matches LLM Wiki)
export const COMMUNITY_COLORS = [
  "#60a5fa", // blue-400
  "#4ade80", // green-400
  "#fb923c", // orange-400
  "#c084fc", // purple-400
  "#f87171", // red-400
  "#2dd4bf", // teal-400
  "#facc15", // yellow-400
  "#f472b6", // pink-400
  "#a78bfa", // violet-400
  "#38bdf8", // sky-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
];

export function getCommunityColor(communityId: number | null | undefined): string {
  if (communityId == null) return "#94a3b8"; // slate-400
  return COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length];
}

// Node type colors — Tailwind 400 palette
export const NODE_TYPE_COLORS: Record<string, string> = {
  entity: "#60a5fa",  // blue-400
  concept: "#c084fc", // purple-400
  method: "#4ade80",  // green-400
  source: "#fb923c",  // orange-400
};

export function getNodeTypeColor(type: string | undefined): string {
  return NODE_TYPE_COLORS[type || "concept"] || "#94a3b8";
}
