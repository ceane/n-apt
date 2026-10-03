import { memo, useMemo } from 'react';
import styled from 'styled-components';
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  createClassifierWorkflowGraph,
  type ClassifierWorkflowNode,
  type ClassifierWorkflowNodeData,
  type ClassifierWorkflowState,
  type ClassifierWorkflowStatus,
} from './classifierWorkflow';

const WorkflowFrame = styled.section`
  min-width: 0;
  border-top: 1px solid var(--color-border, rgba(128, 128, 128, .25));
  padding-top: 8px;
`;

const WorkflowHeading = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  margin-bottom: 6px;
`;

const FlowCanvas = styled.div`
  width: 100%;
  height: 416px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border, rgba(128, 128, 128, .3));
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

const statusColors: Record<ClassifierWorkflowStatus, string> = {
  waiting: 'var(--text-secondary, #77808f)',
  ready: 'var(--color-success, #168a45)',
  recording: 'var(--color-danger, #dc2626)',
  active: 'var(--color-primary, #3b82f6)',
  offline: 'var(--text-secondary, #77808f)',
  idle: 'var(--text-secondary, #77808f)',
  planned: 'var(--color-warning, #b7791f)',
};

const WorkflowNodeCard = styled.div<{ $status: ClassifierWorkflowStatus }>`
  display: grid;
  gap: 3px;
  width: 154px;
  min-height: 68px;
  box-sizing: border-box;
  padding: 7px;
  border: 1px solid var(--color-border, rgba(128, 128, 128, .4));
  border-left: 3px solid ${({ $status }) => statusColors[$status]};
  border-radius: 7px;
  background: var(--color-surface, #fff);
  color: var(--text-primary, #202735);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
  font-family: "JetBrains Mono", monospace;
  white-space: normal;

  strong {
    font-size: 10px;
    line-height: 1.25;
  }

  small {
    color: var(--text-secondary, #687386);
    font-size: 9px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
`;

const WorkflowNode = memo(function WorkflowNode({ id, data }: NodeProps<ClassifierWorkflowNode>) {
  return (
    <WorkflowNodeCard data-testid={`classifier-flow-node-${id}`} data-state={data.status} $status={data.status}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <strong>{data.title}</strong>
      <small>{data.detail}</small>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </WorkflowNodeCard>
  );
});

const nodeTypes = { classifierStep: WorkflowNode };

export const ClassifierWorkflowFlow = memo(function ClassifierWorkflowFlow(props: ClassifierWorkflowState) {
  const { nodes, edges } = useMemo(
    () => createClassifierWorkflowGraph(props),
    [props.selectedSourceHasFrames, props.captureActive, props.hasCapturedFrames, props.loadedModelId, props.resultAvailable],
  );
  const arrowEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-border, #64748b)' },
  })), [edges]);

  return (
    <WorkflowFrame aria-label="Classifier workflow" data-testid="classifier-workflow">
      <WorkflowHeading>
        <strong>Pipeline flow</strong>
        <small>Browser runtime ↔ offline training</small>
      </WorkflowHeading>
      <FlowCanvas>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={arrowEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.04, minZoom: 0.55, maxZoom: 1 }}
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
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(128,128,128,.18)" />
          </ReactFlow>
        </ReactFlowProvider>
      </FlowCanvas>
    </WorkflowFrame>
  );
});

export type { ClassifierWorkflowState, ClassifierWorkflowNodeData };
