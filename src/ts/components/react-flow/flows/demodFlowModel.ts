import type { Edge, Node } from "@xyflow/react";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";

export interface DemodFlowGraph {
  nodes: Node[];
  edges: Edge[];
}

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
    ...(
      isFileSource
        ? []
        : [{
            id: "channel",
            type: "custom",
            position: { x: 250, y: 260 },
            data: {
              label: "Channel",
              channelNode: true,
              nonRemovable: true,
            },
          } satisfies Node]
    ),
    ...(
      isFileSource
        ? [{
            id: "metadata",
            type: "custom",
            position: { x: 250, y: 480 },
            data: {
              label: "Metadata",
              metadataNode: true,
            },
          } satisfies Node]
        : [{
            id: "signalOptions",
            type: "custom",
            position: { x: 250, y: 480 },
            data: {
              label: "Signal Configuration",
              signalOptions: true,
            },
          } satisfies Node]
    ),
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
    ...(
      isFileSource
        ? []
        : [{
            id: "stimulus",
            type: "custom",
            position: { x: 450, y: 860 },
            data: {
              label: "Stimulus",
              stimulusOptions: true,
            },
          } satisfies Node]
    ),
    {
      id: "output",
      type: "custom",
      position: { x: 450, y: 1260 },
      data: { outputNode: true, state: "idle" },
    },
  ];

  const edges: Edge[] = [
    ...(
      isFileSource
        ? [{
            id: "e-source-metadata",
            source: "source",
            target: "metadata",
            animated: true,
            style: { stroke: "#00d4ffaa", strokeWidth: 2, strokeDasharray: "5 5" },
          } satisfies Edge]
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
              style: { stroke: "#00d4ffaa", strokeWidth: 2, strokeDasharray: "5 5" },
            },
          ]
    ),
    {
      id: isFileSource ? "e-metadata-symbols" : "e-signalOptions-symbols",
      source: isFileSource ? "metadata" : "signalOptions",
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
    ...(
      isFileSource
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
          ]
    ),
  ];

  return { nodes, edges };
};
