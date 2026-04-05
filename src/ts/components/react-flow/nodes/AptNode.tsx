import React from 'react';
import styled from 'styled-components';

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NodeTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const NodeBody = styled.div`
  font-size: 10px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

interface AptNodeProps {
  data: {
    label: string;
  };
}

export const AptNode: React.FC<AptNodeProps> = ({ data }) => {
  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <NodeBody>🖼️ Auto Picture TX</NodeBody>
    </NodeWrapper>
  );
};
