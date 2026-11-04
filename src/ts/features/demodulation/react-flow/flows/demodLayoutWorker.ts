/// <reference lib="webworker" />

import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";

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

interface ElkInstance {
  layout: (graph: {
    id: string;
    layoutOptions: Record<string, string>;
    children: { id: string; width: number; height: number }[];
    edges: { id: string; sources: string[]; targets: string[] }[];
  }) => Promise<{
    children?: { id?: string; x?: number; y?: number }[];
  }>;
}

type ElkConstructor = new (options: { workerUrl: string }) => ElkInstance;

let elkInstancePromise: Promise<ElkInstance> | null = null;

const resolveElkInstance = (): Promise<ElkInstance> => {
  elkInstancePromise ??= import("elkjs/lib/elk-api.js").then(() => {
    // elk-api.js is a UMD bundle: importing it for its side effect installs
    // the constructor on the worker global instead of exporting it as ESM.
    const Elk = (self as DedicatedWorkerGlobalScope & { ELK?: ElkConstructor })
      .ELK;
    if (!Elk) throw new Error("ELK layout constructor did not load");
    return new Elk({ workerUrl: elkWorkerUrl });
  });
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
