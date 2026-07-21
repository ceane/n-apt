import { useCallback, useRef } from "react";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import type { SpikeAnalysis } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDraw3DWaterfallSignal } from "@n-apt/hooks/useDraw3DWaterfallSignal";
import {
  type DemodFocusOverlay,
  type SelectionOverlay,
  type TxSliderOverlayState,
  useOverlayRenderer,
} from "@n-apt/hooks/useOverlayRenderer";
import { OverlayTextureRenderer } from "@n-apt/hooks/useWebGPUInit";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
import type { LiveCanvasStatusRow } from "@n-apt/hooks/useDraw2DFFTSignal";

const finiteOrEmpty = (value: number | undefined | null) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const getMarkersOverlaySignature = ({
  width,
  height,
  dpr,
  nodePreview,
  centerFrequencyHz,
  isDeviceConnected,
  hardwareSampleRateHz,
  fullCaptureRange,
  isIqRecordingActive,
  limitMarkers = [],
  fftSize,
  fftWindow,
  temporalResolution,
  reservedBottomPx,
  demodFocusOverlay,
  selectionOverlay,
  txSlider,
  overlayOpacity = 1,
  canvasStatusRow,
  isStandby = false,
  fftMin,
  fftMax,
}: Pick<
  SpectrumRendererOptions,
  | "centerFrequencyHz"
  | "isDeviceConnected"
  | "hardwareSampleRateHz"
  | "fullCaptureRange"
  | "isIqRecordingActive"
  | "limitMarkers"
  | "fftSize"
  | "fftWindow"
  | "temporalResolution"
  | "reservedBottomPx"
  | "demodFocusOverlay"
  | "selectionOverlay"
  | "txSlider"
  | "overlayOpacity"
  | "canvasStatusRow"
  | "nodePreview"
  | "isStandby"
  | "fftMin"
  | "fftMax"
> & {
  width: number;
  height: number;
  dpr: number;
}) => {
  const markerSignature = limitMarkers
    .map((marker) => `${marker.freq}:${marker.kind ?? ""}:${marker.label}`)
    .join(",");
  const demodSignature = demodFocusOverlay
    ? [
        finiteOrEmpty(demodFocusOverlay.centerFrequencyHz),
        finiteOrEmpty(demodFocusOverlay.halfBandwidthHz),
        demodFocusOverlay.alignment,
      ].join(":")
    : "";
  const selectionSignature = selectionOverlay
    ? [
        finiteOrEmpty(selectionOverlay.minFrequencyHz),
        finiteOrEmpty(selectionOverlay.maxFrequencyHz),
      ].join(":")
    : "";
  const txSignature = txSlider?.visible
    ? [
        "visible",
        finiteOrEmpty(txSlider.visibleMinHz),
        finiteOrEmpty(txSlider.visibleMaxHz),
        finiteOrEmpty(txSlider.txCenterHz),
        finiteOrEmpty(txSlider.txSampleRateHz),
        txSlider.signalLabel ?? "",
        finiteOrEmpty(txSlider.powerDbm),
      ].join(":")
    : "hidden";
  const statusSignature = canvasStatusRow
    ? [
        canvasStatusRow.sampleRateLabel,
        canvasStatusRow.txModeLabel ?? "",
        canvasStatusRow.fftSizeLabel,
        canvasStatusRow.fftWindowLabel,
        canvasStatusRow.timingLabel,
      ].join(":")
    : "";

  return [
    width,
    height,
    dpr,
    nodePreview ? "preview" : "full",
    finiteOrEmpty(centerFrequencyHz),
    isDeviceConnected ? "connected" : "disconnected",
    finiteOrEmpty(hardwareSampleRateHz),
    finiteOrEmpty(fullCaptureRange?.min),
    finiteOrEmpty(fullCaptureRange?.max),
    isIqRecordingActive ? "recording" : "idle",
    markerSignature,
    finiteOrEmpty(fftSize),
    fftWindow ?? "",
    temporalResolution ?? "",
    reservedBottomPx,
    demodSignature,
    selectionSignature,
    txSignature,
    statusSignature,
    isStandby ? "standby" : "active",
    finiteOrEmpty(fftMin),
    finiteOrEmpty(fftMax),
  ].join("|");
};

export interface SpectrumRendererOptions {
  /** The target canvas element (WebGPU) */
  canvas: HTMLCanvasElement | null;

  /** Whether WebGPU is currently enabled and available */
  webgpuEnabled: boolean;
  /** Whether WebGPU is currently in the process of initializing */
  isInitializingWebGPU?: boolean;
  /** WebGPU device instance */
  device?: GPUDevice | null;
  /** WebGPU preferred canvas format */
  format?: GPUTextureFormat | null;

  /** Render input data to visualize (live I/Q bytes or precomputed spectrum floats) */
  waveform: Uint8Array | Float32Array;
  /** The current frequency range (min/max MHz) to display on the X-axis */
  frequencyRange: { min: number; max: number };
  /** Minimum dB value for the Y-axis */
  fftMin: number;
  /** Maximum dB value for the Y-axis */
  fftMax: number;
  /** Display scale label for the Y-axis */
  powerScale?: "dB" | "dBm";

