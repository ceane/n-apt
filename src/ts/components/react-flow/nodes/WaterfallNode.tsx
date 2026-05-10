import React, { useState, useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import { FIFOWaterfall } from "@n-apt/components/FIFOWaterfall";
import { useAppSelector } from "@n-apt/redux";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";

interface WaterfallNodeProps {
  data: {
    waterfallOptions: boolean;
    label: string;
  };
}

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  padding: 0;
  width: 100%;
  min-width: 525px;
  min-height: 400px;
  align-self: stretch;
  cursor: grab;
  overflow: hidden;
`;

const NodeTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors?.primary || "#00d4ff"};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 0;

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
  padding: 8px 10px 10px;
`;

export const WaterfallNode: React.FC<WaterfallNodeProps> = ({ data }) => {
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const { processIqToDbmSpectrum } = useWasmSimdMath({
    fftSize: 2048,
    enableSimd: true,
    fallbackToScalar: true,
  });

  // Throttled data polling — waterfall scrolls visually so 8fps is smooth enough.
  const [liveFrame, setLiveFrame] = useState(liveDataRef.current);
  const lastRefRef = useRef<unknown>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const next = liveDataRef.current;
      if (next !== lastRefRef.current) {
        lastRefRef.current = next;
        setLiveFrame(next);
      }
    }, 125); // 8fps — smooth waterfall scrolling
    return () => clearInterval(id);
  }, []);

  const waveform = useMemo(() => {
    const iq = liveFrame?.iq_data;
    if (!iq || iq.length === 0) return null;
    const spectrum = processIqToDbmSpectrum(iq, 0, 2048);
    return spectrum;
  }, [liveFrame?.iq_data, processIqToDbmSpectrum]);

  const frequencyRange = useMemo(
    () => ({
      min:
        liveFrame?.center_frequency_hz != null && liveFrame?.sample_rate != null
          ? liveFrame.center_frequency_hz - liveFrame.sample_rate / 2
          : 0,
      max:
        liveFrame?.center_frequency_hz != null && liveFrame?.sample_rate != null
          ? liveFrame.center_frequency_hz + liveFrame.sample_rate / 2
          : 1,
    }),
    [liveFrame?.center_frequency_hz, liveFrame?.sample_rate],
  );

  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <CanvasContainer>
        <FIFOWaterfall
          width={640}
          height={220}
          waveform={waveform}
          frequencyRange={frequencyRange}
          fftMin={fftMinDb}
          fftMax={fftMaxDb}
          retuneSmear={1}
          isPaused={false}
          isVisible={true}
          performScalarResampling={(input, targetLength) => {
            if (targetLength <= 0) return [];
            if (input.length === 0) {
              return Array.from({ length: targetLength }, () => fftMinDb);
            }
            if (input.length === targetLength) {
              return Array.from(input as ArrayLike<number>);
            }
            return Array.from({ length: targetLength }, (_, index) => {
              const sourceIndex = Math.min(
                input.length - 1,
                Math.floor(
                  (index / Math.max(1, targetLength - 1)) * (input.length - 1),
                ),
              );
              return Number(input[sourceIndex] ?? fftMinDb);
            });
          }}
          awaitingDeviceData={!liveFrame}
        />
      </CanvasContainer>
    </NodeWrapper>
  );
};
