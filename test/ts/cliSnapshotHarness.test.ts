import * as SnapshotModel from "@n-apt/cli/snapshotModel";
import {
  parseCliGeolocationArg,
  resolveCliSnapshotDimensions,
  validateCliGeolocationArg,
} from "@n-apt/cli/snapshotPolicy";

const { buildCliSnapshotModel } = SnapshotModel;

describe("CLI snapshot harness", () => {
  test("requests history only for waterfalls and animated formats", () => {
    const resolveFrameCount = (
      SnapshotModel as typeof SnapshotModel & {
        resolveCliSnapshotFrameCount?: (options: {
          waterfall: boolean;
          format?: string;
        }) => number;
      }
    ).resolveCliSnapshotFrameCount;

    expect(resolveFrameCount?.({ waterfall: false })).toBe(1);
    expect(resolveFrameCount?.({ waterfall: false, format: "png" })).toBe(1);
    expect(resolveFrameCount?.({ waterfall: false, format: "svg" })).toBe(1);
    expect(resolveFrameCount?.({ waterfall: true })).toBe(64);
    expect(
      resolveFrameCount?.({ waterfall: false, format: "animated-svg" }),
    ).toBe(64);
    expect(resolveFrameCount?.({ waterfall: false, format: "webm" })).toBe(64);
    expect(resolveFrameCount?.({ waterfall: false, format: "mp4" })).toBe(64);
  });

  test("resolves aspect-ratio dimensions like the UI snapshot", () => {
    const base = {
      baseWidth: 1400,
      spectrumHeight: 520,
      waterfallHeight: 520,
      waterfall: true,
    };

    expect(resolveCliSnapshotDimensions({ ...base })).toEqual({
      width: 1400,
      height: 1040,
      spectrumHeight: 520,
      waterfallHeight: 520,
    });

    // 1400/1040 ≈ 1.35 is narrower than 16:9, so the frame widens.
    const wide = resolveCliSnapshotDimensions({
      ...base,
      aspectRatio: "16:9",
    });
    expect(wide.width).toBe(Math.round(1040 * (16 / 9)));
    expect(wide.height).toBe(1040);
    expect(wide.spectrumHeight).toBe(520);
    expect(wide.waterfallHeight).toBe(520);

    // 1400/1040 ≈ 1.35 is wider than 4:3, so the frame shortens.
    const tall = resolveCliSnapshotDimensions({ ...base, aspectRatio: "4:3" });
    expect(tall.height).toBe(Math.round(1400 / (4 / 3)));
    expect(tall.width).toBe(1400);
    expect(tall.height).toBe(tall.spectrumHeight + tall.waterfallHeight);

    // Without a waterfall the frame is wider than 16:9, so it shortens.
    const spectrumOnly = resolveCliSnapshotDimensions({
      baseWidth: 1400,
      spectrumHeight: 520,
      waterfallHeight: 520,
      waterfall: false,
      aspectRatio: "16:9",
    });
    expect(spectrumOnly.waterfallHeight).toBe(0);
    expect(spectrumOnly.width).toBe(1400);
    expect(spectrumOnly.spectrumHeight).toBe(Math.round(1400 / (16 / 9)));
  });

  test("validates and parses geolocation coordinates", () => {
    expect(validateCliGeolocationArg("37.7749, -122.4194")).toBeNull();
    expect(validateCliGeolocationArg("90,180")).toBeNull();
    expect(validateCliGeolocationArg("-90,-180")).toBeNull();
    expect(validateCliGeolocationArg("0,0")).toBeNull();
    expect(validateCliGeolocationArg("north,pole")).toContain("finite");
    expect(validateCliGeolocationArg("91,0")).toContain("latitude");
    expect(validateCliGeolocationArg("0,181")).toContain("longitude");
    expect(validateCliGeolocationArg("1,2,3")).toContain("'lat,lon'");
    expect(validateCliGeolocationArg("37.7749")).toContain("'lat,lon'");

    expect(parseCliGeolocationArg("37.7749, -122.4194")).toEqual({
      lat: "37.774900",
      lon: "-122.419400",
    });
  });

  test("converts a Rust IQ frame into spectrum and waterfall snapshot data", () => {
    const iq = new Uint8Array(2048);
    for (let index = 0; index < iq.length; index += 2) {
      iq[index] = 128 + Math.round(40 * Math.sin(index / 12));
      iq[index + 1] = 128 + Math.round(40 * Math.cos(index / 12));
    }

    const model = buildCliSnapshotModel(
      {
        iqData: iq,
        centerFrequencyHz: 1_618_000,
        sampleRateHz: 3_200_000,
      },
      { fftSize: 1024, waterfall: true, waterfallRows: 32 },
    );

    expect(model.waveform).toHaveLength(1024);
    expect(model.spectra).toHaveLength(1);
    expect(model.spectra[0]).toBe(model.waveform);
    expect(model.frequencyRange).toEqual({ min: 18_000, max: 3_218_000 });
    expect(model.waterfallDims).toEqual({ width: 1024, height: 32 });
    expect(model.waterfallBuffer).toHaveLength(1024 * 32 * 4);
  });

  test("exposes one spectrum per history frame, index-aligned", () => {
    const makeFrame = (amplitude: number) => {
      const iqData = new Uint8Array(2048);
      for (let index = 0; index < iqData.length; index += 2) {
        iqData[index] = 128 + Math.round(amplitude * Math.sin(index / 12));
        iqData[index + 1] = 128 + Math.round(amplitude * Math.cos(index / 12));
      }
      return { iqData, centerFrequencyHz: 1_618_000, sampleRateHz: 3_200_000 };
    };

    const model = buildCliSnapshotModel(
      [makeFrame(8), makeFrame(24), makeFrame(48)],
      { fftSize: 1024, waterfall: false },
    );

    expect(model.spectra).toHaveLength(3);
    expect(model.waveform).toBe(model.spectra[2]);
  });

  test("builds waterfall history from distinct Rust frames with newest first", () => {
    const makeFrame = (amplitude: number) => {
      const iqData = new Uint8Array(2048);
      for (let index = 0; index < iqData.length; index += 2) {
        iqData[index] = 128 + Math.round(amplitude * Math.sin(index / 12));
        iqData[index + 1] = 128 + Math.round(amplitude * Math.cos(index / 12));
      }
      return { iqData, centerFrequencyHz: 1_618_000, sampleRateHz: 3_200_000 };
    };

    const model = buildCliSnapshotModel(
      [makeFrame(8), makeFrame(24), makeFrame(48)],
      { fftSize: 1024, waterfall: true, waterfallRows: 3 },
    );

    expect(model.waterfallDims).toEqual({ width: 1024, height: 3 });
    const rows = [0, 1, 2].map((row) =>
      model.waterfallBuffer!.slice(row * 1024 * 4, (row + 1) * 1024 * 4),
    );
    expect(rows[0]).not.toEqual(rows[1]);
    expect(rows[1]).not.toEqual(rows[2]);
  });
});
