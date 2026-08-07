import type { Edge, Node } from "@xyflow/react";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";

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
  | { action: "replace"; replacement: "metadata" };

/** The initial graph uses spacious model coordinates; ELK is for later edits. */
export const shouldRunDemodAutoLayout = (flowVersion: number): boolean =>
  flowVersion > 0;

/** Waterfalls own temporal history in their mounted canvas runtime. Keep every
 * waterfall mounted when zooming moves it outside the viewport. Tx Suite FFTs
 * are also source-bound runtime producers for their adjacent waterfalls. */
export const shouldVirtualizeDemodFlowNodes = (nodes: Node[]): boolean =>
  !nodes.some(
    (node) =>
      node.data?.waterfallOptions === true ||
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
  const replacement =
    sourceMode === "file"
      ? {
          id: "metadata",
          type: replaceableNode.type ?? "custom",
          position: replaceableNode.position,
          data: { label: "Metadata", metadataNode: true },
        }
      : {
          id: "channel",
          type: replaceableNode.type ?? "custom",
          position: replaceableNode.position,
          data: { label: "Channel", channelNode: true },
        };

  return {
    nodes: graph.nodes.map((node) =>
      node.id === replaceableId ? replacement : node,
    ),
    edges: graph.edges.map((edge) => ({
      ...edge,
      source: edge.source === replaceableId ? "metadata" : edge.source,
      target: edge.target === replaceableId ? "metadata" : edge.target,
    })),
  };
};

export const buildDemodFlowGraph = (sourceMode: SourceMode): DemodFlowGraph => {
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
            data: { label: "Waterfall", waterfallOptions: true },
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
