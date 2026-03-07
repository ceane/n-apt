export interface MockNAPTParams {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  floorAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
}

const calculateX = (t: number, params: MockNAPTParams) => {
  // Frequency comb with sine wave spikes and exponential height decay
  // over t ∈ [-1, 1], modulated by Gaussian envelope

  const {
    spikeCount,
    spikeWidth,
    centerSpikeBoost,
    floorAmplitude,
    decayRate,
    envelopeWidth,
  } = params;

  const N = spikeCount;
  const half = Math.floor((N - 1) / 2);

  // Uniform tooth spacing
  const spacing = 2 / (N - 1);

  // Tooth half-width as fraction of spacing
  const halfWidth = (spikeWidth * spacing) / 2;

  let y = 0;

  // Localized loop: only calculate spikes within the immediate vicinity of t
  const kStart = Math.max(-half, Math.floor((t - halfWidth) / spacing));
  const kEnd = Math.min(half, Math.ceil((t + halfWidth) / spacing));

  for (let k = kStart; k <= kEnd; k++) {
    const centerPos = k * spacing;
    const dx = t - centerPos;

    // Finite support check (refined by loop bounds but kept for safety)
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

export default calculateX;
