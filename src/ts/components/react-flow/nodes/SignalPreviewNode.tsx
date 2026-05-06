import React, { useMemo, useRef } from "react";
import styled from "styled-components";
import FFTCanvas from "@n-apt/components/FFTCanvas";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(18, 18, 18, 0.95);
  border: 1px solid #333;
  border-radius: 12px;
  padding: 12px;
  min-width: 420px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
`;

const NodeTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors?.primary || "#00d4ff"};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;

  &::before {
    content: "";
    display: block;
    width: 8px;
    height: 8px;
    background: currentColor;
    border-radius: 2px;
  }
`;

const CanvasContainer = styled.div`
  width: 100%;
  height: 180px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #222;
  background: #000;
`;

interface SignalPreviewNodeProps {
  label: string;
  activeSignalArea: string;
  centerFrequencyHz: number;
  frequencyRange: { min: number; max: number };
  fftSize?: number;
  buildIqData: (fftSize: number) => Uint8Array;
}

export const SignalPreviewNode: React.FC<SignalPreviewNodeProps> = ({
  label,
  activeSignalArea,
  centerFrequencyHz,
  frequencyRange,
  fftSize = 2048,
  buildIqData,
}) => {
  const previewFrame = useMemo<LiveFrameData>(() => {
    const iqData = buildIqData(fftSize);
    return {
      type: "spectrum",
      center_frequency_hz: Math.round(centerFrequencyHz),
      sample_rate: Math.round(frequencyRange.max - frequencyRange.min),
      data_type: "iq_raw",
      iq_data: iqData,
    };
  }, [buildIqData, centerFrequencyHz, fftSize, frequencyRange.max, frequencyRange.min]);

  const dataRef = useRef<LiveFrameData>(previewFrame);
  dataRef.current = previewFrame;

  return (
    <NodeWrapper>
      <NodeTitle>{label}</NodeTitle>
      <CanvasContainer>
        <FFTCanvas
          dataRef={dataRef}
          frequencyRange={frequencyRange}
          centerFrequencyHz={centerFrequencyHz}
          activeSignalArea={activeSignalArea}
          isPaused={false}
          isDeviceConnected={true}
          fftSize={fftSize}
          powerScale="dB"
          snapshotGridPreference={true}
          compact={true}
          awaitingDeviceData={false}
          isIqRecordingActive={true}
        />
      </CanvasContainer>
    </NodeWrapper>
  );
};

export default SignalPreviewNode;
