import { useEffect } from "react";

type MutableRef<T> = React.MutableRefObject<T>;
type OverlayDirtyState = { grid: boolean; markers: boolean; spikes: boolean };

export interface FftCanvasInvalidationOptions {
  displayTemporalResolution: string;
  previousTemporalResolutionRef: MutableRef<string>;
  pendingWaterfallRestoreRef: MutableRef<unknown>;
  pausedWaterfallRowRef: MutableRef<unknown>;
  restoredWaterfallRef: MutableRef<boolean>;
  waveformFloatRef: MutableRef<Float32Array | null>;
  renderWaveformRef: MutableRef<Float32Array | null>;
  dataRef: MutableRef<any>;
  lastProcessedDataRef: MutableRef<unknown>;
  lastProcessedFrameSignatureRef: MutableRef<unknown>;
  fftWindow: string | undefined;
  previousFftWindowRef: MutableRef<string | undefined>;
  invalidateSpectrumProcessingCaches: () => void;
  isPaused: boolean;
  forceRender: () => void;
  awaitingDeviceData: unknown;
  showSpikeOverlay: boolean;
  stableSpikeFloorDbmRef: MutableRef<number | null>;
  stableSpikeClassifierRef: MutableRef<unknown>;
  stableSpikeDecisionRef: MutableRef<boolean>;
  selectionRange: unknown;
  overlayDirtyRef: MutableRef<OverlayDirtyState>;
  deviceBackend: string | null | undefined;
  deviceName: string | null | undefined;
  deviceProfileKind: string | null | undefined;
  deviceIsRtlSdr: unknown;
  hardwareSampleRateHz: number | null | undefined;
  limitMarkers: unknown;
  markersOverlayRendererRef: MutableRef<{ destroy?: () => void } | null>;
  clearOverlayCanvas: (canvas: HTMLCanvasElement | null) => void;
  spectrumOverlayCanvas: HTMLCanvasElement | null;
}

/** Coordinates render invalidation and repaint scheduling for FFT presentation changes. */
export function useFftCanvasInvalidation({
  displayTemporalResolution,
  previousTemporalResolutionRef,
  pendingWaterfallRestoreRef,
  pausedWaterfallRowRef,
  restoredWaterfallRef,
  waveformFloatRef,
  renderWaveformRef,
  dataRef,
  lastProcessedDataRef,
  lastProcessedFrameSignatureRef,
  fftWindow,
  previousFftWindowRef,
  invalidateSpectrumProcessingCaches,
  isPaused,
  forceRender,
  awaitingDeviceData,
  showSpikeOverlay,
  stableSpikeFloorDbmRef,
  stableSpikeClassifierRef,
  stableSpikeDecisionRef,
  selectionRange,
  overlayDirtyRef,
  deviceBackend,
  deviceName,
  deviceProfileKind,
  deviceIsRtlSdr,
  hardwareSampleRateHz,
  limitMarkers,
  markersOverlayRendererRef,
  clearOverlayCanvas,
  spectrumOverlayCanvas,
}: FftCanvasInvalidationOptions): void {
  useEffect(() => {
    if (displayTemporalResolution === previousTemporalResolutionRef.current) {
      return;
    }
    previousTemporalResolutionRef.current = displayTemporalResolution;

    const hasPendingWaterfallRestore = !!pendingWaterfallRestoreRef.current;
    invalidateSpectrumProcessingCaches();
    if (!isPaused || !hasPendingWaterfallRestore) {
      pausedWaterfallRowRef.current = null;
      restoredWaterfallRef.current = false;
    }

    const waveform = waveformFloatRef.current;
    if (waveform && waveform.length > 0) {
      renderWaveformRef.current = new Float32Array(waveform);
    } else if (
      isPaused &&
      (dataRef.current?.iq_data ||
        dataRef.current?.waveform ||
        dataRef.current?.data)
    ) {
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
    }

    overlayDirtyRef.current.grid = true;
    overlayDirtyRef.current.markers = true;
    forceRender();
  }, [
    dataRef,
    displayTemporalResolution,
    forceRender,
    invalidateSpectrumProcessingCaches,
    isPaused,
    lastProcessedDataRef,
    lastProcessedFrameSignatureRef,
    overlayDirtyRef,
    pausedWaterfallRowRef,
    pendingWaterfallRestoreRef,
    previousTemporalResolutionRef,
    renderWaveformRef,
    restoredWaterfallRef,
    waveformFloatRef,
  ]);

  useEffect(() => {
    const currentFftWindow = fftWindow ?? "Rectangular";
    if (previousFftWindowRef.current === currentFftWindow) return;
    previousFftWindowRef.current = currentFftWindow;
    invalidateSpectrumProcessingCaches();
    overlayDirtyRef.current.grid = true;
    overlayDirtyRef.current.markers = true;
    forceRender();
  }, [
    fftWindow,
    forceRender,
    invalidateSpectrumProcessingCaches,
    overlayDirtyRef,
    previousFftWindowRef,
  ]);

  useEffect(() => {
    lastProcessedDataRef.current = null;
    lastProcessedFrameSignatureRef.current = null;
    if (isPaused) {
      forceRender();
    }
  }, [
    displayTemporalResolution,
    fftWindow,
    forceRender,
    isPaused,
    lastProcessedDataRef,
    lastProcessedFrameSignatureRef,
  ]);

  useEffect(() => {
    forceRender();
  }, [awaitingDeviceData, forceRender]);

  useEffect(() => {
    overlayDirtyRef.current.spikes = true;
    if (!showSpikeOverlay) {
      stableSpikeFloorDbmRef.current = null;
      stableSpikeClassifierRef.current = null;
      stableSpikeDecisionRef.current = false;
    }
    forceRender();
  }, [
    forceRender,
    overlayDirtyRef,
    showSpikeOverlay,
    stableSpikeClassifierRef,
    stableSpikeDecisionRef,
    stableSpikeFloorDbmRef,
  ]);

  useEffect(() => {
    overlayDirtyRef.current.markers = true;
    forceRender();
  }, [forceRender, overlayDirtyRef, selectionRange]);

  useEffect(() => {
    markersOverlayRendererRef.current?.destroy?.();
    overlayDirtyRef.current.grid = true;
    overlayDirtyRef.current.markers = true;
    clearOverlayCanvas(spectrumOverlayCanvas);
    forceRender();
  }, [
    clearOverlayCanvas,
    deviceBackend,
    deviceIsRtlSdr,
    deviceName,
    deviceProfileKind,
    forceRender,
    hardwareSampleRateHz,
    limitMarkers,
    markersOverlayRendererRef,
    overlayDirtyRef,
    spectrumOverlayCanvas,
  ]);
}
