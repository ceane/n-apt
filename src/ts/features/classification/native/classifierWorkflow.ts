import type { Edge, Node } from '@xyflow/react';

export type ClassifierWorkflowStatus = 'waiting' | 'ready' | 'recording' | 'active' | 'offline' | 'idle' | 'planned';

export interface ClassifierWorkflowNodeData extends Record<string, unknown> {
  title: string;
  detail: string;
  status: ClassifierWorkflowStatus;
}

export interface ClassifierWorkflowState {
  selectedSourceHasFrames: boolean;
  captureActive: boolean;
  hasCapturedFrames: boolean;
  loadedModelId: string | null;
  resultAvailable: boolean;
}

export type ClassifierWorkflowNode = Node<ClassifierWorkflowNodeData, 'classifierStep'>;

export function createClassifierWorkflowGraph(state: ClassifierWorkflowState): {
  nodes: ClassifierWorkflowNode[];
  edges: Edge[];
} {
  const nodes: ClassifierWorkflowNode[] = [
    {
      id: 'selected-source',
      type: 'classifierStep',
      position: { x: 4, y: 8 },
      data: {
        title: 'Selected spectrum source',
        detail: 'Choose live stream or file playback in Sources',
        status: state.selectedSourceHasFrames ? 'ready' : 'waiting',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
    {
      id: 'capture',
      type: 'classifierStep',
      position: { x: 174, y: 66 },
      data: {
        title: 'Lossless I/Q capture',
        detail: state.captureActive ? 'Live RTL-SDR only · stop on stale source or settings change' : state.hasCapturedFrames ? 'Capture stopped · ready to label and export' : 'Optional training data · requires live receiving RTL-SDR',
        status: state.captureActive ? 'recording' : state.hasCapturedFrames ? 'ready' : 'idle',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
    {
      id: 'native-features',
      type: 'classifierStep',
      position: { x: 4, y: 102 },
      data: {
        title: 'Native feature extraction',
        detail: 'Native FFT metadata · Hz/bin · crop visibility',
        status: state.resultAvailable ? 'active' : 'waiting',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
    {
      id: 'annotations',
      type: 'classifierStep',
      position: { x: 174, y: 158 },
      data: {
        title: 'V6 .iq + labels.json',
        detail: state.hasCapturedFrames ? 'Capture ready · labels bind to trailer SHA-256' : 'Labels bind by trailer digest; filename + UTC fallback',
        status: state.hasCapturedFrames ? 'ready' : 'planned',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
    {
      id: 'shadow-score',
      type: 'classifierStep',
      position: { x: 4, y: 196 },
      data: {
        title: 'Browser shadow scoring',
        detail: state.loadedModelId ? `Loaded model ${state.loadedModelId} · deterministic baseline alongside` : 'Deterministic baseline · learned model optional',
        status: state.resultAvailable ? 'active' : state.selectedSourceHasFrames ? 'ready' : 'waiting',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
    {
      id: 'offline-training',
      type: 'classifierStep',
      position: { x: 174, y: 250 },
      data: {
        title: 'Offline prepare + train',
        detail: 'Python · shared WGSL extraction · evaluate by session',
        status: 'offline',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
    {
      id: 'result',
      type: 'classifierStep',
      position: { x: 4, y: 290 },
      data: {
        title: 'Decision + diagnostics',
        detail: state.resultAvailable ? 'Current score · resolution · visibility · latency' : 'No decision yet · waiting for the selected source',
        status: state.resultAvailable ? 'active' : 'waiting',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
    {
      id: 'model-artifact',
      type: 'classifierStep',
      position: { x: 174, y: 342 },
      data: {
        title: 'Versioned model artifact',
        detail: state.loadedModelId ? `Loaded locally: ${state.loadedModelId}` : 'No model loaded · promote after evaluation',
        status: state.loadedModelId ? 'ready' : 'offline',
      },
      width: 154,
      height: 68,
      draggable: false,
      selectable: false,
    },
  ];

  const edgePairs = [
    ['selected-source', 'native-features'],
    ['native-features', 'shadow-score'],
    ['shadow-score', 'result'],
    ['selected-source', 'capture'],
    ['capture', 'annotations'],
    ['annotations', 'offline-training'],
    ['offline-training', 'model-artifact'],
    ['model-artifact', 'shadow-score'],
  ] as const;
  const edges: Edge[] = edgePairs.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    markerEnd: { type: 'arrowclosed' },
    style: { stroke: 'var(--color-border, #64748b)', strokeWidth: 1.5 },
  }));

  return { nodes, edges };
}
