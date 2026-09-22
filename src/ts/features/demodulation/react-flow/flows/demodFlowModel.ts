import type { Edge, Node } from "@xyflow/react";
import type { SourceMode } from "@n-apt/spectrum/public/useSpectrumStore";

export interface DemodFlowGraph {
  nodes: Node[];
  edges: Edge[];
}

export const resolveDemodCaptureRange = ({
  explicitRange,
  liveRange,
  fileRange,
  sampleRateHz,
}: {
  explicitRange?: { min: number; max: number } | null;
  liveRange?: { min: number; max: number } | null;
  fileRange?: { min: number; max: number } | null;
  sampleRateHz?: number | null;
}): { min: number; max: number } =>
  explicitRange ??
  liveRange ??
  fileRange ?? {
    min: 0,
    max: Math.max(
      typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
        ? sampleRateHz
        : 0,
      1,
    ),
  };

export type DemodNodePolicy =
  | { action: "keep" }
  | { action: "replace"; replacement: "metadata" | "span" };

/** The initial graph uses spacious model coordinates; ELK is for later edits. */
export const shouldRunDemodAutoLayout = (flowVersion: number): boolean =>
  flowVersion > 0;

export const shouldDeferDemodAutoLayout = ({
  hasNodes,
  nodesInitialized,
}: {
  hasNodes: boolean;
  nodesInitialized: boolean;
}): boolean => hasNodes && !nodesInitialized;

export const serializeDemodFlow = (
  sourceMode: SourceMode,
  nodes: Node[],
  edges: Edge[],
): string => JSON.stringify({ sourceMode, nodes, edges });

/** React Flow keeps its viewport in memory only. Persisting it next to the
 * flow lets a remount (notably a dev hot reload) come back to the exact framing
 * instead of dropping to the identity transform.
 *
 * v3: a fit taken while node boxes were still arriving was framed on a partial
 * bounding box and persisted as if it were the user's framing, so every remount
 * restored a zoomed-in view. Bumping the key drops those captures. */
export const DEMOD_FLOW_VIEWPORT_SESSION_KEY = "n-apt:demod-flow-viewport:v3";

export interface DemodFlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PersistedDemodFlowViewport {
  sourceMode: SourceMode;
  flowVersion: number;
  /** The graph this framing was captured for; see getDemodFlowGraphKey. */
  graphKey: string;
  viewport: DemodFlowViewport;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Identity of the node/edge set a framing belongs to. Positions are not part
 * of it: a layout pass that only moves nodes still frames the same graph. */
export const getDemodFlowGraphKey = (nodes: Node[], edges: Edge[]): string =>
  `${nodes
    .map((node) => node.id)
    .sort()
    .join(",")}|${edges
    .map((edge) => edge.id)
    .sort()
    .join(",")}`;

export const serializeDemodFlowViewport = (
  persisted: PersistedDemodFlowViewport,
): string => JSON.stringify(persisted);

/** React Flow's untouched transform is not a framing. Persisting it would make
 * the next remount "restore" the graph at 1:1 off the origin instead of framing
 * it, which reads as nodes zoomed in on one corner of the flow. */
export const isDefaultDemodFlowViewport = (viewport: DemodFlowViewport): boolean =>
  viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1;

export const parseDemodFlowViewport = (
  raw: string | null | undefined,
): PersistedDemodFlowViewport | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      sourceMode?: unknown;
      flowVersion?: unknown;
      graphKey?: unknown;
      viewport?: { x?: unknown; y?: unknown; zoom?: unknown };
    };
    const viewport = parsed?.viewport;
    if (
      typeof parsed?.sourceMode !== "string" ||
      typeof parsed?.graphKey !== "string" ||
      !viewport ||
      !isFiniteNumber(viewport.x) ||
      !isFiniteNumber(viewport.y) ||
      !isFiniteNumber(viewport.zoom) ||
      viewport.zoom <= 0
    ) {
      return null;
    }
    return {
      sourceMode: parsed.sourceMode as SourceMode,
      flowVersion: isFiniteNumber(parsed.flowVersion) ? parsed.flowVersion : 0,
      graphKey: parsed.graphKey,
      viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    };
  } catch {
    return null;
  }
};

/** A persisted viewport frames the graph it was captured for. Revision 0 is the
 * flow restored from session storage, which is that same graph — a remount (a
 * dev hot reload, a route re-entry) resets the revision counter, so the
 * framing still applies and re-running ELK over it would only move the nodes
 * the user was looking at. */
