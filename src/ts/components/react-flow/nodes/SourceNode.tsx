import React from 'react';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';
import { useAppSelector } from '@n-apt/redux';
import styled from 'styled-components';

const SourceContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 180px;
`;

const SourceHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
`;

const IconContainer = styled.div`
  padding: 8px;
  background: ${({ theme }) => theme.colors.primary}1a;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.primary}33;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const IconEmoji = styled.span`
  font-size: 20px;
`;

const TextContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const TitleText = styled.div`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.primary};
  opacity: 0.9;
`;

const SubtitleText = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
`;

interface SourceNodeProps {
  data: {
    sourceNode: boolean;
    label: string;
  };
}

export const SourceNode: React.FC<SourceNodeProps> = ({ data }) => {
  const { wsConnection, deviceName: spectrumDeviceName, state: liveState } = useSpectrumStore();
  const reduxDeviceName = useAppSelector((s) => s.websocket.deviceName);

  const sourceMode = liveState?.sourceMode ?? "live";
  const selectedFiles = liveState?.selectedFiles ?? [];
  const primaryFileName = selectedFiles.length > 0 ? selectedFiles[0].name : "Select a file...";

  const displayTitle = sourceMode === "file" ? "File" : "Source";
  const deviceName = wsConnection?.deviceName || spectrumDeviceName || reduxDeviceName || data?.label || 'SDR Device';
  const displaySubtitle = sourceMode === "file" ? primaryFileName : deviceName;

  return (
    <SourceContainer>
      <SourceHeader>
        <IconContainer>
          <IconEmoji>{sourceMode === "file" ? "📁" : "📡"}</IconEmoji>
        </IconContainer>
        <TextContainer>
          <TitleText>{displayTitle}</TitleText>
          <SubtitleText>{displaySubtitle}</SubtitleText>
        </TextContainer>
      </SourceHeader>
    </SourceContainer>
  );
};
