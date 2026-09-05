import { buildCliSnapshotModel } from "@n-apt/cli/snapshotModel";

describe("CLI snapshot harness", () => {
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
    expect(model.frequencyRange).toEqual({ min: 18_000, max: 3_218_000 });
    expect(model.waterfallDims).toEqual({ width: 1024, height: 32 });
    expect(model.waterfallBuffer).toHaveLength(1024 * 32 * 4);
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