export const shouldReusePersistedDemodViewport = (
  persisted: PersistedDemodFlowViewport | null | undefined,
  sourceMode: SourceMode,
  flowVersion: number,
  graphKey: string,
): persisted is PersistedDemodFlowViewport => {
  if (!persisted) return false;
  if (persisted.sourceMode !== sourceMode) return false;
  if (persisted.graphKey !== graphKey) return false;
  return persisted.flowVersion === flowVersion || flowVersion === 0;
};

export const DEMOD_FIT_VIEW_OPTIONS = {
  padding: 0.15,
  includeHiddenNodes: true,
  duration: 0,
  // The reference graph is intentionally tall; 0.3x cannot contain it in a
  // normal viewport and leaves the source/output nodes offscreen.
  minZoom: 0.15,
  maxZoom: 1.2,
} as const;

/** Waterfalls own temporal history in their mounted canvas runtime. Keep every
 * waterfall mounted when zooming moves it outside the viewport. Tx Suite FFTs
 * are also source-bound runtime producers for their adjacent waterfalls. The
 * phase waterfall keeps its history the same way, so it is exempt too. */
export const shouldVirtualizeDemodFlowNodes = (nodes: Node[]): boolean =>
  !nodes.some(
    (node) =>
      node.data?.waterfallOptions === true ||
      node.data?.phaseOptions === true ||
      (node.data?.sourceBindingGroup === "tx-suite" &&
        node.data?.fftOptions === true),
  );

export const getDemodNodePolicy = (
  data: Record<string, unknown> | undefined,
  sourceMode: SourceMode,
): DemodNodePolicy => {
  if (
    sourceMode === "file" &&
    (data?.channelNode || data?.spanOptions || data?.fmOptions)
  ) {
    return { action: "replace", replacement: "metadata" };
  }
  return { action: "keep" };
};

export const adaptDemodFlowForSourceMode = (
  graph: DemodFlowGraph,
  sourceMode: SourceMode,
): DemodFlowGraph => {
  const replaceableNode = graph.nodes.find((node) =>
    sourceMode === "file"
      ? getDemodNodePolicy(node.data, sourceMode).action === "replace"
      : node.data?.metadataNode === true,
  );
  if (!replaceableNode) return graph;

  const replaceableId = replaceableNode.id;
  const replacementId =
    sourceMode === "file"
      ? "metadata"
      : graph.nodes.some((node) => node.data?.fftOptions) &&
          !graph.nodes.some((node) => node.data?.channelNode)
        ? "span"
        : "channel";
  const replacement =
    sourceMode === "file"
      ? {
          id: "metadata",
          type: replaceableNode.type ?? "custom",
          position: replaceableNode.position,
          data: { label: "Metadata", metadataNode: true },
        }
      : {
          id: graph.nodes.some((node) => node.data?.fftOptions) &&
            !graph.nodes.some((node) => node.data?.channelNode)
            ? "span"
            : "channel",
          type: replaceableNode.type ?? "custom",
          position: replaceableNode.position,
          data: graph.nodes.some((node) => node.data?.fftOptions) &&
            !graph.nodes.some((node) => node.data?.channelNode)
            ? { label: "Span", spanOptions: true }
            : { label: "Channel", channelNode: true },
        };

  return {
    nodes: graph.nodes.map((node) =>
      node.id === replaceableId ? replacement : node,
    ),
    edges: graph.edges.map((edge) => ({
      ...edge,
      source: edge.source === replaceableId ? replacementId : edge.source,
      target: edge.target === replaceableId ? replacementId : edge.target,
    })),
  };
};

