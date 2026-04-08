import {
  createStitchSessionKey,
  getStitchSession,
  setStitchSession,
  clearStitchSession,
} from "@n-apt/utils/stitchSessionCache";

describe("stitchSessionCache", () => {
  const key = createStitchSessionKey({
    selectedFiles: [{ id: "abc", name: "capture.napt" }],
    settings: { gain: 12, ppm: 3 },
    fftSize: 2048,
  });

  afterEach(() => {
    clearStitchSession(key);
  });

  it("creates stable keys for the same file set regardless of order", () => {
    const a = createStitchSessionKey({
      selectedFiles: [
        { id: "b", name: "b.wav" },
        { id: "a", name: "a.wav" },
      ],
      settings: { gain: 1, ppm: 2 },
      fftSize: 1024,
    });
    const b = createStitchSessionKey({
      selectedFiles: [
        { id: "a", name: "a.wav" },
        { id: "b", name: "b.wav" },
      ],
      settings: { gain: 1, ppm: 2 },
      fftSize: 1024,
    });

    expect(a).toBe(b);
  });

  it("stores and retrieves stitched playback state", () => {
    setStitchSession(key, {
      hasStitchedData: true,
      frequencyRange: { min: 100, max: 101 },
      channelCount: 1,
      activeChannel: 0,
      hardwareSampleRateHz: 3200000,
      workerFileDataCache: [],
      workerFreqMap: [],
      workerMetadataMap: [],
      precomputedFrames: [{ waveform: [1, 2, 3] }],
      maxFrames: 1,
      allChannels: [],
      stitchStatus: "Processed Successfully",
    });

    expect(getStitchSession(key)).toEqual(
      expect.objectContaining({
        hasStitchedData: true,
        stitchStatus: "Processed Successfully",
      }),
    );
  });
});
