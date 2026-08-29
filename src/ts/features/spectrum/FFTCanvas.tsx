import {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  memo,
  Suspense,
  type ReactNode,
} from "react";
import styled, { keyframes } from "styled-components";
import { Lock, Unlock, Zap } from "lucide-react";
import { useFftRenderCoordinator } from "@n-apt/spectrum/hooks/useFftRenderCoordinator";
import {
  formatLiveCanvasStatusRow,
  type LiveCanvasStatusRow,
} from "@n-apt/spectrum/hooks/useDraw2DFFTSignal";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";
import { usePauseLogic } from "@n-apt/spectrum/hooks/usePauseLogic";
import { usePausedSpectrumRecovery } from "@n-apt/spectrum/hooks/usePausedSpectrumRecovery";
import { useFftCanvasInvalidation } from "@n-apt/spectrum/hooks/useFftCanvasInvalidation";
import { useSpectrumRenderer } from "@n-apt/spectrum/hooks/useSpectrumRenderer";
import { RESAMPLE_WGSL } from "@n-apt/shaders";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/spectrum/hooks/useDrawWebGPUFIFOWaterfall";
import {
  useSpectrumInteraction,
  type CanvasTxSliderState,
} from "@n-apt/spectrum/hooks/useFrequencyDrag";
import { useWebGPULifecycle } from "@n-apt/spectrum/hooks/useWebGPUInit";
import { useSpectrumMath } from "@n-apt/spectrum/hooks/useWasmSimdMath";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { VISUALIZER_MAX_ZOOM } from "@n-apt/consts/visualizerControls";
import {
  setGpuSpikeCount,
  setGpuSpikeAnalysis,
  setTxCenterFrequencyHz,
  setTxSampleRateHz,
} from "@n-apt/redux/slices/spectrumSlice";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import CanvasPlaceholder, {
  type CanvasPlaceholderState,
} from "@n-apt/ui/CanvasPlaceholder";
import type { DeviceProfile } from "@n-apt/consts/schemas/websocket";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import type { Alignment, FrequencyRange } from "@n-apt/consts/types";
import type { FFTCanvasWaterfallBindings } from "@n-apt/types/canvas";
import type { SdrLimitMarker } from "@n-apt/math/sdrLimitMarkers";
import {
  isRtlSdrDevice,
  resolveRenderableFrequencyRange,
} from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";
import {
  subscribeFrameArrivals,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  createDeviceOptionScheduler,
  type DeviceOptionScheduler,
} from "@n-apt/app/infrastructure/streams/deviceOptionScheduler";
// New hooks
import { useCanvasNodes } from "@n-apt/spectrum/hooks/useCanvasState";
import { useWaterfallBuffers } from "@n-apt/spectrum/hooks/useWaterfallBufferPool";
import { getTemporalResolutionWindow } from "@n-apt/math/temporalResolution";
import { presentSpikeAnalysis } from "@n-apt/spectrum/fft/spikeAnalysisPresentation";
import type { SpikeAnalysis } from "@n-apt/spectrum/hooks/useDrawWebGPUFFTSignal";
import type { PauseSnapshot } from "@n-apt/capture/public/pauseSnapshotStorage";
import {
  accumulateFullChannelWaveform,
  FULL_CHANNEL_BINS,
  newestIqWindow,
  prepareSpectrumRenderData,
  resolveLiveSpectrumPaintContract,
  resolveFrameTemporalWindow,
  resolveSpectrumWaveform,
  shouldAdoptLiveFrameRange,
  shouldClearSpectrumWaveformForRangeChange,
  updateTemporalWaveform,
} from "@n-apt/spectrum/fft/frameProcessing";
export { invertSpectrumVertically } from "@n-apt/spectrum/fft/frameProcessing";
// spectrumToAmplitude removed — dB normalisation now handled in the waterfall WGSL shader
import {
  VISUALIZER_GAP,
  SECTION_TITLE_COLOR,
  SECTION_TITLE_AFTER_COLOR,
  FFT_MIN_DB,
  FFT_MAX_DB,
} from "@n-apt/consts";
import { FFT_AREA_MIN } from "@n-apt/consts";
import type {
  FFTVisualizerMachine,
  FFTVisualizerSnapshot,
} from "@n-apt/app/infrastructure/visualization/fftVisualizerMachine";
import {
  resolvePendingWaterfallRestore,
  type PendingWaterfallRestore,
} from "@n-apt/spectrum/utils/waterfallRestore";
import { shouldAppendWaterfallFrame } from "@n-apt/spectrum/utils/waterfallMotion";
import {
  copyValidWaterfallRow,
  resolveWaterfallDisplayRow,
} from "@n-apt/spectrum/utils/waterfallRows";
import {
  flushWebGpuPresentation,
  flushWebGpuPresentationMultiple,
  shouldClearWebGpuForPlaceholder,
  getInitialHandledWebGpuResetEpoch,
  resetWebGpuStreamTemporalHistory,
  shouldCommitSourcePresentationReset,
  shouldPreserveWaterfallOnTxStandby,
  shouldRestoreWebGpuStreamState,
} from "@n-apt/app/infrastructure/visualization/webgpuStreamReset";
import { formatFrequency, roundDbValue } from "@n-apt/math/frequency";
import { findBestFrequencyRange } from "@n-apt/consts";
import { Vfo } from "@n-apt/layout/vfo/Vfo";
import { getFrontendFftSize } from "@n-apt/spectrum/utils/frontendFftSize";
import { computeHackrfApproxDbmOffsetDb } from "@n-apt/spectrum/utils/hackrfCalibration";
import {
  TX_SLIDER_ROW_HEIGHT,
  useOverlayRenderer,
  type DemodFocusOverlay,
} from "@n-apt/spectrum/hooks/useOverlayRenderer";
import { useResolvedThemeMode } from "@n-apt/ui/Theme";
import { createFFTZoomProcessor } from "@n-apt/spectrum/utils/rendering/fftZoom";
import { type LiveSourcePresentationPolicy } from "@n-apt/spectrum/hooks/liveSourceLifecycle";
import {
  resolveFramePresentation,
  selectFrameForPresentation,
} from "@n-apt/spectrum/fft/framePresentation";
import { removeDcSpikeFromSpectrum } from "@n-apt/spectrum/utils/removeDcSpike";
import {
  displayRangeNeedsBasebandMirror,
  resolveDisplayRangeForPanOffset,
} from "@n-apt/math/basebandMirror";

export const createVizPanScheduler = (
  publish: (pan: number) => void,
): DeviceOptionScheduler<number> =>
  createDeviceOptionScheduler<number>({
    publish,
    intervalMs: 50,
    idleFlushMs: 80,
    // Visual pan is ref-driven during the gesture. Defer Redux until cadence
    // or idle flush so a trackpad burst does not re-render the route every tick.
    leadingPublish: false,
  });

export const resolveMirrorPanPropSync = ({
  pendingPublish,
  incomingPan,
  lastPublishedPan,
}: {
  pendingPublish: boolean;
  incomingPan: number;
  lastPublishedPan: number;
}): { applyIncomingPan: boolean; clearPendingPublish: boolean } => {
  if (incomingPan === lastPublishedPan) {
    return { applyIncomingPan: true, clearPendingPublish: true };
  }
  if (pendingPublish) {
    return { applyIncomingPan: false, clearPendingPublish: false };
  }
  return { applyIncomingPan: true, clearPendingPublish: false };
};

type FrameRenderRangeInput = {
  currentFrame: Pick<LiveFrameData, "center_frequency_hz" | "sample_rate">;
  requestedRange: FrequencyRange;
  propsCenterFrequencyHz: number;
  propsHardwareSampleRateHz?: number | null;
  preferRequestedRange?: boolean;
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
};

const EMPTY_FLOAT32_ARRAY = new Float32Array(0);
const WATERFALL_BIN_COUNT = 4096;

const isMockTxIdentity = ({
  deviceKind,
  backend,
  deviceName,
}: {
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
}) => {
  const normalizedKind = deviceKind?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedBackend = backend?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedName = deviceName?.toLowerCase?.() ?? "";
  return (
    normalizedKind === "mock-tx" ||
    normalizedBackend === "mock-tx" ||
    normalizedName.includes("mock tx")
  );
};

const resolveTxSignalDisplayLabel = (signal: string) => {
  switch (signal) {
    case "d":
      return "D";
    case "wifi":
      return "Mock WiFi";
    case "d_sharp":
      return "D#";
    case "5g":
      return "Mock 5G";
    default:
      return signal.toUpperCase();
  }
};

const isMockAptIdentity = ({
  deviceKind,
  backend,
  deviceName,
}: {
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
}) => {
  const normalizedKind = deviceKind?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedBackend = backend?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedName = deviceName?.toLowerCase?.() ?? "";
  return (
    normalizedKind === "mock-apt" ||
    normalizedBackend === "mock-apt" ||
    normalizedName.includes("mock apt")
  );
};

/**
 * Full-channel accumulation is only needed for hardware that delivers a
 * channel through multiple tuned hops. Mock sources synthesize the requested
 * range directly; accumulating their changing preview windows causes old Tx
 * sample-rate windows to stack into the new one.
 */
export const shouldAccumulateFullChannelWaveform = ({
  isRtlSdr,
  deviceKind,
  backend,
  deviceName,
}: {
  isRtlSdr?: boolean | null;
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
}): boolean =>
  !isRtlSdr &&
  !isMockAptIdentity({ deviceKind, backend, deviceName }) &&
  !isMockTxIdentity({ deviceKind, backend, deviceName });

export const resolveTxModeDeviceName = (
  sources: Array<{ status: string | null; name?: string | null }>,
  deviceName: string | null | undefined,
  canTransmit: boolean,
  isStandby: boolean,
): string | null => {
  const transmittingSource = sources.find(
    (item) => item.status === "transmitting",
  );
  if (transmittingSource?.name?.trim()) {
    return transmittingSource.name.trim();
  }

  if (isStandby && canTransmit) {
    return deviceName?.trim() || null;
  }

  return null;
};

/** True only when a blocking placeholder has entered a new visual state. */
export const shouldClearBlockingPlaceholder = (
  previousKind: number,
  nextKind: number,
): boolean => nextKind !== 0 && previousKind !== nextKind;

/** A paused one-shot frame is still newly processed data for downstream
 * source-bound views, even though it did not arrive through the play loop. */
export const shouldPublishProcessedSpectrumFrame = ({
  hasNewData,
  shouldReprocessCurrentFrame,
  processedCurrentFrame,
}: {
  hasNewData: boolean;
  shouldReprocessCurrentFrame: boolean;
  processedCurrentFrame: boolean;
}): boolean =>
  processedCurrentFrame || hasNewData || shouldReprocessCurrentFrame;

/**
 * Mirror-on already redrew from the cached FFT when pan moved without a new
 * IQ frame. Mirror-off was left on the "wait for the next radio frame" path,
 * which froze the VFO until the retune landed. Viewport geometry changes
 * (pan, zoom, or a same-span retune) must repaint from cache on both paths.
 */
export const shouldRepaintCachedSpectrumForViewportChange = ({
  hasNewData,
  shouldReprocessCurrentFrame,
  hasCachedWaveform,
  zoomChanged,
  panChanged,
  rangeChanged = false,
}: {
  hasNewData: boolean;
  shouldReprocessCurrentFrame: boolean;
  hasCachedWaveform: boolean;
  zoomChanged: boolean;
  panChanged: boolean;
  rangeChanged?: boolean;
}): boolean =>
  !hasNewData &&
  !shouldReprocessCurrentFrame &&
  hasCachedWaveform &&
  (zoomChanged || panChanged || rangeChanged);

/**
 * Mirror-on can repaint from the resident FFT when only pan moved. Without
 * this branch the live loop waits for a matching retune frame and the VFO
 * freezes until the radio catches up.
 */
export const shouldMirrorPanOnlyRedraw = ({
  allowNegativeFrequencies,
  hasNewData,
  shouldReprocessCurrentFrame,
  hasCachedWaveform,
  lastPaintedMirrorPan,
  currentMirrorPan,
}: {
  allowNegativeFrequencies: boolean;
  hasNewData: boolean;
  shouldReprocessCurrentFrame: boolean;
  hasCachedWaveform: boolean;
  lastPaintedMirrorPan: number;
  currentMirrorPan: number;
}): boolean =>
  allowNegativeFrequencies &&
  !hasNewData &&
  !shouldReprocessCurrentFrame &&
  hasCachedWaveform &&
  lastPaintedMirrorPan !== currentMirrorPan;

/**
 * GPU |f| fold must follow the mirror setting, not whether this frame's
 * display.min has crossed 0 Hz. Arming it only after the viewport dips
 * below DC floors the new negative sliver, then fills it in — a snap and a
 * wipe around 0 Hz.
 */
export const shouldEnableGpuMirrorFold = ({
  mirrorOnGpu,
  allowNegativeFrequencies,
  displayMinHz: _displayMinHz,
}: {
  mirrorOnGpu: boolean;
  allowNegativeFrequencies: boolean;
  displayMinHz: number;
}): boolean => Boolean(mirrorOnGpu && allowNegativeFrequencies);

export const resolveEffectiveDbmOffsetDb = ({
  powerScale,
  deviceKind,
  backend,
  deviceName,
  isTransmitting,
  tunerGainDb,
}: {
  powerScale: "dB" | "dBm";
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isTransmitting?: boolean;
  tunerGainDb?: number | null;
}): number => {
  if (powerScale !== "dBm") return 0.0;

  const isMockTxDevice = isMockTxIdentity({ deviceKind, backend, deviceName });
  const isMockAptDevice = isMockAptIdentity({
    deviceKind,
    backend,
    deviceName,
  });
  if (isMockTxDevice || (isMockAptDevice && isTransmitting)) {
    return 15.0;
  }

  if (deviceKind === "hackrf_one") {
    return computeHackrfApproxDbmOffsetDb({
      totalGainDb: tunerGainDb ?? 0,
    });
  }

  return 30.0;
};

export const getTxSpectrumRevisionKey = ({
  centerFrequencyHz,
  sampleRateHz,
  signal,
  powerDbm,
}: {
  centerFrequencyHz?: number | null;
  sampleRateHz?: number | null;
  signal?: string | null;
  powerDbm?: number | null;
}) => {
  const center =
    typeof centerFrequencyHz === "number" && Number.isFinite(centerFrequencyHz)
      ? Math.round(centerFrequencyHz)
      : "n";
  const sampleRate =
    typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
      ? Math.round(sampleRateHz)
      : "n";
  const normalizedSignal = signal ?? null;
  const signalKey =
    normalizedSignal === null
      ? "n"
      : `${normalizedSignal.length}:${normalizedSignal}`;
  const power =
    typeof powerDbm === "number" && Number.isFinite(powerDbm)
      ? Math.round(powerDbm * 1000) / 1000
      : "n";
  return `${center}|${sampleRate}|${signalKey}|${power}`;
};

export const resolveLiveFrameRenderableFrequencyRange = ({
  currentFrame,
  requestedRange,
  propsCenterFrequencyHz,
  propsHardwareSampleRateHz,
  preferRequestedRange,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: FrameRenderRangeInput): FrequencyRange => {
  const mockTxMonitor = isMockTxIdentity({ deviceKind, backend, deviceName });
  const canonicalSampleRateHz =
    typeof propsHardwareSampleRateHz === "number" &&
    Number.isFinite(propsHardwareSampleRateHz) &&
    propsHardwareSampleRateHz > 0
      ? propsHardwareSampleRateHz
      : currentFrame.sample_rate;
  return resolveRenderableFrequencyRange({
    requestedRange,
    centerFrequencyHz: mockTxMonitor
      ? propsCenterFrequencyHz
      : currentFrame.center_frequency_hz,
    hardwareSampleRateHz: canonicalSampleRateHz,
    preferRequestedRange,
    deviceKind,
    backend,
    deviceName,
    isRtlSdr,
  });
};

// Use dynamic import for WASM module loading
(async () => {
  try {
    const wasmModule = await import("n_apt_canvas");
    const initWasm = wasmModule.default;
    const test_wasm_simd_availability = (
      wasmModule as typeof wasmModule & {
        test_wasm_simd_availability?: () => void;
      }
    ).test_wasm_simd_availability;

    // Initialize the WASM module first
    await initWasm();

    // Test WASM SIMD availability
    if (test_wasm_simd_availability) {
      test_wasm_simd_availability();

      // Expose globally for manual testing
      (window as any).testWasmSimd = test_wasm_simd_availability;
    }

    // sdrProcessor = new SIMDRenderingProcessor(); // Removed as sdrProcessor is unused
  } catch {
    // Silently handle WASM loading errors
  }
})();

const VisualizerContainer = memo(styled.div`
  flex: 1.25;
  display: flex;
  flex-direction: row;
  position: relative;
  overflow: hidden;
`);

const VisualizerContent = memo(styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${VISUALIZER_GAP}px;
  min-height: 0;
`);

const SpectrumSection = memo(styled.div`
  flex: 2;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  padding: 2px 2px 12px;
  box-sizing: border-box;
`);

const SectionTitle = memo(styled.div`
  font-size: 11px;
  color: ${SECTION_TITLE_COLOR};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: ${SECTION_TITLE_AFTER_COLOR};
  }
`);

const SectionTitleRow = memo(styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  padding: 0 0 10px;
  margin-bottom: 0;
`);

const SectionTitleActions = memo(styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  gap: 8px;
  flex-shrink: 0;
  transition: opacity 0.15s ease;

  &[data-disabled="true"] {
    opacity: 0.5;
    pointer-events: none;
  }
`);

const CanvasWrapper = memo(styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid ${(props) => props.theme.canvasBorder};
  border-radius: 8px;
  overflow: hidden;
  background-color: ${(props) => props.theme.background};

  &.cursor-grab {
    cursor: grab !important;
  }
  &.cursor-grabbing {
    cursor: grabbing !important;
  }
  &.cursor-crosshair {
    cursor: crosshair !important;
  }
`);

const NodePreviewCanvasWrapper = memo(styled(CanvasWrapper)`
  flex: 1 1 0;
  width: 100%;
  height: auto;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  border: none;
  border-radius: 0;
`);

const NodePreviewLayout = memo(styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  width: 100%;
  height: auto;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
`);

const NodePreviewSelectionBar = memo(styled.div`
  position: relative;
  flex: 0 0 44px;
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: transparent;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  pointer-events: none;
  white-space: nowrap;
`);

const NodePreviewStatsMeta = memo(styled.div`
  flex: 0 0 34px;
  width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
`);

const SpectrumRow = memo(styled.div`
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
`);

const CanvasLayer = memo(styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  will-change: width, height;
`);

const FloorLineOverlay = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: var(--floor-line-top);
  height: 2px;
  background: repeating-linear-gradient(
    to right,
    rgba(255, 120, 150, 0.9) 0,
    rgba(255, 120, 150, 0.9) 24px,
    transparent 24px,
    transparent 38px
  );
  pointer-events: none;
  z-index: 4;
`;

const TxSliderVisualRow = memo(styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${TX_SLIDER_ROW_HEIGHT}px;
  z-index: 130;
  overflow: visible;
  background: transparent;
  border: none;
  box-shadow: none;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  display: flex;
  align-items: center;
  isolation: isolate;
`);

const TxSliderVisualLabel = styled.div`
  padding-left: 14px;
  font-size: 11px;
  font-weight: 700;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  z-index: 1;
`;

const TxSliderLockButton = styled.button`
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
    border-color: ${({ theme }) => theme.colors.border};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const TxBlinkingDot = styled.div`
  position: absolute;
  top: -1px;
  right: -8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary};
  box-shadow: 0 0 8px ${({ theme }) => theme.colors.primary}66;
  z-index: 1;
`;

const TxSliderMetaText = styled.span`
  position: absolute;
  left: 50px;
  top: -9px;
  font-size: 11px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.85;
  white-space: nowrap;
  letter-spacing: 0.02em;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const TxSliderVisualTrack = styled.div`
  position: absolute;
  left: 50px;
  right: 40px;
  top: 8px;
  bottom: 0;
  z-index: 1;
`;

const TxSliderVisualBase = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 4px;
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.border};
  z-index: 1;
`;

const TxSliderVisualBand = styled.div<{
  $width: number;
  $centerLeft: number;
  $isTransmitting: boolean;
}>`
  position: absolute;
  left: ${({ $centerLeft }) => `${$centerLeft}%`};
  width: ${({ $width }) => `max(${$width}%, 6px)`};
  top: 50%;
  transform: translate(-50%, -50%);
  height: 8px;
  border-radius: 999px;
  background: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.primary : theme.colors.textDisabled};
  transition: background 0.3s ease;
  z-index: 1;
`;

const TxSliderVisualText = styled.div<{
  $isTransmitting: boolean;
}>`
  position: absolute;
  left: var(--tx-label-left);
  top: calc(50% + 7px);
  transform: translate(-50%, 0);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 14px;
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 10px;
  font-weight: 800;
  line-height: 1.05;
  white-space: nowrap;
  transition: color 0.3s ease;
  pointer-events: none;
  z-index: 1;
`;

const TxSliderVisualCenterFrequencyText = styled.div<{
  $isTransmitting: boolean;
  $isLocked: boolean;
}>`
  position: absolute;
  left: var(--tx-center-label-left);
  bottom: calc(50% + 7px);
  transform: translate(-50%, 0);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 14px;
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 10px;
  font-weight: 800;
  line-height: 1.05;
  white-space: nowrap;
  transition: color 0.3s ease;
  pointer-events: none;
  z-index: 1;
`;

const TxSliderCenterLockIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  filter: none;
`;

const TxSliderVisualPower = styled.span<{ $isTransmitting: boolean }>`
  color: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.textPrimary : theme.colors.textDisabled};
  font-size: 10px;
  font-weight: 600;
`;

const TxSliderVisualPowerDot = styled.span<{ $isTransmitting: boolean }>`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: ${({ $isTransmitting, theme }) =>
    $isTransmitting ? theme.colors.primary : theme.colors.textDisabled};
  box-shadow: 0 0 0 1px
    ${({ $isTransmitting, theme }) =>
      $isTransmitting ? theme.colors.primary : theme.colors.textDisabled};
  margin-right: 5px;
  transform: translateY(0px);
`;

const TxSliderVisualOffScreenIndicator = styled.button<{
  $direction: "left" | "right";
  $isTransmitting: boolean;
}>`
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  ${({ $direction }) => ($direction === "left" ? "left: 3px;" : "right: 3px;")}
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.surface : theme.colors.textPrimary};
  background: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.primary : theme.colors.surfaceHover};
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 0 0 1px
    ${({ theme, $isTransmitting }) =>
      $isTransmitting ? theme.colors.primary : theme.colors.border};
  border: none;
  cursor: pointer;
  pointer-events: auto;
  z-index: 1;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  &:hover {
    opacity: 0.9;
    transform: translateY(-50%) scale(1.03);
  }
  &:active {
    transform: translateY(-50%) scale(0.97);
  }
`;

const SelectionTooltip = memo(styled.div`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 120;
  pointer-events: none;
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(7, 10, 18, 0.82);
  border: 1px solid rgba(255, 206, 84, 0.45);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  color: rgba(255, 247, 225, 0.98);
  font-size: 11px;
  line-height: 1.35;
  letter-spacing: 0.02em;
  backdrop-filter: blur(8px);

  strong {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(255, 206, 84, 0.92);
  }
`);

