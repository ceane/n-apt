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

interface FmNodeProps {
  data: {
    label: string;
  };
}

export const FmNode: React.FC<FmNodeProps> = ({ data }) => {
  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <NodeBody>📻 FM Demod</NodeBody>
    </NodeWrapper>
  );
};
