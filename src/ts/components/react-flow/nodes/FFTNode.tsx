import React, { useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import FFTCanvas, { type FFTCanvasHandle } from "@n-apt/components/FFTCanvas";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { useAppSelector } from "@n-apt/redux";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";

interface FFTNodeProps {
  data: {
    fftOptions: boolean;
    label: string;
  };
}

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 320px;
  align-self: stretch;
  background: rgba(18, 18, 18, 0.95);
  border: 1px solid #333;
  border-radius: 12px;
  padding: 0;
  min-width: 420px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  cursor: grab;
  overflow: hidden;
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
  padding: 8px 10px 0;

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
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  align-self: stretch;
  overflow: hidden;
  background: #000;
`;

const resolveFrequencyRange = (
  frame: LiveFrameData | null,
  fallbackRange: { min: number; max: number } | null,
  fallbackCenterHz: number,
) => {
  if (fallbackRange) return fallbackRange;

  const centerHz = frame?.center_frequency_hz ?? fallbackCenterHz;
  const sampleRate = frame?.sample_rate ?? 1;

  return {
    min: Math.max(0, centerHz - sampleRate / 2),
    max: centerHz + sampleRate / 2,
  };
};

export const FFTNode: React.FC<FFTNodeProps> = ({ data }) => {
  const fftRef = useRef<FFTCanvasHandle | null>(null);
  const dataRef = useRef<LiveFrameData | null>(liveDataRef.current);
  const frequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const centerFrequencyHz = useAppSelector(
    (state) => (state.spectrum as any).centerFrequencyHz || 0,
  );
  const activeSignalArea = useAppSelector(
    (state) => state.spectrum.activeSignalArea || "A",
  );
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);
  const fftWindow = useAppSelector((state) => state.spectrum.fftWindow);
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const powerScale = useAppSelector((state) => state.spectrum.powerScale);

  // Keep dataRef synced without triggering React re-renders.
  // FFTCanvas has its own 60fps rAF loop (useFFTAnimation) that reads
  // dataRef.current directly, so no setState/dispatch needed here.
  useEffect(() => {
    const id = setInterval(() => {
      dataRef.current = liveDataRef.current;
    }, 16); // ~60fps sync, no React re-render
    return () => clearInterval(id);
  }, []);

  const frame = dataRef.current;
  const previewFrequencyRange = useMemo(
    () => resolveFrequencyRange(frame, frequencyRange, centerFrequencyHz),
    [centerFrequencyHz, frame, frequencyRange],
  );

  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <CanvasContainer>
        <FFTCanvas
          ref={fftRef}
          dataRef={dataRef}
          frequencyRange={previewFrequencyRange}
          centerFrequencyHz={frame?.center_frequency_hz ?? centerFrequencyHz}
          activeSignalArea={activeSignalArea}
          isPaused={false}
          isDeviceConnected={true}
          fftSize={fftSize}
          fftWindow={fftWindow}
          fftMin={fftMinDb}
          fftMax={fftMaxDb}
          powerScale={powerScale}
          snapshotGridPreference={true}
          compact={true}
          nodePreview={true}
          awaitingDeviceData={!frame}
          isIqRecordingActive={true}
        />
      </CanvasContainer>
    </NodeWrapper>
  );
};

export default FFTNode;
