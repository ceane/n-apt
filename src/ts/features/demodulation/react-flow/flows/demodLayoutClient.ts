export interface DemodLayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface DemodLayoutEdge {
  id: string;
  sources: string[];
  targets: string[];
}

export type DemodLayoutPositions = Record<string, { x: number; y: number }>;

interface DemodLayoutRequest {
  kind: "layout";
  runId: number;
  nodes: DemodLayoutNode[];
  edges: DemodLayoutEdge[];
}

interface DemodLayoutSuccess {
  kind: "layout-result";
  runId: number;
  positions: DemodLayoutPositions;
}

interface DemodLayoutFailure {
  kind: "layout-result";
  runId: number;
  error: string;
}

type DemodLayoutResponse = DemodLayoutSuccess | DemodLayoutFailure;

interface PendingLayout {
  resolve: (positions: DemodLayoutPositions) => void;
  reject: (error: Error) => void;
}

const pendingLayouts = new Map<number, PendingLayout>();
let workerSingleton: Worker | null = null;
let workerUnavailable = false;

const rejectAllPending = (error: Error) => {
  for (const pending of pendingLayouts.values()) {
    pending.reject(error);
  }
  pendingLayouts.clear();
};

export const getDemodLayoutWorker = (): Worker | null => {
  if (workerUnavailable) return null;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    workerUnavailable = true;
    return null;
  }
  if (workerSingleton) return workerSingleton;

  try {
    const worker = new Worker(
      new URL("./demodLayoutWorker.ts", import.meta.url),
      { type: "module" },
    );
    worker.addEventListener(
      "message",
      (event: MessageEvent<DemodLayoutResponse>) => {
        const response = event.data;
        if (!response || response.kind !== "layout-result") return;
        const pending = pendingLayouts.get(response.runId);
        if (!pending) return;
        pendingLayouts.delete(response.runId);
        if ("error" in response) {
          pending.reject(new Error(response.error));
        } else {
          pending.resolve(response.positions);
        }
      },
    );
    worker.addEventListener("error", (event) => {
      const error =
        event.error ?? new Error("Demod layout worker failed to load");
      rejectAllPending(error);
    });
    workerSingleton = worker;
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
};

export const runDemodLayout = (
  runId: number,
  nodes: DemodLayoutNode[],
  edges: DemodLayoutEdge[],
): Promise<DemodLayoutPositions> =>
  new Promise<DemodLayoutPositions>((resolve, reject) => {
    const worker = getDemodLayoutWorker();
    if (!worker) {
      reject(new Error("Demod layout worker is unavailable"));
      return;
    }
    const request: DemodLayoutRequest = { kind: "layout", runId, nodes, edges };
    pendingLayouts.set(runId, { resolve, reject });
    try {
      worker.postMessage(request);
    } catch (error) {
      pendingLayouts.delete(runId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
