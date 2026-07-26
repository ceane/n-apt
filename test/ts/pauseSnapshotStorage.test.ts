import {
  readPauseSnapshot,
  writePauseSnapshot,
} from "@n-apt/hooks/pauseSnapshotStorage";

describe("pause snapshot storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips scoped IQ and waterfall snapshot data", () => {
    writePauseSnapshot("source-a", {
      iqData: new Uint8Array([1, 2, 3]),
      waterfall: new Uint8ClampedArray([4, 5, 6, 7]),
      waterfallDimensions: { width: 2, height: 2 },
    });

    expect(readPauseSnapshot("source-a")).toEqual({
      iqData: new Uint8Array([1, 2, 3]),
      waterfall: new Uint8ClampedArray([4, 5, 6, 7]),
      waterfallDimensions: { width: 2, height: 2 },
    });
  });

  it("returns an empty snapshot when persisted data is malformed", () => {
    sessionStorage.setItem("n-apt-fft-iq-snapshot:source-a", "not-base64");

    expect(readPauseSnapshot("source-a")).toEqual({
      iqData: null,
      waterfall: null,
      waterfallDimensions: null,
    });
  });
});
