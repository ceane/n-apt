/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useFrequencyScanner } from "@n-apt/spectrum/hooks/useFrequencyScanner";
import { useAudioExtraction } from "@n-apt/demodulation/hooks/useAudioExtraction";

describe("demod runtime handle stability", () => {
  it("keeps the scanner handle identity stable when its inputs do not change", () => {
    const { result, rerender } = renderHook(() =>
      useFrequencyScanner({
        windowSizeHz: 25_000,
        stepSizeHz: 10_000,
        audioThreshold: 0.3,
        sampleRate: 3_200_000,
        _fftSize: 32_768,
      }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("keeps the audio playback handle identity stable when its inputs do not change", () => {
    const { result, rerender } = renderHook(() =>
      useAudioExtraction({
        _targetSampleRate: 48_000,
        _bufferSize: 4_096,
        enableFiltering: true,
      }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
