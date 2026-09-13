import { createDemodProcessor } from "@n-apt/demodulation/utils/demodProcessors";

const FM_BROADCAST_DEVIATION_HZ = 75_000;

/**
 * Synthesize offset-binary IQ for a tone-modulated FM carrier at baseband.
 * The generator is stateful so successive chunks stay phase-continuous, which
 * is what the streaming demodulator assumes about live frames.
 */
const createFmToneSource = (
  sampleRateHz: number,
  toneHz: number,
  deviationHz = FM_BROADCAST_DEVIATION_HZ,
) => {
  let carrierPhase = 0;
  let tonePhase = 0;
  const toneStep = (2 * Math.PI * toneHz) / sampleRateHz;

  return (samples: number) => {
    const iq = new Uint8Array(samples * 2);
    for (let i = 0; i < samples; i++) {
      const instantaneousHz = deviationHz * Math.sin(tonePhase);
      carrierPhase += (2 * Math.PI * instantaneousHz) / sampleRateHz;
      tonePhase += toneStep;
      iq[i * 2] = 128 + Math.round(120 * Math.cos(carrierPhase));
      iq[i * 2 + 1] = 128 + Math.round(120 * Math.sin(carrierPhase));
    }
    return iq;
  };
};

const peakOf = (audio: Float32Array) => {
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  return peak;
};

const demodulateChunks = (
  sampleRateHz: number,
  chunkSamples: number,
  chunkCount: number,
  toneHz = 1_000,
) => {
  const processor = createDemodProcessor("fm", {
    targetSampleRate: 48_000,
    centerFrequency: 0,
    bandwidth: 200_000,
  });
  const nextChunk = createFmToneSource(sampleRateHz, toneHz);
  const chunks: Float32Array[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(processor.process(nextChunk(chunkSamples), sampleRateHz, 0));
  }
  return chunks;
};

describe("fm demod processor", () => {
  it("reaches near full scale for full broadcast deviation regardless of IQ sample rate", () => {
    // A 75 kHz-deviation broadcast signal should use most of the available
    // headroom whether the SDR streams at 256 kS/s or at 3.2 MS/s.
    const slow = demodulateChunks(256_000, 4_096, 12);
    const fast = demodulateChunks(3_200_000, 53_334, 12);

    const slowPeak = peakOf(slow[slow.length - 1]);
    const fastPeak = peakOf(fast[fast.length - 1]);

    expect(slowPeak).toBeGreaterThan(0.4);
    expect(fastPeak).toBeGreaterThan(0.4);
    expect(fastPeak / slowPeak).toBeGreaterThan(0.5);
    expect(fastPeak / slowPeak).toBeLessThan(2);
  });

  it("never emits NaN while resampling a long stream of frames", () => {
    const chunks = demodulateChunks(3_200_000, 4_096, 400);
    const nanCount = chunks.reduce(
      (total, chunk) =>
        total + chunk.reduce((n, sample) => n + (Number.isNaN(sample) ? 1 : 0), 0),
      0,
    );

    expect(nanCount).toBe(0);
  });

  it("does not punch a zero sample into the start of every frame", () => {
    // previousI/previousQ carry across frames, so the first sample of a frame
    // is a valid phase difference and must not be forced to silence.
    const chunks = demodulateChunks(256_000, 4_096, 6);
    const steadyState = chunks.slice(2);

    for (const chunk of steadyState) {
      const chunkPeak = peakOf(chunk);
      expect(Math.abs(chunk[0])).toBeGreaterThan(chunkPeak * 0.001);
    }
  });

  it("keeps output within the range Web Audio can represent", () => {
    const chunks = demodulateChunks(3_200_000, 53_334, 12);
    for (const chunk of chunks) {
      expect(peakOf(chunk)).toBeLessThanOrEqual(1);
    }
  });

  it("suppresses out-of-band noise instead of aliasing it into the audio band", () => {
    // A 40 kHz tone is above the 15 kHz audio band and above the 24 kHz output
    // Nyquist, so it must not reappear as a loud in-band artifact.
    const inBand = demodulateChunks(3_200_000, 53_334, 12, 1_000);
    const outOfBand = demodulateChunks(3_200_000, 53_334, 12, 40_000);

    const inBandPeak = peakOf(inBand[inBand.length - 1]);
    const aliasPeak = peakOf(outOfBand[outOfBand.length - 1]);

    expect(aliasPeak).toBeLessThan(inBandPeak * 0.1);
  });
});

describe("APT demod processor variants", () => {
  it("exposes distinct APTAudio and APTImage processor names", () => {
    const options = { targetSampleRate: 48_000 };
    const iq = new Uint8Array([128, 128, 128, 128]);

    expect(createDemodProcessor("aptAudio", options).process(iq, 3_200_000)).toBeInstanceOf(
      Float32Array,
    );
    expect(createDemodProcessor("aptImage", options).process(iq, 3_200_000)).toBeInstanceOf(
      Float32Array,
    );
  });
});

describe("fmDiscriminator demod processor", () => {
  it("exposes a distinct FM discriminator algorithm from broadcast FM", () => {
    const options = {
      targetSampleRate: 48_000,
      centerFrequency: 0,
      bandwidth: 200_000,
    };
    const nextChunk = createFmToneSource(3_200_000, 1_000);
    const iq = nextChunk(4_096);

    const discriminator = createDemodProcessor("fmDiscriminator", options);
    const broadcast = createDemodProcessor("fm", options);

    const discAudio = discriminator.process(iq, 3_200_000, 0);
    const fmAudio = broadcast.process(iq, 3_200_000, 0);

    expect(discAudio).toBeInstanceOf(Float32Array);
    expect(discAudio.length).toBeGreaterThan(0);
    expect(peakOf(discAudio)).toBeGreaterThan(0);
    // Discriminator skips broadcast de-emphasis / 75 kHz normalization, so
    // the same tone must not match the WFM full-scale path sample-for-sample.
    expect(peakOf(discAudio)).not.toBeCloseTo(peakOf(fmAudio), 3);
  });

  it("keeps discriminator output within Web Audio range", () => {
    const processor = createDemodProcessor("fmDiscriminator", {
      targetSampleRate: 48_000,
      centerFrequency: 0,
      bandwidth: 200_000,
    });
    const nextChunk = createFmToneSource(3_200_000, 1_000);
    for (let i = 0; i < 8; i++) {
      const audio = processor.process(nextChunk(8_192), 3_200_000, 0);
      expect(peakOf(audio)).toBeLessThanOrEqual(1);
    }
  });
});
