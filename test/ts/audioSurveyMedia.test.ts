import { resampleDecodedAudioToMonoPcm } from "@n-apt/demodulation/survey/audioSurveyMedia";

describe("local media audio conversion", () => {
  it("converts multi-channel decoded media to mono 48 kHz PCM", () => {
    const pcm = resampleDecodedAudioToMonoPcm({
      sampleRate: 24_000,
      length: 4,
      numberOfChannels: 2,
      getChannelData(channel) {
        return channel === 0
          ? Float32Array.of(0, 1, 0, -1)
          : Float32Array.of(0, -1, 0, 1);
      },
    });

    expect(pcm).toHaveLength(8);
    expect(Array.from(pcm)).toEqual(Array(8).fill(0));
  });

  it("resamples mono PCM to the requested model rate and preserves finite samples", () => {
    const pcm = resampleDecodedAudioToMonoPcm(
      {
        sampleRate: 48_000,
        length: 4,
        numberOfChannels: 1,
        getChannelData: () => Float32Array.of(-1, -0.5, 0.5, 1),
      },
      24_000,
    );

    expect(pcm).toHaveLength(2);
    expect(Array.from(pcm)).toEqual([-1, 0.5]);
    expect(Array.from(pcm).every(Number.isFinite)).toBe(true);
  });
});
