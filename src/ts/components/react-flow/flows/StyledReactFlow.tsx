import styled from 'styled-components';
import { ReactFlow } from '@xyflow/react';

export const StyledReactFlow = styled(ReactFlow)`
  width: 100%;
  height: 100%;

  .react-flow__controls {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    border-radius: 8px !important;
  }

  .react-flow__controls-button {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    color: ${(props) => props.theme.textPrimary} !important;
  }

  .react-flow__controls-button:hover {
    background-color: ${(props) => props.theme.surfaceHover} !important;
  }
`;
