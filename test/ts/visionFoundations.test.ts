import {
  VISION_PRESETS,
  visionPairSchema,
} from "@n-apt/demodulation/vision/visionModel";
import {
  generateVisionReference,
  rgbToOpponent,
  opponentToRgb,
} from "@n-apt/demodulation/vision/visionReference";
import { VisionCaptureCoordinator } from "@n-apt/demodulation/vision/visionCapture";
import {
  partitionVisionPairs,
  fitVisionNormalization,
  normalizeVisionFeatures,
  evaluateVisionFrames,
} from "@n-apt/demodulation/vision/visionDataset";
import {
  saveVisionPair,
  loadVisionPair,
} from "@n-apt/demodulation/vision/visionStorage";

const config = {
  version: 1 as const,
  trialId: "trial-1",
  sessionId: "session-1",
  stimulus: { kind: "solid" as const, preset: "Red" as const },
  durationMs: 1000,
  display: {
    label: "Test display",
    width: 1920,
    height: 1080,
    devicePixelRatio: 1,
  },
  sourceId: "rx",
  streamEpoch: 1,
  optionsRevision: 2,
  centerFrequencyHz: 100e6,
  sampleRateHz: 3_200_000,
  clock: { backendMinusBrowserMs: 100, uncertaintyMs: 2 },
};
const frame = (sequence = 1, timestampMs = 1000) => ({
  sourceId: "rx",
  streamEpoch: 1,
  optionsRevision: 2,
  sequence,
  timestampMs,
  sampleStartIndex: (sequence - 1) * 320_000,
  sampleCount: 320_000,
  sampleRateHz: 3_200_000,
  centerFrequencyHz: 100e6,
  discontinuityBefore: false,
});
const artifact = {
  jobId: "ref_vision_1",
  filename: "capture.iq",
  checksum: "a".repeat(64),
};
const completedPair = () => {
  const capture = new VisionCaptureCoordinator(config);
  capture.observe(frame());
  capture.present(0, 950); // backend onset 1050; first capture frame already exists
  for (let i = 2; i <= 12; i++) capture.observe(frame(i, 1000 + (i - 1) * 100));
  return capture.finish(1950, artifact);
};

describe("vision references", () => {
  test("retains Red and produces reproducible spatial targets", () => {
    expect(VISION_PRESETS.Red).toEqual([255, 0, 0]);
    const stimulus = { kind: "calibration" as const, seed: 123 };
    const a = generateVisionReference(stimulus, 3);
    expect(a).toHaveLength(768);
    expect(a).toEqual(generateVisionReference(stimulus, 3));
    expect(a).not.toEqual(generateVisionReference(stimulus, 4));
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(() => generateVisionReference(stimulus, -1)).toThrow();
  });
  test.each([
    [0, 0, 0],
    [255, 255, 255],
    [102, 51, 255],
    [191, 255, 0],
  ])("RGB/opponent round trip %j", (...rgb) => {
    const result = opponentToRgb(rgbToOpponent(rgb));
    result.forEach((value, i) => expect(value).toBeCloseTo(rgb[i], 3));
  });
  test("rejects nonfinite or out-of-range color input", () => {
    expect(() => rgbToOpponent([NaN, 0, 0])).toThrow();
    expect(() => rgbToOpponent([256, 0, 0])).toThrow();
  });
});

describe("vision capture coordination", () => {
  test("labels actual onset, uses acquisition coverage, and snapshots configuration", () => {
    const pair = completedPair();
    expect(pair.timeline[0]).toEqual({ frameIndex: 0, onsetBackendMs: 1050 });
    expect(pair.endBackendMs).toBe(2050);
    expect(pair.status).toBe("complete");
    expect(pair.config.stimulus).toEqual({ kind: "solid", preset: "Red" });
    expect(visionPairSchema.parse(pair)).toEqual(pair);
    const changed = { ...config, stimulus: { ...config.stimulus } };
    const capture = new VisionCaptureCoordinator(changed);
    changed.stimulus.preset = "S" as "Red";
    capture.observe(frame());
    capture.present(0, 950);
    capture.interrupt("display-lost");
    expect(capture.finish(1000, artifact).config.stimulus).toEqual({
      kind: "solid",
      preset: "Red",
    });
  });
  test("requires fresh RF before presentation", () => {
    const capture = new VisionCaptureCoordinator(config);
    expect(() => capture.present(0, 950)).toThrow(/fresh/);
    capture.observe(frame());
    expect(() => capture.present(0, 2000)).toThrow(/fresh/);
  });
  test.each([
    { sequence: 3 },
    { sourceId: "other" },
    { streamEpoch: 2 },
    { optionsRevision: 3 },
    { sampleStartIndex: 1 },
    { timestampMs: 1200 },
    { discontinuityBefore: true },
    { sampleRateHz: 2_400_000 },
  ])("invalidates interrupted or changed acquisition %j", (change) => {
    const capture = new VisionCaptureCoordinator(config);
    capture.observe(frame());
    capture.present(0, 950);
    capture.observe({ ...frame(2, 1100), ...change });
    expect(capture.finish(1950, artifact).status).toBe("incomplete");
  });
  test("rejects insufficient coverage, timing uncertainty, missing calibration frames, and reuse", () => {
    const capture = new VisionCaptureCoordinator(config);
    capture.observe(frame());
    capture.present(0, 950);
    expect(capture.finish(1950, artifact).status).toBe("incomplete");
    expect(() => capture.observe(frame())).toThrow(/finished/);
    expect(
      () =>
        new VisionCaptureCoordinator({
          ...config,
          clock: { ...config.clock, uncertaintyMs: 26 },
        }),
    ).toThrow();
    const calibration = new VisionCaptureCoordinator({
      ...config,
      stimulus: { kind: "calibration", seed: 1 },
    });
    calibration.observe(frame());
    calibration.present(0, 950);
    for (let i = 2; i <= 12; i++)
      calibration.observe(frame(i, 1000 + (i - 1) * 100));
    expect(calibration.finish(1950, artifact).status).toBe("incomplete");
  });
});