const _buildReferenceCaptureFlowGraph = (sourceMode: SourceMode): DemodFlowGraph => {
  const isFileSource = sourceMode === "file";

  const nodes: Node[] = [
    {
      id: "source",
      type: "custom",
      position: { x: 450, y: 50 },
      data: {
        label: "Source",
        sourceNode: true,
        nonRemovable: true,
      },
    },
    ...(isFileSource
      ? []
      : [
          {
            id: "channel",
            type: "custom",
            position: { x: 40, y: 420 },
            data: {
              label: "Channel",
              channelNode: true,
              nonRemovable: true,
            },
          } satisfies Node,
        ]),
    ...(isFileSource
      ? [
          {
            id: "metadata",
            type: "custom",
            position: { x: 450, y: 420 },
            data: {
              label: "Metadata",
              metadataNode: true,
            },
          } satisfies Node,
        ]
      : [
          {
            id: "signalOptions",
            type: "custom",
            position: { x: 850, y: 420 },
            data: {
              label: "Signal Configuration",
              signalOptions: true,
            },
          } satisfies Node,
        ]),
    ...(isFileSource
      ? []
      : [
          {
            id: "fft",
            type: "custom",
            position: { x: 40, y: 1150 },
            data: { label: "FFT", fftOptions: true },
          } satisfies Node,
          {
            id: "waterfall",
            type: "custom",
            position: { x: 850, y: 1150 },
            data: {
              label: "Waterfall",
              waterfallOptions: true,
              showMiniVfo: true,
              miniVfoPosition: "top",
            },
          } satisfies Node,
        ]),
    {
      id: "iq-capture",
      type: "custom",
      position: { x: 450, y: 2200 },
      data: {
        label: "I/Q Capture",
        iqCaptureNode: true,
      },
    },
    {
      id: "symbols",
      type: "custom",
      position: { x: 40, y: 3600 },
      data: {
        label: "Symbol (I/Q) Analysis",
        symbolOptions: true,
      },
    },
    {
      id: "bitstream",
      type: "custom",
      position: { x: 450, y: 3600 },
      data: {
        label: "Bitstream Analysis",
        bitstreamOptions: true,
      },
    },
    ...(isFileSource
      ? []
      : [
          {
            id: "stimulus",
            type: "custom",
            position: { x: 850, y: 3600 },
            data: {
              label: "Stimulus",
              stimulusOptions: true,
            },
          } satisfies Node,
        ]),
    {
      id: "output",
      type: "custom",
      position: { x: 450, y: 5200 },
      data: { outputNode: true, state: "idle" },
    },
  ];

  const edges: Edge[] = [
    ...(isFileSource
      ? [
          {
            id: "e-source-metadata",
            source: "source",
            target: "metadata",
            animated: true,
            style: {
              stroke: "#00d4ffaa",
              strokeWidth: 2,
              strokeDasharray: "5 5",
            },
          } satisfies Edge,
        ]
      : [
          {
            id: "e-source-channel",
            source: "source",
            target: "channel",
            animated: true,
            style: { stroke: "#00d4ff", strokeWidth: 2 },
          },
          {
            id: "e-channel-signalOptions",
            source: "channel",
            target: "signalOptions",
            animated: true,
            style: {
              stroke: "#00d4ffaa",
              strokeWidth: 2,
              strokeDasharray: "5 5",
            },
          },
          {
            id: "e-channel-fft",
            source: "channel",
            target: "fft",
            animated: true,
            style: { stroke: "#00d4ff", strokeWidth: 2 },
          },
          {
            id: "e-channel-waterfall",
            source: "channel",
            target: "waterfall",
            animated: true,
            style: { stroke: "#00d4ff", strokeWidth: 2 },
          },
          {
            id: "e-signalOptions-fft",
            source: "signalOptions",
            target: "fft",
            animated: true,
            style: {
              stroke: "#00d4ffaa",
              strokeWidth: 2,
              strokeDasharray: "5 5",
            },
          },
          {
            id: "e-signalOptions-waterfall",
            source: "signalOptions",
            target: "waterfall",
            animated: true,
            style: {
              stroke: "#00d4ffaa",
              strokeWidth: 2,
              strokeDasharray: "5 5",
            },
          },
        ]),
    {
      id: isFileSource ? "e-metadata-symbols" : "e-signalOptions-symbols",
      source: isFileSource ? "metadata" : "signalOptions",
      target: "symbols",
      animated: true,
      style: { stroke: "#00d4ffaa", strokeWidth: 2, strokeDasharray: "5 5" },
    },
    {
      id: "e-iq-capture-symbols",
      source: "iq-capture",
      target: "symbols",
      animated: true,
      style: { stroke: "#00d4ffaa", strokeWidth: 2, strokeDasharray: "5 5" },
    },
    {
      id: isFileSource ? "e-metadata-bitstream" : "e-signalOptions-bitstream",
      source: isFileSource ? "metadata" : "signalOptions",
      target: "bitstream",
      animated: true,
      style: { stroke: "#00d4ffaa", strokeWidth: 2, strokeDasharray: "5 5" },
    },
    ...(isFileSource
      ? []
      : [
          {
            id: "e-signalOptions-stimulus",
            source: "signalOptions",
            target: "stimulus",
            animated: true,
            style: { stroke: "#a855f7", strokeWidth: 2 },
          },
          {
            id: "e-stimulus-output",
            source: "stimulus",
            target: "output",
            animated: true,
            style: { stroke: "#e100ff", strokeWidth: 2 },
          },
        ]),
  ];

  return { nodes, edges };
};

