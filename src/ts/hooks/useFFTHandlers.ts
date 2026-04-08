import { useRef, useCallback } from "react";
import { useAppSelector } from "@n-apt/redux";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import type { FrequencyRange } from "@n-apt/consts/types";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
import { useSpectrumRenderer } from "@n-apt/hooks/useSpectrumRenderer";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";
import type { CanvasState } from "@n-apt/hooks/useCanvasState";
import type { VisualizationState } from "@n-apt/hooks/useVisualizationState";

export interface FFTHandlersState {
  // Processing refs
  waveformFloatRef: React.MutableRefObject<Float32Array | null>;
  renderWaveformRef: React.MutableRefObject<Float32Array | null>;
  lastProcessedDataRef: React.MutableRefObject<any>;
  lastRenderedPowerScaleRef: React.MutableRefObject<"dB" | "dBm" | null>;
  lastIncomingFrameRef: React.MutableRefObject<LiveFrameData | null>;
  liveGpuProcessInFlightRef: React.MutableRefObject<boolean>;

  // Processing buffers
  frameBufferRef: React.MutableRefObject<Float32Array[]>;
  fftAvgBufferRef: React.MutableRefObject<Float32Array | null>;
  fftProcessedBufferRef: React.MutableRefObject<Float32Array | null>;
  fftSmoothedBufferRef: React.MutableRefObject<Float32Array | null>;
  spikePersistenceRef: React.MutableRefObject<Float32Array | null>;
  spectrumResampleBufRef: React.MutableRefObject<Float32Array | null>;

  // Full channel snapshot data
  fullChannelWaveformRef: React.MutableRefObject<Float32Array | null>;
  fullChannelRangeRef: React.MutableRefObject<FrequencyRange | null>;

  // Rendering functions
  drawSpectrum: ReturnType<typeof useSpectrumRenderer>["drawSpectrum"];
  cleanupSpectrum: ReturnType<typeof useSpectrumRenderer>["cleanup"];
  processIqToDbmSpectrum: (iqData: Uint8Array, offsetDb: number, fftSize: number) => Float32Array;
  detectProminentSpikes: ReturnType<typeof useWasmSimdMath>["detectProminentSpikes"];

  // Utility functions
  clearOverlayCanvas: (canvas: HTMLCanvasElement | null) => void;
  drawLoadingPlaceholder: (canvas: HTMLCanvasElement | null, fontOverride?: string) => void;
  buildSnapshotData: () => any;
}

export interface FFTHandlersProps {
  dataRef: React.MutableRefObject<any>;
  fftSize?: number;
  fftWindow?: string;
  isPaused: boolean;
  displayTemporalResolution?: "low" | "medium" | "high";
  isDeviceConnected?: boolean;
  showSpikeOverlay?: boolean;
  awaitingDeviceData?: boolean;
  hardwareSampleRateHz?: number;
  isIqRecordingActive?: boolean;
  limitMarkers?: SdrLimitMarker[];
  canvasState: CanvasState;
  visualizationState: VisualizationState;
  webgpuEnabled: boolean;
  isInitializingWebGPU: boolean;
  webgpuDeviceRef: React.MutableRefObject<GPUDevice | null>;
  webgpuFormatRef: React.MutableRefObject<GPUTextureFormat | null>;
  gridOverlayRendererRef: React.MutableRefObject<any>;
  markersOverlayRendererRef: React.MutableRefObject<any>;
  spikesOverlayRendererRef: React.MutableRefObject<any>;
  overlayDirtyRef: React.MutableRefObject<any>;
}