  /** (WebGPU only) The overlay renderer instance for the grid */
  gridOverlayRenderer?: OverlayTextureRenderer | null;
  /** (WebGPU only) The overlay renderer instance for markers/labels */
  markersOverlayRenderer?: OverlayTextureRenderer | null;
  /** (WebGPU only) The overlay renderer instance for spike markers */
  spikesOverlayRenderer?: OverlayTextureRenderer | null;
  /** An object containing dirty flags to trigger overlay updates */
  overlayDirty?: { grid: boolean; markers: boolean; spikes: boolean };

  /** Center frequency in MHz for marker placement */
  centerFrequencyHz?: number;
  /** Whether the SDR device is currently connected (for marker visibility) */
  isDeviceConnected?: boolean;
  /** Hardware sample rate in Hz for block boundary markers */
  hardwareSampleRateHz?: number;
  /** FFT size displayed in the live canvas status row */
  fftSize?: number;
  /** FFT window displayed in the live canvas status row */
  fftWindow?: string;
  /** Temporal resolution displayed in the live canvas status row */
  temporalResolution?: "low" | "medium" | "high";
  /** Bottom pixels reserved below the FFT plot for VFO/status labels */
  reservedBottomPx?: number;
  /** The full unzoomed capture range used as an anchor for hardware blocks */
  fullCaptureRange?: { min: number; max: number };
  /** Whether I/Q recording is active (forces hardware block labels) */
  isIqRecordingActive?: boolean;
  /** Hardware limit markers derived from signals.yaml */
  limitMarkers?: SdrLimitMarker[];
  /** Whether the WebGPU spike overlay should be drawn */
  showSpikeOverlay?: boolean;
  /** Receives a throttled readback of the GPU spike counter */
  onSpikeCount?: (count: number) => void;
  onSpikeAnalysis?: (analysis: SpikeAnalysis) => void;
  /** FM/demod focus region rendered into the marker overlay texture */
  demodFocusOverlay?: DemodFocusOverlay | null;
  /** Live span selection rendered as a sliding range */
  selectionOverlay?: SelectionOverlay | null;
  /** Tx slider rendered into the marker overlay texture */
  txSlider?: TxSliderOverlayState | null;
  /** Fade applied to marker overlays */
  overlayOpacity?: number;
  /** Optional explicit status labels rendered in the bottom FFT status band. */
  canvasStatusRow?: LiveCanvasStatusRow | null;
  /** Whether the visualizer is in standby mode */
  isStandby?: boolean;

  /** Visual customization: Main signal line color */
  lineColor?: string;
  /** Visual customization: Signal fill/shadow color */
  fillColor?: string;

  /** Whether to render in 3D waterfall mode */
  drawSignal3D?: boolean;
  /** Display mode: FFT or IQ */
  displayMode?: "fft" | "iq";
  /** Tighten FFT margins for small node previews */
  nodePreview?: boolean;
}

/**
 * A unified hook that abstracts away the complexity of rendering the FFT
 * spectrum with WebGPU and the associated overlays.
 *
 * It handles throttled overlay updates, backend selection, and coordinate
 * normalization across both rendering paths.
 */