const LOADING_PLACEHOLDER_TEXT = "Loading data from source...";
const LOADING_PLACEHOLDER_FONT = "24px 'JetBrains Mono', monospace";
const WATERFALL_PLACEHOLDER_FONT = "20px 'JetBrains Mono', monospace";
const LOADING_PLACEHOLDER_COLOR = "#888888";
const MIN_FFT_DB_SPAN = 5;
const NODE_PREVIEW_BACKGROUND_STYLE = { backgroundColor: "#05070d" } as const;
const COMPACT_VISUALIZER_STYLE = {
  backgroundColor: "#05070d",
  minHeight: 0,
} as const;
const COMPACT_VISUALIZER_CONTENT_STYLE = { gap: 0 } as const;
const EMPTY_STYLE = {} as const;

export const getNodePreviewSelectionBarLabels = (
  selectionRange?: FrequencyRange,
  fallbackRange?: FrequencyRange,
): { center: string; bandwidth: string } | null => {
  const range =
    selectionRange &&
    Number.isFinite(selectionRange.min) &&
    Number.isFinite(selectionRange.max) &&
    selectionRange.max > selectionRange.min
      ? selectionRange
      : fallbackRange &&
          Number.isFinite(fallbackRange.min) &&
          Number.isFinite(fallbackRange.max) &&
          fallbackRange.max > fallbackRange.min
        ? fallbackRange
        : null;

  if (!range) {
    return null;
  }

  const formatBarFrequency = (hz: number) =>
    formatFrequency(hz, {
      showUnits: true,
      precisionMHz: 3,
      precisionGHz: 3,
      precisionKHz: 3,
    }).replace(/(\d)(?=[A-Za-z])/g, "$1 ");

  return {
    center: `○ ${formatBarFrequency((range.min + range.max) / 2)}`,
    bandwidth: `| ${formatBarFrequency(range.max - range.min)} |`,
  };
};

export const getNodePreviewMiniVfoMetrics = ({
  displayRange,
  selectionRange,
}: {
  displayRange?: FrequencyRange;
  selectionRange?: FrequencyRange;
}): { center: string; leftPercent: number; widthPercent: number } | null => {
  if (
    !displayRange ||
    !Number.isFinite(displayRange.min) ||
    !Number.isFinite(displayRange.max) ||
    displayRange.max <= displayRange.min
  ) {
    return null;
  }

  const span = displayRange.max - displayRange.min;
  const selection =
    selectionRange &&
    Number.isFinite(selectionRange.min) &&
    Number.isFinite(selectionRange.max) &&
    selectionRange.max > selectionRange.min
      ? selectionRange
      : {
          min: (displayRange.min + displayRange.max) / 2 - span * 0.01,
          max: (displayRange.min + displayRange.max) / 2 + span * 0.01,
        };
  const leftPercent = Math.max(
    0,
    Math.min(100, ((selection.min - displayRange.min) / span) * 100),
  );
  const widthPercent = Math.max(
    0.8,
    Math.min(100 - leftPercent, ((selection.max - selection.min) / span) * 100),
  );
  const center = formatFrequency((selection.min + selection.max) / 2, {
    showUnits: true,
    precisionMHz: 3,
    precisionGHz: 3,
    precisionKHz: 3,
  }).replace(/(\d)(?=[A-Za-z])/g, "$1 ");

  return { center, leftPercent, widthPercent };
};

export const getNodePreviewVfoScaleTicks = (
  displayRange?: FrequencyRange,
): Array<{ frequencyHz: number; positionPercent: number }> => {
  if (
    !displayRange ||
    !Number.isFinite(displayRange.min) ||
    !Number.isFinite(displayRange.max) ||
    displayRange.max <= displayRange.min
  ) {
    return [];
  }
  const span = displayRange.max - displayRange.min;
  const stepHz = findBestFrequencyRange(span, 10);
  const ticks = [{ frequencyHz: displayRange.min, positionPercent: 0 }];
  for (
    let frequencyHz = Math.ceil(displayRange.min / stepHz) * stepHz;
    frequencyHz < displayRange.max;
    frequencyHz += stepHz
  ) {
    if (frequencyHz > displayRange.min) {
      ticks.push({
        frequencyHz,
        positionPercent: ((frequencyHz - displayRange.min) / span) * 100,
      });
    }
  }
  ticks.push({ frequencyHz: displayRange.max, positionPercent: 100 });
  return ticks;
};

const DB_MAX_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: FFT_MAX_DB },
  dBm: { min: -100, max: 30 },
};

const DB_MIN_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: -10 },
  dBm: { min: -120, max: -10 },
};
const clampDbMaxValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MAX_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const clampDbMinValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MIN_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const ensureValidDbRange = (
  minVal: number,
  maxVal: number,
  scale: "dB" | "dBm",
) => {
  let nextMin = clampDbMinValue(minVal, scale);
  let nextMax = clampDbMaxValue(maxVal, scale);

  if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
    nextMax = clampDbMaxValue(nextMin + MIN_FFT_DB_SPAN, scale);
    if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
      nextMin = clampDbMinValue(nextMax - MIN_FFT_DB_SPAN, scale);
    }
  }

  return { min: nextMin, max: nextMax };
};

const toUnifiedWindowType = (
  windowType?: string,
): "rectangular" | "hanning" | "hamming" | "blackman" | "nuttall" => {
  switch ((windowType ?? "Rectangular").toLowerCase()) {
    case "rectangular":
    case "none":
      return "rectangular";
    case "hann":
    case "hanning":
      return "hanning";
    case "hamming":
      return "hamming";
    case "blackman":
      return "blackman";
    case "nuttall":
      return "nuttall";
    default:
      return "rectangular";
  }
};

/**
 * Props for FFTCanvas component
 */
export interface FFTCanvasProps {
  /** Reference to FFT data containing waveform and metadata */
  dataRef: React.MutableRefObject<any>;
  /** Frequency range to display */
  frequencyRange: FrequencyRange;
  /** Current center frequency in Hz (for overlay label) */
  centerFrequencyHz: number;
  /** Currently active signal area identifier */
  activeSignalArea: string;
  /** Signal area bounds for VFO drag clamping */
  signalAreaBounds?: Record<string, { min: number; max: number }>;
  /** Whether the visualization is paused */
  isPaused: boolean;
  /** Target frame rate for the visualization */
  fftFrameRate?: number;
  fftSize?: number;
  fftWindow?: string;
  powerScale?: "dB" | "dBm";
  removeDcSpike?: boolean;
  /** Whether the RTL-SDR device is connected */
  isDeviceConnected?: boolean;
  /** Callback for frequency range changes */
  onFrequencyRangeChange?: (range: FrequencyRange) => void;
  /** Fires when the user double-clicks the center-frequency/VFO label region. */
  onCenterFrequencyDoubleClick?: () => void;
  /** Currently active demodulation selection range */
  selectionRange?: FrequencyRange;
  selectionMode?: "zoom" | "range";
  /** How range selection should move the spectrum when it crosses a plot edge. */
  selectionEdgePanMode?: "visual" | "frequency-range";
  /** How plain pointer drags interact with an existing range selection. */
  rangeSelectionInteraction?: "create-only" | "edit-existing";
  /** Whether the selection overlay is disabled */
  selectionDisabled?: boolean;
  /** Callback for selection range changes (dragging the box) */
  onSelectionChange?: (range: FrequencyRange) => void;
  bandwidthAlignment?: Alignment;
  displayTemporalResolution?: TemporalResolution;
  /** Callback to trigger a snapshot render for the sidebar */
  onSnapshot?: (data: {
    waveform: Float32Array;
    frequencyRange: FrequencyRange;
    dbMin: number;
    dbMax: number;
    centerFrequencyHz: number;
    isDeviceConnected: boolean;
    vizZoom: number;
    vizPanOffset: number;
    grid: boolean;
  }) => void;
  /** Grid preference for snapshot rendering (affects 2D shadow canvases) */
  snapshotGridPreference: boolean;
  /** Whether to hide title and use compact layout (for node integration) */
  compact?: boolean;
  /** Tighten FFT margins for small node previews */
  nodePreview?: boolean;
  /** Multiplier applied to the backing-canvas pixel density. */
  canvasResolutionScale?: number;
  /** Publishes the processed source spectrum to sibling visualization targets. */
  onSpectrumFrame?: (
    spectrum: Float32Array,
    sourceFrame: LiveFrameData,
  ) => void;
  /** Optional overlay rendered inside the FFT canvas wrapper */
  overlayContent?: ReactNode;
  /** Optional TX slider drawn into the bottom FFT status band. */
  txSlider?: CanvasTxSliderState & {
    signalLabel?: string;
    powerDbm?: number;
  };
  /** Explicitly suppresses the canvas-owned Tx slider fallback in Rx mode. */
  txSliderAllowed?: boolean;
  /** Optional explicit labels for the bottom FFT status band. */
  canvasStatusRow?: LiveCanvasStatusRow | null;
  /** Optional action content rendered beside the FFT section title */
  headerActionContent?: ReactNode;
  /** Optional label used to personalize loading / error placeholders. */
  placeholderSourceLabel?: string;
  /** Optional pane label used by the placeholder copy. */
  placeholderPaneLabel?: string;
  /** Optional explicit playback error message for the placeholder overlay. */
  placeholderErrorReason?: string | null;
  /** Optional explicit placeholder state for non-loading display modes. */
  placeholderState?: CanvasPlaceholderState | null;
  /** Source lifecycle policy for stale-frame suppression and standby retention. */
  presentationPolicy?: LiveSourcePresentationPolicy;
  /** Vertically invert the FFT power plot for visual diagnostics. */
  invertSpectrum?: boolean;
  /** Disable canvas interactions while a placeholder is shown. */
  interactionDisabled?: boolean;
  /** Emits when the rAF loop sees a real live frame from a mutable data ref. */
  onRenderableFrameChange?: (hasRenderableFrame: boolean) => void;
  /** Emits the actual placeholder/loading state owned by the FFT canvas. */
  onCanvasLoadingChange?: (isLoading: boolean) => void;
  showSpikeOverlay?: boolean;
  isStandby?: boolean;
  vizZoom?: number;
  vizZoomFloor?: number;
  maxVizZoom?: number;
  vizZoomFloorPan?: number;
  vizPanOffset?: number;
  autoZoomStability?: boolean;
  onVizZoomChange?: (zoom: number) => void;
  onVizZoomFloorChange?: (zoomFloor: number) => void;
  onVizZoomFloorPanChange?: (pan: number) => void;
  onVizPanChange?: (pan: number) => void;
  /** Maximum allowed bandwidth for the selection range */
  maxBandwidthHz?: number;
  fftMin?: number;
  fftMax?: number;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  hardwareSampleRateHz?: number;
  deviceProfile?: DeviceProfile | null;
  deviceBackend?: string | null;
  deviceName?: string | null;
  tunerGainDb?: number;
  /** Whether I/Q recording is active */
  isIqRecordingActive?: boolean;
  limitMarkers?: SdrLimitMarker[];
  isWaterfallCleared?: boolean;
  onResetWaterfallCleared?: () => void;
  awaitingDeviceData?: boolean | string;
  /** Source whose first frame may end the loading handoff. */
  expectedSourceId?: string | null;
  /** Active transport owner used when binary live frames are untagged. */
  frameSourceIdFallback?: string | null;
  visualizerMachine?: FFTVisualizerMachine;
  visualizerSessionKey?: string;
  /** Whether this canvas may read or write persisted paused-frame snapshots. */
  pauseSnapshotEnabled?: boolean;
  /** Increments at a source/reconnect boundary to discard stale GPU output. */
  webGpuStreamResetEpoch?: number;
  waterfallCanvasBindings?: FFTCanvasWaterfallBindings;
  demodulationCenterFreqHz?: number | null;
  demodulationRangeHz?: number | null;
}

export const getLatestLiveFrame = <T,>(
  liveData: T | T[] | null | undefined,
): T | null => {
  if (!liveData) return null;
  return Array.isArray(liveData)
    ? (liveData[liveData.length - 1] ?? null)
    : liveData;
};

export const getLiveFrameSignature = (
  liveFrame: LiveFrameData | null | undefined,
): LiveFrameData | null => {
  if (!liveFrame) return null;
  return liveFrame;
};

export const formatTxIfftSizeLabel = (
  ifftSize: number | null | undefined,
  fallbackSize: number,
): string => {
  const resolvedSize =
    typeof ifftSize === "number" && Number.isFinite(ifftSize) && ifftSize > 0
      ? ifftSize
      : fallbackSize;
  return resolvedSize.toLocaleString("en-US");
};

export const shouldRenderWaterfallWithFrameOrRestore = (
  hasDimensions: boolean,
  hasCurrentFrame: boolean,
  hasPendingRestore: boolean,
): boolean => hasDimensions && (hasCurrentFrame || hasPendingRestore);

export const shouldCreatePausedFallbackWaveform = (
  cachedWaveform: Float32Array | null,
): boolean => !cachedWaveform || cachedWaveform.length === 0;

/**
 * Paused standby views must not preserve a rendered waveform across a source
 * handoff. The selected source label can update before its first frame, so
 * retaining the old canvas would display a foreign signal under the new name.
 */
export const shouldDrawZoomMarkersForCanvas = (
  nodePreview: boolean,
  hasBlockingPlaceholder = false,
): boolean => !nodePreview && !hasBlockingPlaceholder;

export const getCanvasPixelRatio = (
  devicePixelRatio: number,
  resolutionScale = 1,
): number => {
  const safeDevicePixelRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const safeResolutionScale =
    Number.isFinite(resolutionScale) && resolutionScale > 0
      ? resolutionScale
      : 1;
  // A scale above one used to multiply an already DPR-scaled canvas. In a
  // React Flow node that produced 4x linear resolution on Retina displays,
  // or 16x the base pixel work. Keep the argument for API compatibility but
  // cap live backing stores at the physical device density.
  return Math.min(
    safeDevicePixelRatio,
    safeDevicePixelRatio * safeResolutionScale,
  );
};

export const resolveDemodFocusOverlay = ({
  selectionMode,
  selectionRange,
  demodulationCenterFreqHz,
  demodulationRangeHz,
  bandwidthAlignment,
}: {
  selectionMode: "zoom" | "range";
  selectionRange?: FrequencyRange;
  demodulationCenterFreqHz?: number | null;
  demodulationRangeHz?: number | null;
  bandwidthAlignment: Alignment;
}): DemodFocusOverlay | null => {
  if (
    selectionMode !== "range" &&
    selectionRange &&
    Number.isFinite(selectionRange.min) &&
    Number.isFinite(selectionRange.max) &&
    selectionRange.max > selectionRange.min
  ) {
    return {
      centerFrequencyHz: (selectionRange.min + selectionRange.max) / 2,
      halfBandwidthHz: (selectionRange.max - selectionRange.min) / 2,
      alignment: bandwidthAlignment,
    };
  }

  if (
    demodulationCenterFreqHz === null ||
    demodulationCenterFreqHz === undefined ||
    !Number.isFinite(demodulationCenterFreqHz)
  ) {
    return null;
  }

  const range = demodulationRangeHz ?? 100_000;
  if (!Number.isFinite(range) || range <= 0) return null;

  return {
    centerFrequencyHz: demodulationCenterFreqHz,
    halfBandwidthHz: range / 2,
    alignment: bandwidthAlignment,
  };
};

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
export type SnapshotData = {
  waveform: Float32Array | null;
  fullChannelWaveform: Float32Array | null;
  frequencyRange: FrequencyRange;
  dbMin: number;
  dbMax: number;
  powerScale?: "dB" | "dBm";
  fftSize?: number;
  fftWindow?: string;
  centerFrequencyHz: number;
  isDeviceConnected: boolean;
  vizZoom: number;
  vizPanOffset: number;
  waterfallTextureSnapshot: Uint8Array | null;
  waterfallTextureMeta: {
    width: number;
    height: number;
    writeRow: number;
  } | null;
  waterfallBuffer: Uint8ClampedArray | null;
  waterfallDims: { width: number; height: number } | null;
  webgpuEnabled: boolean;
  hardwareSampleRateHz?: number;
  isIqRecordingActive?: boolean;
  demodFocusOverlay?: DemodFocusOverlay | null;
  activeSignalArea?: string;

  colormap: number[][];
};

export type SnapshotDataOptions = {
  /**
   * Copy the waterfall texture and 2D buffer into the result. These are
   * multi-megabyte copies, so callers that render the waterfall from the live
   * GPU canvas instead (video recording) should opt out.
   */
  includeWaterfall?: boolean;
  /**
   * Copy the waveform arrays. When false the caller receives live references
   * that the renderer keeps mutating, so the data must be consumed
   * synchronously before yielding to the event loop.
   */
  copyWaveforms?: boolean;
};

export type FFTCanvasHandle = {
  getSpectrumCanvas: () => HTMLCanvasElement | null;
  getWaterfallCanvas: () => HTMLCanvasElement | null;
  getSpectrumOverlayCanvas: () => HTMLCanvasElement | null;
  getWaterfallOverlayCanvas: () => HTMLCanvasElement | null;
  triggerSnapshotRender: () => void;
  getSnapshotData: (options?: SnapshotDataOptions) => SnapshotData | null;
  getCompositeSnapshot: () => {
    dataUrl: string;
    width: number;
    height: number;
  } | null;
};

const EMPTY_LIMIT_MARKERS: SdrLimitMarker[] = [];

export const resolveLimitMarkers = (
  limitMarkers: SdrLimitMarker[] | undefined,
): SdrLimitMarker[] => limitMarkers ?? EMPTY_LIMIT_MARKERS;