const LOADING_PLACEHOLDER_TEXT = "Loading data from source...";
const LOADING_PLACEHOLDER_FONT = "24px 'JetBrains Mono', monospace";
const LOADING_PLACEHOLDER_COLOR = "#888888";
export const useFFTHandlers = ({
  dataRef: _dataRef,
  fftSize = 32768,
  fftWindow = "Rectangular",
  isPaused: _isPaused,
  displayTemporalResolution: _displayTemporalResolution = "medium",
  isDeviceConnected = true,
  showSpikeOverlay: _showSpikeOverlay,
  awaitingDeviceData: _awaitingDeviceData,
  hardwareSampleRateHz,
  isIqRecordingActive = false,
  limitMarkers: _limitMarkers,
  canvasState: _canvasState,
  visualizationState,
  webgpuEnabled: _webgpuEnabled,
  isInitializingWebGPU: _isInitializingWebGPU,
  webgpuDeviceRef: _webgpuDeviceRef,
  webgpuFormatRef: _webgpuFormatRef,
  gridOverlayRendererRef: _gridOverlayRendererRef,
  markersOverlayRendererRef: _markersOverlayRendererRef,
  spikesOverlayRendererRef: _spikesOverlayRendererRef,
  overlayDirtyRef: _overlayDirtyRef,
}: FFTHandlersProps): FFTHandlersState => {
  const {
    vizDbMinRef,
    vizDbMaxRef,
    frequencyRangeRef,
    centerFreqRef,
    // effectivePowerScale,
    // getZoomedData,
  } = visualizationState;

  // Redux state (for future use)
  useAppSelector((reduxState) => reduxState.theme.fftColor);
  useAppSelector((reduxState) => reduxState.spectrum.fftAvgEnabled);
  useAppSelector((reduxState) => reduxState.spectrum.fftSmoothEnabled);

  // const fillColor = useMemo(() => {
  //   if (fftColor.startsWith("#")) {
  //     return `${fftColor}33`; // 20% opacity
  //   }
  //   return fftColor;
  // }, [fftColor]);

  // Processing refs
  const waveformFloatRef = useRef<Float32Array | null>(null);
  const renderWaveformRef = useRef<Float32Array | null>(null);
  const lastProcessedDataRef = useRef<any>(null);
  const lastRenderedPowerScaleRef = useRef<"dB" | "dBm" | null>(null);
  const lastIncomingFrameRef = useRef<LiveFrameData | null>(null);
  const liveGpuProcessInFlightRef = useRef(false);

  // Processing buffers
  const frameBufferRef = useRef<Float32Array[]>([]);
  const fftAvgBufferRef = useRef<Float32Array | null>(null);
  const fftProcessedBufferRef = useRef<Float32Array | null>(null);
  const fftSmoothedBufferRef = useRef<Float32Array | null>(null);
  const spikePersistenceRef = useRef<Float32Array | null>(null);
  const spectrumResampleBufRef = useRef<Float32Array | null>(null);

  // Full channel snapshot data
  const fullChannelWaveformRef = useRef<Float32Array | null>(null);
  const fullChannelRangeRef = useRef<FrequencyRange | null>(null);

  // Initialize WASM SIMD for optimized data processing
  const {
    processIqToDbmSpectrum,
    detectProminentSpikes,
  } = useWasmSimdMath({
    fftSize: 4096,
    enableSimd: true,
    fallbackToScalar: true,
  });

  // Use the unified spectrum renderer
  const { drawSpectrum, cleanup: cleanupSpectrum } = useSpectrumRenderer();

  const clearOverlayCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const drawLoadingPlaceholder = useCallback(
    (canvas: HTMLCanvasElement | null, fontOverride?: string) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = canvas.width / dpr;
      const logicalHeight = canvas.height / dpr;
      ctx.save();
      ctx.font = fontOverride ?? LOADING_PLACEHOLDER_FONT;
      ctx.fillStyle = LOADING_PLACEHOLDER_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        LOADING_PLACEHOLDER_TEXT,
        logicalWidth / 2,
        logicalHeight / 2,
      );
      ctx.restore();
    },
    [],
  );

  const buildSnapshotData = useCallback(() => {
    const waveform = renderWaveformRef.current;
    const frequencyRangeCurrent = frequencyRangeRef.current;
    if (!waveform || waveform.length === 0 || !frequencyRangeCurrent) {
      return null;
    }

    return {
      waveform: new Float32Array(waveform),
      fullChannelWaveform: fullChannelWaveformRef.current
        ? new Float32Array(fullChannelWaveformRef.current)
        : null,
      frequencyRange: { ...frequencyRangeCurrent },
      dbMin: vizDbMinRef.current,
      dbMax: vizDbMaxRef.current,
      fftSize,
      fftWindow,
      centerFrequencyMHz: centerFreqRef.current,
      isDeviceConnected,
      vizZoom: visualizationState.vizZoomRef.current,
      vizPanOffset: visualizationState.vizPanOffsetRef.current,
      waterfallTextureSnapshot: null,
      waterfallTextureMeta: null,
      waterfallBuffer: null,
      waterfallDims: null,
      webgpuEnabled: _webgpuEnabled,
      hardwareSampleRateHz,
      isIqRecordingActive,
      colormap: [] as number[][],
    };
  }, [
    fftSize,
    fftWindow,
    centerFreqRef,
    hardwareSampleRateHz,
    isDeviceConnected,
    isIqRecordingActive,
    visualizationState,
    _webgpuEnabled,
    frequencyRangeRef,
    vizDbMinRef,
    vizDbMaxRef,
  ]);

  return {
    // Processing refs
    waveformFloatRef,
    renderWaveformRef,
    lastProcessedDataRef,
    lastRenderedPowerScaleRef,
    lastIncomingFrameRef,
    liveGpuProcessInFlightRef,

    // Processing buffers
    frameBufferRef,
    fftAvgBufferRef,
    fftProcessedBufferRef,
    fftSmoothedBufferRef,
    spikePersistenceRef,
    spectrumResampleBufRef,

    // Full channel snapshot data
    fullChannelWaveformRef,
    fullChannelRangeRef,

    // Rendering functions
    drawSpectrum,
    cleanupSpectrum,
    processIqToDbmSpectrum,
    detectProminentSpikes,

    // Utility functions
    clearOverlayCanvas,
    drawLoadingPlaceholder,
    buildSnapshotData,
  };
};
