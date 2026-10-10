import {
  VISION_PREPROCESSING,
  VISION_PRESETS,
} from "@n-apt/demodulation/vision/visionModel";
import {
  preprocessVisionIqContext,
  VISION_FEATURE_COUNT,
} from "@n-apt/demodulation/vision/visionPreprocessing";
import { buildVisionTrainingDataset } from "@n-apt/demodulation/vision/visionDataset";

const sampleRateHz = 3_200_000;
const contextSamples = (sampleRateHz * VISION_PREPROCESSING.contextMs) / 1000;
const checksum = "a".repeat(64);
const pair = {
  version: 1 as const,
  config: {
    version: 1 as const,
    trialId: "trial-1",
    sessionId: "session-1",
    stimulus: { kind: "solid" as const, preset: "M" as const },
    durationMs: 1000,
    display: {
      label: "test monitor",
      width: 1920,
      height: 1080,
      devicePixelRatio: 1,
    },
    sourceId: "rx-1",
    streamEpoch: 4,
    optionsRevision: 2,
    centerFrequencyHz: 100_000_000,
    sampleRateHz,
    clock: { backendMinusBrowserMs: 100, uncertaintyMs: 2 },
  },
  artifact: { jobId: "job-1", filename: "capture.napt", checksum },
  status: "complete" as const,
  reasons: [],
  timeline: [{ frameIndex: 0, onsetBackendMs: 1000 }],
  endBackendMs: 2000,
  acquisition: {
    startBackendMs: 900,
    endBackendMs: 2050,
    firstSampleIndex: 1_000_000,
    sampleCount: (sampleRateHz * 1150) / 1000,
  },
};
const features = new Float32Array(VISION_FEATURE_COUNT).fill(0.25);
const featureSample = {
  trialId: "trial-1",
  artifactChecksum: checksum,
  sourceId: "rx-1",
  streamEpoch: 4,
  optionsRevision: 2,
  centerFrequencyHz: 100_000_000,
  sampleRateHz,
  firstSampleIndex:
    pair.acquisition.firstSampleIndex + (sampleRateHz * 130) / 1000,
  timestampBackendMs: 1060,
  features,
};

describe("vision preprocessing and paired reference dataset", () => {
  test("extracts deterministic FFT-shifted power and phase bins from contiguous I/Q", () => {
    const iq = new Uint8Array(contextSamples * 2);
    for (let sample = 0; sample < contextSamples; sample++) {
      const phase = (2 * Math.PI * 17 * sample) / VISION_PREPROCESSING.fftSize;
      iq[sample * 2] = Math.round(128 + 60 * Math.cos(phase));
      iq[sample * 2 + 1] = Math.round(128 + 60 * Math.sin(phase));
    }

    const first = preprocessVisionIqContext(iq, sampleRateHz);
    const second = preprocessVisionIqContext(iq, sampleRateHz);
    const index = (slice: number, bin: number, channel: number) =>
      (slice * 1024 + bin) * 2 + channel;
    expect(first).toHaveLength(VISION_FEATURE_COUNT);
    expect(second).toEqual(first);
    expect(first[index(4, 529, 0)]).toBeGreaterThan(first[index(4, 512, 0)]);
    expect(Math.abs(first[index(4, 529, 1)])).toBeGreaterThan(2.5);
    expect(first.every(Number.isFinite)).toBe(true);
  });

  test("rejects unsupported rates and incomplete I/Q contexts", () => {
    expect(() =>
      preprocessVisionIqContext(new Uint8Array(128), sampleRateHz),
    ).toThrow(/30 ms/i);
    expect(() =>
      preprocessVisionIqContext(
        new Uint8Array(contextSamples * 2 + 1),
        sampleRateHz,
      ),
    ).toThrow(/complete I\/Q/i);
    expect(() =>
      preprocessVisionIqContext(new Uint8Array(128), 2_400_000),
    ).toThrow(/sample rate/i);
  });

  test("pairs preprocessed bins to automatic RGB and opponent labels from the exact capture", () => {
    const result = buildVisionTrainingDataset([pair], [featureSample], {
      "session-1": "train",
    });
    expect(result.train).toHaveLength(1);
    expect(result.train[0].artifactChecksum).toBe(checksum);
    expect(result.train[0].rgb).toEqual(
      new Uint8Array(Array(256).fill(VISION_PRESETS.M).flat()),
    );
    expect(result.train[0].opponent).toHaveLength(768);
    expect(result.train[0].colorClassIndex).toBe(1);
    expect(result.excludedTransitionCount).toBe(0);
  });

  test("rejects capture identity, settings, sample-range, and incomplete-reference mismatches", () => {
    expect(() =>
      buildVisionTrainingDataset(
        [pair],
        [{ ...featureSample, artifactChecksum: "b".repeat(64) }],
        { "session-1": "train" },
      ),
    ).toThrow(/artifact/i);
    expect(() =>
      buildVisionTrainingDataset(
        [pair],
        [{ ...featureSample, optionsRevision: 3 }],
        { "session-1": "train" },
      ),
    ).toThrow(/options/i);
    expect(() =>
      buildVisionTrainingDataset(
        [pair],
        [{ ...featureSample, firstSampleIndex: 0 }],
        { "session-1": "train" },
      ),
    ).toThrow(/sample range/i);
    expect(() =>
      buildVisionTrainingDataset(
        [{ ...pair, status: "incomplete", reasons: ["gap"] }],
        [featureSample],
        { "session-1": "train" },
      ),
    ).toThrow(/incomplete/i);
  });
});
