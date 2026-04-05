import React from 'react';
import styled from 'styled-components';

const NodeContainerWrapper = styled.div`
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px;
  min-width: 200px;
  font-family: var(--font-mono, monospace);
  
  &:hover {
    border-color: #444;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
`;

interface NodeContainerProps {
  children: React.ReactNode;
  'data-nodeid'?: string;
}

export const NodeContainer: React.FC<NodeContainerProps> = ({ children, ...props }) => {
  return (
    <NodeContainerWrapper {...props}>
      {children}
    </NodeContainerWrapper>
  );
};
