import { act, renderHook } from "@testing-library/react";
import { usePausedSpectrumRecovery } from "@n-apt/spectrum/hooks/usePausedSpectrumRecovery";

describe("usePausedSpectrumRecovery", () => {
  it("rebuilds a missing waveform from the hydrated paused IQ snapshot", () => {
    const renderWaveformRef = { current: null as Float32Array | null };
    const spectrumOutputBufferRef = { current: null as Float32Array | null };
    let processCalls = 0;
    const { result } = renderHook(() =>
      usePausedSpectrumRecovery({
        enabled: true,
        isPaused: true,
        renderWaveformRef,
        spectrumOutputBufferRef,
        lastProcessedFrameRef: { current: null },
        pausedSnapshotRef: {
          current: {
            iqData: new Uint8Array([3, 4]),
            waterfall: null,
            waterfallDimensions: null,
          },
        },
        processIqToDbmSpectrum: (iqData) => {
          processCalls++;
          return new Float32Array([iqData[0] + iqData[1]]);
        },
        dbmOffset: 0,
        fftSize: 1024,
        fftWindow: "Rectangular",
        fallbackBinCount: 1024,
        fallbackDb: -120,
      }),
    );

    act(() => {
      expect(result.current.recoverPausedWaveform()).toBe(true);
    });

    expect(processCalls).toBe(1);
    expect(Array.from(renderWaveformRef.current ?? [])).toEqual([7]);
    expect(spectrumOutputBufferRef.current).not.toBe(renderWaveformRef.current);
    expect(Array.from(spectrumOutputBufferRef.current ?? [])).toEqual([7]);
  });

  it("preserves an already-rendered frozen waveform", () => {
    const frozen = new Float32Array([-42]);
    let processCalls = 0;
    const { result } = renderHook(() =>
      usePausedSpectrumRecovery({
        enabled: true,
        isPaused: true,
        renderWaveformRef: { current: frozen },
        spectrumOutputBufferRef: { current: null },
        lastProcessedFrameRef: { current: null },
        pausedSnapshotRef: { current: null },
        processIqToDbmSpectrum: () => {
          processCalls++;
          return new Float32Array([1]);
        },
        dbmOffset: 0,
        fftSize: 1024,
        fftWindow: "Rectangular",
        fallbackBinCount: 1024,
        fallbackDb: -120,
      }),
    );

    expect(result.current.recoverPausedWaveform()).toBe(true);
    expect(processCalls).toBe(0);
  });
});
