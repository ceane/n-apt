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
import { formatFrequency } from "@n-apt/math/frequency";
import type { AudioSurveyTrainingState } from "@n-apt/demodulation/survey/audioSurveyTraining";

type WorkflowStatus =
  | "waiting"
  | "ready"
  | "recording"
  | "active"
  | "offline"
  | "idle"
  | "planned"
  | "warning";

interface WorkflowNodeData extends Record<string, unknown> {
  title: string;
  detail: string;
  status: WorkflowStatus;
}

type WorkflowNode = Node<WorkflowNodeData, "demodWorkflowStep">;

export interface AudioDemodWorkflowFlowProps {
  sourceMode: string;
  sourceReady: boolean;
  replayCaptureCount: number;
  tunedFrequencyHz: number | null;
  channelAllowed: boolean;
  channelRequirement: string;
  bandwidthKhz: number;
  candidateCount: number;
  surveyStatus: string | null;
  analysisState: string;
  referenceTarget: string;
  selectedAlgorithm: string;
  isListening: boolean;
  audioPlaying: boolean;
  training: AudioSurveyTrainingState | null;
  neuralModelReady: boolean;
  neuralBackend: "typescript" | "onnx";
  onnxAvailable: boolean;
  onnxLoading: boolean;
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
  waiting: "var(--text-secondary, #77808f)",
  ready: "var(--color-success, #168a45)",
  recording: "var(--color-danger, #dc2626)",
  active: "var(--color-primary, #3b82f6)",
  offline: "var(--text-secondary, #77808f)",
  idle: "var(--text-secondary, #77808f)",
  planned: "var(--color-warning, #b7791f)",
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
      data-testid={`audio-demod-flow-node-${id}`}
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

const nodeTypes = { demodWorkflowStep: FlowNode };

const algorithmLabels: Record<string, string> = {
  am: "AM envelope detector",
  fm: "FM discriminator",
  fmDiscriminator: "FM discriminator",
  aptAudio: "APT audio demodulator",
  aptImage: "APT image demodulator",
  neural: "Neural time-domain decoder",
};

const analysisStatus = (state: string): WorkflowStatus => {
  if (state === "starting" || state === "capturing") return "recording";
  if (state === "analyzing") return "active";
  if (state === "result") return "ready";
  return "planned";
};

const trainingStatus = (
  training: AudioSurveyTrainingState | null,
): WorkflowStatus => {
  if (!training) return "offline";
  if (training.status === "running") return "recording";
  if (training.status === "paused") return "planned";
  if (training.status === "failed") return "warning";
  if (training.status === "completed") {
    return training.modelPreferred ? "ready" : "warning";
  }
  if (training.status === "stopped") return "idle";
  return "planned";
};

const trainingDetail = (training: AudioSurveyTrainingState | null) => {
  if (!training) return "Train locally after collecting paired examples";
  if (training.error) return training.error;
  if (training.status === "running") {
    return `Epoch ${training.epoch}/${training.totalEpochs} · ${training.trainingPairCount} train · ${training.holdoutPairCount} holdout`;
  }
  if (training.status === "completed") {
    const rmse = training.validationRmse;
    return `${training.trainingPairCount} train · ${training.holdoutPairCount} holdout${typeof rmse === "number" ? ` · RMSE ${rmse.toFixed(3)}` : ""}`;
  }
  return `${training.trainingPairCount} training pairs · held-out comparison against DSP`;
};

const createWorkflowGraph = (props: AudioDemodWorkflowFlowProps) => {
  const algorithmLabel =
    algorithmLabels[props.selectedAlgorithm] ?? props.selectedAlgorithm;
  const hasSurveyCandidates = props.candidateCount > 0;
  const surveyRunning = props.surveyStatus === "running";
  const surveyPaused = props.surveyStatus === "paused";
  const modelStatus: WorkflowStatus = props.neuralModelReady
    ? "ready"
    : props.onnxLoading
      ? "active"
      : props.training?.status === "failed"
        ? "warning"
        : "offline";
  const trainingPairs = props.training?.trainingPairCount ?? 0;

  const nodes: WorkflowNode[] = [
    {
      id: "source",
      type: "demodWorkflowStep",
      position: { x: 5, y: 5 },
      data: {
        title: "RF source",
        detail:
          props.sourceMode === "live"
            ? props.sourceReady
              ? "Live receiver stream selected"
              : "Select a live receiver in Sources"
            : props.sourceReady
              ? `${props.replayCaptureCount} replay capture${props.replayCaptureCount === 1 ? "" : "s"} selected`
              : "Select a replay capture in Sources",
        status: props.sourceReady ? "ready" : "waiting",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "stimulus",
      type: "demodWorkflowStep",
      position: { x: 149, y: 5 },
      data: {
        title: "Known stimulus",
        detail: `${props.referenceTarget} tone or local media provides reference PCM`,
        status: analysisStatus(props.analysisState),
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "channelizer",
      type: "demodWorkflowStep",
      position: { x: 5, y: 82 },
      data: {
        title: "Select channel + width",
        detail:
          props.channelAllowed && props.tunedFrequencyHz !== null
            ? `${formatFrequency(props.tunedFrequencyHz)} · ${props.bandwidthKhz} kHz low-pass width`
            : `Tune to ${props.channelRequirement} and choose a signal width`,
        status: props.channelAllowed ? "ready" : "warning",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "paired-reference",
      type: "demodWorkflowStep",
      position: { x: 149, y: 82 },
      data: {
        title: "Align I/Q + PCM",
        detail:
          trainingPairs > 0
            ? `${trainingPairs} paired training examples ready`
            : "Enable pairing to align narrowband I/Q with reference audio",
        status:
          trainingPairs > 0
            ? "ready"
            : props.analysisState === "starting" ||
                props.analysisState === "capturing"
              ? "recording"
              : props.analysisState === "analyzing"
                ? "active"
                : "planned",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "candidates",
      type: "demodWorkflowStep",
      position: { x: 5, y: 159 },
      data: {
        title: "Walk spike + valley groups",
        detail: hasSurveyCandidates
          ? `${props.candidateCount} candidates · 2–7 rightward pairs mapped`
          : surveyRunning
            ? "Walk 2–7 rightward pairs · ~34 kHz typical spacing"
            : surveyPaused
              ? "Survey paused · resume to continue candidate mapping"
              : "Start at a peak; follow right-side valleys to estimate width",
        status: hasSurveyCandidates
          ? "ready"
          : surveyRunning
            ? "recording"
            : surveyPaused
              ? "planned"
              : "waiting",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "training",
      type: "demodWorkflowStep",
      position: { x: 149, y: 159 },
      data: {
        title: "Train + hold out",
        detail: trainingDetail(props.training),
        status: trainingStatus(props.training),
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "dsp-baseline",
      type: "demodWorkflowStep",
      position: { x: 5, y: 236 },
      data: {
        title: "DSP baseline",
        detail: `${algorithmLabel} · compare AM/FM/APT-style candidates`,
        status: !props.channelAllowed
          ? "waiting"
          : props.selectedAlgorithm === "neural" && !props.neuralModelReady
            ? "warning"
            : props.isListening
              ? "recording"
              : "ready",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "neural-runtime",
      type: "demodWorkflowStep",
      position: { x: 149, y: 236 },
      data: {
        title: "Local neural runtime",
        detail: props.neuralModelReady
          ? props.neuralBackend === "onnx"
            ? "ONNX Runtime · held-out profile passed"
            : "TypeScript runtime · held-out profile passed"
          : props.onnxAvailable
            ? "ONNX artifact available · profile gate decides use"
            : "Optional path · require a held-out win over DSP",
        status: modelStatus,
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
    {
      id: "output",
      type: "demodWorkflowStep",
      position: { x: 77, y: 313 },
      data: {
        title: "Demodulated output",
        detail:
          props.audioPlaying || props.isListening
            ? "Local audio output is active"
            : "DSP or validated neural output reaches local playback",
        status:
          props.audioPlaying || props.isListening
            ? "active"
            : props.channelAllowed || props.neuralModelReady
              ? "ready"
              : "waiting",
      },
      width: 132,
      height: 60,
      draggable: false,
      selectable: false,
    },
  ];

  const edgePairs = [
    ["source", "channelizer"],
    ["channelizer", "candidates"],
    ["candidates", "dsp-baseline"],
    ["dsp-baseline", "output"],
    ["source", "paired-reference"],
    ["stimulus", "paired-reference"],
    ["channelizer", "paired-reference"],
    ["paired-reference", "training"],
    ["training", "neural-runtime"],
    ["channelizer", "neural-runtime"],
    ["neural-runtime", "output"],
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

export const AudioDemodWorkflowFlow = memo(function AudioDemodWorkflowFlow(
  props: AudioDemodWorkflowFlowProps,
) {
  const { nodes, edges } = useMemo(
    () => createWorkflowGraph(props),
    [
      props.sourceMode,
      props.sourceReady,
      props.replayCaptureCount,
      props.tunedFrequencyHz,
      props.channelAllowed,
      props.channelRequirement,
      props.bandwidthKhz,
      props.candidateCount,
      props.surveyStatus,
      props.analysisState,
      props.referenceTarget,
      props.selectedAlgorithm,
      props.isListening,
      props.audioPlaying,
      props.training,
      props.neuralModelReady,
      props.neuralBackend,
      props.onnxAvailable,
      props.onnxLoading,
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
      aria-label="Audio demodulation workflow"
      data-testid="audio-demod-workflow"
    >
      <WorkflowHeading>
        <strong>Audio demodulation flow</strong>
        <small>I/Q → DSP or ML → playback</small>
      </WorkflowHeading>
      <FlowCanvas className="nodrag nowheel">
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
