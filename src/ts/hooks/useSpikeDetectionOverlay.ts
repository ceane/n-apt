import { useEffect, useMemo, useRef } from "react";
import {
  useWasmSimdMath,
  type SpectrumSpikeMarker,
} from "@n-apt/hooks/useWasmSimdMath";

export interface UseSpikeDetectionOverlayParams {
  waveform: Float32Array | Uint8Array | null | undefined;
  enabled: boolean;
  isDeviceConnected: boolean;
  fftMin: number;
  fftMax: number;
  frequencyRange: { min: number; max: number } | null;
  maxMarkers?: number;
}

export interface UseSpikeDetectionOverlayResult {
  spikeMarkers: SpectrumSpikeMarker[];
  showSpikes: boolean;
}

export function useSpikeDetectionOverlay({
  waveform,
  enabled,
  isDeviceConnected,
  fftMin,
  fftMax,
  frequencyRange,
  maxMarkers = 96,
}: UseSpikeDetectionOverlayParams): UseSpikeDetectionOverlayResult {
  const spikePersistenceRef = useRef<Float32Array | null>(null);
  const { detectProminentSpikes } = useWasmSimdMath({
    fftSize: 4096,
    enableSimd: true,
    fallbackToScalar: true,
  });

  useEffect(() => {
    if (!enabled) {
      spikePersistenceRef.current = null;
    }
  }, [enabled]);

  const spikeMarkers = useMemo(() => {
    if (!enabled || !isDeviceConnected || !waveform || waveform.length < 2) {
      return [];
    }

    const waveformData =
      waveform instanceof Uint8Array ? Float32Array.from(waveform) : waveform;

    const persistence =
      spikePersistenceRef.current &&
      spikePersistenceRef.current.length === waveformData.length
        ? spikePersistenceRef.current
        : (spikePersistenceRef.current = new Float32Array(waveformData.length));

    return detectProminentSpikes({
      spectrumData: waveformData,
      dbMin: fftMin,
      dbMax: fftMax,
      maxMarkers,
      frequencyRange: frequencyRange ?? undefined,
      temporalPersistence: persistence,
    });
  }, [
    enabled,
    isDeviceConnected,
    waveform,
    fftMin,
    fftMax,
    frequencyRange,
    maxMarkers,
    detectProminentSpikes,
  ]);

  return useMemo(
    () => ({ spikeMarkers, showSpikes: enabled && isDeviceConnected }),
    [spikeMarkers, enabled, isDeviceConnected],
  );
}
