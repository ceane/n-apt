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
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ChannelSelect = styled.select`
  width: 100%;
  padding: 4px;
  font-size: 10px;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};

  option {
    background: ${({ theme }) => theme.colors.surface};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

interface ChannelOptionsNodeProps {
  data: {
    label: string;
  };
}

export const ChannelOptionsNode: React.FC<ChannelOptionsNodeProps> = ({ data }) => {
  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <NodeBody>
        <ChannelSelect defaultValue="">
          <option value="">Select Channel...</option>
          <option value="channel1">Channel 1</option>
          <option value="channel2">Channel 2</option>
          <option value="channel3">Channel 3</option>
        </ChannelSelect>
      </NodeBody>
    </NodeWrapper>
  );
};
