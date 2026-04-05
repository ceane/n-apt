import React from 'react';
import styled from 'styled-components';

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 260px;
`;

const NodeTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const NodeBody = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
`;

const SpanInput = styled.input`
  width: 60px;
  padding: 2px;
  font-size: 9px;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 2px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SpanUnit = styled.span`
  font-size: 9px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

interface SpanNodeProps {
  data: {
    label: string;
  };
}

export const SpanNode: React.FC<SpanNodeProps> = ({ data }) => {
  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <NodeBody>
        <SpanInput type="number" placeholder="Start" />
        <span>-</span>
        <SpanInput type="number" placeholder="End" />
        <SpanUnit>Hz</SpanUnit>
      </NodeBody>
    </NodeWrapper>
  );
};
