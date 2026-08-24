/// <reference lib="webworker" />

interface DemodLayoutRequest {
  kind: "layout";
  runId: number;
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; sources: string[]; targets: string[] }[];
}

interface DemodLayoutSuccess {
  kind: "layout-result";
  runId: number;
  positions: Record<string, { x: number; y: number }>;
}

interface DemodLayoutFailure {
  kind: "layout-result";
  runId: number;
  error: string;
}

type ElkInstance = {
  layout: (graph: unknown) => Promise<{
    children?: { id?: string; x?: number; y?: number }[];
  }>;
};

let elkInstancePromise: Promise<ElkInstance> | null = null;

const resolveElkInstance = (): Promise<ElkInstance> => {
  elkInstancePromise ??= import("elkjs/lib/elk.bundled.js").then(
    (moduleValue) => {
      const candidate = moduleValue as {
        default?: unknown;
        ELK?: unknown;
      };
      const globalCandidate = globalThis as { ELK?: unknown };
      const values = [
        candidate?.default,
        (candidate?.default as { default?: unknown } | undefined)?.default,
        candidate?.ELK,
        moduleValue,
        globalCandidate?.ELK,
      ];
      const Constructor = values.find(
        (value): value is new () => ElkInstance => typeof value === "function",
      );
      if (!Constructor) {
        throw new Error("Unable to resolve the ELK layout constructor");
      }
      return new Constructor();
    },
  );
  return elkInstancePromise;
};

self.onmessage = async (event: MessageEvent<DemodLayoutRequest>) => {
  const request = event.data;
  if (!request || request.kind !== "layout") return;

  try {
    const elk = await resolveElkInstance();
    const layoutedGraph = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.spacing.nodeNode": "60",
        "elk.layered.spacing.nodeNodeBetweenLayers": "80",
        "elk.alignment": "CENTER",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      },
      children: request.nodes.map((node) => ({
        id: node.id,
        width: node.width,
        height: node.height,
      })),
      edges: request.edges.map((edge) => ({
        id: edge.id,
        sources: edge.sources,
        targets: edge.targets,
      })),
    });

    const positions: Record<string, { x: number; y: number }> = {};
    for (const child of layoutedGraph.children ?? []) {
      if (
        child.id !== undefined &&
        child.x !== undefined &&
        child.y !== undefined
      ) {
        positions[child.id] = { x: child.x, y: child.y };
      }
    }

    const response: DemodLayoutSuccess = {
      kind: "layout-result",
      runId: request.runId,
      positions,
    };
    self.postMessage(response);
  } catch (error) {
    const response: DemodLayoutFailure = {
      kind: "layout-result",
      runId: request.runId,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