/** The first demod render is intentionally the compact audio-analysis flow.
 * Larger capture/reference graphs remain explicit sidebar templates. */
const _buildCompactAudioAnalysisFlowGraph = (sourceMode: SourceMode): DemodFlowGraph => {
  const isFileSource = sourceMode === "file";
  const sourceNode: Node = {
    id: "source",
    type: "custom",
    position: { x: 250, y: 50 },
    data: { label: "Source", description: "Signal source", sourceNode: true },
  };
  const middleNode: Node = isFileSource
    ? {
        id: "metadata",
        type: "custom",
        position: { x: 250, y: 450 },
        data: { label: "Metadata", metadataNode: true },
      }
    : {
        id: "span",
        type: "custom",
        position: { x: 250, y: 450 },
        data: {
          label: "Span",
          description: "Hardware tuning range",
          spanOptions: true,
        },
      };
  const nodes: Node[] = [
    sourceNode,
    middleNode,
    {
      id: "fft",
      type: "custom",
      position: { x: 50, y: 850 },
      data: { label: "FFT", fftOptions: true, showDemodOverlay: true },
    },
    {
      id: "waterfall-analysis",
      type: "custom",
      position: { x: 450, y: 850 },
      data: {
        label: "Waterfall Analysis",
        waterfallOptions: true,
        analysisOptions: true,
      },
    },
    {
      id: "radio",
      type: "custom",
      position: { x: 250, y: 1450 },
      data: { label: "Radio", radioOptions: true },
    },
  ];
  const middleId = isFileSource ? "metadata" : "span";
  const edges: Edge[] = [
    { id: `e-source-${middleId}`, source: "source", target: middleId, animated: true },
    { id: `e-${middleId}-fft`, source: middleId, target: "fft", animated: true },
    {
      id: `e-${middleId}-waterfall-analysis`,
      source: middleId,
      target: "waterfall-analysis",
      animated: true,
    },
    { id: "e-fft-radio", source: "fft", target: "radio", animated: true },
    {
      id: "e-waterfall-analysis-radio",
      source: "waterfall-analysis",
      target: "radio",
      animated: true,
    },
  ];
  return { nodes, edges };
};

/** Reference Capture is the canonical first flow. Keep it intentionally
 * separate from the larger analysis graph used by older persisted sessions. */
export const buildDemodFlowGraph = (sourceMode: SourceMode): DemodFlowGraph => {
  const isFileSource = sourceMode === "file";
  const middleId = isFileSource ? "metadata" : "channel";
  const nodes: Node[] = [
    {
      id: "source",
      type: "custom",
      position: { x: 250, y: 50 },
      data: { label: "Source", description: "Signal source", sourceNode: true },
    },
    {
      id: middleId,
      type: "custom",
      position: { x: -600, y: 450 },
      data: isFileSource
        ? { label: "Metadata", metadataNode: true }
        : { label: "Channel", description: "Channel configuration", channelNode: true },
    },
    {
      id: "signal-config",
      type: "custom",
      position: { x: 500, y: 450 },
      data: { label: "Signal Configuration", signalOptions: true },
    },
    {
      id: "stimulus",
      type: "custom",
      position: { x: 250, y: 950 },
      data: { label: "Stimulus", description: "Select a known reference stimulus", stimulusOptions: true },
    },
    {
      id: "output",
      type: "custom",
      position: { x: 250, y: 1350 },
      data: { label: "Output", description: "Use the generated I/Q capture for demodulation", outputNode: true },
    },
  ];
  const edges: Edge[] = [
    { id: `e-source-${middleId}`, source: "source", target: middleId, animated: true },
    { id: "e-source-signal-config", source: "source", target: "signal-config", animated: true },
    { id: `e-${middleId}-stimulus`, source: middleId, target: "stimulus", animated: true },
    { id: "e-signal-config-stimulus", source: "signal-config", target: "stimulus", animated: true },
    { id: "e-stimulus-output", source: "stimulus", target: "output", animated: true },
  ];
  return { nodes, edges };
};
