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

const Canvas = styled.div`
  width: 220px;
  height: 70px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surfaceHover};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textMuted};
  border-radius: 4px;
`;

const Caption = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textMuted};
  margin-top: 4px;
`;

interface TempoNoteNodeProps {
  data: {
    label: string;
  };
}

export const TempoNoteNode: React.FC<TempoNoteNodeProps> = ({ data }) => {
  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <Canvas>Measure Canvas</Canvas>
      <Caption>🎵 Musical Pattern Detection</Caption>
    </NodeWrapper>
  );
};
