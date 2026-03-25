import React, { useRef, useEffect, useState } from "react";
import styled from "styled-components";
import FFTCanvas from "@n-apt/components/FFTCanvas";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";

const VizGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  width: 100%;
`;

const StageContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(20, 20, 22, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 16px;
`;

const StageHeader = styled.h3`
  margin: 0;
  color: #fff;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
`;

interface AptDemodVizProps {
  iqData: Uint8Array | null;
  sampleRate?: number;
  centerFreq?: number;
  minFreq?: number;
  maxFreq?: number;
}

export const AptDemodViz: React.FC<AptDemodVizProps> = ({
  iqData,
  sampleRate = 32768,
  centerFreq = 137.1,
  minFreq,
  maxFreq
}) => {
  const { processIqToDbmSpectrum } = useWasmSimdMath({
    fftSize: 2048,
    enableSimd: true,
    fallbackToScalar: true
  });

  const [rfData, setRfData] = useState<{ waveform: Float32Array; update_counter?: number } | null>(null);
  const [fmData, setFmData] = useState<{ waveform: Float32Array; update_counter?: number } | null>(null);
  const [amData, setAmData] = useState<{ waveform: Float32Array; update_counter?: number } | null>(null);

  const rfDataRef = useRef<{ waveform: Float32Array; update_counter?: number } | null>(null);
  const fmDataRef = useRef<{ waveform: Float32Array; update_counter?: number } | null>(null);
  const amDataRef = useRef<{ waveform: Float32Array; update_counter?: number } | null>(null);

  // Update refs when state changes so FFTCanvas can read them
  useEffect(() => {
    rfDataRef.current = rfData;
  }, [rfData]);
  
  useEffect(() => {
    fmDataRef.current = fmData;
  }, [fmData]);

  useEffect(() => {
    amDataRef.current = amData;
  }, [amData]);

  // Compute demodulation stages whenever new IQ data arrives
  useEffect(() => {
    if (!iqData) return;

    // 1. RF Stage (Raw)
    const rfSpec = processIqToDbmSpectrum(iqData, 0, 2048);
    setRfData({ waveform: rfSpec, update_counter: 0 });

    // 2. FM Demodulation Stage
    const numSamples = Math.floor(iqData.length / 2);
    const fmBuffer = new Float32Array(numSamples);
    
    let lastPhase = 0;
    for (let i = 0; i < numSamples; i++) {
      const i_val = (iqData[i * 2] - 128) / 128.0;
      const q_val = (iqData[i * 2 + 1] - 128) / 128.0;
      
      const phase = Math.atan2(q_val, i_val);
      let dPhase = phase - lastPhase;
      
      // Unwrap
      while (dPhase > Math.PI) dPhase -= 2 * Math.PI;
      while (dPhase < -Math.PI) dPhase += 2 * Math.PI;
      
      fmBuffer[i] = dPhase;
      lastPhase = phase;
    }

    // Convert fmBuffer back to pseudo-IQ (real values + 0 imaginary) for FFTCanvas
    const fmIq = new Uint8Array(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const val = (fmBuffer[i] / Math.PI) * 128 + 128;
      fmIq[i * 2] = Math.max(0, Math.min(255, val));
      fmIq[i * 2 + 1] = 128; // Q = 0
    }
    const fmSpec = processIqToDbmSpectrum(fmIq, 0, 2048);
    setFmData({ waveform: fmSpec, update_counter: 0 });

    // 3. AM Envelope Detection (APT Subcarrier isolation + diode envelope + LPF)
    // For simplicity, we rectify the FM signal and apply a basic low pass
    const amBuffer = new Float32Array(numSamples);
    let lpfState = 0;
    const alpha = 0.1; // simple LPF alpha
    
    for (let i = 0; i < numSamples; i++) {
        // Enveloping
        const rectified = Math.abs(fmBuffer[i]);
        // LPF
        lpfState = lpfState + alpha * (rectified - lpfState);
        amBuffer[i] = lpfState;
    }

    const amIq = new Uint8Array(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      // Scale AM up
      const val = (amBuffer[i] * 5.0) * 128 + 128; // Boost to see
      amIq[i * 2] = Math.max(0, Math.min(255, val));
      amIq[i * 2 + 1] = 128;
    }
    const amSpec = processIqToDbmSpectrum(amIq, 0, 2048);
    setAmData({ waveform: amSpec, update_counter: 0 });

    // Force continuous updates to dataRef so FFTCanvas thinks data is streaming
    const interval = setInterval(() => {
      if (rfDataRef.current) rfDataRef.current = { ...rfDataRef.current, update_counter: (rfDataRef.current.update_counter || 0) + 1 };
      if (fmDataRef.current) fmDataRef.current = { ...fmDataRef.current, update_counter: (fmDataRef.current.update_counter || 0) + 1 };
      if (amDataRef.current) amDataRef.current = { ...amDataRef.current, update_counter: (amDataRef.current.update_counter || 0) + 1 };
    }, 33); // ~30fps

    return () => clearInterval(interval);
  }, [iqData]);

  const canvasStyle = { aspectRatio: "4 / 3", width: "100%", display: "flex", flexDirection: "column" as const };

  return (
    <VizGrid>
      <StageContainer>
        <StageHeader>1. RF Input (Raw I/Q)</StageHeader>
        <div style={canvasStyle}>
          {rfData && (
             <FFTCanvas
               dataRef={rfDataRef}
               frequencyRange={minFreq !== undefined && maxFreq !== undefined 
                 ? { min: minFreq, max: maxFreq } 
                 : { min: centerFreq - (sampleRate / 2e6), max: centerFreq + (sampleRate / 2e6) }
               }
               centerFrequencyMHz={centerFreq}
               activeSignalArea={"0"}
               isPaused={false}
               isDeviceConnected={true}
               awaitingDeviceData={false}
               fftSize={2048}
               snapshotGridPreference={true}
               hideWaterfall={true}
               hideSliders={true}
             />
          )}
        </div>
      </StageContainer>

      <StageContainer>
        <StageHeader>2. FM Demodulator Output</StageHeader>
        <div style={canvasStyle}>
          {fmData && (
             <FFTCanvas
               dataRef={fmDataRef}
               frequencyRange={{ min: -sampleRate / 2e6, max: sampleRate / 2e6 }}
               centerFrequencyMHz={0}
               activeSignalArea={"0"}
               isPaused={false}
               isDeviceConnected={true}
               awaitingDeviceData={false}
               fftSize={2048}
               fftMin={-80}
               snapshotGridPreference={true}
               hideWaterfall={true}
               hideSliders={true}
             />
          )}
        </div>
      </StageContainer>

      <StageContainer>
        <StageHeader>3. AM Envelope (Pixels)</StageHeader>
        <div style={canvasStyle}>
          {amData && (
             <FFTCanvas
               dataRef={amDataRef}
               frequencyRange={{ min: -sampleRate / 2e6, max: sampleRate / 2e6 }}
               centerFrequencyMHz={0}
               activeSignalArea={"0"}
               isPaused={false}
               isDeviceConnected={true}
               awaitingDeviceData={false}
               fftSize={2048}
               fftMin={-80}
               snapshotGridPreference={true}
               hideWaterfall={true}
               hideSliders={true}
             />
          )}
        </div>
      </StageContainer>
    </VizGrid>
  );
};
