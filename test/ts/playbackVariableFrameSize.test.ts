import { getIqFrameAtOffset, getIqFrameTimestampAtOffset } from "@n-apt/capture/hooks/usePlaybackAnimation";

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

  it("reads per-frame capture timestamps while retaining legacy updates", () => {
    const updates = [
      { sample_offset: 0, timestamp_us: 1_000_000, kind: "Frame", frame_sequence: 0, patch: {} },
      { sample_offset: 0, timestamp_us: 1_000_000, patch: { fft_size: 4 } },
      { sample_offset: 8, timestamp_us: 1_100_000, kind: "Frame", frame_sequence: 1, patch: {} },
    ];

    expect(getIqFrameTimestampAtOffset(updates, 0)).toBe(1000);
    expect(getIqFrameTimestampAtOffset(updates, 8)).toBe(1100);
    expect(getIqFrameTimestampAtOffset(updates.slice(1), 0)).toBeNull();
  });
});