const FFTCanvas = memo(
  forwardRef<FFTCanvasHandle, FFTCanvasProps>((props, ref) => {
    const {
      dataRef,
      frequencyRange,
      centerFrequencyHz,
      activeSignalArea: _activeSignalArea,
      signalAreaBounds,
      isPaused,
      fftFrameRate,
      fftSize,
      fftWindow,
      powerScale,
      removeDcSpike = false,
      isDeviceConnected = true,
      onFrequencyRangeChange,
      onCenterFrequencyDoubleClick,
      displayTemporalResolution = "reduced",
      onSnapshot: _onSnapshot,
      snapshotGridPreference,
      showSpikeOverlay = false,
      headerActionContent,
      txSlider,
      txSliderAllowed = true,
      canvasStatusRow,
      placeholderSourceLabel,
      placeholderPaneLabel = "FFT",
      placeholderErrorReason = null,
      placeholderState: explicitPlaceholderState = null,
      presentationPolicy,
      invertSpectrum = false,
      interactionDisabled = false,
      isStandby: explicitIsStandby,
      onRenderableFrameChange,
      onCanvasLoadingChange,
      vizZoom = 1,
      vizZoomFloor = 1,
      maxVizZoom = VISUALIZER_MAX_ZOOM,
      vizPanOffset = 0,
      onVizZoomChange,
      onVizZoomFloorChange,
      onVizZoomFloorPanChange,
      onVizPanChange,
      maxBandwidthHz,
      fftMin = FFT_MIN_DB,
      fftMax,
      onFftDbLimitsChange,
      hardwareSampleRateHz,
      deviceProfile,
      deviceBackend,
      deviceName,
      tunerGainDb,
      isIqRecordingActive = false,
      limitMarkers: limitMarkersProp,
      isWaterfallCleared = false,
      onResetWaterfallCleared,
      awaitingDeviceData = false,
      expectedSourceId = null,
      frameSourceIdFallback = null,
      visualizerMachine,
      visualizerSessionKey = "default",
      pauseSnapshotEnabled = true,
      webGpuStreamResetEpoch = 0,
      waterfallCanvasBindings,
      compact = false,
      nodePreview = false,
      canvasResolutionScale = 1,
      onSpectrumFrame,
      demodulationCenterFreqHz = null,
      demodulationRangeHz = null,
      selectionRange,
      selectionMode = "zoom",
      selectionEdgePanMode = "visual",
      rangeSelectionInteraction = "create-only",
      selectionDisabled = false,
      bandwidthAlignment = "centered",
      onSelectionChange,
      autoZoomStability = false,
    } = props;
    const renderabilityNotifiedRef = useRef(false);
    const notifyRenderableFrame = useCallback(
      (hasRenderableFrame: boolean) => {
        if (renderabilityNotifiedRef.current === hasRenderableFrame) return;
        renderabilityNotifiedRef.current = hasRenderableFrame;
        onRenderableFrameChange?.(hasRenderableFrame);
      },
      [onRenderableFrameChange],
    );
    const limitMarkers = resolveLimitMarkers(limitMarkersProp);
    const canRestoreVisualizerSession = shouldRestoreWebGpuStreamState(
      webGpuStreamResetEpoch,
    );
    const dispatch = useAppDispatch();
    const {
      drawMarkersOnContext,
      drawDemodFocusOnContext,
      drawSelectionOverlayOnContext,
      drawZoomMarkersOnContext,
      drawPowerLineOnContext,
      drawZoomboxOnContext,
    } = useOverlayRenderer();
    const fftColor = useAppSelector((reduxState) => reduxState.theme.fftColor);
    const gpuSpikeAnalysis = useAppSelector(
      (reduxState) => reduxState.spectrum.gpuSpikeAnalysis,
    );
    const hoveredSpikeIndex = useAppSelector(
      (reduxState) => reduxState.spectrum.hoveredSpikeIndex,
    );
    const themeAppMode = useAppSelector(
      (reduxState) => reduxState.theme.appMode,
    );
    const resolvedThemeMode = useResolvedThemeMode(themeAppMode);
    const reduxShowTxSlider = useAppSelector(
      (reduxState) => reduxState.spectrum.showTxSlider ?? true,
    );
    const reduxTxSignal = useAppSelector(
      (reduxState) => reduxState.spectrum.txSignal || "wifi",
    );
    const reduxTxCenterFrequencyHz = useAppSelector(
      (reduxState) => reduxState.spectrum.txCenterFrequencyHz,
    );
    const reduxTxSampleRateHz = useAppSelector(
      (reduxState) => reduxState.spectrum.txSampleRateHz,
    );
    const reduxTxIfftSize = useAppSelector(
      (reduxState) => reduxState.spectrum.txIfftSize,
    );
    const reduxTxPowerDbm = useAppSelector(
      (reduxState) => reduxState.spectrum.txPowerDbm,
    );
    const reduxDeviceKind = useAppSelector(
      (reduxState) => reduxState.spectrum.deviceKind,
    );
    const reduxWebsocketSources = useAppSelector(
      (reduxState) => reduxState.websocket.sources,
    );
    const isTransmittingGlobal = useMemo(() => {
      return reduxWebsocketSources.some(
        (source) => source.status === "transmitting",
      );
    }, [reduxWebsocketSources]);
    const isStandby = useMemo(() => {
      if (typeof explicitIsStandby === "boolean") {
        return explicitIsStandby;
      }
      return !!(
        explicitPlaceholderState &&
        explicitPlaceholderState.kind === "idle" &&
        explicitPlaceholderState.title === "Start Tx to transmit"
      );
    }, [explicitIsStandby, explicitPlaceholderState]);
    const canTransmit = useMemo(() => {
      return (
        reduxDeviceKind === "hackrf_one" ||
        reduxDeviceKind === "mock_tx" ||
        reduxDeviceKind === "tx_rx" ||
        reduxDeviceKind === "tx"
      );
    }, [reduxDeviceKind]);
    const txModeDeviceName = useMemo(() => {
      return resolveTxModeDeviceName(
        reduxWebsocketSources,
        deviceName,
        canTransmit,
        isStandby,
      );
    }, [canTransmit, deviceName, isStandby, reduxWebsocketSources]);
    const explicitPlaceholderStateRef = useRef<CanvasPlaceholderState | null>(
      explicitPlaceholderState,
    );
    explicitPlaceholderStateRef.current = explicitPlaceholderState;
    const pendingTxSliderDispatchRef = useRef<{
      centerHz?: number;
      sampleRateHz?: number;
    }>({});
    const txSliderDispatchTimerRef = useRef<ReturnType<
      typeof setTimeout
    > | null>(null);
    const flushTxSliderDispatch = useCallback(() => {
      txSliderDispatchTimerRef.current = null;
      const pending = pendingTxSliderDispatchRef.current;
      pendingTxSliderDispatchRef.current = {};
      if (typeof pending.sampleRateHz === "number") {
        dispatch(setTxSampleRateHz(pending.sampleRateHz));
      }
      if (typeof pending.centerHz === "number") {
        dispatch(setTxCenterFrequencyHz(pending.centerHz));
      }
    }, [dispatch]);
    const scheduleTxSliderDispatch = useCallback(
      (patch: { centerHz?: number; sampleRateHz?: number }) => {
        pendingTxSliderDispatchRef.current = {
          ...pendingTxSliderDispatchRef.current,
          ...patch,
        };
        if (txSliderDispatchTimerRef.current) return;
        txSliderDispatchTimerRef.current = setTimeout(
          flushTxSliderDispatch,
          16,
        );
      },
      [flushTxSliderDispatch],
    );
    useEffect(() => {
      return () => {
        if (txSliderDispatchTimerRef.current) {
          clearTimeout(txSliderDispatchTimerRef.current);
          txSliderDispatchTimerRef.current = null;
        }
      };
    }, []);
    const effectiveTxSlider = useMemo(() => {
      if (!txSliderAllowed) return null;
      if (txSlider?.visible) return txSlider;
      if (!reduxShowTxSlider || !canTransmit) return null;
      if (
        !frequencyRange ||
        !Number.isFinite(frequencyRange.min) ||
        !Number.isFinite(frequencyRange.max)
      ) {
        return null;
      }
      const visibleMinHz = frequencyRange.min;
      const visibleMaxHz =
        frequencyRange.max > visibleMinHz
          ? frequencyRange.max
          : visibleMinHz + 1;
      const visibleSpanHz = visibleMaxHz - visibleMinHz;
      const centerHz = Number.isFinite(reduxTxCenterFrequencyHz)
        ? reduxTxCenterFrequencyHz
        : visibleMinHz + visibleSpanHz / 2;
      const sampleRateHz = Number.isFinite(reduxTxSampleRateHz)
        ? Math.max(1, reduxTxSampleRateHz)
        : Math.max(1, Math.min(120_000, visibleSpanHz));
      return {
        visible: true,
        isTransmitting: isTransmittingGlobal,
        deviceLabel: txModeDeviceName ?? undefined,
        signalLabel: resolveTxSignalDisplayLabel(reduxTxSignal),
        powerDbm: reduxTxPowerDbm,
        visibleMinHz,
        visibleMaxHz,
        txCenterHz: centerHz,
        txSampleRateHz: sampleRateHz,
        rxSampleRateHz: visibleSpanHz,
        onCenterFrequencyChange: (value: number) =>
          scheduleTxSliderDispatch({ centerHz: value }),
        onSampleRateChange: (value: number) =>
          scheduleTxSliderDispatch({ sampleRateHz: value }),
      };
    }, [
      frequencyRange,
      canTransmit,
      reduxDeviceKind,
      reduxShowTxSlider,
      reduxTxCenterFrequencyHz,
      reduxTxPowerDbm,
      reduxTxSampleRateHz,
      reduxTxSignal,
      isTransmittingGlobal,
      scheduleTxSliderDispatch,
      txSlider,
      txSliderAllowed,
    ]);

    const autoZoomStabilityRef = useRef(autoZoomStability);
    useEffect(() => {
      autoZoomStabilityRef.current = autoZoomStability;
    }, [autoZoomStability]);
    const waterfallTheme = useAppSelector(
      (reduxState) => reduxState.theme.waterfallTheme,
    );
    // dataFrameCounter subscription removed — live rendering is driven by
    // useFFTAnimation's rAF loop, and paused-frame tracking uses a polling interval.
    const fillColor = useMemo(() => {
      if (fftColor.startsWith("#")) {
        return `${fftColor}33`; // 20% opacity
      }
      return fftColor;
    }, [fftColor]);

    const colormap = useMemo(
      () => WATERFALL_COLORMAPS[waterfallTheme],
      [waterfallTheme],
    );

    // Use new hooks for state management
    const canvasState = useCanvasNodes(waterfallCanvasBindings);
    const {
      spectrumGpuCanvasNode,
      setSpectrumGpuCanvasNode,
      spectrumOverlayCanvasNode,
      setSpectrumOverlayCanvasNode: _setSpectrumOverlayCanvasNode,
      waterfallGpuCanvasNode,
      waterfallOverlayCanvasNode,
      setWaterfallGpuCanvasNode: _setWaterfallGpuCanvasNode,
      setWaterfallOverlayCanvasNode: _setWaterfallOverlayCanvasNode,
      spectrumGpuCanvasRef,
      spectrumOverlayCanvasRef,
      waterfallGpuCanvasRef,
      waterfallOverlayCanvasRef,
      spectrumContainerRef,
    } = canvasState;
    const zoomboxStateRef = useRef<{
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    } | null>(null);

    // Canvas node refs are synchronized by useCanvasNodes.

    const lastRenderedPowerScaleRef = useRef<"dB" | "dBm" | null>(null);
    const lastIncomingFrameRef = useRef<LiveFrameData | null>(null);
    const lastRenderableFrameRef = useRef<LiveFrameData | null>(null);
    const blockingPlaceholderClearKindRef = useRef(0);
    const pendingSourcePresentationResetRef = useRef(false);
    const [hasRenderedSpectrumFrame, setHasRenderedSpectrumFrame] =
      useState(false);

    const [isTxSliderLocked, setIsTxSliderLocked] = useState(false);
    const [fontLoadedTrigger, setFontLoadedTrigger] = useState(0);

    const powerLineDbRef = useRef<number | null>(null);
    const isPowerLineHeldRef = useRef(false);
    const txSliderRef = useRef<CanvasTxSliderState | null>(null);
    txSliderRef.current = effectiveTxSlider?.visible ? effectiveTxSlider : null;
    const [txSliderVisualRevision, setTxSliderVisualRevision] = useState(0);
    const setPowerLineDb = useCallback((nextPowerLineDb: number | null) => {
      const wasActive = powerLineDbRef.current !== null;
      const isActive = nextPowerLineDb !== null;
      if (Object.is(powerLineDbRef.current, nextPowerLineDb)) return;

      powerLineDbRef.current = nextPowerLineDb;
      if (nextPowerLineDb === null) {
        isPowerLineHeldRef.current = false;
      }
      if (wasActive !== isActive) {
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
      }
      forceRenderRef.current?.();
    }, []);

    const {
      waterfallBufferRef,
      waterfallDataWidthRef,
      getBufferFromPool,
      returnBufferToPool,
    } = useWaterfallBuffers();

    const waterfallCappedBufferRef = useRef<Float32Array | null>(null);

    // Track canvas dimensions for cache management
    const spectrumWidthRef = useRef<number>(0);
    const spectrumHeightRef = useRef<number>(0);
    const context2DCacheRef = useRef<WeakMap<
      HTMLCanvasElement,
      CanvasRenderingContext2D | null
    > | null>(null);
    if (!context2DCacheRef.current) {
      context2DCacheRef.current = new WeakMap();
    }
    const getCached2DContext = useCallback((canvas: HTMLCanvasElement) => {
      const cache = context2DCacheRef.current!;
      if (cache.has(canvas)) return cache.get(canvas) ?? null;
      const context = canvas.getContext("2d");
      cache.set(canvas, context);
      return context;
    }, []);

    const clearOverlayCanvas = useCallback(
      (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return;
        const ctx = getCached2DContext(canvas);
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      [getCached2DContext],
    );

    const drawTxSliderOnContext = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        visualRange: FrequencyRange,
        slider: CanvasTxSliderState | null,
      ) => {
        if (
          !slider?.visible ||
          !Number.isFinite(slider.visibleMinHz) ||
          !Number.isFinite(slider.visibleMaxHz) ||
          slider.visibleMaxHz <= slider.visibleMinHz ||
          !Number.isFinite(slider.txCenterHz) ||
          !Number.isFinite(slider.txSampleRateHz)
        ) {
          return;
        }

        const plotLeft = Math.min(50, width);
        const plotRight = Math.max(plotLeft, width - 40);
        const left = 4;
        const right = Math.max(left, width - 4);
        const top = Math.max(0, height - TX_SLIDER_ROW_HEIGHT);
        const bottom = Math.max(top + 1, height - 4);
        const trackLeft = plotLeft;
        const trackRight = Math.max(trackLeft + 80, plotRight);
        const trackWidth = Math.max(1, trackRight - trackLeft);
        const visibleSpan = visualRange.max - visualRange.min;
        const bandwidth = Math.max(1, slider.txSampleRateHz);
        const bandMin = slider.txCenterHz - bandwidth / 2;
        const bandMax = slider.txCenterHz + bandwidth / 2;
        const toX = (hz: number) =>
          trackLeft + ((hz - visualRange.min) / visibleSpan) * trackWidth;
        const rawBandLeft = toX(bandMin);
        const rawBandRight = toX(bandMax);
        const bandLeft = Math.max(trackLeft, Math.min(trackRight, rawBandLeft));
        const bandRight = Math.max(
          trackLeft,
          Math.min(trackRight, rawBandRight),
        );
        const boundaryDashColor = slider.isTransmitting
          ? "rgba(0, 212, 255, 0.98)"
          : "rgba(148, 163, 184, 0.96)";
        const plotBottom = Math.max(0, top - 40);
        const plotTop = Math.min(20, height);

        ctx.save();
        ctx.clearRect(left - 2, top - 2, right - left + 4, bottom - top + 4);
        if (bandRight > bandLeft) {
          ctx.save();
          ctx.strokeStyle = boundaryDashColor;
          ctx.lineWidth = 1.75;
          ctx.lineCap = "round";
          ctx.setLineDash([4, 4]);
          for (const x of [rawBandLeft, rawBandRight]) {
            if (x < trackLeft - 0.5 || x > trackRight + 0.5) continue;
            ctx.beginPath();
            ctx.moveTo(x, plotTop);
            ctx.lineTo(x, plotBottom);
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
      },
      [resolvedThemeMode],
    );

    const drawLoadingPlaceholder = useCallback(
      (canvas: HTMLCanvasElement | null, fontOverride?: string) => {
        if (!canvas) return;
        const ctx = getCached2DContext(canvas);
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const dpr = getCanvasPixelRatio(
          window.devicePixelRatio || 1,
          canvasResolutionScale,
        );
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
      [canvasResolutionScale, getCached2DContext],
    );

    const lastWaterfallRowRef = useRef<Float32Array | null>(null);
    const pausedWaterfallRowRef = useRef<Float32Array | null>(null);
    const waterfallTextureSnapshotRef = useRef<Uint8Array | null>(null);
    const waterfallRowBytesRef = useRef<Uint8Array | null>(null);
    const waterfallTextureMetaRef = useRef<{
      width: number;
      height: number;
      writeRow: number;
    } | null>(null);
    const pendingWaterfallRestoreRef = useRef<PendingWaterfallRestore | null>(
      null,
    );
    const restoredWaterfallRef = useRef(false);
    const activeVisualizerSessionKeyRef = useRef(visualizerSessionKey);
    const latestVisualizerMachineRef = useRef(visualizerMachine);
    const latestVisualizerSessionKeyRef = useRef(visualizerSessionKey);
    const lastVisualizerAutoPersistAtRef = useRef(0);
    const lastWebGpuStreamResetEpochRef = useRef(
      getInitialHandledWebGpuResetEpoch(webGpuStreamResetEpoch),
    );

    useEffect(() => {
      latestVisualizerMachineRef.current = visualizerMachine;
      latestVisualizerSessionKeyRef.current = visualizerSessionKey;
    }, [visualizerMachine, visualizerSessionKey]);

    // Simplified frame management
    const frameBufferRef = useRef<Float32Array[]>([]);
    const maxFrameBufferSize = 1;
    const lastProcessedDataRef = useRef<any>(null);
    const invertedSpectrumBufferRef = useRef<Float32Array | null>(null);
    const hasPresentedSpectrumFrameRef = useRef(false);
    const lastPresentedSourceIdRef = useRef<string | null>(null);
    // Retain the identity of the frame that was frozen before a source reset.
    // The mutable presentation identity is cleared at the boundary, but the
    // paused marker still needs to explain which frame was on screen.
    const lastPausedFrameSourceIdRef = useRef<string | null>(null);
    const hasPresentedStandbySpectrumRef = useRef(false);
    const lastProcessedFrameSignatureRef = useRef<LiveFrameData | null>(null);
    const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
    const centerFreqRef = useRef(centerFrequencyHz);
    centerFreqRef.current = centerFrequencyHz;
    const renderableFrequencyRange = useMemo(
      () =>
        resolveRenderableFrequencyRange({
          requestedRange: frequencyRange,
          centerFrequencyHz,
          hardwareSampleRateHz,
          deviceKind: deviceProfile?.kind,
          backend: deviceBackend,
          deviceName,
          isRtlSdr: deviceProfile?.is_rtl_sdr,
        }),
      [
        frequencyRange,
        centerFrequencyHz,
        hardwareSampleRateHz,
        deviceProfile?.kind,
        deviceProfile?.is_rtl_sdr,
        deviceBackend,
        deviceName,
      ],
    );


    const effectivePowerScale = powerScale ?? "dB";
    const isHackrfDevice = deviceProfile?.kind === "hackrf_one";
    const isRtlSdr = isRtlSdrDevice({
      deviceKind: deviceProfile?.kind,
      backend: deviceBackend,
      deviceName,
      isRtlSdr: deviceProfile?.is_rtl_sdr,
    });
    // This arrives from the source-aware resolver in SpectrumRoute; do not
    // substitute a rendered channel span or a duplicate device constant here.
    const displayHardwareSampleRateHz = hardwareSampleRateHz ?? 0;
    const effectiveDbmOffsetDb = resolveEffectiveDbmOffsetDb({
      powerScale: effectivePowerScale,
      deviceKind: deviceProfile?.kind,
      backend: deviceBackend,
      deviceName,
      isTransmitting: isTransmittingGlobal,
      tunerGainDb,
    });
    const baseDbMin = Number.isFinite(fftMin) ? (fftMin as number) : FFT_MIN_DB;
    const baseDbMax = Number.isFinite(fftMax) ? (fftMax as number) : FFT_MAX_DB;
    const effectiveFftSize = fftSize ?? 32768;
    const frontendFftSize = getFrontendFftSize(effectiveFftSize);
    const effectiveCanvasStatusRow = useMemo<LiveCanvasStatusRow | null>(() => {
      const txModeLabel = canTransmit
        ? txModeDeviceName
          ? `${txModeDeviceName} > ${resolveTxSignalDisplayLabel(reduxTxSignal)}`
          : resolveTxSignalDisplayLabel(reduxTxSignal)
        : null;

      if (canvasStatusRow) {
        return {
          ...canvasStatusRow,
          ...(txModeLabel ? { txModeLabel } : {}),
        };
      }

      if (typeof hardwareSampleRateHz !== "number") return null;
      return {
        ...formatLiveCanvasStatusRow({
          sampleRateHz: displayHardwareSampleRateHz,
          fftSize: effectiveFftSize,
          fftWindow: fftWindow ?? "Rectangular",
          temporalResolution: displayTemporalResolution,
        }),
        ...(txModeLabel
          ? {
              bandwidthLabel: `${formatFrequency(
                reduxTxSampleRateHz ?? displayHardwareSampleRateHz,
                {
                  trimTrailingZeros: true,
                  precisionMHz: 4,
                  precisionKHz: 2,
                  precisionGHz: 3,
                },
              )} Bandwidth`,
              ifftSizeLabel: `IFFT Size: ${formatTxIfftSizeLabel(
                reduxTxIfftSize,
                effectiveFftSize,
              )}`,
            }
          : {}),
        ...(txModeLabel ? { txModeLabel } : {}),
      };
    }, [
      canTransmit,
      canvasStatusRow,
      displayTemporalResolution,
      effectiveFftSize,
      fftWindow,
      displayHardwareSampleRateHz,
      reduxTxIfftSize,
      reduxTxSampleRateHz,
      reduxTxSignal,
      txModeDeviceName,
    ]);
    const validatedDbRange = useMemo(
      () => ensureValidDbRange(baseDbMin, baseDbMax, effectivePowerScale),
      [baseDbMin, baseDbMax, effectivePowerScale],
    );
    const vizDbMin = validatedDbRange.min;
    const vizDbMax = validatedDbRange.max;

    const applyDbLimits = useCallback(
      (minValue: number, maxValue: number) => {
        if (!onFftDbLimitsChange) return;
        const next = ensureValidDbRange(
          minValue,
          maxValue,
          effectivePowerScale,
        );
        onFftDbLimitsChange(next.min, next.max);
      },
      [onFftDbLimitsChange, effectivePowerScale],
    );

    // Effect: Synchronizes validated dB range back to parent when it changes.
    // Prevents infinite loops by only emitting when values actually differ from last emitted.
    useEffect(() => {
      if (!onFftDbLimitsChange) return;
      const normalized = { min: vizDbMin, max: vizDbMax };
      const lastEmitted = lastEmittedDbLimitsRef.current;
      const shouldEmit =
        baseDbMin !== normalized.min || baseDbMax !== normalized.max;

      if (
        shouldEmit &&
        (!lastEmitted ||
          lastEmitted.min !== normalized.min ||
          lastEmitted.max !== normalized.max)
      ) {
        lastEmittedDbLimitsRef.current = normalized;
        onFftDbLimitsChange(vizDbMin, vizDbMax);
      }
    }, [baseDbMin, baseDbMax, vizDbMin, vizDbMax, onFftDbLimitsChange]);

    const currentVizZoom = vizZoom ?? 1;

    const currentVisualRange = useMemo(() => {
      const minFreq = frequencyRange?.min ?? 0;
      const maxFreq = frequencyRange?.max ?? 0;
      const fullSpan = maxFreq - minFreq;
      if (fullSpan <= 0) return { min: minFreq, max: maxFreq };

      const halfSpan = fullSpan / (2 * currentVizZoom);
      const centerFreq = (minFreq + maxFreq) / 2;
      const visualCenter = centerFreq + vizPanOffset;
      return {
        min: visualCenter - halfSpan,
        max: visualCenter + halfSpan,
      };
    }, [frequencyRange, currentVizZoom, vizPanOffset]);

    const clampedVizRangeRef = useRef<FrequencyRange>(currentVisualRange);
    clampedVizRangeRef.current = currentVisualRange;

    const wfSmoothEnabled = useAppSelector(
      (reduxState) => reduxState.spectrum.wfSmoothEnabled,
    );
    const hardwareSpectrumBounds = useAppSelector(
      (reduxState) => reduxState.demod.hardwareRange,
    );
    const allowNegativeFrequencies = useAppSelector(
      (reduxState) => reduxState.settings.mirrorIqBasebandBelowZero,
    );

    const spectrumOutputBufferRef = useRef<Float32Array | null>(null);
    const dcRemovedSpectrumBufferRef = useRef<Float32Array | null>(null);
    const pendingFftSizeChangeRef = useRef(false);

    const vizZoomRef = useRef(currentVizZoom);
    const setVizZoom = useCallback(
      (val: number | ((prev: number) => number)) => {
        const newZoom =
          typeof val === "function" ? val(vizZoomRef.current) : val;
        if (onVizZoomChange) {
          onVizZoomChange(newZoom);
        }
      },
      [onVizZoomChange],
    );

    const vizZoomFloorRef = useRef(vizZoomFloor);
    const vizDbMaxRef = useRef(vizDbMax);
    const vizDbMinRef = useRef(vizDbMin);
    const vizPanOffsetRef = useRef(vizPanOffset);
    const onVizPanChangeRef = useRef(onVizPanChange);
    onVizPanChangeRef.current = onVizPanChange;

    /** True while mirror-mode pan is held in the ref ahead of the Redux write. */
    const mirrorPanPendingPublishRef = useRef(false);
    const mirrorPanLastPublishedRef = useRef(vizPanOffset);
    /** True while a mirror retune ref is ahead of the Redux frequency range. */
    const hardwareRangeReanchorPendingRef = useRef(false);
    const lastPaintedMirrorPanRef = useRef(vizPanOffset);
    const lastPaintedZoomRef = useRef(currentVizZoom);
    const vizPanSchedulerRef = useRef<DeviceOptionScheduler<number> | null>(
      null,
    );
    if (!vizPanSchedulerRef.current) {
      vizPanSchedulerRef.current = createVizPanScheduler((pan) => {
        mirrorPanLastPublishedRef.current = pan;
        // Publish the coalesced value to the parent exactly once. Calling the
        // local interaction handler here would submit back into this same
        // scheduler and recurse on the first wheel event. Keep the local ref
        // authoritative until the published prop is acknowledged below;
        // clearing pending here creates a render-sized stale-prop rewind.
        onVizPanChangeRef.current?.(pan);
      });
    }
    const vizPanScheduler = vizPanSchedulerRef.current;

    // Cancel timers on cleanup, but keep the ref-backed scheduler reusable
    // across React Strict Mode's mount probe and callback refreshes.
    useEffect(() => () => vizPanScheduler.cancel(), [vizPanScheduler]);
    const previousPowerScaleRef = useRef(effectivePowerScale);
    const previousRemoveDcSpikeRef = useRef(removeDcSpike);
    const previousFftSizeRef = useRef(effectiveFftSize);
    const previousFftWindowRef = useRef(fftWindow);
    const previousTemporalResolutionRef = useRef(displayTemporalResolution);
    const lastEmittedDbLimitsRef = useRef<{ min: number; max: number } | null>(
      null,
    );
    vizZoomRef.current = currentVizZoom;
    vizZoomFloorRef.current = vizZoomFloor;
    vizDbMaxRef.current = vizDbMax;
    vizDbMinRef.current = vizDbMin;
    // Do not clobber a live mirror pan with a stale Redux value. Live frames
    // re-render this component constantly; syncing every render undid the
    // in-flight pan and made the paint loop fight the gesture.
    if (!mirrorPanPendingPublishRef.current) {
      vizPanOffsetRef.current = vizPanOffset;
    }

    const isLoadingPlaceholder =
      !placeholderErrorReason &&
      !isStandby &&
      (explicitPlaceholderState?.kind === "loading" ||
        !hasRenderedSpectrumFrame);

    const canvasPlaceholderState =
      useMemo<CanvasPlaceholderState | null>(() => {
        if (isStandby && !explicitPlaceholderState) {
          return null;
        }
        // Placeholder authority lives in liveSourceLifecycle (via route props).
        // This canvas only renders the supplied state / error reason.
        if (explicitPlaceholderState) {
          return explicitPlaceholderState;
        }

        if (placeholderErrorReason) {
          return {
            kind: "error",
            sourceLabel: placeholderSourceLabel,
            reason: placeholderErrorReason,
          };
        }

        if (isPaused) {
          return {
            kind: "top-bar",
            kicker: "Paused",
            title: "",
            sourceLabel: placeholderSourceLabel,
          };
        }

        if (isLoadingPlaceholder || awaitingDeviceData) {
          return {
            kind: "loading",
            sourceLabel: placeholderSourceLabel,
            paneLabel: placeholderPaneLabel,
            message:
              typeof awaitingDeviceData === "string"
                ? awaitingDeviceData
                : undefined,
          };
        }

        return null;
      }, [
        isLoadingPlaceholder,
        placeholderErrorReason,
        placeholderSourceLabel,
        placeholderPaneLabel,
        awaitingDeviceData,
        explicitPlaceholderState,
        isStandby,
        isPaused,
      ]);

    const demodFocusOverlay = useMemo(() => {
      return resolveDemodFocusOverlay({
        selectionMode,
        selectionRange,
        demodulationCenterFreqHz,
        demodulationRangeHz,
        bandwidthAlignment,
      });
    }, [
      selectionMode,
      selectionRange,
      demodulationCenterFreqHz,
      demodulationRangeHz,
      bandwidthAlignment,
    ]);

    const selectionOverlay = useMemo(() => {
      if (
        !selectionRange ||
        !Number.isFinite(selectionRange.min) ||
        !Number.isFinite(selectionRange.max) ||
        selectionRange.max <= selectionRange.min
      ) {
        return null;
      }

      return {
        minFrequencyHz: selectionRange.min,
        maxFrequencyHz: selectionRange.max,
      };
    }, [selectionRange]);

    const selectionTooltipText = useMemo(() => {
      if (!selectionRange) return null;
      if (
        !Number.isFinite(selectionRange.min) ||
        !Number.isFinite(selectionRange.max) ||
        selectionRange.max <= selectionRange.min
      ) {
        return null;
      }

      const startHz = selectionRange.min.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
      const endHz = selectionRange.max.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
      const spanHz = (selectionRange.max - selectionRange.min).toLocaleString(
        undefined,
        { maximumFractionDigits: 0 },
      );

      return {
        startHz,
        endHz,
        spanHz,
      };
    }, [selectionRange]);

    const nodePreviewSelectionBarLabels = useMemo(
      () => getNodePreviewSelectionBarLabels(selectionRange),
      [selectionRange],
    );
    const nodePreviewMiniVfoMetrics = useMemo(
      () =>
        getNodePreviewMiniVfoMetrics({
          displayRange: frequencyRange,
          selectionRange,
        }),
      [frequencyRange, selectionRange],
    );
    const txSliderVisualMetrics = useMemo(() => {
      const slider = effectiveTxSlider;
      if (
        !slider?.visible ||
        !Number.isFinite(slider.visibleMinHz) ||
        !Number.isFinite(slider.visibleMaxHz) ||
        slider.visibleMaxHz <= slider.visibleMinHz ||
        !Number.isFinite(slider.txCenterHz) ||
        !Number.isFinite(slider.txSampleRateHz)
      ) {
        return null;
      }

      const visualMin = currentVisualRange.min;
      const visualMax = currentVisualRange.max;
      const span = visualMax - visualMin;
      if (span <= 0) return null;

      const bandwidth = Math.max(1, slider.txSampleRateHz);
      const rawBandStart = slider.txCenterHz - bandwidth / 2;
      const rawBandEnd = slider.txCenterHz + bandwidth / 2;
      const center = (rawBandStart + rawBandEnd) / 2;
      const left = ((rawBandStart - visualMin) / span) * 100;
      const width = ((rawBandEnd - rawBandStart) / span) * 100;
      const centerLeft = ((center - visualMin) / span) * 100;
      const powerLabel =
        typeof slider.powerDbm === "number" && Number.isFinite(slider.powerDbm)
          ? `${slider.powerDbm.toFixed(0)} dBm`
          : null;

      let offScreenDirection: "left" | "right" | null = null;
      if (center < visualMin) offScreenDirection = "left";
      else if (center > visualMax) offScreenDirection = "right";

      const formatHz = (hz: number) => {
        if (!Number.isFinite(hz)) return "Unknown";
        const abs = Math.abs(hz);
        if (abs >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`;
        if (abs >= 1_000) return `${(hz / 1_000).toFixed(0)} kHz`;
        return `${Math.round(hz)} Hz`;
      };

      return {
        left: Math.max(0, Math.min(100, left)),
        width: Math.max(0, Math.min(100, width)),
        centerLeft: Math.max(0, Math.min(100, centerLeft)),
        signalLabel: slider.signalLabel ?? "TX",
        powerLabel,
        isOffScreen: offScreenDirection !== null,
        offScreenDirection,
        centerHzFormatted: `○ ${formatHz(center)}`,
        bandwidthFormatted: `| ${formatHz(bandwidth)} |`,
      };
    }, [effectiveTxSlider, currentVisualRange, txSliderVisualRevision]);
    const txSliderDisplayLabel = useMemo(() => {
      if (!txSliderVisualMetrics) return null;
      return txModeDeviceName
        ? `${txModeDeviceName} > ${txSliderVisualMetrics.signalLabel || "Unknown"}`
        : txSliderVisualMetrics.signalLabel || "Unknown";
    }, [txModeDeviceName, txSliderVisualMetrics]);

    const handleOffscreenIndicatorClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const slider = effectiveTxSlider;
        if (!slider || !frequencyRange) return;

        const span = frequencyRange.max - frequencyRange.min;
        const visualCenter =
          (currentVisualRange.min + currentVisualRange.max) / 2;
        onVizPanChange?.(slider.txCenterHz - visualCenter);
        if (onFrequencyRangeChange && Number.isFinite(span) && span > 0) {
          const center = Math.max(0, slider.txCenterHz);
          let nextMin = center - span / 2;
          let nextMax = center + span / 2;
          if (nextMin < 0) {
            nextMax -= nextMin;
            nextMin = 0;
          }
          onFrequencyRangeChange({ min: nextMin, max: nextMax });
          onVizPanChange?.(0);
          return;
        }
      },
      [
        effectiveTxSlider,
        frequencyRange,
        currentVisualRange,
        onFrequencyRangeChange,
        onVizPanChange,
      ],
    );

    const zoomProcessorRef = useRef<ReturnType<
      typeof createFFTZoomProcessor
    > | null>(null);
    if (!zoomProcessorRef.current) {
      zoomProcessorRef.current = createFFTZoomProcessor(FFT_MIN_DB);
    }
    const getZoomedData = zoomProcessorRef.current.process;

    // Ref to track snapshot grid preference (for 2D shadow renders)
    const snapshotGridPreferenceRef = useRef(true);

    // Effect: Sync snapshotGridPreference prop to ref for access in callbacks without dependency churn
    useEffect(() => {
      snapshotGridPreferenceRef.current = snapshotGridPreference;
    }, [snapshotGridPreference]);
    const waveformFloatRef = useRef<Float32Array | null>(null);
    const renderWaveformRef = useRef<Float32Array | null>(null);
    const pausedSnapshotRef = useRef<PauseSnapshot | null>(null);
    const fullChannelWaveformRef = useRef<Float32Array | null>(null);
    const fullChannelRangeRef = useRef<FrequencyRange | null>(null);
    const waterfallDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );
    const waterfallGpuDimsRef = useRef<{
      width: number;
      height: number;
    } | null>(null);

    // Simplified WebGPU references
    const resampleComputePipelineRef = useRef<GPUComputePipeline | null>(null);
    const resampleParamsBufferRef = useRef<GPUBuffer | null>(null);
    const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);

    const {
      webgpuEnabled,
      isInitializingWebGPU,
      webgpuDeviceRef,
      webgpuFormatRef,
      gridOverlayRendererRef,
      markersOverlayRendererRef,
      spikesOverlayRendererRef,
      overlayDirtyRef,
    } = useWebGPULifecycle({
      spectrumGpuCanvasRef,
      waterfallGpuCanvasRef,
      resampleWgsl: RESAMPLE_WGSL,
      resampleComputePipelineRef,
      resampleParamsBufferRef,
      gpuBufferPoolRef,
    });

    // Trigger redraw once fonts are fully loaded to prevent serif font fallback glitch in Safari
    useEffect(() => {
      if (typeof document !== "undefined" && document.fonts) {
        document.fonts.ready.then(() => {
          if (overlayDirtyRef.current) {
            overlayDirtyRef.current.grid = true;
            overlayDirtyRef.current.markers = true;
          }
          setFontLoadedTrigger((prev) => prev + 1);
          forceRenderRef.current?.();
        });
      }
    }, [overlayDirtyRef]);

    const spectrumWebgpuEnabled = webgpuEnabled;
    const activeScaleDbMin = vizDbMin;
    const activeScaleDbMax = vizDbMax;

    const clearSpectrumBackbuffer = useCallback(() => {
      const device = webgpuDeviceRef?.current ?? null;
      const format = webgpuFormatRef?.current ?? null;

      if (device && format) {
        const canvases = [
          spectrumGpuCanvasRef.current,
          waterfallGpuCanvasRef.current,
        ];
        flushWebGpuPresentationMultiple({
          canvases,
          device,
          format,
        });
      } else {
        flushWebGpuPresentation({
          canvas: spectrumGpuCanvasRef.current,
          device,
          format,
        });
        flushWebGpuPresentation({
          canvas: waterfallGpuCanvasRef.current,
          device,
          format,
        });
      }
      clearOverlayCanvas(spectrumOverlayCanvasRef.current);
      clearOverlayCanvas(waterfallOverlayCanvasRef.current);
    }, [
      spectrumGpuCanvasRef,
      spectrumOverlayCanvasRef,
      waterfallGpuCanvasRef,
      waterfallOverlayCanvasRef,
      webgpuDeviceRef,
      webgpuFormatRef,
    ]);

    // Temporal frames ring buffer refs
    const temporalFramePoolRef = useRef<Float32Array[]>([]);
    const temporalWriteIndexRef = useRef(0);
    const temporalActiveCountRef = useRef(0);
    const activeTemporalFramesRef = useRef<Float32Array[]>([]);
    const hasTxSpectrumRevisionRef = useRef(false);
    const lastTxCenterFrequencyHzRef = useRef<number | null>(null);
    const lastTxSampleRateHzRef = useRef<number | null>(null);
    const lastTxSignalRef = useRef<string | null>(null);
    const lastTxPowerMilliDbmRef = useRef<number | null>(null);

    const resetTemporalAveragingState = useCallback(() => {
      resetWebGpuStreamTemporalHistory(
        temporalFramePoolRef.current,
        activeTemporalFramesRef.current,
      );
      temporalWriteIndexRef.current = 0;
      temporalActiveCountRef.current = 0;
    }, []);

    const invalidateSpectrumProcessingCaches = useCallback(() => {
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      lastRenderedPowerScaleRef.current = null;
      pendingFftSizeChangeRef.current = true;
      spectrumOutputBufferRef.current = null;
      resetTemporalAveragingState();
    }, [resetTemporalAveragingState]);

    useEffect(() => {
      const centerFrequencyHz =
        typeof reduxTxCenterFrequencyHz === "number" &&
        Number.isFinite(reduxTxCenterFrequencyHz)
          ? Math.round(reduxTxCenterFrequencyHz)
          : null;
      const sampleRateHz =
        typeof reduxTxSampleRateHz === "number" &&
        Number.isFinite(reduxTxSampleRateHz)
          ? Math.round(reduxTxSampleRateHz)
          : null;
      const signal = reduxTxSignal ?? null;
      const powerMilliDbm =
        typeof reduxTxPowerDbm === "number" && Number.isFinite(reduxTxPowerDbm)
          ? Math.round(reduxTxPowerDbm * 1000)
          : null;

      if (!hasTxSpectrumRevisionRef.current) {
        hasTxSpectrumRevisionRef.current = true;
        lastTxCenterFrequencyHzRef.current = centerFrequencyHz;
        lastTxSampleRateHzRef.current = sampleRateHz;
        lastTxSignalRef.current = signal;
        lastTxPowerMilliDbmRef.current = powerMilliDbm;
        return;
      } else if (
        lastTxCenterFrequencyHzRef.current === centerFrequencyHz &&
        lastTxSampleRateHzRef.current === sampleRateHz &&
        lastTxSignalRef.current === signal &&
        lastTxPowerMilliDbmRef.current === powerMilliDbm
      ) {
        return;
      }
      lastTxCenterFrequencyHzRef.current = centerFrequencyHz;
      lastTxSampleRateHzRef.current = sampleRateHz;
      lastTxSignalRef.current = signal;
      lastTxPowerMilliDbmRef.current = powerMilliDbm;
      invalidateSpectrumProcessingCaches();
      fullChannelWaveformRef.current = null;
      fullChannelRangeRef.current = null;
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      forceRenderRef.current?.();
    }, [
      invalidateSpectrumProcessingCaches,
      reduxTxCenterFrequencyHz,
      reduxTxSampleRateHz,
      reduxTxSignal,
      reduxTxPowerDbm,
    ]);

    // Refs for volatile rendering parameters to stabilize callbacks
    const fftColorRef = useRef(fftColor);
    const fillColorRef = useRef(fillColor);
    const colormapRef = useRef(colormap);
    const waterfallThemeRef = useRef(waterfallTheme);
    const wfSmoothEnabledRef = useRef(wfSmoothEnabled);
    const effectivePowerScaleRef = useRef(effectivePowerScale);
    const activeScaleDbMinRef = useRef(activeScaleDbMin);
    const activeScaleDbMaxRef = useRef(activeScaleDbMax);
    const showSpikeOverlayRef = useRef(showSpikeOverlay);
    const stableSpikeFloorDbmRef = useRef<number | null>(null);
    const stableSpikeClassifierRef = useRef<{
      confidence: number;
      suspensionBridgeScore: number;
      uDipScore: number;
      floorRelativePowerScore: number;
      sincPenaltyScore: number;
      captureQualityScore: number;
      envelopeFitScore: number;
      envelopeResidualScore: number;
    } | null>(null);
    const stableSpikeDecisionRef = useRef(false);
    const floorLinePercent = useMemo(() => {
      if (!showSpikeOverlay || !gpuSpikeAnalysis) return null;
      const span = Math.max(
        1,
        activeScaleDbMaxRef.current - activeScaleDbMinRef.current,
      );
      const ratio =
        (gpuSpikeAnalysis.floorDbm - activeScaleDbMinRef.current) / span;
      if (!Number.isFinite(ratio)) return null;
      return Math.max(0, Math.min(100, 100 - ratio * 100));
    }, [gpuSpikeAnalysis, showSpikeOverlay]);
    const awaitingDeviceDataRef = useRef(awaitingDeviceData);
    const demodFocusOverlayRef = useRef(demodFocusOverlay);
    const selectionOverlayRef = useRef(selectionOverlay);
    const nodePreviewRef = useRef(nodePreview);

    const liveDragSelectionRef = useRef<FrequencyRange | null>(null);
    const tooltipSpanRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
      fftColorRef.current = fftColor;
      fillColorRef.current = fillColor;
      colormapRef.current = colormap;
      waterfallThemeRef.current = waterfallTheme;
      wfSmoothEnabledRef.current = wfSmoothEnabled;
      effectivePowerScaleRef.current = effectivePowerScale;
      activeScaleDbMinRef.current = activeScaleDbMin;
      activeScaleDbMaxRef.current = activeScaleDbMax;
      showSpikeOverlayRef.current = showSpikeOverlay;
      awaitingDeviceDataRef.current = awaitingDeviceData;
      demodFocusOverlayRef.current = demodFocusOverlay;
      selectionOverlayRef.current = selectionOverlay;
      nodePreviewRef.current = nodePreview;
    }, [
      fftColor,
      fillColor,
      colormap,
      waterfallTheme,
      wfSmoothEnabled,
      effectivePowerScale,
      activeScaleDbMin,
      activeScaleDbMax,
      showSpikeOverlay,
      awaitingDeviceData,
      demodFocusOverlay,
      selectionOverlay,
      nodePreview,
    ]);

    useEffect(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      forceRenderRef.current?.();
    }, [resolvedThemeMode, fftColor, waterfallTheme]);

    const forceRenderRef = useRef<(() => void) | null>(null);

    // Pointer moves can arrive much faster than the FFT frame cadence. Keep
    // paused overlays responsive, but never synchronously force a full FFT
    // render once per pointer event while the user is panning/retuning.
    const dragRepaintFrameRef = useRef<number | null>(null);
    useEffect(
      () => () => {
        if (dragRepaintFrameRef.current !== null) {
          window.cancelAnimationFrame(dragRepaintFrameRef.current);
          dragRepaintFrameRef.current = null;
        }
      },
      [],
    );
    const scheduleInteractionRepaint = useCallback(() => {
      if (dragRepaintFrameRef.current !== null) return;
      dragRepaintFrameRef.current = window.requestAnimationFrame(() => {
        dragRepaintFrameRef.current = null;
        forceRenderRef.current?.();
      });
    }, []);

    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      forceRenderRef.current?.();
    }, [
      effectiveTxSlider,
      spectrumOverlayCanvasNode,
      overlayDirtyRef,
      isInitializingWebGPU,
      webgpuEnabled,
    ]);

    const handleSpikeCount = useCallback(
      (count: number) => {
        dispatch(setGpuSpikeCount(count));
      },
      [dispatch],
    );

    const flushMirrorPanToRedux = useCallback(() => {
      vizPanScheduler.flush();
    }, [vizPanScheduler]);

    const onHardwareRangeReanchor = useCallback((range: FrequencyRange) => {
      frequencyRangeRef.current = range;
      hardwareRangeReanchorPendingRef.current = true;
    }, []);

    const publishVizPanReanchor = useCallback(
      (pan: number) => {
        // A hardware re-anchor is an atomic range + pan operation. Flush any
        // queued gesture pan BEFORE re-anchoring: cancel() would drop the
        // in-flight motion, so the first publish after the retune would be the
        // re-anchor's hold-pan, briefly reversing the display ("initial scroll
        // goes opposite, stop + continue flips direction"). Flushing preserves
        // the accumulated gesture motion, then the re-anchor keeps the viewport
        // fixed while the acquisition moves.
        vizPanScheduler.flush();
        vizPanOffsetRef.current = pan;
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
        scheduleInteractionRepaint();
        mirrorPanPendingPublishRef.current = true;
        mirrorPanLastPublishedRef.current = pan;
        onVizPanChangeRef.current?.(pan);
      },
      [overlayDirtyRef, scheduleInteractionRepaint, vizPanScheduler],
    );

    const handleVizPanChange = useCallback(
      (pan: number) => {
        // Commit the ref immediately and schedule at most one render per
        // animation frame. Waiting for the next server frame makes mirrored
        // pan feel frozen; rendering once per native wheel event starves it.
        vizPanOffsetRef.current = pan;
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
        scheduleInteractionRepaint();
        // Keep the ref ahead of Redux so live FFT frames cannot rewind the
        // gesture. Publish the subscriber-local snapshot at the shared 20 Hz
        // cadence; the scheduler also flushes wheel inactivity and pointerup.
        mirrorPanPendingPublishRef.current = true;
        vizPanScheduler.submit(pan, "gesture");
        // The scheduler skips unchanged values; clear the pending guard here so
        // a stale Redux pan cannot fight the gesture on the next render.
        if (pan === mirrorPanLastPublishedRef.current) {
          mirrorPanPendingPublishRef.current = false;
        }
      },
      [scheduleInteractionRepaint, vizPanScheduler],
    );

    // Grab-pan ends on pointerup — clear the pending-ref guard so
    // sidebar / Redux consumers stay in lockstep with the gesture.
    useEffect(() => {
      const flush = () => flushMirrorPanToRedux();
      window.addEventListener("pointerup", flush);
      window.addEventListener("pointercancel", flush);
      return () => {
        window.removeEventListener("pointerup", flush);
        window.removeEventListener("pointercancel", flush);
      };
    }, [flushMirrorPanToRedux]);

    // Channel tunes / slider writes must win over an in-flight pan.
    // Echoes of our own publish match lastPublished and are ignored.
    useEffect(() => {
      const sync = resolveMirrorPanPropSync({
        pendingPublish: mirrorPanPendingPublishRef.current,
        incomingPan: vizPanOffset,
        lastPublishedPan: mirrorPanLastPublishedRef.current,
      });
      if (sync.clearPendingPublish) {
        mirrorPanPendingPublishRef.current = false;
      }
      if (!sync.applyIncomingPan) return;
      mirrorPanLastPublishedRef.current = vizPanOffset;
      vizPanOffsetRef.current = vizPanOffset;
    }, [vizPanOffset]);

    // Effect: When hardware frequency range changes, mark overlays for redraw
    // and sync the ref used by drag/render logic. Note: this does NOT retune the device.
    useEffect(() => {
      if (hardwareRangeReanchorPendingRef.current) {
        if (
          renderableFrequencyRange.min === frequencyRangeRef.current.min &&
          renderableFrequencyRange.max === frequencyRangeRef.current.max
        ) {
          hardwareRangeReanchorPendingRef.current = false;
        } else {
          overlayDirtyRef.current.grid = true;
          overlayDirtyRef.current.markers = true;
          return;
        }
      }
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      frequencyRangeRef.current = renderableFrequencyRange;
    }, [renderableFrequencyRange, overlayDirtyRef]);

    // Effect: When center frequency changes, only mark markers overlay for redraw
    // (grid lines stay at same positions, but frequency labels shift)
    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      centerFreqRef.current = centerFrequencyHz;
    }, [centerFrequencyHz, overlayDirtyRef]);

    // Effect: When device connection state changes, redraw markers overlay
    // to show/hide red limit lines indicating hardware boundaries
    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      if (!isDeviceConnected) {
        lastProcessedDataRef.current = null;
        lastProcessedFrameSignatureRef.current = null;
        lastIncomingFrameRef.current = null;
        renderWaveformRef.current = null;
        waveformFloatRef.current = null;
        fullChannelWaveformRef.current = null;
        fullChannelRangeRef.current = null;
        frameBufferRef.current = [];
        forceRenderRef.current?.();
      }
    }, [isDeviceConnected]);

    useEffect(() => {
      overlayDirtyRef.current.markers = true;
    }, [demodFocusOverlay, overlayDirtyRef]);

    // Effect: When Tx center frequency or sample rate changes, mark markers overlay as dirty
    // and redraw the canvas (especially useful if the visualization is paused)
    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      forceRenderRef.current?.();
    }, [reduxTxCenterFrequencyHz, reduxTxSampleRateHz, overlayDirtyRef]);

    // Effect: Recording state or sample rate changes trigger grid redraw
    // to update the recording indicator visual elements
    useEffect(() => {
      overlayDirtyRef.current.grid = true;
    }, [isIqRecordingActive, hardwareSampleRateHz]);

    const hasRealWaveform = !!(
      waveformFloatRef.current && waveformFloatRef.current.length > 0
    );
    useEffect(() => {
      if (awaitingDeviceData || placeholderErrorReason) {
        setHasRenderedSpectrumFrame(false);
        notifyRenderableFrame(false);
      }
    }, [awaitingDeviceData, notifyRenderableFrame, placeholderErrorReason]);

    useLayoutEffect(() => {
      // Loading / standby chrome must cover the last painted graph — never wipe
      // WebGPU for those. Clearing on Loading flashed black between handoff
      // and the Mock Tx standby preview paint.
      if (
        !placeholderErrorReason &&
        !shouldClearWebGpuForPlaceholder(explicitPlaceholderState?.kind)
      ) {
        return;
      }

      setHasRenderedSpectrumFrame(false);
      notifyRenderableFrame(false);
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      hasPresentedSpectrumFrameRef.current = false;
      lastPresentedSourceIdRef.current = null;
      hasPresentedStandbySpectrumRef.current = false;
      frameBufferRef.current = [];
      renderWaveformRef.current = null;
      waveformFloatRef.current = null;
      fullChannelWaveformRef.current = null;
      fullChannelRangeRef.current = null;
      resetTemporalAveragingState();
      clearSpectrumBackbuffer();
    }, [
      clearSpectrumBackbuffer,
      explicitPlaceholderState,
      isInitializingWebGPU,
      notifyRenderableFrame,
      placeholderErrorReason,
      resetTemporalAveragingState,
      webGpuStreamResetEpoch,
    ]);

    useEffect(() => {
      onCanvasLoadingChange?.(isLoadingPlaceholder);
    }, [isLoadingPlaceholder, onCanvasLoadingChange]);

    useSpectrumInteraction({
      disabled:
        selectionDisabled || interactionDisabled || isLoadingPlaceholder,
      selectionMode,
      spectrumGpuCanvasRef,
      spectrumGpuCanvasNode,
      spectrumContainerRef,
      zoomboxStateRef,
      frequencyRangeRef,
      spectrumWebgpuEnabled,
      activeSignalArea: _activeSignalArea,
      signalAreaBounds,
      hardwareSpectrumBounds,
      allowNegativeFrequencies,
      isPaused,
      onFrequencyRangeChange,
      selectionRange,
      onSelectionChange,
      fullPlotSelection: nodePreview,
      selectionEdgePanMode,
      rangeSelectionInteraction,
      vizZoomRef,
      vizZoomFloorRef,
      maxVizZoom,
      vizPanOffsetRef,
      clampedVizRangeRef,
      onVizPanChange: handleVizPanChange,
      onVizPanReanchor: publishVizPanReanchor,
      onHardwareRangeReanchor,
      vizDbMinRef,
      vizDbMaxRef,
      onFftDbLimitsChange: applyDbLimits,
      onVizZoomChange: setVizZoom,
      onVizZoomFloorChange,
      onVizZoomFloorPanChange,
      autoZoomStabilityRef,
      renderWaveformRef,
      maxBandwidthHz,
      liveDragSelectionRef,
      onDragRepaint: useCallback(() => {
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
        scheduleInteractionRepaint();
      }, [overlayDirtyRef, scheduleInteractionRepaint]),
      onTxSliderRepaint: useCallback(() => {
        setTxSliderVisualRevision((revision) => revision + 1);
      }, []),
      tooltipSpanRef,
      powerLineDbRef,
      onPowerLineDbChange: setPowerLineDb,
      onPowerLineHoldChange: useCallback((held: boolean) => {
        if (isPowerLineHeldRef.current === held) return;
        isPowerLineHeldRef.current = held;
        overlayDirtyRef.current.markers = true;
        forceRenderRef.current?.();
      }, []),
      powerScale: effectivePowerScale,
      txSliderRef,
      txSliderEnabled: !!effectiveTxSlider?.visible,
      txSliderLocked: isTxSliderLocked,
    });

    // Initialize WASM SIMD for optimized data processing
    const { processIqToDbmSpectrum } = useSpectrumMath({
      fftSize: 4096,
      enableSimd: true,
      fallbackToScalar: true,
    });

    // Use the unified spectrum renderer (WebGPU + Canvas2D fallback)
    const { drawSpectrum, cleanup: cleanupSpectrum } = useSpectrumRenderer();
    const { drawWebGPUFIFOWaterfall, cleanup: cleanupWebGPUFIFOWaterfall } =
      useDrawWebGPUFIFOWaterfall();

    useEffect(() => {
      // Error placeholders may tear down GPU state. Loading must not — the
      // overlay sits on top of the retained presentation until replacement.
      if (
        !placeholderErrorReason &&
        !shouldClearWebGpuForPlaceholder(explicitPlaceholderState?.kind)
      ) {
        return;
      }
      cleanupWebGPUFIFOWaterfall();
      clearSpectrumBackbuffer();
    }, [
      cleanupWebGPUFIFOWaterfall,
      clearSpectrumBackbuffer,
      explicitPlaceholderState,
      isInitializingWebGPU,
      placeholderErrorReason,
      webgpuEnabled,
    ]);

    // Effect: Clears all waterfall state when isWaterfallCleared becomes true.
    // This resets the persisted snapshot, CPU history, and WebGPU circular texture.
    useEffect(() => {
      if (isWaterfallCleared) {
        visualizerMachine?.clear(visualizerSessionKey);
        cleanupWebGPUFIFOWaterfall();
        waterfallBufferRef.current = null;
        waterfallCappedBufferRef.current = null;
        waterfallTextureSnapshotRef.current = null;
        waterfallTextureMetaRef.current = null;
        lastWaterfallRowRef.current = null;
        pausedWaterfallRowRef.current = null;
        pendingWaterfallRestoreRef.current = null;
        restoredWaterfallRef.current = false;
        clearOverlayCanvas(waterfallOverlayCanvasNode);
        onResetWaterfallCleared?.();
      }
    }, [
      cleanupWebGPUFIFOWaterfall,
      clearOverlayCanvas,
      isWaterfallCleared,
      onResetWaterfallCleared,
      visualizerMachine,
      visualizerSessionKey,
      waterfallOverlayCanvasNode,
    ]);

    const commitPendingSourcePresentationReset = useCallback(() => {
      pendingSourcePresentationResetRef.current = false;
      cleanupWebGPUFIFOWaterfall();
      waterfallBufferRef.current = null;
      waterfallCappedBufferRef.current = null;
      waterfallTextureSnapshotRef.current = null;
      waterfallTextureMetaRef.current = null;
      lastWaterfallRowRef.current = null;
      pausedWaterfallRowRef.current = null;
      pendingWaterfallRestoreRef.current = null;
      restoredWaterfallRef.current = false;
      renderWaveformRef.current = null;
      waveformFloatRef.current = null;
      fullChannelWaveformRef.current = null;
      fullChannelRangeRef.current = null;
      frameBufferRef.current = [];
      lastRenderableFrameRef.current = null;
      lastIncomingFrameRef.current = null;
      hasPresentedSpectrumFrameRef.current = false;
      hasPresentedStandbySpectrumRef.current = false;
      resetTemporalAveragingState();
      clearSpectrumBackbuffer();
      lastPresentedSourceIdRef.current = null;
    }, [
      cleanupWebGPUFIFOWaterfall,
      clearSpectrumBackbuffer,
      resetTemporalAveragingState,
      waterfallBufferRef,
    ]);

    // Redundant overlay logic removed (now handled by useSpectrumRenderer)

    const recoverPausedWaveformRef = useRef<() => boolean>(() => false);
    const previousIsStandbyRef = useRef(isStandby);

    // The standby bar commits with React, but the frame loop may not run
    // before the browser paints that commit. Preserve a same-source TX
    // waterfall across rapid standby/transmit toggles; reset only when the
    // retained frame belongs to a different presentation owner.
    useLayoutEffect(() => {
      if (previousIsStandbyRef.current === isStandby) return;
      const previousIsStandby = previousIsStandbyRef.current;
      previousIsStandbyRef.current = isStandby;
      const presentedSourceId =
        dataRef.current && !Array.isArray(dataRef.current)
          ? dataRef.current.source_id
          : (lastRenderableFrameRef.current?.source_id ??
            lastPausedFrameSourceIdRef.current);
      const preserveTxWaterfall = shouldPreserveWaterfallOnTxStandby({
        previousIsStandby,
        nextIsStandby: isStandby,
        expectedSourceId,
        presentedSourceId,
      });
      if (!preserveTxWaterfall) {
        // Defer the wipe until a replacement frame commits. Immediate clear
        // here flashed black under STANDBY while the one-shot preview was
        // still in flight (WebGPU clear → paint latency).
        pendingSourcePresentationResetRef.current = true;
      }
      forceRenderRef.current?.();
    }, [dataRef, expectedSourceId, isStandby]);

    /**
     * Animation loop for continuous spectrum and waterfall updates
     * While paused: keep rendering the last cached waveform without ingesting new data.
     *
     * NOTE: React's dev profiling creates PerformanceMeasure objects that leak memory.
     * WebGPU state changes also trigger performance measurements. Clear them each frame
     * to prevent memory ballooning (was reaching 40GB+ without this).
     */
    const onRenderFrame = useCallback(
      (_runId: number) => {
        // React dev profiling and WebGPU commits accumulate PerformanceMeasure
        // entries without bound; clear each frame to prevent multi-GB growth.
        if (typeof performance !== "undefined") {
          performance.clearMeasures?.();
          performance.clearMarks?.();
        }

        // Standby toggles are handled by the layout effect above. Never wipe
        // WebGPU from the animation loop — that raced the preserve path and
        // cleared the canvas a frame before the standby preview painted.
        if (previousIsStandbyRef.current !== isStandby) {
          previousIsStandbyRef.current = isStandby;
        }

        const spectrumGpuCanvas = spectrumGpuCanvasRef.current;
        const waterfallGpuCanvas = waterfallGpuCanvasRef.current;
        const spectrumOverlayCanvas = spectrumOverlayCanvasRef.current;
        const waterfallOverlayCanvas = waterfallOverlayCanvasRef.current;

        const currentData = dataRef.current;
        const incomingFrame = getLatestLiveFrame(currentData);
        let currentFrame = selectFrameForPresentation({
          incomingFrame,
          isPaused,
          isStandby,
          pauseSnapshotEnabled,
          cachedFrame: lastRenderableFrameRef.current,
        });
        const isTxPreviewFrame =
          (currentFrame as any)?.frame_status === "standby" ||
          (currentFrame as any)?.is_tx_preview === true ||
          (currentFrame as any)?.is_mock_tx_preview === true;
        const currentFrameMatchesRequestedRange =
          !currentFrame?.iq_data ||
          shouldAdoptLiveFrameRange({
            frameCenterHz: currentFrame.center_frequency_hz,
            frameSampleRateHz: currentFrame.sample_rate,
            requestedRange: frequencyRangeRef.current,
            isTxPreviewFrame,
          });
        const framePresentation = resolveFramePresentation({
          currentFrame,
          expectedSourceId,
          frameSourceIdFallback,
          lastPresentedSourceId: lastPresentedSourceIdRef.current,
          lastRenderableFrame: lastRenderableFrameRef.current,
          isStandby,
          presentationPolicy,
          awaitingDeviceData,
          isLoadingPlaceholder,
          isDeviceConnected,
          placeholderErrorReason,
          explicitPlaceholderState: explicitPlaceholderStateRef.current,
          hasPresentedSpectrumFrame: hasPresentedSpectrumFrameRef.current,
        });
        const {
          isCurrentSourceFrame,
          hasStalePresentedSource,
          hasCurrentSourceFrame,
          hasRenderableFrame,
          preservesMatchingStandbyPresentation,
          shouldBlockForSourceHandoff,
          showLoadingPlaceholder,
          showErrorPlaceholder,
          currentExplicitPlaceholderState,
          hasExplicitPlaceholder,
          preservePresentationDuringGap,
          isExplicitStandbyPlaceholder,
          explicitPlaceholderBlocksFrame,
          hasBlockingVisualPlaceholder,
          blockingPlaceholderKind,
        } = framePresentation;
        if (
          presentationPolicy?.clearStalePresentation &&
          (hasStalePresentedSource ||
            (currentFrame != null && !isCurrentSourceFrame))
        ) {
          // Mark a deferred reset only. Committing here wiped the FFT to
          // black before Mock Tx standby / Start Tx replacement frames arrived.
          pendingSourcePresentationResetRef.current = true;
        }
        if (currentFrame && !isCurrentSourceFrame) {
          lastIncomingFrameRef.current = null;
          const blockingState = explicitPlaceholderStateRef.current;
          const hasAuthoritativeBlockingState = !!(
            placeholderErrorReason ||
            isLoadingPlaceholder ||
            awaitingDeviceData ||
            (blockingState &&
              blockingState.kind !== "top-bar" &&
              blockingState.kind !== "overlay-only")
          );
          if (
            shouldCommitSourcePresentationReset(
              pendingSourcePresentationResetRef.current,
              false,
            )
          ) {
            commitPendingSourcePresentationReset();
          }
          // The mutable transport ref can still contain the previous source
          // while a handoff is in flight. Reject that frame without erasing
          // the last presentation; the target frame or delayed placeholder
          // will replace it.
          //
          // When paused, a reset (source switch / epoch bump) may have already
          // wiped the GPU buffers and the paused-frame cache. Returning here
          // would strand the canvas blank under the paused top-bar: the paused
          // recovery path below is the only thing that repaints a waveform.
          // Drop the stale frame (so it is never ingested) and fall through so
          // that recovery can run.
          if (!hasAuthoritativeBlockingState) {
            if (isPaused) {
              currentFrame = null;
            } else {
              return;
            }
          }
        }
        if (
          shouldCommitSourcePresentationReset(
            pendingSourcePresentationResetRef.current,
            hasRenderableFrame,
            undefined,
            preservesMatchingStandbyPresentation,
          )
        ) {
          commitPendingSourcePresentationReset();
        }
        if (hasRenderableFrame) {
          lastPresentedSourceIdRef.current =
            expectedSourceId ??
            currentFrame?.source_id ??
            frameSourceIdFallback ??
            null;
          lastPausedFrameSourceIdRef.current = currentFrame?.source_id ?? null;
        }

        // Notify the parent as soon as the first frame is present in the
        // mutable WebSocket ref. The parent uses this signal to remove its
        // loading placeholder; waiting until after the placeholder gate below
        // can deadlock the first live frame until Pause/Resume forces a new
        // render pass.
        if (hasRenderableFrame) {
          notifyRenderableFrame(true);
        }

        if (hasRenderableFrame && currentFrame) {
          lastRenderableFrameRef.current = currentFrame;
        }

        lastIncomingFrameRef.current = currentFrame;

        if (isExplicitStandbyPlaceholder) {
          if (
            !shouldClearBlockingPlaceholder(
              blockingPlaceholderClearKindRef.current,
              blockingPlaceholderKind,
            )
          ) {
            return;
          }
          blockingPlaceholderClearKindRef.current = blockingPlaceholderKind;
          lastProcessedDataRef.current = null;
          lastProcessedFrameSignatureRef.current = null;
          frameBufferRef.current = [];
          renderWaveformRef.current = null;
          waveformFloatRef.current = null;
          fullChannelWaveformRef.current = null;
          fullChannelRangeRef.current = null;
          frequencyRangeRef.current = frequencyRange;
          centerFreqRef.current = centerFrequencyHz;
          clearSpectrumBackbuffer();
          clearOverlayCanvas(spectrumOverlayCanvas);
          clearOverlayCanvas(waterfallOverlayCanvas);
          return;
        }

        if (
          showLoadingPlaceholder ||
          showErrorPlaceholder ||
          explicitPlaceholderBlocksFrame
        ) {
          if (preservePresentationDuringGap) {
            return;
          }
          if (
            !shouldClearBlockingPlaceholder(
              blockingPlaceholderClearKindRef.current,
              blockingPlaceholderKind,
            )
          ) {
            return;
          }
          blockingPlaceholderClearKindRef.current = blockingPlaceholderKind;
          clearSpectrumBackbuffer();
          clearOverlayCanvas(spectrumOverlayCanvas);
          clearOverlayCanvas(waterfallOverlayCanvas);

          if (spectrumOverlayCanvas) {
            const ctx = getCached2DContext(spectrumOverlayCanvas);
            if (ctx) {
              const dpr = getCanvasPixelRatio(
                window.devicePixelRatio || 1,
                canvasResolutionScale,
              );
              const logicalW = spectrumOverlayCanvas.width / dpr;
              const logicalH = spectrumOverlayCanvas.height / dpr;
              ctx.clearRect(0, 0, logicalW, logicalH);
            }
          }

          if (waterfallOverlayCanvas) {
            const ctx = getCached2DContext(waterfallOverlayCanvas);
            if (ctx) {
              const dpr = getCanvasPixelRatio(
                window.devicePixelRatio || 1,
                canvasResolutionScale,
              );
              const logicalW = waterfallOverlayCanvas.width / dpr;
              const logicalH = waterfallOverlayCanvas.height / dpr;
              ctx.clearRect(0, 0, logicalW, logicalH);
            }
          }
          return;
        }

        blockingPlaceholderClearKindRef.current = 0;

        clearOverlayCanvas(waterfallOverlayCanvas);

        const powerScale = effectivePowerScaleRef.current;
        const powerScaleChanged =
          lastRenderedPowerScaleRef.current !== powerScale;
        const fftWindowChanged =
          previousFftWindowRef.current !== (fftWindow ?? "Rectangular");
        const removeDcSpikeChanged =
          previousRemoveDcSpikeRef.current !== removeDcSpike;
        if (removeDcSpikeChanged) {
          // Do not let temporal averaging or a stitched snapshot retain bins
          // rendered with the previous DC-spike policy.
          resetTemporalAveragingState();
          fullChannelWaveformRef.current = null;
          fullChannelRangeRef.current = null;
        }
        const hasNewData =
          !isExplicitStandbyPlaceholder &&
          currentFrame &&
          getLiveFrameSignature(currentFrame) !==
            lastProcessedFrameSignatureRef.current &&
          (!!currentFrame.iq_data ||
            !!(currentFrame as any).waveform ||
            !!(currentFrame as any).data);
        const shouldReprocessCurrentFrame = !!(
          !isExplicitStandbyPlaceholder &&
          currentFrame &&
          (getLiveFrameSignature(currentFrame) ===
            lastProcessedFrameSignatureRef.current ||
            isPaused) &&
          (powerScaleChanged || fftWindowChanged || removeDcSpikeChanged) &&
          (!!currentFrame.iq_data ||
            !!(currentFrame as any).waveform ||
            !!(currentFrame as any).data)
        );
        let processedCurrentFrame = false;
        const frameAcquisitionRange =
          currentFrame &&
          Number.isFinite(currentFrame.center_frequency_hz) &&
          Number.isFinite(currentFrame.sample_rate) &&
          currentFrame.sample_rate > 0
            ? {
                min:
                  currentFrame.center_frequency_hz -
                  currentFrame.sample_rate / 2,
                max:
                  currentFrame.center_frequency_hz +
                  currentFrame.sample_rate / 2,
              }
            : null;
        // Process every incoming IQ frame immediately. The frame owns its
        // acquisition axis; an outrun mirror viewport is painted directly and
        // the resampler handles any uncovered bins at the noise floor.

        if (
          (hasNewData || shouldReprocessCurrentFrame) &&
          currentFrame?.iq_data
        ) {
          // Unified IQ→spectrum path: all live data is iq_data (Uint8Array).
          // The only variable is the dB offset for the power scale.
          const iqBytes = currentFrame?.iq_data;
          if (!iqBytes || iqBytes.length < 2) return;

          const requestedFrameRange = frequencyRangeRef.current;
          const frameRenderableRange = resolveLiveFrameRenderableFrequencyRange({
            currentFrame,
            requestedRange: requestedFrameRange,
            propsCenterFrequencyHz: centerFreqRef.current,
            propsHardwareSampleRateHz: hardwareSampleRateHz,
            preferRequestedRange: isIqRecordingActive,
            deviceKind: deviceProfile?.kind,
            backend: deviceBackend,
            deviceName,
            isRtlSdr: deviceProfile?.is_rtl_sdr,
          });
          // A frame from the previous hardware window is still useful for
          // demodulation, but it must not take ownership of the displayed
          // frequency axis. Leave the requested range intact until the
          // retuned frame reports its own axis.
          if (currentFrameMatchesRequestedRange) {
            frequencyRangeRef.current = frameRenderableRange;
          }

          let waveform: Float32Array;

          const rawSpectrum = resolveSpectrumWaveform({
            source: { iq_data: newestIqWindow(iqBytes, frontendFftSize) },
            processIq: (iqData) =>
              processIqToDbmSpectrum(
                iqData,
                effectiveDbmOffsetDb,
                frontendFftSize,
                fftWindow,
                spectrumOutputBufferRef.current ?? undefined,
              ),
          });
          if (!rawSpectrum) return;
          spectrumOutputBufferRef.current = rawSpectrum;
          waveform = removeDcSpike
            ? removeDcSpikeFromSpectrum(
                rawSpectrum,
                dcRemovedSpectrumBufferRef.current ?? undefined,
              )
            : rawSpectrum;
          if (removeDcSpike) {
            dcRemovedSpectrumBufferRef.current = waveform;
          }
          pendingFftSizeChangeRef.current = false;

          // Validate waveform before processing
          if (waveform && waveform.length > 0) {
            processedCurrentFrame = true;
            waveformFloatRef.current = waveform;
            lastProcessedDataRef.current = currentFrame;
            lastProcessedFrameSignatureRef.current =
              getLiveFrameSignature(currentFrame);
            lastRenderedPowerScaleRef.current = effectivePowerScale;
            previousFftWindowRef.current = fftWindow ?? "Rectangular";

            // Accumulate frequency-hop data into full-channel composite buffer.
            // This builds a 4096-bin representation of the entire channel span
            // from individual hop-sized I/Q chunks for intentional wide snapshots.
            // RTL-SDR must never synthesize a whole-channel buffer because its
            // hardware window is limited to the current 3.2MHz sample rate.
            const shouldAccumulate = shouldAccumulateFullChannelWaveform({
              isRtlSdr,
              deviceKind: deviceProfile?.kind,
              backend: deviceBackend,
              deviceName,
            });
            if (!shouldAccumulate) {
              fullChannelWaveformRef.current = null;
              fullChannelRangeRef.current = null;
            } else {
              const channelRange = frequencyRangeRef.current;
              if (!channelRange) return;
              const accumulated = accumulateFullChannelWaveform({
                state: {
                  waveform: fullChannelWaveformRef.current,
                  range: fullChannelRangeRef.current,
                },
                channelRange,
                hopCenterHz: currentFrame.center_frequency_hz,
                hopSampleRate: currentFrame.sample_rate,
                waveform,
              });
              fullChannelWaveformRef.current = accumulated.waveform;
              fullChannelRangeRef.current = accumulated.range;
            }

            // Architecture note: Only one active spectrum pipeline here.
            // The direct drawSpectrum path is the authoritative visible renderer.
            // Launching unifiedFFT.processUnified in parallel causes a second
            // GPU processing path that races the visible renderer, causing
            // flashing and color shifts during dBm/dB-range transitions.

            const temporalWindow = resolveFrameTemporalWindow({
              configuredWindow: getTemporalResolutionWindow(
                displayTemporalResolution,
                fftFrameRate,
              ),
              isRequestedNextFrame: isStandby || isPaused,
            });
            if (!currentFrameMatchesRequestedRange) {
              resetTemporalAveragingState();
            }
            const temporalUpdate = updateTemporalWaveform(
              waveform,
              temporalWindow,
              {
                framePool: temporalFramePoolRef.current,
                activeFrames: activeTemporalFramesRef.current,
                writeIndex: temporalWriteIndexRef.current,
                activeCount: temporalActiveCountRef.current,
                renderWaveform: renderWaveformRef.current,
              },
            );
            temporalWriteIndexRef.current = temporalUpdate.writeIndex;
            temporalActiveCountRef.current = temporalUpdate.activeCount;
            renderWaveformRef.current = temporalUpdate.renderWaveform;
          }
        } else if (
          currentFrame &&
          (currentFrame.iq_data ? isPaused : true) &&
          (currentFrame.iq_data ||
            (currentFrame as any).waveform ||
            (currentFrame as any).data) &&
          (currentFrame !== lastProcessedDataRef.current ||
            powerScaleChanged ||
            fftWindowChanged ||
            removeDcSpikeChanged)
        ) {
          let processedWaveform: Float32Array | undefined;

          if (currentFrame.iq_data) {
            // Paused: ingest once to avoid blank frames (file mode or first paused frame)
            processedWaveform = resolveSpectrumWaveform({
              source: currentFrame,
              processIq: (iqData) =>
                processIqToDbmSpectrum(
                  iqData,
                  effectiveDbmOffsetDb,
                  frontendFftSize,
                  fftWindow,
                  spectrumOutputBufferRef.current ?? undefined,
                ),
            });
            if (processedWaveform) {
              spectrumOutputBufferRef.current = processedWaveform;
            }
            previousFftWindowRef.current = fftWindow ?? "Rectangular";
          } else {
            // Handle pre-processed FFT data (playback mode)
            processedWaveform = resolveSpectrumWaveform({
              source: currentFrame,
            });
          }

          // Validate waveform before processing
          if (!processedWaveform || processedWaveform.length === 0) {
            return;
          }

          if (removeDcSpike) {
            processedWaveform = removeDcSpikeFromSpectrum(
              processedWaveform,
              dcRemovedSpectrumBufferRef.current ?? undefined,
            );
            dcRemovedSpectrumBufferRef.current = processedWaveform;
          }

          waveformFloatRef.current = processedWaveform;
          processedCurrentFrame = true;
          lastProcessedDataRef.current = currentFrame;
          lastProcessedFrameSignatureRef.current =
            getLiveFrameSignature(currentFrame);
          lastRenderedPowerScaleRef.current = powerScale;

          const temporalWindow = resolveFrameTemporalWindow({
            configuredWindow: getTemporalResolutionWindow(
              displayTemporalResolution,
              fftFrameRate,
            ),
            isRequestedNextFrame: isStandby || isPaused,
          });
          const temporalUpdate = updateTemporalWaveform(
            processedWaveform,
            temporalWindow,
            {
              framePool: temporalFramePoolRef.current,
              activeFrames: activeTemporalFramesRef.current,
              writeIndex: temporalWriteIndexRef.current,
              activeCount: temporalActiveCountRef.current,
              renderWaveform: renderWaveformRef.current,
            },
          );
          temporalWriteIndexRef.current = temporalUpdate.writeIndex;
          temporalActiveCountRef.current = temporalUpdate.activeCount;
          renderWaveformRef.current = temporalUpdate.renderWaveform;
          pendingFftSizeChangeRef.current = false;
        }

        previousRemoveDcSpikeRef.current = removeDcSpike;

        // Mirror-on can change viewport geometry without a fresh IQ frame.
        const mirrorPanOnlyRedraw = shouldMirrorPanOnlyRedraw({
          allowNegativeFrequencies,
          hasNewData: Boolean(hasNewData),
          shouldReprocessCurrentFrame,
          hasCachedWaveform: Boolean(
            renderWaveformRef.current && renderWaveformRef.current.length > 0,
          ),
          lastPaintedMirrorPan: lastPaintedMirrorPanRef.current,
          currentMirrorPan: vizPanOffsetRef.current,
        });
        const viewportOnlyRedraw =
          !allowNegativeFrequencies &&
          shouldRepaintCachedSpectrumForViewportChange({
            hasNewData: Boolean(hasNewData),
            shouldReprocessCurrentFrame,
            hasCachedWaveform: Boolean(
              renderWaveformRef.current && renderWaveformRef.current.length > 0,
            ),
            zoomChanged:
              lastPaintedZoomRef.current !== (vizZoomRef.current || 1),
            panChanged:
              lastPaintedMirrorPanRef.current !== vizPanOffsetRef.current,
            rangeChanged: !currentFrameMatchesRequestedRange,
          });

        if (!hasNewData && !shouldReprocessCurrentFrame && !isStandby) {
          if (isPaused) {
            if (!recoverPausedWaveformRef.current()) {
              return;
            }
          } else if (!mirrorPanOnlyRedraw && !viewportOnlyRedraw) {
            return;
          }
        }

        if (isStandby) {
          if (
            !hasRenderableFrame &&
            !hasRenderedSpectrumFrame &&
            (!renderWaveformRef.current ||
              renderWaveformRef.current.length !== effectiveFftSize ||
              !hasPresentedStandbySpectrumRef.current)
          ) {
            const previewWaveform = new Float32Array(effectiveFftSize).fill(
              FFT_MIN_DB,
            );
            const prev = renderWaveformRef.current;
            if (!prev || prev.length !== previewWaveform.length) {
              renderWaveformRef.current = new Float32Array(previewWaveform);
            } else {
              prev.set(previewWaveform);
            }
            waveformFloatRef.current = renderWaveformRef.current;
            hasPresentedStandbySpectrumRef.current = true;
          }

          if (frequencyRange) {
            frequencyRangeRef.current = frequencyRange;
          }
          centerFreqRef.current = centerFrequencyHz;

          // Explicit standby placeholders must not preserve the previous source's waterfall.
          const waterfallDevice = webgpuDeviceRef.current;
          const waterfallFormat = webgpuFormatRef.current;
          if (waterfallGpuCanvas && waterfallDevice && waterfallFormat) {
            const standbyWaterfallData = isExplicitStandbyPlaceholder
              ? new Float32Array(effectiveFftSize).fill(FFT_MIN_DB)
              : new Float32Array(0);
            drawWebGPUFIFOWaterfall({
              canvas: waterfallGpuCanvas,
              device: waterfallDevice,
              format: waterfallFormat,
              fftData: standbyWaterfallData,
              fftMin: activeScaleDbMinRef.current,
              fftMax: activeScaleDbMaxRef.current,
              driftAmount: 0,
              freeze: !isExplicitStandbyPlaceholder,
              colormap: colormapRef.current,
              colormapName: waterfallThemeRef.current,
            });
          }
        } else {
          hasPresentedStandbySpectrumRef.current = false;
        }

        // Update waveform reference after potential restoration
        const currentWaveform = renderWaveformRef.current;

        if (
          currentFrame &&
          currentWaveform &&
          currentWaveform.length > 0 &&
          shouldPublishProcessedSpectrumFrame({
            hasNewData: Boolean(hasNewData),
            shouldReprocessCurrentFrame,
            processedCurrentFrame,
          })
        ) {
          onSpectrumFrame?.(currentWaveform, currentFrame);
        }

        if (
          currentWaveform &&
          currentWaveform.length > 0 &&
          frequencyRangeRef.current
        ) {
          // IQ bins cover the frame's CF ± fs/2. Redux pan is still measured
          // against frequencyRangeRef (often start-anchored). Painting the
          // GPU |f| fold with those two axes mixed is the channel-island
          // regression: only a narrow band maps, the rest floors. Keep the
          // absolute Hz the gesture asked for, but re-base pan/zoom onto the
          // waveform axis so view + source + bins agree.
          const requestedViewRange = frequencyRangeRef.current;
          const sourceFrequencyRange =
            frameAcquisitionRange ??
            (Number.isFinite(centerFreqRef.current) &&
            typeof hardwareSampleRateHz === "number" &&
            Number.isFinite(hardwareSampleRateHz) &&
            hardwareSampleRateHz > 0
              ? {
                  min: centerFreqRef.current - hardwareSampleRateHz / 2,
                  max: centerFreqRef.current + hardwareSampleRateHz / 2,
                }
              : requestedViewRange);
          const paintContract = resolveLiveSpectrumPaintContract({
            requestedViewRange,
            sourceFrequencyRange,
            zoom: vizZoomRef.current || 1,
            panOffsetHz: vizPanOffsetRef.current,
            mirrorEnabled: allowNegativeFrequencies,
          });
          // Setting on → free pan + optional GPU fold. Fold arms inside
          // prepareSpectrumRenderData only when visual.min < 0.
          const mirrorOnGpu = Boolean(
            allowNegativeFrequencies &&
              spectrumWebgpuEnabled &&
              webgpuDeviceRef.current,
          );
          const resampleOnGpu = Boolean(
            spectrumWebgpuEnabled && webgpuDeviceRef.current,
          );
          const preparedSpectrum = prepareSpectrumRenderData({
            waveform: currentWaveform,
            frequencyRange: paintContract.paintViewportRange,
            sourceFrequencyRange: paintContract.sourceFrequencyRange,
            zoom: paintContract.zoom,
            panOffset: paintContract.panOffsetHz,
            invert: invertSpectrum,
            dbMin: activeScaleDbMinRef.current,
            dbMax: activeScaleDbMaxRef.current,
            inversionBuffer: invertedSpectrumBufferRef.current,
            // Always the setting, never "is viewport below 0". Passing the
            // viewport gate here re-enabled the positive pan clamp and froze
            // the spectrum while EditableCenterFrequency still updated Redux.
            // Live spectrum rendering is WebGPU-only. Do not run the CPU
            // snapshot resampler while the GPU is still initializing.
            allowNegativeFrequencies:
              allowNegativeFrequencies && mirrorOnGpu,
            mirrorOnGpu,
            resampleOnGpu,
            getZoomedData,
          });

          // Paint the current frame immediately. The shader floors only bins
          // that are truly outside the current acquisition window.
          const { visualRange } = preparedSpectrum;
          // Keep the pan the gesture/tune requested. Writing clampedPan back
          // into the ref on the mirror-off path froze the spectrum: every
          // paint rewrote vizPan into the acquisition while the VFO moved.
          lastPaintedMirrorPanRef.current = vizPanOffsetRef.current;
          lastPaintedZoomRef.current = vizZoomRef.current || 1;

          const currentTxSlider = txSliderRef.current as
            | (CanvasTxSliderState & {
                signalLabel?: string;
                powerDbm?: number;
              })
            | null;
          const spectrumWaveform = preparedSpectrum.spectrumWaveform;
          if (invertSpectrum) {
            invertedSpectrumBufferRef.current = spectrumWaveform;
          }
          const displayWaveform = spectrumWaveform;
          const displayVisualRange = visualRange;
          // Mirror fold follows the setting, not this frame's sign. Arming it
          // only after display.min crosses 0 Hz floors the new negative sliver
          // and then fills it in — a snap and a wipe around DC.
          const gpuMirrorActive = shouldEnableGpuMirrorFold({
            mirrorOnGpu,
            allowNegativeFrequencies,
            displayMinHz: displayVisualRange.min,
          });
          const displayFullCaptureRange = requestedViewRange;
          const displayCenterFrequencyHz =
            (displayVisualRange.min + displayVisualRange.max) / 2;
          const displayTxSlider = currentTxSlider
            ? {
                ...currentTxSlider,
                visibleMinHz: currentTxSlider.visibleMinHz,
                visibleMaxHz: currentTxSlider.visibleMaxHz,
                txCenterHz: currentTxSlider.txCenterHz,
              }
            : null;
          const displayLimitMarkers = limitMarkers;
          const displayDemodFocus = demodFocusOverlayRef.current
            ? {
                ...demodFocusOverlayRef.current,
                centerFrequencyHz:
                  demodFocusOverlayRef.current.centerFrequencyHz,
              }
            : null;
          const displaySelection = selectionOverlayRef.current
              ? { ...selectionOverlayRef.current }
            : null;
          const bottomReservedPx = nodePreview
            ? 0
            : compact
              ? 0
              : TX_SLIDER_ROW_HEIGHT;
          const markerOverlayOpacity =
            powerLineDbRef.current !== null ? 0.1 : 1;
          const skipSpikeAnalysis =
            mirrorPanOnlyRedraw && !hasNewData && !shouldReprocessCurrentFrame;
          // Spectrum render (using unified hook)
          if (spectrumGpuCanvas) {
            drawSpectrum({
              canvas: spectrumGpuCanvas,
              webgpuEnabled: spectrumWebgpuEnabled,
              isInitializingWebGPU,
              device: webgpuDeviceRef.current,
              format: webgpuFormatRef.current,
              waveform: displayWaveform,
              waveformDirty: processedCurrentFrame,
              frequencyRange: displayVisualRange,
              sourceFrequencyRange: resampleOnGpu
                ? sourceFrequencyRange
                : undefined,
              mirrorEnabled: gpuMirrorActive,
              reuseWaveformUpload: resampleOnGpu,
              fftMin: activeScaleDbMinRef.current,
              fftMax: activeScaleDbMaxRef.current,
              powerScale: effectivePowerScaleRef.current,
              nodePreview: nodePreviewRef.current,
              gridOverlayRenderer:
                compact || hasBlockingVisualPlaceholder
                  ? undefined
                  : gridOverlayRendererRef.current,
              markersOverlayRenderer:
                compact || hasBlockingVisualPlaceholder
                  ? undefined
                  : markersOverlayRendererRef.current,
              spikesOverlayRenderer: spikesOverlayRendererRef.current,
              overlayDirty: overlayDirtyRef.current,
              centerFrequencyHz: displayCenterFrequencyHz,
              isDeviceConnected,
              hardwareSampleRateHz: displayHardwareSampleRateHz,
              fftSize: effectiveFftSize,
              fftWindow,
              temporalResolution: displayTemporalResolution,
              reservedBottomPx: bottomReservedPx,
              fullCaptureRange: displayFullCaptureRange,
              isIqRecordingActive: compact ? false : isIqRecordingActive,
              limitMarkers: compact ? [] : displayLimitMarkers,
              showSpikeOverlay: showSpikeOverlayRef.current,
              // Node previews use the transparent 2D overlay canvas as the
              // single selection renderer. Painting the same band into the
              // spectrum backbuffer makes it flicker as frames swap.
              demodFocusOverlay: nodePreview
                ? null
                : liveDragSelectionRef.current
                  ? {
                      centerFrequencyHz:
                        (liveDragSelectionRef.current.min +
                          liveDragSelectionRef.current.max) /
                        2,
                      halfBandwidthHz:
                        (liveDragSelectionRef.current.max -
                          liveDragSelectionRef.current.min) /
                        2,
                      alignment: bandwidthAlignment,
                    }
                  : displayDemodFocus,
              selectionOverlay: nodePreview
                ? null
                : liveDragSelectionRef.current
                  ? {
                      minFrequencyHz: liveDragSelectionRef.current.min,
                      maxFrequencyHz: liveDragSelectionRef.current.max,
                    }
                  : displaySelection,
              txSlider: compact ? null : displayTxSlider,
              overlayOpacity: markerOverlayOpacity,
              canvasStatusRow: compact ? null : effectiveCanvasStatusRow,
              onSpikeCount: skipSpikeAnalysis
                ? undefined
                : (count) => {
                    dispatch(setGpuSpikeCount(count));
                  },
              onSpikeAnalysis: skipSpikeAnalysis
                ? undefined
                : (analysis) => {
                    const presented = presentSpikeAnalysis(
                      analysis as SpikeAnalysis,
                      stableSpikeClassifierRef.current,
                      stableSpikeDecisionRef.current,
                      stableSpikeFloorDbmRef.current,
                    );
                    if (!presented) return;
                    stableSpikeFloorDbmRef.current = presented.floorDbm;
                    stableSpikeClassifierRef.current = presented.classifier;
                    stableSpikeDecisionRef.current = presented.isNapt;
                    dispatch(setGpuSpikeAnalysis(presented.analysis));
                  },
              lineColor: fftColorRef.current,
              fillColor: fillColorRef.current,
              isStandby: isStandby,
              removeDcSpike,
            });

            if (!hasRenderedSpectrumFrame) {
              hasPresentedSpectrumFrameRef.current = true;
              setHasRenderedSpectrumFrame(true);
              notifyRenderableFrame(true);
            }
          }

          // Render overlays to 2D HTML canvas instead of WebGPU texture
          if (hasBlockingVisualPlaceholder) {
            clearOverlayCanvas(spectrumOverlayCanvas);
          }

          if (spectrumOverlayCanvas && !hasBlockingVisualPlaceholder) {
            const ctx = getCached2DContext(spectrumOverlayCanvas);
            if (ctx) {
              const dpr = getCanvasPixelRatio(
                window.devicePixelRatio || 1,
                canvasResolutionScale,
              );
              const logicalW = spectrumOverlayCanvas.width / dpr;
              const logicalH = spectrumOverlayCanvas.height / dpr;
              ctx.clearRect(0, 0, logicalW, logicalH);

              if (showSpikeOverlay && gpuSpikeAnalysis) {
                const hoveredSpike =
                  hoveredSpikeIndex === null
                    ? null
                    : gpuSpikeAnalysis.spikes.find(
                        (spike) => spike.index === hoveredSpikeIndex,
                      );
                if (hoveredSpike) {
                  const plotLeft = nodePreview ? 0 : FFT_AREA_MIN.x;
                  const plotRight = logicalW - (nodePreview ? 0 : 40);
                  const plotTop = nodePreview ? 0 : FFT_AREA_MIN.y;
                  const plotBottom =
                    logicalH - (nodePreview ? 0 : 40 + bottomReservedPx);
                  const x =
                    plotLeft +
                    ((hoveredSpike.frequencyHz - visualRange.min) /
                      Math.max(1, visualRange.max - visualRange.min)) *
                      (plotRight - plotLeft);
                  const y =
                    plotBottom -
                    ((hoveredSpike.powerDbm - activeScaleDbMinRef.current) /
                      Math.max(
                        1,
                        activeScaleDbMaxRef.current -
                          activeScaleDbMinRef.current,
                      )) *
                      (plotBottom - plotTop);
                  const bandWidth = Math.max(5, logicalW / 180);
                  ctx.save();
                  ctx.fillStyle = "rgba(220, 40, 255, 0.18)";
                  ctx.fillRect(
                    x - bandWidth / 2,
                    plotTop,
                    bandWidth,
                    plotBottom - plotTop,
                  );
                  ctx.fillStyle = "#d800ff";
                  ctx.beginPath();
                  ctx.moveTo(x, Math.max(plotTop, y - 22));
                  ctx.lineTo(x - 7, Math.max(plotTop, y - 8));
                  ctx.lineTo(x + 7, Math.max(plotTop, y - 8));
                  ctx.closePath();
                  ctx.fill();
                  ctx.restore();
                }
              }

              const activeSelection = liveDragSelectionRef.current
                ? {
                    minFrequencyHz: liveDragSelectionRef.current.min,
                    maxFrequencyHz: liveDragSelectionRef.current.max,
                  }
                : selectionOverlayRef.current;
              const activeDemodFocus =
                selectionMode === "range" && activeSelection
                  ? null
                  : liveDragSelectionRef.current
                    ? {
                        centerFrequencyHz:
                          (liveDragSelectionRef.current.min +
                            liveDragSelectionRef.current.max) /
                          2,
                        halfBandwidthHz:
                          (liveDragSelectionRef.current.max -
                            liveDragSelectionRef.current.min) /
                          2,
                        alignment: bandwidthAlignment,
                      }
                    : demodFocusOverlayRef.current;
              const rendersMarkersInWebGpuOverlay =
                !compact && !!markersOverlayRendererRef.current;

              if (
                !rendersMarkersInWebGpuOverlay &&
                !nodePreview &&
                centerFreqRef.current !== undefined
              ) {
                drawMarkersOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  visualRange,
                  centerFreqRef.current,
                  isDeviceConnected,
                  hardwareSampleRateHz,
                  frequencyRangeRef.current,
                  isIqRecordingActive,
                  compact ? [] : limitMarkers,
                  frontendFftSize,
                  fftWindow,
                  displayTemporalResolution,
                  !currentTxSlider?.visible,
                  bottomReservedPx,
                  compact ? undefined : (effectiveCanvasStatusRow ?? undefined),
                  1.0,
                  isStandby,
                );
              }

              if (!rendersMarkersInWebGpuOverlay && activeDemodFocus) {
                drawDemodFocusOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  visualRange,
                  activeDemodFocus,
                  nodePreview,
                  bottomReservedPx,
                  markerOverlayOpacity,
                );
              }

              if (!rendersMarkersInWebGpuOverlay && activeSelection) {
                drawSelectionOverlayOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  visualRange,
                  activeSelection,
                  nodePreview,
                  bottomReservedPx,
                );
              }

              if (
                shouldDrawZoomMarkersForCanvas(
                  nodePreview,
                  hasBlockingVisualPlaceholder,
                )
              ) {
                drawZoomMarkersOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  visualRange,
                  frequencyRangeRef.current,
                  bottomReservedPx,
                  markerOverlayOpacity,
                );
              }

              // Draw draggable horizontal power line
              if (powerLineDbRef.current !== null) {
                drawPowerLineOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  powerLineDbRef.current,
                  activeScaleDbMinRef.current,
                  activeScaleDbMaxRef.current,
                  effectivePowerScaleRef.current,
                  bottomReservedPx,
                  currentTxSlider?.powerDbm ?? null,
                  isPowerLineHeldRef.current,
                );
              }

              // Draw Zoombox if active
              if (zoomboxStateRef.current) {
                drawZoomboxOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  zoomboxStateRef.current,
                  nodePreview,
                  bottomReservedPx,
                  visualRange,
                );
              }
            }
          }

          // Waterfall render (only push new lines when not paused AND new data is available)
          // Note: Unified FFT system provides its own waterfall texture for instant synchronization
          // This fallback waterfall rendering is kept for compatibility when unified FFT is not available
          if (
            webgpuEnabled &&
            webgpuDeviceRef.current &&
            webgpuFormatRef.current &&
            waterfallGpuCanvas
          ) {
            const dims = waterfallGpuDimsRef.current;
            if (
              shouldRenderWaterfallWithFrameOrRestore(
                !!dims,
                !!currentFrame,
                !!pendingWaterfallRestoreRef.current,
              )
            ) {
              const waterfallDims = dims!;
              const isTxPreviewFrame =
                (currentFrame as any)?.is_tx_preview === true ||
                (currentFrame as any)?.is_mock_tx_preview === true;
              const shouldUpdateWaterfallRow =
                shouldAppendWaterfallFrame({
                  hasNewData,
                  isStandby,
                  isTxPreviewFrame,
                  coversDisplay: preparedSpectrum.coversDisplay,
                });

              // Waterfall texture strategy: Always resample to constant 4096 bins.
              // This 'bakes' the zoom into each row permanently, avoiding WebGPU
              // texture resets when zoom changes. The shader handles the final
              // mapping from 4096 bins to display pixels.
              // Ensure we have a persistent buffer for the fixed-width data
              if (
                !waterfallCappedBufferRef.current ||
                waterfallCappedBufferRef.current.length !== WATERFALL_BIN_COUNT
              ) {
                waterfallCappedBufferRef.current = new Float32Array(
                  WATERFALL_BIN_COUNT,
                );
              }
              const processed = waterfallCappedBufferRef.current;
              let waterfallBins: Float32Array = processed;

              // Bake the displayed axis (including |f| below 0 Hz) into each
              // new row so the waterfall follows the FFT past DC both ways.
              if (hasNewData) {
                waterfallBins = resolveWaterfallDisplayRow({
                  sourceWaveform: currentWaveform,
                  sourceRange: sourceFrequencyRange,
                  displayRange: displayVisualRange,
                  target: processed,
                  floorDb: activeScaleDbMinRef.current,
                });
              } else if (
                lastWaterfallRowRef.current &&
                lastWaterfallRowRef.current.length === WATERFALL_BIN_COUNT
              ) {
                waterfallBins = lastWaterfallRowRef.current;
              } else {
                waterfallBins = resolveWaterfallDisplayRow({
                  sourceWaveform: currentWaveform,
                  sourceRange: sourceFrequencyRange,
                  displayRange: displayVisualRange,
                  target: processed,
                  floorDb: activeScaleDbMinRef.current,
                });
              }

              if (shouldUpdateWaterfallRow) {
                // Cache the last row for pause state and snapshots
                if (
                  !lastWaterfallRowRef.current ||
                  lastWaterfallRowRef.current.length !== waterfallBins.length
                ) {
                  lastWaterfallRowRef.current = new Float32Array(
                    waterfallBins.length,
                  );
                  copyValidWaterfallRow(
                    waterfallBins,
                    lastWaterfallRowRef.current,
                    null,
                  );
                } else {
                  copyValidWaterfallRow(
                    waterfallBins,
                    lastWaterfallRowRef.current,
                    lastWaterfallRowRef.current,
                  );
                }

              } else {
                // Paused or no new data: keep the last complete row.
                waterfallBins = lastWaterfallRowRef.current ?? processed;
              }

              // Snapshot tracking: maintain a CPU-side copy of the waterfall texture
              // for session persistence. Always 4096 bins wide × RGBA.
              const textureBytesPerRow = WATERFALL_BIN_COUNT * 4;
              const textureByteSize = textureBytesPerRow * waterfallDims.height;
              if (
                !waterfallTextureSnapshotRef.current ||
                waterfallTextureSnapshotRef.current.length !== textureByteSize
              ) {
                const oldSnapshot = waterfallTextureSnapshotRef.current;
                const oldMeta = waterfallTextureMetaRef.current;

                const newSnapshot = new Uint8Array(textureByteSize);
                let newWriteRow = 0;

                if (oldSnapshot && oldMeta) {
                  // Repack the circular buffer by display age so the visible history
                  // stays in the same order after a height change. Matches WebGPU logic.
                  const prevH = oldMeta.height;
                  const needH = waterfallDims.height;
                  const prevRenderRow =
                    prevH > 0 ? (oldMeta.writeRow - 1 + prevH) % prevH : 0;
                  const nextRenderRow =
                    needH > 0 ? (oldMeta.writeRow - 1 + needH) % needH : 0;

                  for (let age = 0; age < needH; age++) {
                    const srcAge = Math.max(
                      0,
                      Math.min(prevH - 1, Math.floor((age * prevH) / needH)),
                    );
                    const srcY =
                      prevH > 0 ? (prevRenderRow - srcAge + prevH) % prevH : 0;
                    const dstY = (nextRenderRow - age + needH) % needH;

                    const srcOff = srcY * textureBytesPerRow;
                    const dstOff = dstY * textureBytesPerRow;
                    newSnapshot.set(
                      oldSnapshot.subarray(srcOff, srcOff + textureBytesPerRow),
                      dstOff,
                    );
                  }
                  newWriteRow = Math.min(oldMeta.writeRow, needH - 1);
                }

                waterfallTextureSnapshotRef.current = newSnapshot;
                waterfallTextureMetaRef.current = {
                  width: WATERFALL_BIN_COUNT,
                  height: waterfallDims.height,
                  writeRow: newWriteRow,
                };
              }
              const meta = waterfallTextureMetaRef.current;
              const snapshot = waterfallTextureSnapshotRef.current;
              const restoreTexture = resolvePendingWaterfallRestore({
                pendingRestore: pendingWaterfallRestoreRef.current,
                shouldUpdateWaterfallRow,
                hasRenderedRestore: restoredWaterfallRef.current,
              });

              // Sync restore data into CPU snapshot so auto-persist
              // doesn't overwrite restored history with an empty buffer.
              if (restoreTexture && meta && snapshot) {
                const restoreBytes = restoreTexture.data;
                const restoreW = restoreTexture.width;
                const restoreH = restoreTexture.height;
                if (
                  restoreW === WATERFALL_BIN_COUNT &&
                  restoreH === waterfallDims.height &&
                  restoreBytes.length === textureByteSize
                ) {
                  // Exact match — bulk copy
                  snapshot.set(restoreBytes);
                } else if (
                  restoreW === WATERFALL_BIN_COUNT &&
                  restoreBytes.length >= restoreW * restoreH * 4
                ) {
                  // Height may differ; repack chronologically to match WebGPU logic.
                  const prevH = restoreH;
                  const needH = waterfallDims.height;
                  const prevRenderRow =
                    prevH > 0
                      ? (restoreTexture.writeRow - 1 + prevH) % prevH
                      : 0;
                  const nextRenderRow =
                    needH > 0
                      ? (restoreTexture.writeRow - 1 + needH) % needH
                      : 0;

                  for (let age = 0; age < needH; age++) {
                    const srcAge = Math.max(
                      0,
                      Math.min(prevH - 1, Math.floor((age * prevH) / needH)),
                    );
                    const srcY =
                      prevH > 0 ? (prevRenderRow - srcAge + prevH) % prevH : 0;
                    const dstY = (nextRenderRow - age + needH) % needH;

                    const srcOff = srcY * textureBytesPerRow;
                    const dstOff = dstY * textureBytesPerRow;
                    snapshot.set(
                      restoreBytes.subarray(
                        srcOff,
                        srcOff + textureBytesPerRow,
                      ),
                      dstOff,
                    );
                  }
                }
                meta.writeRow = Math.max(
                  0,
                  Math.min(restoreTexture.writeRow, waterfallDims.height - 1),
                );
              }

              if (
                shouldUpdateWaterfallRow &&
                meta &&
                snapshot &&
                meta.width === WATERFALL_BIN_COUNT
              ) {
                let rowBytes = waterfallRowBytesRef.current;
                if (
                  !rowBytes ||
                  rowBytes.buffer !== waterfallBins.buffer ||
                  rowBytes.byteOffset !== waterfallBins.byteOffset ||
                  rowBytes.byteLength !== waterfallBins.byteLength
                ) {
                  rowBytes = new Uint8Array(
                    waterfallBins.buffer,
                    waterfallBins.byteOffset,
                    waterfallBins.byteLength,
                  );
                  waterfallRowBytesRef.current = rowBytes;
                }
                const row = meta.writeRow;
                const offset = row * textureBytesPerRow;
                snapshot.set(rowBytes, offset);
                const nextWriteRow = row + 1;
                meta.writeRow =
                  nextWriteRow === waterfallDims.height ? 0 : nextWriteRow;
                if (pendingWaterfallRestoreRef.current) {
                  pendingWaterfallRestoreRef.current = null;
                  restoredWaterfallRef.current = false;
                }

                const now = performance.now();
                if (
                  visualizerMachine &&
                  now - lastVisualizerAutoPersistAtRef.current > 250
                ) {
                  lastVisualizerAutoPersistAtRef.current = now;
                  visualizerMachine.persist(visualizerSessionKey, {
                    waveform: renderWaveformRef.current,
                    waterfallTextureSnapshot: snapshot,
                    waterfallTextureMeta: meta,
                    waterfallBuffer: waterfallBufferRef.current,
                    waterfallDims: waterfallDimsRef.current,
                  });
                }
              }

              const waterfallDevice = webgpuDeviceRef.current;
              const waterfallFormat = webgpuFormatRef.current;
              if (!waterfallDevice || !waterfallFormat) return;

              // Pass only the validated 4096-bin row; no retune interpolation
              // or shifted placeholder row is synthesized here.
              drawWebGPUFIFOWaterfall({
                canvas: waterfallGpuCanvas,
                device: waterfallDevice,
                format: waterfallFormat,
                fftData: waterfallBins,
                fftDataBuffer: undefined,
                fftSize: effectiveFftSize,
                sampleRate: hardwareSampleRateHz,
                centerFrequencyHz: centerFreqRef.current,
                fftMin: activeScaleDbMinRef.current,
                fftMax: activeScaleDbMaxRef.current,
                driftAmount: 0,
                freeze: !shouldUpdateWaterfallRow,
                restoreTexture,
                wfSmooth: wfSmoothEnabledRef.current,
                colormap: colormapRef.current,
                colormapName: waterfallThemeRef.current,
              });
              if (restoreTexture) {
                restoredWaterfallRef.current = true;
              }
            } else if (isPaused) {
              const restore = pendingWaterfallRestoreRef.current ?? undefined;
              const FIXED_WATERFALL_BINS = 4096;
              const targetWidth = restore?.width ?? FIXED_WATERFALL_BINS;

              let rowBuffer: Float32Array | null = null;
              if (targetWidth > 0) {
                rowBuffer = lastWaterfallRowRef.current;
                if (!rowBuffer || rowBuffer.length !== targetWidth) {
                  if (
                    !pausedWaterfallRowRef.current ||
                    pausedWaterfallRowRef.current.length !== targetWidth
                  ) {
                    pausedWaterfallRowRef.current = new Float32Array(
                      targetWidth,
                    );
                    pausedWaterfallRowRef.current.fill(-120);
                  } else {
                    pausedWaterfallRowRef.current.fill(-120);
                  }
                  restoredWaterfallRef.current = true;
                }
                rowBuffer = pausedWaterfallRowRef.current;
              }

              if (rowBuffer) {
                drawWebGPUFIFOWaterfall({
                  canvas: waterfallGpuCanvas,
                  device: webgpuDeviceRef.current!,
                  format: webgpuFormatRef.current!,
                  fftData: rowBuffer,
                  fftMin: activeScaleDbMinRef.current,
                  fftMax: activeScaleDbMaxRef.current,
                  driftAmount: 0,
                  freeze: true,
                  restoreTexture: restore,
                  colormap: colormapRef.current,
                  colormapName: waterfallThemeRef.current,
                });
              }
            }
          }
        }
      },
      [
        drawSpectrum,
        drawWebGPUFIFOWaterfall,
        isPaused,
        invertSpectrum,
        pauseSnapshotEnabled,
        displayTemporalResolution,
        spectrumWebgpuEnabled,
        webgpuEnabled,
        webgpuDeviceRef,
        webgpuFormatRef,
        gridOverlayRendererRef,
        markersOverlayRendererRef,
        isDeviceConnected,
        spectrumGpuCanvasNode,
        waterfallGpuCanvasNode,
        drawLoadingPlaceholder,
        clearOverlayCanvas,
        clearSpectrumBackbuffer,
        commitPendingSourcePresentationReset,
        presentationPolicy,
        awaitingDeviceData,
        expectedSourceId,
        frameSourceIdFallback,
        placeholderErrorReason,
        isLoadingPlaceholder,
        hasRenderedSpectrumFrame,
        frontendFftSize,
        notifyRenderableFrame,
        dispatch,
        WATERFALL_PLACEHOLDER_FONT,
        fftFrameRate,
        fftWindow,
        removeDcSpike,
        resetTemporalAveragingState,
        frequencyRange,
        allowNegativeFrequencies,
        deviceProfile?.kind,
        deviceProfile?.is_rtl_sdr,
        deviceBackend,
        deviceName,
        drawMarkersOnContext,
        drawDemodFocusOnContext,
        drawSelectionOverlayOnContext,
        drawZoomMarkersOnContext,
        hardwareSampleRateHz,
        isIqRecordingActive,
        limitMarkers,
        compact,
        nodePreview,
        canvasResolutionScale,
        onSpectrumFrame,
        selectionMode,
        bandwidthAlignment,
        visualizerMachine,
        visualizerSessionKey,
        effectiveCanvasStatusRow,
        isStandby,
        gpuSpikeAnalysis,
        hoveredSpikeIndex,
      ],
    );

    const onBecomeVisible = useCallback(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
    }, []);

    const { forceRender } = useFftRenderCoordinator({
      isPaused,
      onRenderFrame,
      onBecomeVisible,
      targetFPS: fftFrameRate,
      forceRenderRef,
    });

    useFftCanvasInvalidation({
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
      deviceProfileKind: deviceProfile?.kind,
      deviceIsRtlSdr: deviceProfile?.is_rtl_sdr,
      hardwareSampleRateHz,
      limitMarkers,
      markersOverlayRendererRef,
      clearOverlayCanvas,
      spectrumOverlayCanvas: spectrumOverlayCanvasNode,
    });

    const { ensurePausedFrame } = usePauseLogic({
      isPaused,
      waterfallBufferRef,
      waterfallDimsRef,
      dataRef,
      forceRender,
      snapshotScope: visualizerSessionKey,
      enabled: pauseSnapshotEnabled,
      pausedSnapshotRef,
    });

    const { recoverPausedWaveform } = usePausedSpectrumRecovery({
      enabled: pauseSnapshotEnabled,
      isPaused,
      renderWaveformRef,
      spectrumOutputBufferRef,
      lastProcessedFrameRef: lastProcessedDataRef,
      pausedSnapshotRef,
      processIqToDbmSpectrum,
      dbmOffset: effectiveDbmOffsetDb,
      fftSize: frontendFftSize,
      fftWindow,
      fallbackBinCount: 1024,
      fallbackDb: FFT_MIN_DB,
    });
    recoverPausedWaveformRef.current = recoverPausedWaveform;

    // Build a serializable snapshot of current visualizer state for session persistence.
    // Includes waveform data, waterfall texture, and dimensional metadata.
    const buildVisualizerSessionSnapshot =
      useCallback((): FFTVisualizerSnapshot | null => {
        const waveform = renderWaveformRef.current ?? waveformFloatRef.current;
        const waterfallTextureSnapshot = waterfallTextureSnapshotRef.current;
        const waterfallTextureMeta = waterfallTextureMetaRef.current;
        const waterfallBuffer = waterfallBufferRef.current;

        if (
          !waveform &&
          !waterfallTextureSnapshot &&
          !waterfallTextureMeta &&
          !waterfallBuffer &&
          !waterfallDimsRef.current
        ) {
          return null;
        }

        return {
          waveform: waveform ? new Float32Array(waveform) : null,
          waterfallTextureSnapshot: waterfallTextureSnapshot
            ? new Uint8Array(waterfallTextureSnapshot)
            : null,
          waterfallTextureMeta: waterfallTextureMeta
            ? { ...waterfallTextureMeta }
            : null,
          waterfallBuffer: waterfallBuffer
            ? new Uint8ClampedArray(waterfallBuffer)
            : null,
          waterfallDims: waterfallDimsRef.current
            ? { ...waterfallDimsRef.current }
            : null,
        };
      }, []);

    // Restore visualizer state from a previously saved snapshot.
    // Handles three data formats: waveform, legacy waterfall buffer, and WebGPU texture snapshot.
    const restoreVisualizerSessionSnapshot = useCallback(
      (snapshot: FFTVisualizerSnapshot | null) => {
        if (!snapshot) {
          return false;
        }

        let restored = false;

        if (snapshot.waveform && snapshot.waveform.length > 0) {
          const waveform = new Float32Array(snapshot.waveform);
          renderWaveformRef.current = waveform;
          waveformFloatRef.current = new Float32Array(snapshot.waveform);
          restored = true;
        }

        // Legacy waterfall buffer path (2D canvas mode)
        if (snapshot.waterfallBuffer && snapshot.waterfallDims) {
          waterfallBufferRef.current = new Uint8ClampedArray(
            snapshot.waterfallBuffer,
          );
          waterfallDimsRef.current = { ...snapshot.waterfallDims };
          restored = true;
        }

        // WebGPU texture snapshot path (modern mode)
        if (
          snapshot.waterfallTextureSnapshot &&
          snapshot.waterfallTextureMeta
        ) {
          waterfallTextureSnapshotRef.current = new Uint8Array(
            snapshot.waterfallTextureSnapshot,
          );
          waterfallTextureMetaRef.current = {
            ...snapshot.waterfallTextureMeta,
          };
          pendingWaterfallRestoreRef.current = {
            data: new Uint8Array(snapshot.waterfallTextureSnapshot),
            width: snapshot.waterfallTextureMeta.width,
            height: snapshot.waterfallTextureMeta.height,
            writeRow: snapshot.waterfallTextureMeta.writeRow,
          };
          restoredWaterfallRef.current = false;
          restored = true;
        }

        return restored;
      },
      [],
    );

    const persistVisualizerSession = useCallback(() => {
      if (!visualizerMachine) {
        return;
      }

      visualizerMachine.persist(
        visualizerSessionKey,
        buildVisualizerSessionSnapshot(),
      );
    }, [
      buildVisualizerSessionSnapshot,
      visualizerMachine,
      visualizerSessionKey,
    ]);

    const clearLocalVisualizerSession = useCallback(() => {
      cleanupWebGPUFIFOWaterfall();
      waterfallBufferRef.current = null;
      waterfallCappedBufferRef.current = null;
      waterfallTextureSnapshotRef.current = null;
      waterfallTextureMetaRef.current = null;
      lastWaterfallRowRef.current = null;
      pausedWaterfallRowRef.current = null;
      pendingWaterfallRestoreRef.current = null;
      restoredWaterfallRef.current = false;
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      renderWaveformRef.current = null;
      waveformFloatRef.current = null;
      fullChannelWaveformRef.current = null;
      fullChannelRangeRef.current = null;
      frameBufferRef.current = [];
      resetTemporalAveragingState();
      clearOverlayCanvas(waterfallOverlayCanvasNode);
    }, [
      cleanupWebGPUFIFOWaterfall,
      clearOverlayCanvas,
      resetTemporalAveragingState,
      waterfallOverlayCanvasNode,
    ]);

    useEffect(() => {
      const previousSessionKey = activeVisualizerSessionKeyRef.current;
      if (previousSessionKey === visualizerSessionKey) {
        return;
      }

      visualizerMachine?.persist(
        previousSessionKey,
        buildVisualizerSessionSnapshot(),
      );
      activeVisualizerSessionKeyRef.current = visualizerSessionKey;

      // Switching sources is a presentation handoff, not a disconnect. Reset
      // processing state so samples cannot blend across devices, while leaving
      // the current GPU surfaces painted until a saved target presentation or
      // its first live frame is ready to replace them.
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      lastWaterfallRowRef.current = null;
      pausedWaterfallRowRef.current = null;
      frameBufferRef.current = [];
      resetTemporalAveragingState();

      const restoredFromMachine = canRestoreVisualizerSession
        ? restoreVisualizerSessionSnapshot(
            visualizerMachine?.restore(visualizerSessionKey) ?? null,
          )
        : false;
      // Defer GPU wipe until a replacement frame commits — including standby
      // handoffs. Immediate clearLocalVisualizerSession flashed black under
      // STANDBY while the one-shot preview was still in flight.
      pendingSourcePresentationResetRef.current = !restoredFromMachine;
      if (restoredFromMachine) {
        forceRenderRef.current?.();
      }
    }, [
      buildVisualizerSessionSnapshot,
      canRestoreVisualizerSession,
      clearLocalVisualizerSession,
      isStandby,
      resetTemporalAveragingState,
      restoreVisualizerSessionSnapshot,
      visualizerMachine,
      visualizerSessionKey,
    ]);

    // Hotplug can reconnect to the same source id, so a session-key change is
    // not enough to protect against presenting old I/Q. This explicit epoch
    // clears CPU history, the circular waterfall texture, and both WebGPU
    // presentation surfaces before the replacement stream's first frame.
    useEffect(() => {
      if (lastWebGpuStreamResetEpochRef.current === webGpuStreamResetEpoch) {
        return;
      }
      lastWebGpuStreamResetEpochRef.current = webGpuStreamResetEpoch;
      visualizerMachine?.clear(visualizerSessionKey);
      clearLocalVisualizerSession();
      lastIncomingFrameRef.current = null;
      // A paused canvas is still renderable: the paused recovery path repaints
      // a waveform from the snapshot / floor fallback. Flipping this to false
      // while paused strands the canvas under a loading placeholder (or blank)
      // because no live frame will arrive to flip it back until resume.
      if (!isPaused) {
        setHasRenderedSpectrumFrame(false);
        hasPresentedSpectrumFrameRef.current = false;
        notifyRenderableFrame(false);
      }
      clearSpectrumBackbuffer();
      forceRenderRef.current?.();
    }, [
      clearLocalVisualizerSession,
      clearSpectrumBackbuffer,
      notifyRenderableFrame,
      visualizerMachine,
      visualizerSessionKey,
      webGpuStreamResetEpoch,
      isPaused,
    ]);

    // Effect: On mount: restore visualizer state from machine if available.
    // On unmount: persist current state to machine and cleanup resources.
    useEffect(() => {
      const restoredFromMachine = canRestoreVisualizerSession
        ? restoreVisualizerSessionSnapshot(
            latestVisualizerMachineRef.current?.restore(
              latestVisualizerSessionKeyRef.current,
            ) ?? null,
          )
        : false;
      if (restoredFromMachine) {
        forceRenderRef.current?.();
      }

      return () => {
        latestVisualizerMachineRef.current?.persist(
          latestVisualizerSessionKeyRef.current,
          buildVisualizerSessionSnapshot(),
        );
        cleanupSpectrum();
        cleanupWebGPUFIFOWaterfall();
      };
    }, [
      buildVisualizerSessionSnapshot,
      canRestoreVisualizerSession,
      cleanupWebGPUFIFOWaterfall,
      cleanupSpectrum,
      restoreVisualizerSessionSnapshot,
    ]);

    // Effect: When hardware frequency range changes, invalidate live caches.
    // While paused, keep the cached waveform intact so a channel/zoom change
    // redraws the frozen frame instead of rebuilding from a transient frame.
    useEffect(() => {
      const prevRange = frequencyRangeRef.current;
      if (hardwareRangeReanchorPendingRef.current) {
        if (
          renderableFrequencyRange.min === frequencyRangeRef.current.min &&
          renderableFrequencyRange.max === frequencyRangeRef.current.max
        ) {
          hardwareRangeReanchorPendingRef.current = false;
        } else {
          if (isPaused) {
            forceRender();
          }
          return;
        }
      }
      frequencyRangeRef.current = renderableFrequencyRange;

        if (
          renderableFrequencyRange &&
          prevRange &&
          (prevRange.min !== renderableFrequencyRange.min ||
            prevRange.max !== renderableFrequencyRange.max) &&
          shouldClearSpectrumWaveformForRangeChange({ isPaused })
        ) {
          lastProcessedDataRef.current = null;
          lastProcessedFrameSignatureRef.current = null;
          frameBufferRef.current = [];
          renderWaveformRef.current = null;
          waveformFloatRef.current = null;
          fullChannelWaveformRef.current = null;
          fullChannelRangeRef.current = null;
        }

      if (isPaused) {
        forceRender();
      }
    }, [
      renderableFrequencyRange,
      isPaused,
      forceRender,
    ]);

    // Effect: Tracks when new data frames arrive while paused.
    // Frame arrival is an imperative notification; the live (non-paused) case
    // is already handled by useFFTAnimation's rAF loop. This avoids a polling
    // timer and keeps the update outside React state.
    useEffect(() => {
      if (!isPaused) return;

      return subscribeFrameArrivals(() => {
        const currentData = dataRef.current;
        const currentFrame = getLatestLiveFrame(currentData);
        const hasData = !!(
          currentFrame &&
          (currentFrame.iq_data ||
            (currentFrame as any).waveform ||
            (currentFrame as any).data)
        );

        if (hasData && currentFrame !== lastIncomingFrameRef.current) {
          lastIncomingFrameRef.current = currentFrame;
          forceRender();
        }
      });
    }, [dataRef, isPaused, forceRender]);

    // Effect: Manages canvas dimensions, DPR scaling, and overlay dirty flags on resize.
    // Uses both window resize event and ResizeObserver for container changes.
    useEffect(() => {
      // Use the state value directly as a fallback — the ref may not be
      // synced yet when this effect first runs after a canvas mount.
      const gpuCanvas = spectrumGpuCanvasRef.current ?? spectrumGpuCanvasNode;

      const handleResize = () => {
        const dpr = getCanvasPixelRatio(
          window.devicePixelRatio || 1,
          canvasResolutionScale,
        );

        // Use offsetWidth/offsetHeight instead of getBoundingClientRect() —
        // getBoundingClientRect() returns post-CSS-transform visual dimensions,
        // but React Flow applies transform: scale(zoom) to the viewport. Using
        // offset* gives us the actual CSS layout dimensions the canvas needs.
        const getLayoutSize = (el: HTMLElement | null | undefined) => {
          if (!el) return null;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (w > 0 && h > 0) return { width: w, height: h };
          return null;
        };

        const spectrumRect =
          getLayoutSize(gpuCanvas?.parentElement) ??
          getLayoutSize(spectrumContainerRef.current);
        const waterfallRect = getLayoutSize(
          waterfallGpuCanvasRef.current?.parentElement,
        );

        if (spectrumRect && spectrumOverlayCanvasRef.current) {
          const canvas = spectrumOverlayCanvasRef.current;
          const targetW = spectrumRect.width * dpr;
          const targetH = spectrumRect.height * dpr;
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            canvas.style.width = `${spectrumRect.width}px`;
            canvas.style.height = `${spectrumRect.height}px`;
            getCached2DContext(canvas)?.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }

        if (spectrumRect && spectrumWebgpuEnabled && gpuCanvas) {
          const targetW = Math.max(1, Math.round(spectrumRect.width * dpr));
          const targetH = Math.max(1, Math.round(spectrumRect.height * dpr));
          if (gpuCanvas.width !== targetW || gpuCanvas.height !== targetH) {
            gpuCanvas.width = targetW;
            gpuCanvas.height = targetH;
            gpuCanvas.style.width = `${spectrumRect.width}px`;
            gpuCanvas.style.height = `${spectrumRect.height}px`;
          }

          spectrumWidthRef.current = spectrumRect.width;
          spectrumHeightRef.current = spectrumRect.height;
          overlayDirtyRef.current.grid = true;
          overlayDirtyRef.current.markers = true;
        }

        if (waterfallRect && waterfallOverlayCanvasRef.current) {
          const canvas = waterfallOverlayCanvasRef.current;
          const targetW = waterfallRect.width * dpr;
          const targetH = waterfallRect.height * dpr;
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            canvas.style.width = `${waterfallRect.width}px`;
            canvas.style.height = `${waterfallRect.height}px`;
            getCached2DContext(canvas)?.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }

        if (waterfallRect && waterfallGpuCanvasRef.current) {
          const canvas = waterfallGpuCanvasRef.current;
          const targetW = Math.max(1, Math.round(waterfallRect.width * dpr));
          const targetH = Math.max(1, Math.round(waterfallRect.height * dpr));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            canvas.style.width = `${waterfallRect.width}px`;
            canvas.style.height = `${waterfallRect.height}px`;
          }

          const marginX = Math.round(40 * dpr);
          const marginY = Math.round(8 * dpr);
          const displayWidth = Math.max(
            1,
            Math.round(waterfallRect.width * dpr - marginX * 2),
          );
          const displayHeight = Math.max(
            1,
            Math.round(waterfallRect.height * dpr - marginY * 2),
          );
          if (waterfallDataWidthRef.current !== displayWidth) {
            waterfallDataWidthRef.current = displayWidth;
          }
          const dataWidth = waterfallDataWidthRef.current;
          waterfallGpuDimsRef.current = {
            width: dataWidth,
            height: displayHeight,
          };
        }

        if (isPaused) {
          ensurePausedFrame();
        }

        forceRenderRef.current?.();
      };

      handleResize();
      window.addEventListener("resize", handleResize);

      const resizeObserver = new ResizeObserver(() => handleResize());
      const spectrumParent = gpuCanvas?.parentElement;
      const waterfallParent = waterfallGpuCanvasRef.current?.parentElement;
      if (spectrumParent) resizeObserver.observe(spectrumParent);
      if (waterfallParent) resizeObserver.observe(waterfallParent);
      // Also observe the spectrumContainerRef itself — in nodePreview mode
      // the canvas parent may not be available when the effect first runs
      // (React Flow defers node layout), so we watch the container directly.
      const containerEl = spectrumContainerRef.current;
      if (containerEl && containerEl !== spectrumParent) {
        resizeObserver.observe(containerEl);
      }

      return () => {
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
      };
    }, [
      spectrumWebgpuEnabled,
      isPaused,
      ensurePausedFrame,
      spectrumGpuCanvasNode,
      spectrumOverlayCanvasNode,
      waterfallGpuCanvasNode,
      waterfallOverlayCanvasNode,
      canvasResolutionScale,
    ]);

    // Effect: Periodic memory cleanup (every 30s). Returns oversized buffers to pool
    // and clears stale waveform data. Skips cleanup when paused to preserve snapshot state.
    useEffect(() => {
      const cleanupInterval = setInterval(() => {
        if (isPaused) return;

        if (waterfallBufferRef.current && waterfallDimsRef.current) {
          const { width, height } = waterfallDimsRef.current;
          const expectedSize = width * height * 4;
          if (waterfallBufferRef.current.length > expectedSize * 1.5) {
            returnBufferToPool(waterfallBufferRef.current);
            waterfallBufferRef.current = getBufferFromPool(expectedSize);
          }
        }

        const currentFrameForCleanup = getLatestLiveFrame(dataRef.current);
        if (
          waveformFloatRef.current &&
          !currentFrameForCleanup?.iq_data &&
          !(currentFrameForCleanup as any)?.waveform &&
          !(currentFrameForCleanup as any)?.data
        ) {
          waveformFloatRef.current = null;
        }
      }, 30000);

      return () => clearInterval(cleanupInterval);
    }, [
      dataRef,
      waterfallDimsRef,
      returnBufferToPool,
      getBufferFromPool,
      isPaused,
    ]);

    // Effect: When paused with WebGPU becoming ready, trigger a render to show
    // the restored/snapshot state on the newly initialized canvas.
    useEffect(() => {
      if (!isPaused) return;
      if (!webgpuEnabled) return;
      if (!webgpuDeviceRef.current || !webgpuFormatRef.current) return;
      forceRender();
    }, [isPaused, webgpuEnabled, forceRender]);

    // Effect: When visualization parameters change (dB limits, zoom),
    // mark overlays dirty and trigger paused re-render to update immediately.
    // Pan is ref-driven during gestures; syncing Redux pan here re-marked
    // overlays on every coalesced publish and duplicated rAF overlay work.
    useEffect(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      if (isPaused) {
        forceRender();
      }
    }, [
      vizDbMin,
      vizDbMax,
      currentVizZoom,
      isPaused,
      forceRender,
    ]);

    // Effect: Handles power scale (dB vs dBm) switches separately for immediate updates.
    // Preserves render buffers to redraw from existing IQ frame rather than showing blank.
    useEffect(() => {
      if (previousPowerScaleRef.current === effectivePowerScale) {
        return;
      }
      previousPowerScaleRef.current = effectivePowerScale;
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      lastRenderedPowerScaleRef.current = null;
      // Keep render buffers intact so the new power scale can redraw immediately
      // from the existing live IQ frame instead of flashing a blank placeholder.
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      if (isPaused) {
        forceRender();
      }
    }, [effectivePowerScale, isPaused, forceRender]);

    const lastExpectedSourceIdRef = useRef<string | null | undefined>(
      expectedSourceId,
    );

    // Reject cached processing state as soon as the expected source changes,
    // but retain the already-painted presentation until the target source
    // supplies its first frame. The delayed loading placeholder remains the
    // fallback for a slow handoff instead of becoming a mandatory middle step.
    useEffect(() => {
      if (expectedSourceId !== lastExpectedSourceIdRef.current) {
        lastExpectedSourceIdRef.current = expectedSourceId;
        lastProcessedDataRef.current = null;
        lastProcessedFrameSignatureRef.current = null;
        lastRenderableFrameRef.current = null;
        lastPausedFrameSourceIdRef.current = null;
        frameBufferRef.current = [];
        fullChannelWaveformRef.current = null;
        fullChannelRangeRef.current = null;
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
        forceRender();
      }
    }, [expectedSourceId, forceRender]);

    // Effect: When FFT size changes, drop the cached processed frame so the
    // next render recomputes at the newly selected resolution.
    useEffect(() => {
      if (previousFftSizeRef.current === effectiveFftSize) {
        return;
      }

      previousFftSizeRef.current = effectiveFftSize;
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      pendingFftSizeChangeRef.current = true;
      if (isPaused) {
        forceRender();
      }
    }, [effectiveFftSize, isPaused, forceRender]);

    const buildSnapshotData = useCallback(
      (options?: SnapshotDataOptions): SnapshotData | null => {
        const waveform = renderWaveformRef.current;
        const frequencyRangeCurrent = frequencyRangeRef.current;
        if (!waveform || waveform.length === 0 || !frequencyRangeCurrent) {
          return null;
        }

        const includeWaterfall = options?.includeWaterfall ?? true;
        const copyWaveforms = options?.copyWaveforms ?? true;

        return {
          waveform: copyWaveforms ? new Float32Array(waveform) : waveform,
          fullChannelWaveform:
            shouldAccumulateFullChannelWaveform({
              isRtlSdr,
              deviceKind: deviceProfile?.kind,
              backend: deviceBackend,
              deviceName,
            }) && fullChannelWaveformRef.current
              ? copyWaveforms
                ? new Float32Array(fullChannelWaveformRef.current)
                : fullChannelWaveformRef.current
              : null,
          frequencyRange: { ...frequencyRangeCurrent },
          dbMin: roundDbValue(vizDbMinRef.current),
          dbMax: roundDbValue(vizDbMaxRef.current),
          powerScale: effectivePowerScaleRef.current,
          fftSize: effectiveFftSize,
          fftWindow: fftWindow ?? "Rectangular",
          centerFrequencyHz: centerFreqRef.current,
          isDeviceConnected,
          vizZoom: vizZoomRef.current,
          vizPanOffset: vizPanOffsetRef.current,
          waterfallTextureSnapshot:
            includeWaterfall && waterfallTextureSnapshotRef.current
              ? new Uint8Array(waterfallTextureSnapshotRef.current)
              : null,
          waterfallTextureMeta:
            includeWaterfall && waterfallTextureMetaRef.current
              ? { ...waterfallTextureMetaRef.current }
              : null,
          waterfallBuffer:
            includeWaterfall && waterfallBufferRef.current
              ? new Uint8ClampedArray(waterfallBufferRef.current)
              : null,
          waterfallDims:
            includeWaterfall && waterfallDimsRef.current
              ? { ...waterfallDimsRef.current }
              : null,
          webgpuEnabled,
          hardwareSampleRateHz,
          isIqRecordingActive,
          colormap: colormap || [],
          demodFocusOverlay: demodFocusOverlayRef.current,
          activeSignalArea: _activeSignalArea,
        };
      },
      [
        colormap,
        effectiveFftSize,
        fftWindow,
        hardwareSampleRateHz,
        isDeviceConnected,
        isIqRecordingActive,
        isRtlSdr,
        webgpuEnabled,
        _activeSignalArea,
      ],
    );

    const getCompositeSnapshot = useCallback(() => {
      const spectrumCanvas = spectrumGpuCanvasRef.current;
      const waterfallCanvas = waterfallGpuCanvasRef.current;

      if (!spectrumCanvas) {
        return null;
      }

      const width = spectrumCanvas.width;
      const waterfallHeight = waterfallCanvas?.height ?? 0;
      const height = spectrumCanvas.height + waterfallHeight;
      const compositeCanvas = document.createElement("canvas");
      compositeCanvas.width = width;
      compositeCanvas.height = height;
      const ctx = getCached2DContext(compositeCanvas);
      if (!ctx) {
        return null;
      }

      const srcSpectrum =
        (spectrumCanvas as any)._lastFrameCanvas || spectrumCanvas;
      ctx.drawImage(srcSpectrum, 0, 0);
      if (waterfallCanvas) {
        const srcWaterfall =
          (waterfallCanvas as any)._lastFrameCanvas || waterfallCanvas;
        ctx.drawImage(srcWaterfall, 0, spectrumCanvas.height);
      }

      return {
        dataUrl: compositeCanvas.toDataURL("image/png"),
        width,
        height,
      };
    }, [spectrumWebgpuEnabled, webgpuEnabled]);

    useImperativeHandle(
      ref,
      () => ({
        getSpectrumCanvas: () => spectrumGpuCanvasRef.current,
        getWaterfallCanvas: () => waterfallGpuCanvasRef.current,
        getSpectrumOverlayCanvas: () => spectrumOverlayCanvasRef.current,
        getWaterfallOverlayCanvas: () => waterfallOverlayCanvasRef.current,
        triggerSnapshotRender: () => {
          forceRender();
        },
        getSnapshotData: buildSnapshotData,
        getCompositeSnapshot,
      }),
      [
        spectrumWebgpuEnabled,
        webgpuEnabled,
        buildSnapshotData,
        getCompositeSnapshot,
      ],
    );

    return (
      <Suspense fallback={<div>Loading FFT visualization…</div>}>
        {nodePreview ? (
          <NodePreviewLayout>
            <NodePreviewCanvasWrapper
              ref={spectrumContainerRef}
              style={NODE_PREVIEW_BACKGROUND_STYLE}
            >
              {canvasPlaceholderState && (
                <CanvasPlaceholder state={canvasPlaceholderState} />
              )}
              {!isInitializingWebGPU && (
                <CanvasLayer
                  ref={setSpectrumGpuCanvasNode}
                  id="fft-spectrum-canvas-webgpu"
                />
              )}
              <CanvasLayer
                ref={_setSpectrumOverlayCanvasNode}
                id="fft-spectrum-canvas-overlay"
              />
              {floorLinePercent !== null && (
                <FloorLineOverlay
                  style={
                    {
                      "--floor-line-top": `${floorLinePercent}%`,
                    } as React.CSSProperties
                  }
                />
              )}
            </NodePreviewCanvasWrapper>
            <Vfo
              visualState="compact"
              drawingType="dom"
              orientation="bottom"
              frequencyRange={frequencyRange}
              centerFrequencyHz={(frequencyRange.min + frequencyRange.max) / 2}
              data-testid="fft-node-mini-vfo"
              data-center={nodePreviewMiniVfoMetrics?.center}
              style={{ height: 42, flex: "0 0 42px" }}
            />
            <NodePreviewSelectionBar
              data-testid="fft-node-selection-bar"
              data-has-selection={
                nodePreviewSelectionBarLabels ? "true" : "false"
              }
            >
              {nodePreviewSelectionBarLabels ? (
                <>
                  <span data-testid="fft-node-stats-selection">
                    Center: {nodePreviewSelectionBarLabels.center}
                  </span>
                  <span>
                    Bandwidth: {nodePreviewSelectionBarLabels.bandwidth}
                  </span>
                </>
              ) : (
                <span data-testid="fft-node-stats-selection">
                  No current bandwidth selection
                </span>
              )}
            </NodePreviewSelectionBar>
            <NodePreviewStatsMeta data-testid="fft-node-stats-meta">
              <span>FFT Size: {effectiveFftSize.toLocaleString()}</span>
              <span>
                Sample Rate:{" "}
                {formatFrequency(
                  hardwareSampleRateHz ??
                    frequencyRange.max - frequencyRange.min,
                  {
                    showUnits: true,
                    precisionMHz: 3,
                    precisionGHz: 3,
                    precisionKHz: 3,
                  },
                ).replace(/(\d)(?=[A-Za-z])/g, "$1 ")}
              </span>
              <span>{deviceName || placeholderSourceLabel || "Unknown"}</span>
            </NodePreviewStatsMeta>
          </NodePreviewLayout>
        ) : (
          <VisualizerContainer
            style={compact ? COMPACT_VISUALIZER_STYLE : EMPTY_STYLE}
          >
            <VisualizerContent
              style={compact ? COMPACT_VISUALIZER_CONTENT_STYLE : EMPTY_STYLE}
            >
              <SpectrumSection>
                {!compact && (
                  <SectionTitleRow>
                    <SectionTitle>FFT Signal Display</SectionTitle>
                    {headerActionContent && (
                      <SectionTitleActions
                        data-disabled={
                          !!canvasPlaceholderState &&
                          canvasPlaceholderState.kind !== "top-bar"
                        }
                      >
                        {headerActionContent}
                      </SectionTitleActions>
                    )}
                  </SectionTitleRow>
                )}
                <SpectrumRow>
                  <CanvasWrapper
                    ref={spectrumContainerRef}
                    onDoubleClick={onCenterFrequencyDoubleClick}
                  >
                    {canvasPlaceholderState && (
                      <CanvasPlaceholder state={canvasPlaceholderState} />
                    )}
                    {!isInitializingWebGPU && (
                      <CanvasLayer
                        ref={setSpectrumGpuCanvasNode}
                        id="fft-spectrum-canvas-webgpu"
                      />
                    )}
                    <CanvasLayer
                      ref={_setSpectrumOverlayCanvasNode}
                      id="fft-spectrum-canvas-overlay"
                    />
                    {floorLinePercent !== null && (
                      <FloorLineOverlay
                        style={
                          {
                            "--floor-line-top": `${floorLinePercent}%`,
                          } as React.CSSProperties
                        }
                      />
                    )}

                    {selectionTooltipText &&
                      selectionMode === "range" &&
                      !nodePreview && (
                        <SelectionTooltip>
                          <strong>Selection</strong>
                          <span ref={tooltipSpanRef}>
                            Span: {selectionTooltipText.spanHz} Hz
                          </span>
                        </SelectionTooltip>
                      )}
                    {txSliderVisualMetrics && !compact ? (
                      <TxSliderVisualRow data-testid="tx-slider-visual-row">
                        <TxSliderVisualLabel>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              height: "18px",
                            }}
                          >
                            <TxSliderLockButton
                              type="button"
                              onClick={() =>
                                setIsTxSliderLocked((value) => !value)
                              }
                              aria-pressed={isTxSliderLocked}
                              aria-label={
                                isTxSliderLocked
                                  ? "Unlock Tx slider"
                                  : "Lock Tx slider"
                              }
                              title={
                                isTxSliderLocked
                                  ? "Unlock Tx slider"
                                  : "Lock Tx slider"
                              }
                            >
                              {isTxSliderLocked ? (
                                <Lock size={10} strokeWidth={2.5} />
                              ) : (
                                <Unlock size={10} strokeWidth={2.5} />
                              )}
                            </TxSliderLockButton>
                            <TxSliderMetaText>
                              {txSliderDisplayLabel}
                            </TxSliderMetaText>
                          </div>
                        </TxSliderVisualLabel>
                        <TxSliderVisualTrack>
                          <TxSliderVisualBase />
                          <TxSliderVisualBand
                            $width={txSliderVisualMetrics.width}
                            $centerLeft={txSliderVisualMetrics.centerLeft}
                            $isTransmitting={isTransmittingGlobal}
                          />
                          {!txSliderVisualMetrics.isOffScreen && (
                            <>
                              <TxSliderVisualCenterFrequencyText
                                $isTransmitting={isTransmittingGlobal}
                                $isLocked={isTxSliderLocked}
                                style={
                                  {
                                    "--tx-center-label-left": `${txSliderVisualMetrics.centerLeft}%`,
                                  } as React.CSSProperties
                                }
                              >
                                {isTxSliderLocked ? (
                                  <TxSliderCenterLockIcon aria-hidden="true">
                                    <Lock size={10} strokeWidth={2.5} />
                                  </TxSliderCenterLockIcon>
                                ) : null}
                                {txSliderVisualMetrics.centerHzFormatted}
                              </TxSliderVisualCenterFrequencyText>
                              <TxSliderVisualText
                                $isTransmitting={isTransmittingGlobal}
                                style={
                                  {
                                    "--tx-label-left": `${txSliderVisualMetrics.centerLeft}%`,
                                  } as React.CSSProperties
                                }
                              >
                                <span>
                                  {txSliderVisualMetrics.bandwidthFormatted}
                                </span>
                                {txSliderVisualMetrics.powerLabel ? (
                                  <TxSliderVisualPower
                                    $isTransmitting={isTransmittingGlobal}
                                  >
                                    <Zap
                                      size={9}
                                      strokeWidth={2.2}
                                      style={{
                                        display: "inline-block",
                                        verticalAlign: "-1px",
                                        marginRight: "3px",
                                        marginLeft: "4px",
                                      }}
                                    />
                                    {txSliderVisualMetrics.powerLabel}
                                  </TxSliderVisualPower>
                                ) : null}
                              </TxSliderVisualText>
                            </>
                          )}
                          {txSliderVisualMetrics.isOffScreen &&
                            txSliderVisualMetrics.offScreenDirection && (
                              <TxSliderVisualOffScreenIndicator
                                type="button"
                                $direction={
                                  txSliderVisualMetrics.offScreenDirection
                                }
                                $isTransmitting={isTransmittingGlobal}
                                onClick={handleOffscreenIndicatorClick}
                              >
                                {txSliderVisualMetrics.offScreenDirection ===
                                "left"
                                  ? "←"
                                  : ""}{" "}
                                {txSliderVisualMetrics.centerHzFormatted} ·{" "}
                                {txSliderVisualMetrics.powerLabel ?? "Unknown"}{" "}
                                · {txSliderVisualMetrics.bandwidthFormatted}{" "}
                                {txSliderVisualMetrics.offScreenDirection ===
                                "right"
                                  ? "→"
                                  : ""}
                              </TxSliderVisualOffScreenIndicator>
                            )}
                        </TxSliderVisualTrack>
                        <span aria-hidden="true" />
                      </TxSliderVisualRow>
                    ) : null}
                  </CanvasWrapper>
                </SpectrumRow>
              </SpectrumSection>
            </VisualizerContent>
          </VisualizerContainer>
        )}
      </Suspense>
    );
  }),
);

FFTCanvas.displayName = "FFTCanvas";

export default FFTCanvas;
