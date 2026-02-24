import { useCallback } from "react";

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
    const {
      spikeCount,
      spikeWidth,
      centerSpikeBoost,
      floorAmplitude,
      decayRate,
      envelopeWidth,
    } = params;

    const calculateX = (t: number) => {
      // Frequency comb with sine wave spikes and exponential height decay
      // over t ∈ [-1, 1], modulated by Gaussian envelope

      const N = spikeCount;
      const half = Math.floor((N - 1) / 2);

      // Uniform tooth spacing
      const spacing = 2 / (N - 1);

      // Tooth half-width as fraction of spacing
      const halfWidth = (spikeWidth * spacing) / 2;

      let y = 0;

      for (let k = -half; k <= half; k++) {
        const centerPos = k * spacing;
        const dx = t - centerPos;

        // Finite support guarantees baseline = 0
        if (Math.abs(dx) > halfWidth) continue;

        // Sine wave tooth
        const local = dx / halfWidth;
        const tooth = Math.sin((Math.PI * (local + 1)) / 2);

        let height;

        // Center tooth (absolute dominant)
        if (k === 0) {
          height = Math.max(1 * centerSpikeBoost, 1.05);
        } else {
          const centerHeight = Math.max(1 * centerSpikeBoost, 1.05);
          const effectiveFloor = Math.min(floorAmplitude, 1, centerHeight);
          const decay = Math.exp(-Math.abs(k) * decayRate);
          height = effectiveFloor + (centerHeight - effectiveFloor) * decay;
        }

        y += height * tooth;
      }

      // Gaussian envelope
      const envelope = Math.exp(-Math.pow(t / envelopeWidth, 2));
      const signalValue = Math.max(y * envelope, 0);

      return signalValue;
    };

    const rawSamples: Array<{ t: number; freq: number; signal: number }> = [];
    let maxSignal = Number.NEGATIVE_INFINITY;
    let minSignal = Number.POSITIVE_INFINITY;
    const steps = 32768; // Match FFT resolution for smoother curve

    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps;
      const freq = ((t + 1) / 2) * 3; // 0 to 3 MHz like working version
      const signalValue = calculateX(t);

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
