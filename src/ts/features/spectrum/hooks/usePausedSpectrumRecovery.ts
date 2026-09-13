import { useCallback } from "react";
import type { PauseSnapshot } from "@n-apt/capture/public/pauseSnapshotStorage";

type IqFrame = { iq_data?: Uint8Array | null };

export interface PausedSpectrumRecoveryOptions {
  enabled: boolean;
  isPaused: boolean;
  renderWaveformRef: React.MutableRefObject<Float32Array | null>;
  spectrumOutputBufferRef: React.MutableRefObject<Float32Array | null>;
  lastProcessedFrameRef: React.MutableRefObject<IqFrame | null>;
  pausedSnapshotRef: React.MutableRefObject<PauseSnapshot | null>;
  processIqToDbmSpectrum: (
    iqData: Uint8Array,
    dbmOffset: number,
    fftSize: number,
    fftWindow: string | undefined,
    outputBuffer?: Float32Array,
  ) => Float32Array;
  dbmOffset: number;
  fftSize: number;
  fftWindow: string | undefined;
  fallbackBinCount: number;
  fallbackDb: number;
}

/** Ensures paused rendering has a waveform without reading persistent storage. */
export function usePausedSpectrumRecovery({
  enabled,
  isPaused,
  renderWaveformRef,
  spectrumOutputBufferRef,
  lastProcessedFrameRef,
  pausedSnapshotRef,
  processIqToDbmSpectrum,
  dbmOffset,
  fftSize,
  fftWindow,
  fallbackBinCount,
  fallbackDb,
}: PausedSpectrumRecoveryOptions) {
  const recoverPausedWaveform = useCallback((): boolean => {
    if (!enabled || !isPaused) return false;

    const existing = renderWaveformRef.current;
    if (existing && existing.length > 0) return true;

    const iqData =
      lastProcessedFrameRef.current?.iq_data ??
      pausedSnapshotRef.current?.iqData ??
      null;
    if (iqData && iqData.length >= 2) {
      const restored = processIqToDbmSpectrum(
        iqData,
        dbmOffset,
        fftSize,
        fftWindow,
        spectrumOutputBufferRef.current ?? undefined,
      );
      if (restored.length > 0) {
        spectrumOutputBufferRef.current = restored;
        renderWaveformRef.current = new Float32Array(restored);
        return true;
      }
    }

    renderWaveformRef.current = new Float32Array(fallbackBinCount).fill(
      fallbackDb,
    );
    return true;
  }, [
    dbmOffset,
    enabled,
    fallbackBinCount,
    fallbackDb,
    fftSize,
    fftWindow,
    isPaused,
    lastProcessedFrameRef,
    pausedSnapshotRef,
    processIqToDbmSpectrum,
    renderWaveformRef,
    spectrumOutputBufferRef,
  ]);

  return { recoverPausedWaveform };
}
