import React, { useMemo } from "react";
import styled from "styled-components";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { formatFrequency } from "@n-apt/utils/frequency";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  grid-column: 1 / -1;
  padding: 8px 0;
`;

const ChannelList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  grid-column: 1 / -1;
`;

const ChannelBlock = styled.button<{ $isActive: boolean }>`
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 20px;
  text-align: left;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.8;
  }
`;

const ChannelLetter = styled.span<{ $isActive: boolean }>`
  font-size: 48px;
  font-weight: 800;
  color: ${props => props.$isActive ? (props.theme.primary || "#00d4ff") : "#333"};
  line-height: 1;
`;

const ChannelFreq = styled.span<{ $isActive: boolean }>`
  font-size: 24px;
  font-weight: 700;
  font-family: "JetBrains Mono", monospace;
  color: ${props => props.$isActive ? props.theme.primary : "#444"};
`;

const SampleRateLabel = styled.p`
  grid-column: 1 / -1;
  font-size: 11px;
  color: #666;
  line-height: 1.5;
  margin: 16px 0 0 0;
  font-family: "JetBrains Mono", monospace;
  font-weight: 500;
`;

const SampleRateValue = styled.span`
  color: #00d4ff;
`;

export const Channels: React.FC = () => {
  const { state, dispatch, effectiveFrames, sampleRateMHz, wsConnection } = useSpectrumStore();

  const channels = useMemo(() => {
    return effectiveFrames.filter(f => ["A", "B"].includes(f.label));
  }, [effectiveFrames]);

  const handleTune = (frame: any) => {
    const range = {
      min: frame.min_mhz,
      max: sampleRateMHz ? Math.min(frame.max_mhz, frame.min_mhz + sampleRateMHz) : frame.max_mhz
    };

    dispatch({
      type: "SET_SIGNAL_AREA_AND_RANGE",
      area: frame.label,
      range
    });

    wsConnection.sendFrequencyRange(range);
  };

  return (
    <Container>
      <ChannelList>
        {channels.map(ch => {
          const isActive = state.activeSignalArea === ch.label;
          return (
            <ChannelBlock
              key={ch.id}
              $isActive={isActive}
              onClick={() => handleTune(ch)}
            >
              <ChannelLetter $isActive={isActive}>{ch.label}</ChannelLetter>
              <ChannelFreq $isActive={isActive}>
                {formatFrequency(ch.min_mhz)} - {formatFrequency(ch.max_mhz)}
              </ChannelFreq>
            </ChannelBlock>
          );
        })}
      </ChannelList>

      <SampleRateLabel>
        Hardware sample rate: <SampleRateValue>{sampleRateMHz ? formatFrequency(sampleRateMHz) : "X.X MHz"}</SampleRateValue>
      </SampleRateLabel>
    </Container>
  );
};
