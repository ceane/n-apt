import { useCallback, useRef } from "react";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDraw3DWaterfallSignal } from "@n-apt/hooks/useDraw3DWaterfallSignal";
import {
  type DemodFocusOverlay,
  type SelectionOverlay,
  useOverlayRenderer,
} from "@n-apt/hooks/useOverlayRenderer";
import { OverlayTextureRenderer } from "@n-apt/hooks/useWebGPUInit";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";

const OVERLAY_MIN_INTERVAL_MS = 50;

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
  /** FM/demod focus region rendered into the marker overlay texture */
  demodFocusOverlay?: DemodFocusOverlay | null;
  /** Live span selection rendered as a sliding range */
  selectionOverlay?: SelectionOverlay | null;

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
  } = useOverlayRenderer();

  const lastOverlayUploadMsRef = useRef({ grid: 0, markers: 0, spikes: 0 });

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
        demodFocusOverlay,
        selectionOverlay,

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
        const now = performance.now();
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth || 1;
        const height = canvas.clientHeight || 1;

        // Update grid/hardware-sample-rate labels if dirty or enough time passed
        if (
          gridOverlayRenderer &&
          (overlayDirty?.grid ||
            now - lastOverlayUploadMsRef.current.grid >=
              OVERLAY_MIN_INTERVAL_MS * 2)
        ) {
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
          );
          gridOverlayRenderer.endDraw();
          if (overlayDirty) overlayDirty.grid = false;
          lastOverlayUploadMsRef.current.grid = now;
        }

        // Update center markers and hotspot labels
        if (
          markersOverlayRenderer &&
          (overlayDirty?.markers ||
            now - lastOverlayUploadMsRef.current.markers >=
              OVERLAY_MIN_INTERVAL_MS)
        ) {
          const ctx = markersOverlayRenderer.beginDraw(width, height, dpr);
          ctx.clearRect(0, 0, width, height);
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
            );
          }
          drawDemodFocusOnContext(
            ctx,
            width,
            height,
            frequencyRange,
            demodFocusOverlay,
            nodePreview,
          );
          drawSelectionOverlayOnContext(
            ctx,
            width,
            height,
            frequencyRange,
            selectionOverlay,
            nodePreview,
          );
          markersOverlayRenderer.endDraw();
          if (overlayDirty) overlayDirty.markers = false;
          lastOverlayUploadMsRef.current.markers = now;
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
    ],
  );

  const cleanup = useCallback(() => {
    cleanupGPU();
    cleanup3D();
    lastOverlayUploadMsRef.current = { grid: 0, markers: 0, spikes: 0 };
  }, [cleanupGPU, cleanup3D]);

  return {
    drawSpectrum,
    cleanup,
  };
}
