import { useCallback } from "react";
import calculateX from "@n-apt/math/napt-spike-eq";

export interface MockNAPTParams {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  floorAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
}

export function useDrawMockNAPTSignal() {
  const generateMockNAPTData = useCallback((params: MockNAPTParams) => {
    const rawSamples: Array<{ t: number; freq: number; signal: number }> = [];
    let maxSignal = Number.NEGATIVE_INFINITY;
    let minSignal = Number.POSITIVE_INFINITY;
    const steps = 32768; // Match FFT resolution for smoother curve

    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps;
      const freq = ((t + 1) / 2) * 3; // 0 to 3 MHz like working version
      const signalValue = calculateX(t, params);

      rawSamples.push({ t: i / steps, freq, signal: signalValue });
      if (signalValue > maxSignal) {
        maxSignal = signalValue;
      }
      if (signalValue < minSignal) {
        minSignal = signalValue;
      }
    }

    // Avoid division by zero
    const safeMaxSignal = maxSignal <= 0 ? 1 : maxSignal;
    const safeMinSignal = minSignal <= 0 ? 1e-6 : minSignal;
    const rangeSignal = Math.max(safeMaxSignal - safeMinSignal, 1e-6);
    const MIN_DB = -80;

    return rawSamples.map(({ t, freq, signal }) => {
      const normalizedLinear = (signal - safeMinSignal) / rangeSignal;
      const clampedLinear = Math.max(0, Math.min(1, normalizedLinear));
      const dbValue = MIN_DB + clampedLinear * 80;
      return {
        t,
        x: dbValue,
        y: freq,
      };
    });
  }, []);

  return { generateMockNAPTData };
}
