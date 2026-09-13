import { renderHook } from "@testing-library/react";
import { useAudioDemodFM } from "@n-apt/demodulation/hooks/useAudioDemodFM";

describe("useAudioDemodFM", () => {
  it("keeps silence silent instead of normalizing it into full-scale audio", () => {
    const { result } = renderHook(() =>
      useAudioDemodFM({ targetSampleRate: 48000, bufferSize: 4096 }),
    );

    const silence = new Uint8Array(32);
    const audio = result.current.processIQData(silence, 3_200_000, 0);

    expect(audio).not.toBeNull();
    expect(audio?.every((sample) => sample === 0)).toBe(true);
  });
});
