import { useCallback } from "react";

type CalculateXFn = (t: number, clump: MockNAPTParams) => number;

let calculateX: CalculateXFn | null = null;
let mathLoaded = false;
const loadMath = async () => {
  try {
    const modulePath = [
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
      mathLoaded = true;
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
}

export function useDrawMockNAPTSignal() {
  const generateMockNAPTData = useCallback((clumps: MockNAPTParams[], globalNoiseFloor: number) => {
    if (!mathLoaded) return [];

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
      const freq = ((t + 1) / 2) * 3;
      
      let maxClumpSignal = 0;
      for (const clump of clumps) {
        // Base signal for this clump
        let clumpSum = calculateX ? calculateX(t, clump) : 0;
        
        // Add beats (heterodyne)
        if (clump.beats && clump.beats.length > 0) {
          for (const beat of clump.beats) {
            // Shift centerOffset by offsetHz (convert Hz to MHz)
            const beatClump = { 
              ...clump, 
              centerOffset: clump.centerOffset + (beat.offsetHz / 1_000_000) 
            };
            clumpSum += calculateX ? calculateX(t, beatClump) : 0;
          }
          // Normalize power: total sum / (1 original + N beats)
          clumpSum /= (1 + clump.beats.length);
        }
        
        maxClumpSignal = Math.max(maxClumpSignal, clumpSum);
      }

      // Noise parameters:
      // target avg of (Math.random() * 3) is 1.5
      // sequential filter v = v * 0.92 + target * 0.08 stabilizes at avg 1.5
      // noiseValue = (v / 80) * noiseFactor has avg = (1.5 / 80) * noiseFactor = 0.01875 * noiseFactor
      const expectedNoiseAvg = 0.01875 * noiseFactor;
      
      const target = Math.random() * 3;
      v = v * 0.92 + target * 0.08;
      
      const noiseValue = (v / 80) * noiseFactor; 
      
      // Zero-mean noise: subtract the expected average so the noise oscillates around the signal
      const combinedSignal = maxClumpSignal + signalFloor + (noiseValue - expectedNoiseAvg);

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
      const visualDb = -100 + (signal * 100);
      
      // Clamp for visual range
      const dbValue = Math.min(Math.max(-120, visualDb), 0.5);

      return {
        t,
        x: dbValue,
        y: freq,
      };
    });
  }, []);

  return { generateMockNAPTData, mathLoaded };
}