describe("vision dataset boundaries", () => {
  test("explicit session assignments prevent trial and capture leakage", () => {
    const pair = completedPair();
    expect(
      partitionVisionPairs([pair], { "session-1": "train" }).train,
    ).toHaveLength(1);
    expect(() => partitionVisionPairs([pair], {})).toThrow(/assignment/);
    expect(() =>
      partitionVisionPairs(
        [
          pair,
          {
            ...pair,
            config: {
              ...pair.config,
              trialId: "trial-2",
              sessionId: "session-2",
            },
          },
        ],
        { "session-1": "train", "session-2": "test" },
      ),
    ).toThrow(/capture/);
    expect(() =>
      partitionVisionPairs(
        [{ ...pair, status: "incomplete", reasons: ["gap"] }],
        { "session-1": "train" },
      ),
    ).toThrow(/incomplete/);
  });
  test("normalization uses training rows only and rejects invalid shapes", () => {
    const stats = fitVisionNormalization([
      { split: "train", features: [1, 4] },
      { split: "train", features: [3, 4] },
      { split: "test", features: [999, 999] },
    ]);
    expect(stats.mean).toEqual([2, 4]);
    expect(normalizeVisionFeatures([2, 4], stats)).toEqual([0, 0]);
    expect(() => normalizeVisionFeatures([1], stats)).toThrow();
    expect(() =>
      fitVisionNormalization([{ split: "test", features: [1] }]),
    ).toThrow();
  });
  test("evaluation separates model error from fixed training-derived baseline", () => {
    const reference = Array(768).fill(0.5);
    const metrics = evaluateVisionFrames(
      [{ expected: reference, predicted: reference }],
      Array(768).fill(0),
    );
    expect(metrics.modelMse).toBe(0);
    expect(metrics.baselineMse).toBe(0.25);
    expect(metrics.frameCount).toBe(1);
    expect(() => evaluateVisionFrames([], reference)).toThrow();
  });
});

describe("vision server persistence client", () => {
  test("round-trips validated references without I/Q or credentials in the body", async () => {
    const pair = completedPair();
    const fetcher = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => pair });
    await saveVisionPair(pair, "test-session", fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("/api/vision/references/trial-1");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(pair);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-session",
    );
    expect(await loadVisionPair("trial-1", "test-session", fetcher)).toEqual(
      pair,
    );
  });
  test("fails closed on server error and malformed loaded data", async () => {
    await expect(
      saveVisionPair(
        completedPair(),
        "test-session",
        jest.fn().mockResolvedValue({ ok: false, status: 503 }),
      ),
    ).rejects.toThrow(/503/);
    await expect(
      loadVisionPair(
        "trial-1",
        "test-session",
        jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
      ),
    ).rejects.toThrow();
  });
});

describe("reference target alignment", () => {
  test("excludes onset/end uncertainty and returns generated ground truth only inside coverage", () => {
    const pair = completedPair();
    const {
      visionTargetAt,
    } = require("@n-apt/demodulation/vision/visionReference");
    expect(visionTargetAt(pair, 1050)).toBeNull();
    expect(visionTargetAt(pair, 1040)).toBeNull();
    expect(visionTargetAt(pair, 2050)).toBeNull();
    expect(visionTargetAt(pair, 1500)).toEqual(
      generateVisionReference(config.stimulus, 0),
    );
  });
  test("rejects inconsistent sample count even when wall-clock coverage appears complete", () => {
    const pair = completedPair();
    expect(
      visionPairSchema.safeParse({
        ...pair,
        acquisition: { ...pair.acquisition, sampleCount: 1 },
      }).success,
    ).toBe(false);
  });
});

test("calibration evaluation cannot reuse a training pattern seed in another split", () => {
  const pair = completedPair();
  const spatial = {
    ...pair,
    config: {
      ...pair.config,
      durationMs: 100,
      stimulus: { kind: "calibration" as const, seed: 9 },
    },
    endBackendMs: 1150,
  };
  const other = {
    ...spatial,
    config: {
      ...spatial.config,
      sessionId: "held-out",
      trialId: "held-out-trial",
    },
    artifact: { ...artifact, jobId: "ref_vision_2", checksum: "b".repeat(64) },
  };
  expect(() =>
    partitionVisionPairs([spatial, other], {
      "session-1": "train",
      "held-out": "test",
    }),
  ).toThrow(/seed/);
});

test("storage requires an explicit session token before making a request", async () => {
  const fetcher = jest.fn();
  await expect(saveVisionPair(completedPair(), "", fetcher)).rejects.toThrow(
    /session/,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
