import { buildPlaybackSeedFrame } from "../../src/ts/utils/playbackSeedFrame";

describe("buildPlaybackSeedFrame", () => {
  it("uses the first precomputed FFT frame in fft mode", () => {
    const frame = { waveform: new Float32Array([1, 2, 3]) };

    expect(
      buildPlaybackSeedFrame({
        displayMode: "fft",
        precomputedFrames: [frame],
        channelData: null,
      }),
    ).toBe(frame);
  });

  it("builds the first IQ chunk in iq mode", () => {
    const iqData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(
      buildPlaybackSeedFrame({
        displayMode: "iq",
        precomputedFrames: [],
        channelData: {
          iq_data: iqData,
          bins_per_frame: 2,
        },
      }),
    ).toEqual({
      type: "spectrum",
      center_frequency_hz: undefined,
      sample_rate: undefined,
      iq_data: new Uint8Array([1, 2, 3, 4]),
      data_type: "iq_raw",
    });
  });

  it("prefers the stitched playback frame over a raw IQ chunk in iq mode", () => {
    const stitchedFrame = {
      waveform: new Float32Array([-80, -60, -40]),
    };

    const iqData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(
      buildPlaybackSeedFrame({
        displayMode: "iq",
        precomputedFrames: [stitchedFrame],
        channelData: {
          is_mock_apt: true,
          iq_data: iqData,
          bins_per_frame: 2,
        },
      }),
    ).toBe(stitchedFrame);
  });
});
