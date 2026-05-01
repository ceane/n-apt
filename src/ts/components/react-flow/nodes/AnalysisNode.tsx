import React from 'react';
import { Brain } from 'lucide-react';
import { formatFrequency } from '@n-apt/utils/frequency';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';
import styled from 'styled-components';

const AnalysisContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 220px;
  text-align: left;
`;

const AnalysisHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: 4px;
`;

const IconContainer = styled.div`
  padding: 6px;
  background: ${({ theme }) => theme.colors.primary}22;
  border-radius: 4px;
`;

const TitleContainer = styled.div`
  display: flex;
  flex-direction: column;
`;

const MainTitle = styled.div`
  font-size: 12px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.primary};
`;

const Subtitle = styled.div`
  font-size: 9px;
  opacity: 0.6;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const ContentBox = styled.div`
  background: ${({ theme }) => theme.colors.background}44;
  border: 1px solid ${({ theme }) => theme.colors.border}11;
  border-radius: 6px;
  padding: 10px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const FrequencySpan = styled.div`
  flex: 1;
`;

const FrequencyLabel = styled.div`
  opacity: 0.6;
`;

const FrequencyValue = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: 700;
`;

const SnrRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SummaryText = styled.div`
  font-size: 10px;
  line-height: 1.4;
  margin-top: 4px;
  border-top: 1px solid ${({ theme }) => theme.colors.border}11;
  padding-top: 8px;
`;

interface AnalysisNodeProps {
  data: {
    analysisOptions: boolean;
    label: string;
    result: {
      snrDelta: string;
      summary: string;
    };
  };
}

export const AnalysisNode: React.FC<AnalysisNodeProps> = ({ data }) => {
  const { state: spectrumState, sampleRateHzEffective: sampleRateHz } = useSpectrumStore();
  const { activeSignalArea, frequencyRange, lastKnownRanges, vizZoom, vizPanOffset } = spectrumState;
  const areaKey = activeSignalArea || "A";
  const safeLastKnownRanges = lastKnownRanges && typeof lastKnownRanges === 'object' ? lastKnownRanges : {};

  // Calculate visible frequency range based on zoom and pan for labeling
  const calculateVisible = () => {
    const minFreq = 0;
    const maxFreq = 2000; // Cap
    const hardwareSpan = sampleRateHz || 3_200_000;

    const safeZoom = (Number.isFinite(vizZoom) && vizZoom > 0) ? vizZoom : 1;

    if (!frequencyRange) {
      return safeLastKnownRanges[areaKey] || { min: minFreq, max: minFreq + hardwareSpan };
    }

    const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const visualSpan = hardwareSpan / safeZoom;
    const halfVisualSpan = visualSpan / 2;
    let visualCenter = hardwareCenter + vizPanOffset;

    visualCenter = Math.max(
      minFreq + halfVisualSpan,
      Math.min(maxFreq - halfVisualSpan, visualCenter),
    );

    return {
      min: visualCenter - halfVisualSpan,
      max: visualCenter + halfVisualSpan,
    };
  };

  const freqRange = calculateVisible();
  const result = data.result;
  if (!result) return null;

  return (
    <AnalysisContainer>
      <AnalysisHeader>
        <IconContainer>
          <Brain size={16} />
        </IconContainer>
        <TitleContainer>
          <MainTitle>BASELINE ANALYSIS</MainTitle>
          <Subtitle>Neural Vector Result</Subtitle>
        </TitleContainer>
      </AnalysisHeader>

      <ContentBox>
        <FrequencySpan>
          <FrequencyLabel>Frequency Span</FrequencyLabel>
          <FrequencyValue>{formatFrequency(freqRange.min)} - {formatFrequency(freqRange.max)}</FrequencyValue>
        </FrequencySpan>
        <SnrRow>
          <span style={{ opacity: 0.6 }}>SNR Delta:</span>
          <span style={{ fontFamily: 'monospace' }}>{result.snrDelta}</span>
        </SnrRow>
        <SummaryText>
          {result.summary}
        </SummaryText>
      </ContentBox>
    </AnalysisContainer>
  );
};
