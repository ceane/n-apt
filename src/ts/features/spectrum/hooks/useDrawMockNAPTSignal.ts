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
      mathLoadedListeners.forEach((l) => l(true));
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

      const globalNoiseFloorPower = Math.pow(10, globalNoiseFloor / 10);

      // Precompute base signal amplitude power to avoid Math.pow in the inner loop
      const clumpsWithPower = clumps.map((clump) => ({
        ...clump,
        baseAmpPower: Math.pow(10, (clump.baseSignalAmplitude ?? -55) / 10),
      }));

      // Noise filter state
      let v = 0;
      const noiseTotal = clumps.reduce((acc, c) => acc + c.simulatedNoise, 0);
      const noiseFactor = noiseTotal / (clumps.length || 1);

      for (let i = 0; i <= steps; i++) {
        const t = -1 + (2 * i) / steps;
        const freq = ((t + 1) / 2) * 3_000_000;

        let maxClumpPower = 0;
        for (const clump of clumpsWithPower) {
          // Spikes signal power
          let spikesPower = 0;
          if (calculateX) {
            const spikesLinearVal = calculateX(t, clump);
            const spikesDb = -100 + spikesLinearVal * 100;
            spikesPower = Math.pow(10, spikesDb / 10);
          }

          // Pedestal signal power (computed directly in physical power space)
          let pedestalPower = 0;
          const baseType = clump.baseSignalType || "none";
          if (baseType !== "none") {
            const t_eff = (freq - clump.centerOffset) / 1_500_000;
            let shape = 0;
            if (baseType === "gaussian") {
              shape = Math.exp(
                -Math.pow(t_eff / (clump.envelopeWidth * 0.8), 2),
              );
            } else if (baseType === "bpsk") {
              const x = t_eff * Math.PI * 2.5;
              const sinc = x === 0 ? 1 : Math.sin(x) / x;
              shape = sinc * sinc;
            }
            // Add pseudo-random data modulation to the base carrier
            const dataModulation = 0.5 + Math.random() * 1.5;
            pedestalPower = shape * clump.baseAmpPower * dataModulation;
          }

          // Add beats (heterodyne)
          if (clump.beats && clump.beats.length > 0) {
            let beatsPowerSum = 0;
            for (const beat of clump.beats) {
              const beatClump = {
                ...clump,
                centerOffset: clump.centerOffset + beat.offsetHz,
              };
              if (calculateX) {
                const beatLinearVal = calculateX(t, beatClump);
                const beatDb = -100 + beatLinearVal * 100;
                beatsPowerSum += Math.pow(10, beatDb / 10);
              }
            }
            // Normalize power: total sum / (1 original + N beats)
            spikesPower =
              (spikesPower + beatsPowerSum) / (1 + clump.beats.length);
          }

          const clumpPower = spikesPower + pedestalPower;
          if (clumpPower > maxClumpPower) {
            maxClumpPower = clumpPower;
          }
        }

        // Noise parameters
        const target = Math.random() * 100;
        v = v * 0.5 + target * 0.5;

        const noiseValue = v * 0.015 * noiseFactor;
        const expectedNoiseAvg = 50 * 0.015 * noiseFactor;

        // Combine powers in linear space, convert back to dB, and add fuzzy noise
        const combinedPower = maxClumpPower + globalNoiseFloorPower;
        const combinedDb = 10 * Math.log10(Math.max(combinedPower, 1e-15));
        const combinedSignal =
          (combinedDb + 100) / 100 + (noiseValue - expectedNoiseAvg);

        rawSamples.push({ t: i / steps, freq, signal: combinedSignal });
        if (combinedSignal > maxSignal) {
          maxSignal = combinedSignal;
        }
        if (combinedSignal < minSignal) {
          minSignal = combinedSignal;
        }
      }

      return rawSamples.map(({ t, freq, signal }) => {
        const visualDb = -100 + signal * 100;
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
