import React from "react";
import styled from "styled-components";
import { ReactFlow as BaseReactFlow, ConnectionMode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const StyledReactFlowWrapper = styled(BaseReactFlow)`
  width: 100%;
  height: 100%;
  background: ${({ theme }) => theme.colors.background};
  border-radius: 12px;
  overflow: hidden;

  .react-flow {
    background: ${({ theme }) => theme.colors.background};
  }

  .react-flow__controls {
    background: ${({ theme }) => theme.colors.surface};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 8px;
    padding: 4px;
    box-shadow: none;
  }

  .react-flow__controls-button {
    background: ${({ theme }) => theme.colors.surface};
    border: 1px solid ${({ theme }) => theme.colors.border};
    color: ${({ theme }) => theme.colors.textPrimary};
    border-radius: 4px;
    margin: 2px;
    transition: all 0.2s;

    &:hover {
      background: ${({ theme }) => theme.colors.surfaceHover};
      border-color: ${({ theme }) => theme.colors.primary};
      color: ${({ theme }) => theme.colors.primary};
    }

    svg {
      fill: currentColor;
    }
  }

  .react-flow__minimap {
    background: ${({ theme }) => theme.colors.surface};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 12px;
    overflow: hidden;
    box-shadow: none;
  }

  .react-flow__edge-path {
    stroke: ${({ theme }) => theme.colors.border};
    stroke-width: 2;
    transition: stroke 0.2s;
  }

  .react-flow__edge.selected .react-flow__edge-path {
    stroke: ${({ theme }) => theme.colors.primary};
    stroke-width: 3;
  }

  .react-flow__handle {
    background: ${({ theme }) => theme.colors.border};
    border: 1px solid ${({ theme }) => theme.colors.borderHover};
    width: 8px;
    height: 8px;
    transition: all 0.2s;

    &:hover {
      background: ${({ theme }) => theme.colors.primary};
      transform: scale(1.2);
    }
  }

  .react-flow__handle.connecting {
    background: ${({ theme }) => theme.colors.primary};
    box-shadow: none;
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
    <StyledReactFlowWrapper {...props}>{props.children}</StyledReactFlowWrapper>
  );
};
