import type { Edge, Node } from "@xyflow/react";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";

export interface DemodFlowGraph {
  nodes: Node[];
  edges: Edge[];
}

export type DemodNodePolicy =
  | { action: "keep" }
  | { action: "replace"; replacement: "metadata" };

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
  const replaceableNode = graph.nodes.find(
    (node) =>
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
      position: { x: 250, y: 50 },
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
            position: { x: 250, y: 260 },
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
            position: { x: 250, y: 480 },
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
            position: { x: 250, y: 480 },
            data: {
              label: "Signal Configuration",
              signalOptions: true,
            },
          } satisfies Node,
        ]),
    {
      id: "iq-capture",
      type: "custom",
      position: { x: 250, y: 680 },
      data: {
        label: "I/Q Capture",
        iqCaptureNode: true,
      },
    },
    {
      id: "symbols",
      type: "custom",
      position: { x: 50, y: 860 },
      data: {
        label: "Symbol (I/Q) Analysis",
        symbolOptions: true,
      },
    },
    {
      id: "bitstream",
      type: "custom",
      position: { x: 250, y: 860 },
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
            position: { x: 450, y: 860 },
            data: {
              label: "Stimulus",
              stimulusOptions: true,
            },
          } satisfies Node,
        ]),
    {
      id: "output",
      type: "custom",
      position: { x: 450, y: 1260 },
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
