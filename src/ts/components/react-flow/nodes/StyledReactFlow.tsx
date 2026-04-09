import React from 'react';
import styled from 'styled-components';
import {
  ReactFlow as BaseReactFlow,
  ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const StyledReactFlowWrapper = styled(BaseReactFlow)`
  width: 100%;
  height: 100%;
  background: #0a0a0a;
  border-radius: 8px;
  overflow: hidden;
  
  .react-flow {
    background: #0a0a0a;
  }
  
  .react-flow__controls {
    background: #1a1a1a;
    border: 1px solid #333;
  }
  
  .react-flow__controls-button {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #fff;
    
    &:hover {
      background: #3a3a3a;
    }
  }
  
  .react-flow__minimap {
    background: #1a1a1a;
    border: 1px solid #333;
  }
  
  .react-flow__edge-path {
    stroke: #666;
  }
  
  .react-flow__edge.selected .react-flow__edge-path {
    stroke: #00d4ff;
  }
  
  .react-flow__handle {
    background: #666;
    border: 1px solid #999;
  }
  
  .react-flow__handle.connecting {
    background: #00d4ff;
  }
`;

interface StyledReactFlowProps {
  nodes: any[];
  edges: any[];
  onNodesChange: any;
  onEdgesChange: any;
  onConnect: any;
  nodeTypes: any;
  connectionMode: ConnectionMode;
  fitView?: boolean;
  children?: React.ReactNode;
}

export const StyledReactFlow: React.FC<StyledReactFlowProps> = (props) => {
  return (
    <StyledReactFlowWrapper {...props}>
      {props.children}
    </StyledReactFlowWrapper>
  );
};
