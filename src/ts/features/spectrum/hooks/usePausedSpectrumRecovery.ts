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
}

/**
 * Rebuilds a paused canvas waveform from real I/Q only.
 *
 * A synthesized all-floor waveform is indistinguishable from a genuinely dead
 * input, so this never invents one: when neither the retained frame nor the
 * pause snapshot supplies I/Q, it reports failure and leaves the waveform
 * empty. The caller then falls back to the placeholder / a fresh
 * `request_next_frame` instead of painting a fake flat spectrum.
 */
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
}: PausedSpectrumRecoveryOptions) {
  const recoverPausedWaveform = useCallback((): boolean => {
    if (!enabled || !isPaused) return false;

    const existing = renderWaveformRef.current;
    if (existing && existing.length > 0) return true;

    const iqData =
      lastProcessedFrameRef.current?.iq_data ??
      pausedSnapshotRef.current?.iqData ??
      null;
    if (!iqData || iqData.length < 2) return false;

    const restored = processIqToDbmSpectrum(
      iqData,
      dbmOffset,
      fftSize,
      fftWindow,
      spectrumOutputBufferRef.current ?? undefined,
    );
    if (restored.length === 0) return false;

    spectrumOutputBufferRef.current = restored;
    renderWaveformRef.current = new Float32Array(restored);
    return true;
  }, [
    dbmOffset,
    enabled,
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
