import { useCallback, useState, useEffect } from "react";

type CalculateXFn = (t: number, clump: MockNAPTParams) => number;

let calculateX: CalculateXFn | null = null;
let mathLoadedGlobal = false;
const mathLoadedListeners: Array<(loaded: boolean) => void> = [];

const loadMath = async () => {
  try {
    const modulePath =
      "/" +
      [
        "@n-apt",
        "encrypted-modules",
        "tmp",
        "ts",
        "math",
        "napt-spike-eq",
      ].join("/");

    const mod = await import(/* @vite-ignore */ modulePath).catch(() => null);
    if (mod?.default) {
      calculateX = mod.default as CalculateXFn;
      mathLoadedGlobal = true;
      mathLoadedListeners.forEach(l => l(true));
    }
  } catch {
    console.warn("LaTeX math module not decrypted, fallback to zero signal");
  }
};
loadMath();

export interface BeatParams {
  offsetHz: number;
}

export interface MockNAPTParams {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  spikesAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
  centerOffset: number;
  peakAmplitude: number;
  simulatedNoise: number;
  beats: BeatParams[];
  baseSignalType?: "none" | "gaussian" | "bpsk";
  baseSignalAmplitude?: number;
}

export function useDrawMockNAPTSignal() {
  const [mathLoaded, setMathLoaded] = useState(mathLoadedGlobal);

  useEffect(() => {
    if (mathLoadedGlobal) return;
    const listener = (loaded: boolean) => setMathLoaded(loaded);
    mathLoadedListeners.push(listener);
    return () => {
      const idx = mathLoadedListeners.indexOf(listener);
      if (idx > -1) mathLoadedListeners.splice(idx, 1);
    };
  }, []);

  const generateMockNAPTData = useCallback(
    (clumps: MockNAPTParams[], globalNoiseFloor: number) => {
      if (!mathLoadedGlobal) return [];

      const rawSamples: Array<{ t: number; freq: number; signal: number }> = [];
      let maxSignal = Number.NEGATIVE_INFINITY;
      let minSignal = Number.POSITIVE_INFINITY;
      const steps = 16384; // Reduced from 32768 for performance

      // Convert global noise floor (dB) to linear (Visual Mapping)
      // -100dB = 0.0, 0dB = 1.0
      const signalFloor = (globalNoiseFloor + 100) / 100;

      // Noise filter state
      let v = 0;
      const noiseTotal = clumps.reduce((acc, c) => acc + c.simulatedNoise, 0);
      const noiseFactor = noiseTotal / (clumps.length || 1);

      for (let i = 0; i <= steps; i++) {
        const t = -1 + (2 * i) / steps;
        const freq = ((t + 1) / 2) * 3_000_000;

        let maxClumpSignal = 0;
        for (const clump of clumps) {
          // Base signal for this clump
          let clumpSum = calculateX ? calculateX(t, clump) : 0;

          // Add base signal pedestal if configured
          const baseType = clump.baseSignalType || "none";
          if (baseType !== "none") {
            const baseAmpLinear = ((clump.baseSignalAmplitude ?? -55) - 20 + 100) / 100;
            const t_eff = (freq - clump.centerOffset) / 1_500_000;
            let shape = 0;
            if (baseType === "gaussian") {
              shape = Math.exp(-Math.pow(t_eff / (clump.envelopeWidth * 0.8), 2));
            } else if (baseType === "bpsk") {
              const x = t_eff * Math.PI * 2.5;
              const sinc = x === 0 ? 1 : Math.sin(x) / x;
              shape = sinc * sinc;
            }
            // Add pseudo-random data modulation to the base carrier
            // This gives it the "noise/data between the spikes" look
            // Made variance more dramatic: 50% to 200% of base amplitude
            const dataModulation = 0.5 + Math.random() * 1.5;
            clumpSum += shape * baseAmpLinear * dataModulation;
          }

          // Add beats (heterodyne)
          if (clump.beats && clump.beats.length > 0) {
            for (const beat of clump.beats) {
              // Shift centerOffset by offsetHz
              const beatClump = {
                ...clump,
                centerOffset: clump.centerOffset + beat.offsetHz,
              };
              clumpSum += calculateX ? calculateX(t, beatClump) : 0;
            }
            // Normalize power: total sum / (1 original + N beats)
            clumpSum /= 1 + clump.beats.length;
          }

          maxClumpSignal = Math.max(maxClumpSignal, clumpSum);
        }

        // Noise parameters:
        // Increased variance and jumpiness for "Data Band Variance"
        const target = Math.random() * 100; // was 10
        v = v * 0.5 + target * 0.5;

        // Multiply by 0.015 to give a substantial visual jump
        // Max v ~ 100, so noiseValue can swing up to 1.5 * noiseFactor
        const noiseValue = v * 0.015 * noiseFactor;
        const expectedNoiseAvg = 50 * 0.015 * noiseFactor; // target avg is 50

        // Zero-mean noise: subtract the expected average so the noise oscillates around the signal
        const combinedSignal =
          maxClumpSignal + signalFloor + (noiseValue - expectedNoiseAvg);

        rawSamples.push({ t: i / steps, freq, signal: combinedSignal });
        if (combinedSignal > maxSignal) {
          maxSignal = combinedSignal;
        }
        if (combinedSignal < minSignal) {
          minSignal = combinedSignal;
        }
      }

      return rawSamples.map(({ t, freq, signal }) => {
        // Visual dB Mapping: -100dB = 0.0, 0dB = 1.0 linear
        const visualDb = -100 + signal * 100;

        // Clamp for visual range
        const dbValue = Math.min(Math.max(-120, visualDb), 0.5);

        return {
          t,
          x: dbValue,
          y: freq,
        };
      });
    },
    [],
  );

  return { generateMockNAPTData, mathLoaded };
}
