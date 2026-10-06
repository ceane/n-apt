import { memo, useMemo } from "react";
import styled from "styled-components";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { VisionPreset } from "@n-apt/demodulation/vision/visionModel";

type WorkflowStatus = "ready" | "waiting" | "planned" | "active" | "warning";

interface WorkflowNodeData extends Record<string, unknown> {
  title: string;
  detail: string;
  status: WorkflowStatus;
}

type WorkflowNode = Node<WorkflowNodeData, "visionDemodWorkflowStep">;

export interface VisionDemodWorkflowFlowProps {
  sourceReady: boolean;
  sourceLabel: "RTL-SDR" | "HackRF One" | null;
  channelAllowed: boolean;
  sourceMode: "live" | "replay";
  channelRange: string | null;
  preset: VisionPreset;
  captureStatus: string;
}

const WorkflowFrame = styled.section`
  min-width: 0;
  margin-top: 12px;
  border-top: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  padding-top: 9px;
`;

const WorkflowHeading = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  margin-bottom: 7px;

  strong {
    color: ${({ theme }) => theme.colors.textPrimary};
    font-size: 10px;
    font-weight: 750;
  }

  small {
    color: ${({ theme }) => theme.colors.textSecondary};
    font-size: 9px;
    text-align: right;
  }
