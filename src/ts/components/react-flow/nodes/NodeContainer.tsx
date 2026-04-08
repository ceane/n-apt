import React from 'react';
import styled from 'styled-components';

const NodeContainerWrapper = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: ${({ theme }) => theme.spacing.md};
  min-width: 200px;
  font-family: ${({ theme }) => theme.typography.mono};
  
  &:hover {
    border-color: ${({ theme }) => theme.colors.borderHover};
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
