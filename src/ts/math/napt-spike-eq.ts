export interface MockNAPTParams {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  spikesAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
  centerOffset: number;    // Unit: MHz (range 0-3)
  peakAmplitude: number;
  simulatedNoise: number;
}

const calculateX = (t: number, params: MockNAPTParams) => {
  // Frequency comb with sine wave spikes and exponential height decay
  // over t ∈ [-1, 1], modulated by Gaussian envelope

  const {
    spikeCount,
    spikeWidth,
    centerSpikeBoost,
    spikesAmplitude,
    decayRate,
    envelopeWidth,
    centerOffset,
    peakAmplitude,
  } = params;

  // Convert dB-based amplitudes to linear gains (Visual Mapping)
  // -100dB = 0.0, 0dB = 1.0
  const peakLinear = (peakAmplitude + 100) / 100;
  const spikesLinear = (spikesAmplitude + 100) / 100;

  // Map t in [-1, 1] to frequency f in [0, 3] MHz
  const f = ((t + 1) / 2) * 3;
  
  // Calculate relative t based on frequency offset (clump center in MHz)
  // Distance in MHz: f - centerOffset
  // Map back to t-space: 1.5 MHz = 1 unit
  const t_eff = (f - centerOffset) / 1.5;

  const N = spikeCount;
  const half = Math.floor((N - 1) / 2);

  // Helper to evaluate signal at a given t_eff relative to clump center
  const evaluate = (rel_t: number) => {
    let val = 0;
    const spacing = 2 / (N - 1);
    const halfWidth = (spikeWidth * spacing) / 2;
    const kStart = Math.max(-half, Math.floor((rel_t - halfWidth) / spacing));
    const kEnd = Math.min(half, Math.ceil((rel_t + halfWidth) / spacing));

    for (let k = kStart; k <= kEnd; k++) {
      const centerPos = k * spacing;
      const dx = rel_t - centerPos;
      if (Math.abs(dx) > halfWidth) continue;

      const local = dx / halfWidth;
      const tooth = Math.sin((Math.PI * (local + 1)) / 2);
      
      let height;
      if (k === 0) {
        height = Math.max(1 * centerSpikeBoost, 1.05);
      } else {
        const centerHeight = Math.max(1 * centerSpikeBoost, 1.05);
        const effectiveFloor = Math.min(spikesLinear, 1, centerHeight);
        const decay = Math.exp(-Math.abs(k) * decayRate);
        height = effectiveFloor + (centerHeight - effectiveFloor) * decay;
      }
      val += height * tooth;
    }
    const env = Math.exp(-Math.pow(rel_t / envelopeWidth, 2));
    return val * env;
  };

  // 1. Calculate the theoretical maximum of the core signal (at clump center t_eff=0)
  // This accounts for the center spike + tails of adjacent spikes
  const theoreticalPeak = evaluate(0);

  // 2. Evaluate at current t_eff
  const rawSignal = evaluate(t_eff);

  // 3. Normalize so that peak is exactly peakLinear
  // If theoreticalPeak is 0 (shouldn't happen with boost > 1), fallback to 1
  return (rawSignal / (theoreticalPeak || 1)) * peakLinear;
};

export default calculateX;
