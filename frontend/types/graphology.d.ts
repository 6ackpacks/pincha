declare module 'graphology' {
  export interface NodeAttributes {
    label?: string;
    x?: number;
    y?: number;
    size?: number;
    color?: string;
    type?: string;
    [key: string]: unknown;
  }

  export interface EdgeAttributes {
    weight?: number;
    color?: string;
    size?: number;
    type?: string;
    label?: string;
    [key: string]: unknown;
  }

  export default class Graph {
    constructor(options?: { multi?: boolean; type?: string });

    order: number;
    size: number;

    addNode(key: string, attributes?: NodeAttributes): string;
    addEdge(source: string, target: string, attributes?: EdgeAttributes): string;

    hasNode(key: string): boolean;
    hasEdge(source: string, target: string): boolean;

    getNodeAttributes(key: string): NodeAttributes;
    getNodeAttribute(key: string, name: string): unknown;
    setNodeAttribute(key: string, name: string, value: unknown): void;
    updateNodeAttribute(key: string, name: string, updater: (value: unknown) => unknown): void;

    forEachNode(callback: (key: string, attributes: NodeAttributes) => void): void;
    forEachEdge(callback: (key: string, attributes: EdgeAttributes, source: string, target: string, sourceAttributes: NodeAttributes, targetAttributes: NodeAttributes) => void): void;

    nodes(): string[];
    edges(): string[];

    degree(key: string): number;

    dropNode(key: string): void;
    dropEdge(key: string): void;
    clear(): void;

    import(data: { nodes: Array<{ key: string; attributes?: NodeAttributes }>; edges: Array<{ source: string; target: string; attributes?: EdgeAttributes }> }): void;
    export(): { nodes: Array<{ key: string; attributes: NodeAttributes }>; edges: Array<{ key: string; source: string; target: string; attributes: EdgeAttributes }> };
  }
}

declare module 'graphology-layout-forceatlas2' {
  import Graph from 'graphology';

  interface ForceAtlas2Settings {
    iterations?: number;
    gravity?: number;
    scalingRatio?: number;
    barnesHutOptimize?: boolean;
    barnesHutTheta?: number;
    slowDown?: number;
    strongGravityMode?: boolean;
    outboundAttractionDistribution?: boolean;
    linLogMode?: boolean;
    adjustSizes?: boolean;
    edgeWeightInfluence?: number;
  }

  export default function forceAtlas2(graph: Graph, options?: { settings?: ForceAtlas2Settings; iterations?: number }): void;
  export function assign(graph: Graph, options?: { settings?: ForceAtlas2Settings; iterations?: number }): void;
}
