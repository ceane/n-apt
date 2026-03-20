import React, { useMemo } from "react";
import styled from "styled-components";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { formatFrequency } from "@n-apt/utils/frequency";
import FrequencyRangeSlider from "@n-apt/components/sidebar/FrequencyRangeSlider";
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  grid-column: 1 / -1;
  padding: 8px 0;
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
  user-select: none;
  align-items: center;

  &:hover {
    opacity: 0.8;
  }
`;

const ChannelLetter = styled.span<{ $isActive: boolean }>`
  font-size: 36px;
  font-weight: 800;
  color: ${(props) => (props.$isActive ? props.theme.primary : props.theme.textDisabled)};
  line-height: 1;
  tex
`;

const ChannelFreq = styled.span<{ $isActive: boolean }>`
  font-size: 18px;
  font-weight: 700;
  font-family: ${(props) => props.theme.typography.mono};
  color: ${(props) => (props.$isActive ? props.theme.primary : props.theme.textDisabled)};
`;

const SampleRateLabel = styled.p`
  grid-column: 1 / -1;
  font-size: 11px;
  color: ${(props) => props.theme.textMuted};
  line-height: 1.5;
  margin: 16px 0 0 0;
  font-family: ${(props) => props.theme.typography.mono};
  font-weight: 500;
`;

const SampleRateValue = styled.span`
  color: ${(props) => props.theme.primary};
`;

interface ChannelsProps {
  isScanning?: boolean;
  scanProgress?: number;
  scanCurrentFreq?: number;
  scanRange?: FrequencyRange;
  onScanStart?: () => void;
  onScanStop?: () => void;
}

export const Channels: React.FC<ChannelsProps> = ({
  isScanning = false,
  scanProgress = 0,
  scanCurrentFreq,
  scanRange,
  onScanStart,
  onScanStop,
}) => {
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
      {channels.map(ch => {
        const isActive = state.activeSignalArea === ch.label;
        const isChannelScanning = isScanning && scanRange &&
          ch.min_mhz * 1e6 <= (scanRange.max || 0) &&
          ch.max_mhz * 1e6 >= (scanRange.min || 0);

        return (
          <React.Fragment key={ch.id}>
            <ChannelBlock
              $isActive={isActive}
              onClick={() => handleTune(ch)}
            >
              <ChannelLetter $isActive={isActive}>{ch.label}</ChannelLetter>
              <ChannelFreq $isActive={isActive}>
                {formatFrequency(ch.min_mhz)} - {formatFrequency(ch.max_mhz)}
              </ChannelFreq>
            </ChannelBlock>

            {/* Show FrequencyRangeSlider only for the active channel */}
            {isActive && (
              <FrequencyRangeSlider
                label=""
                minFreq={ch.min_mhz}
                maxFreq={ch.max_mhz}
                visibleMin={ch.min_mhz}
                visibleMax={ch.max_mhz}
                sampleRateMHz={sampleRateMHz}
                isActive={isActive}
                onActivate={() => handleTune(ch)}
                onRangeChange={() => { }}
                readOnly={isChannelScanning}
                scanProgress={isChannelScanning ? scanProgress : 0}
                scanCurrentFreq={isChannelScanning && scanCurrentFreq !== undefined ? scanCurrentFreq : undefined}
              />
            )}
          </React.Fragment>
        );
      })}

      <SampleRateLabel>
        Hardware sample rate: <SampleRateValue>{sampleRateMHz ? formatFrequency(sampleRateMHz) : "X.X MHz"}</SampleRateValue>
      </SampleRateLabel>
    </Container>
  );
};