export function useSpectrumRenderer() {
  const { drawWebGPUFFTSignal, cleanup: cleanupGPU } = useDrawWebGPUFFTSignal();
  const { draw3DWaterfallSignal, cleanup: cleanup3D } =
    useDraw3DWaterfallSignal();
  const {
    drawGridOnContext,
    drawMarkersOnContext,
    drawDemodFocusOnContext,
    drawSelectionOverlayOnContext,
    drawTxSliderOnContext,
    drawTxSliderBackdropOnContext,
  } = useOverlayRenderer();

  const lastMarkersOverlaySignatureRef = useRef<string | null>(null);

  const drawSpectrum = useCallback(
    (options: SpectrumRendererOptions) => {
      const {
        canvas,
        webgpuEnabled: _webgpuEnabled,
        isInitializingWebGPU,
        device,
        format,
        waveform,
        frequencyRange,
        fftMin,
        fftMax,
        powerScale = "dB",
        gridOverlayRenderer,
        markersOverlayRenderer,
        spikesOverlayRenderer: _spikesOverlayRenderer,
        overlayDirty,
        centerFrequencyHz,
        isDeviceConnected = true,
        hardwareSampleRateHz,
        fftSize,
        fftWindow,
        temporalResolution,
        reservedBottomPx = 0,
        fullCaptureRange,
        isIqRecordingActive,
        limitMarkers = [],
        showSpikeOverlay = false,
        onSpikeCount,
        onSpikeAnalysis,
        demodFocusOverlay,
        selectionOverlay,
        txSlider,
        overlayOpacity = 1,
        canvasStatusRow,
        isStandby = false,

        lineColor,
        fillColor,
        drawSignal3D = false,
        nodePreview = false,
      } = options;

      if (!canvas) return false;

      // VERY IMPORTANT: If WebGPU is still initializing, we must not render yet.
      if (isInitializingWebGPU) return false;

      if (drawSignal3D) {
        return draw3DWaterfallSignal({
          canvas,
          device: device ?? ({} as GPUDevice),
          format: format ?? ("bgra8unorm" as GPUTextureFormat),
          waveform,
          frequencyRange,
          fftMin,
          fftMax,
          showGrid: true,
          centerFrequencyHz,
          isDeviceConnected,
        });
      }

      if (device && format) {
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth || 1;
        const height = canvas.clientHeight || 1;

        // Update static grid/hardware-sample-rate labels only when inputs change.
        if (gridOverlayRenderer && overlayDirty?.grid) {
          const ctx = gridOverlayRenderer.beginDraw(width, height, dpr);
          drawGridOnContext(
            ctx,
            width,
            height,
            frequencyRange,
            fftMin,
            fftMax,
            powerScale,
            hardwareSampleRateHz,
            fullCaptureRange,
            isIqRecordingActive,
            reservedBottomPx,
            overlayOpacity,
          );
          gridOverlayRenderer.endDraw();
          if (overlayDirty) overlayDirty.grid = false;
        }

        // Update center markers and hotspot labels
        const markersOverlaySignature = getMarkersOverlaySignature({
          width,
          height,
          dpr,
          nodePreview,
          centerFrequencyHz,
          isDeviceConnected,
          hardwareSampleRateHz,
          fullCaptureRange,
          isIqRecordingActive,
          limitMarkers,
          fftSize,
          fftWindow,
          temporalResolution,
          reservedBottomPx,
          demodFocusOverlay,
          selectionOverlay,
          txSlider,
          overlayOpacity,
          canvasStatusRow,
          isStandby,
          fftMin,
          fftMax,
        });
        const markersOverlayInputsChanged =
          markersOverlaySignature !== lastMarkersOverlaySignatureRef.current;
        if (
          markersOverlayRenderer &&
          (markersOverlayInputsChanged || overlayDirty?.markers)
        ) {
          const ctx = markersOverlayRenderer.beginDraw(width, height, dpr);
          ctx.clearRect(0, 0, width, height);
          drawTxSliderBackdropOnContext(
            ctx,
            width,
            height,
            txSlider,
            frequencyRange,
            fftMin,
            fftMax,
          );
          if (!nodePreview && centerFrequencyHz !== undefined) {
            drawMarkersOnContext(
              ctx,
              width,
              height,
              frequencyRange,
              centerFrequencyHz,
              isDeviceConnected,
              hardwareSampleRateHz,
              fullCaptureRange,
              isIqRecordingActive,
              limitMarkers,
              fftSize,
              fftWindow,
              temporalResolution,
              !txSlider?.visible,
              reservedBottomPx,
              canvasStatusRow ?? undefined,
              overlayOpacity,
              isStandby,
            );
          }
          drawDemodFocusOnContext(
            ctx,
            width,
            height,
            frequencyRange,
            demodFocusOverlay,
            nodePreview,
            reservedBottomPx,
            overlayOpacity,
          );
          drawSelectionOverlayOnContext(
            ctx,
            width,
            height,
            frequencyRange,
            selectionOverlay,
            nodePreview,
            reservedBottomPx,
          );
          drawTxSliderOnContext(
            ctx,
            width,
            height,
            txSlider,
            frequencyRange,
            overlayOpacity,
          );
          markersOverlayRenderer.endDraw();
          if (overlayDirty) overlayDirty.markers = false;
          lastMarkersOverlaySignatureRef.current = markersOverlaySignature;
        }

        // Perform the actual signal trace render
        return drawWebGPUFFTSignal({
          canvas,
          device,
          format,
          waveform,
          frequencyRange,
          fftMin,
          fftMax,
          gridOverlayRenderer: gridOverlayRenderer ?? undefined,
          markersOverlayRenderer: markersOverlayRenderer ?? undefined,
          spikesOverlayRenderer: undefined,
          centerFrequencyHz,
          isDeviceConnected,
          showGrid: true, // Internal to drawWebGPU - handled by the overlays above
          showSpikeOverlay,
          onSpikeCount,
          onSpikeAnalysis,
          lineColor,
          fillColor,
          nodePreview,
          reservedBottomPx,
        });
      } else {
        return false;
      }
    },
    [
      drawWebGPUFFTSignal,
      draw3DWaterfallSignal,
      drawGridOnContext,
      drawMarkersOnContext,
      drawDemodFocusOnContext,
      drawSelectionOverlayOnContext,
      drawTxSliderOnContext,
      drawTxSliderBackdropOnContext,
    ],
  );

  const cleanup = useCallback(() => {
    cleanupGPU();
    cleanup3D();
    lastMarkersOverlaySignatureRef.current = null;
  }, [cleanupGPU, cleanup3D]);

  return {
    drawSpectrum,
    cleanup,
  };
}