`;

const FlowCanvas = styled.div`
  width: 100%;
  height: 386px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.3));
  border-radius: 8px;
  background: var(--color-surface, transparent);

  .react-flow,
  .react-flow__pane {
    background: transparent;
  }

  .react-flow__edge-path {
    stroke: var(--color-border, #64748b);
    stroke-width: 1.5;
  }

  .react-flow__arrowhead {
    fill: var(--color-border, #64748b);
  }

  .react-flow__handle {
    width: 6px;
    height: 6px;
    border: 1px solid var(--color-border, #64748b);
    background: var(--color-surface, #fff);
  }
`;

const statusColors: Record<WorkflowStatus, string> = {
  ready: "var(--color-success, #168a45)",
  waiting: "var(--text-secondary, #77808f)",
  planned: "var(--text-secondary, #77808f)",
  active: "var(--color-primary, #3b82f6)",
  warning: "var(--color-warning, #b7791f)",
};

const WorkflowNodeCard = styled.div<{ $status: WorkflowStatus }>`
  display: grid;
  align-content: center;
  gap: 3px;
  width: 132px;
  min-height: 60px;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.4));
  border-left: 3px solid ${({ $status }) => statusColors[$status]};
  border-radius: 7px;
  background: var(--color-surface, #fff);
  color: var(--text-primary, #202735);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  font-family: "JetBrains Mono", monospace;
  white-space: normal;

  strong {
    font-size: 9px;
    line-height: 1.25;
  }

  small {
    color: var(--text-secondary, #687386);
    font-size: 8px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
`;

const FlowNode = memo(function FlowNode({ id, data }: NodeProps<WorkflowNode>) {
  return (
    <WorkflowNodeCard
      data-testid={`vision-demod-flow-node-${id}`}
      data-state={data.status}
      $status={data.status}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <strong>{data.title}</strong>
      <small>{data.detail}</small>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </WorkflowNodeCard>
  );
});

const nodeTypes = { visionDemodWorkflowStep: FlowNode };

const createWorkflowGraph = (props: VisionDemodWorkflowFlowProps) => {
  const liveReceiverReady =
    props.sourceMode === "live" &&
    props.sourceReady &&
    props.sourceLabel !== null;
  const nodes: WorkflowNode[] = [
    {
      id: "source",
      type: "visionDemodWorkflowStep",
      position: { x: 5, y: 5 },
      data: {
        title: "RF source",
        detail:
          props.sourceMode === "live"
            ? liveReceiverReady
              ? `Live ${props.sourceLabel} selected`
              : "Select a live RTL-SDR or HackRF One"
            : "Replay selected · live RTL-SDR or HackRF One required",
        status: liveReceiverReady ? "ready" : "waiting",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "stimulus",
      type: "visionDemodWorkflowStep",
      position: { x: 149, y: 5 },
      data: {
        title: "Known visual stimulus",
        detail: `Preset ${props.preset} · S violet/blue · M green · L yellow-green→red · Red`,
        status: "active",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "channel",
      type: "visionDemodWorkflowStep",
      position: { x: 5, y: 82 },
      data: {
        title: "Select channel + width",
        detail: props.channelAllowed
          ? `Channel C source ready · ${props.channelRange ?? "frequency range unavailable"}`
          : `Tune within Channel C · ${props.channelRange ?? "frequency range unavailable"}`,
        status: props.channelAllowed ? "ready" : "warning",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "paired-reference",
      type: "visionDemodWorkflowStep",
      position: { x: 149, y: 82 },
      data: {
        title: "Align I/Q + reference timeline",
        detail: `${props.captureStatus} · onset alignment is not verified`,
        status: "planned",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "features",
      type: "visionDemodWorkflowStep",
      position: { x: 5, y: 159 },
      data: {
        title: "Build frequency features",
        detail: "100 ms windows · 10 temporal slices · deterministic features",
        status: "planned",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "labels",
      type: "visionDemodWorkflowStep",
      position: { x: 149, y: 159 },
      data: {
        title: "Automatic RGB + preset labels",
        detail: "RGB from reference · S/M/L/Red class from selected preset",
        status: "planned",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "apt-baseline",
      type: "visionDemodWorkflowStep",
      position: { x: 5, y: 236 },
      data: {
        title: "N-APT spike/valley DSP",
        detail:
          "Walk measured peak/valley pairs · ~34 kHz spacing prior, not a pixel clock",
        status: "planned",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "apt-output",
      type: "visionDemodWorkflowStep",
      position: { x: 5, y: 313 },
      data: {
        title: "Band-to-region mapping",
        detail:
          "A channel band may cover only part of the frame · learn from spatial references",
        status: "waiting",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "decoder",
      type: "visionDemodWorkflowStep",
      position: { x: 149, y: 236 },
      data: {
        title: "Train + hold out",
        detail: "Trainer ready · needs session-disjoint reference captures",
        status: "waiting",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "output",
      type: "visionDemodWorkflowStep",
      position: { x: 149, y: 313 },
      data: {
        title: "Reconstructed frames",
        detail:
          "16 × 16 RGB · references stay RGB; opponent head is experimental",
        status: "planned",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
  ];

  const edgePairs = [
    ["source", "channel"],
    ["channel", "features"],
    ["channel", "apt-baseline"],
    ["apt-baseline", "apt-output"],
    ["labels", "apt-output"],
    ["stimulus", "paired-reference"],
    ["channel", "paired-reference"],
    ["paired-reference", "labels"],
    ["labels", "decoder"],
    ["features", "decoder"],
    ["decoder", "output"],
  ] as const;
  const edges: Edge[] = edgePairs.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "var(--color-border, #64748b)", strokeWidth: 1.5 },
  }));

  return { nodes, edges };
};

export const VisionDemodWorkflowFlow = memo(function VisionDemodWorkflowFlow(
  props: VisionDemodWorkflowFlowProps,
) {
  const { nodes, edges } = useMemo(
    () => createWorkflowGraph(props),
    [
      props.sourceReady,
      props.sourceLabel,
      props.channelAllowed,
      props.sourceMode,
      props.channelRange,
      props.preset,
      props.captureStatus,
    ],
  );
  const arrowEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-border, #64748b)",
        },
      })),
    [edges],
  );

  return (
    <WorkflowFrame
      aria-label="Visual demodulation workflow"
      data-testid="vision-demod-workflow"
    >
      <WorkflowHeading>
        <strong>Visual demodulation flow</strong>
        <small>Channel C morphology or neural RGB</small>
      </WorkflowHeading>
      <FlowCanvas className="nodrag nowheel" data-edge-count={edges.length}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={arrowEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.04, minZoom: 0.45, maxZoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={18}
              size={1}
              color="rgba(128, 128, 128, 0.18)"
            />
          </ReactFlow>
        </ReactFlowProvider>
      </FlowCanvas>
    </WorkflowFrame>
  );
});
