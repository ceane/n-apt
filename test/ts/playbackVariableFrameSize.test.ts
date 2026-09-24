import { getIqFrameAtOffset } from "@n-apt/capture/hooks/usePlaybackAnimation";

describe("variable-size I/Q playback frames", () => {
  it("uses the FFT size effective at each sparse patch boundary", () => {
    const bytes = Uint8Array.from({ length: 24 }, (_, index) => index);
    const patches = [
      { sample_offset: 8, patch: { fft_size: 6 } },
    ];

    const first = getIqFrameAtOffset(bytes, 0, 4, patches);
    expect(first?.data).toEqual(bytes.slice(0, 8));
    expect(first?.nextOffset).toBe(8);
    expect(first?.fftSize).toBe(4);

    const second = getIqFrameAtOffset(bytes, first!.nextOffset, first!.fftSize, patches);
    expect(second?.data).toEqual(bytes.slice(8, 20));
    expect(second?.nextOffset).toBe(20);
    expect(second?.fftSize).toBe(6);
  });
});
