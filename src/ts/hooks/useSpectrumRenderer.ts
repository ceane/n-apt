import { useCallback, useRef } from "react";
import { useDrawWebGPUFFTSignal } from "./useDrawWebGPUFFTSignal";
import { useDraw2DFFTSignal } from "./useDraw2DFFTSignal";
import { useOverlayRenderer } from "./useOverlayRenderer";
import { OverlayTextureRenderer } from "./useWebGPUInit";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";

const OVERLAY_MIN_INTERVAL_MS = 50;

export interface SpectrumRendererOptions {
  /** The target canvas element (WebGPU or 2D) */
  canvas: HTMLCanvasElement | null;
  
  /** Whether WebGPU is currently enabled and available */
  webgpuEnabled: boolean;
  /** Whether WebGPU is currently in the process of initializing */
  isInitializingWebGPU?: boolean;
  /** WebGPU device instance */
  device?: GPUDevice | null;
  /** WebGPU preferred canvas format */
  format?: GPUTextureFormat | null;
  
  /** The FFT waveform data to visualize */
  waveform: Float32Array | number[];
  /** The current frequency range (min/max MHz) to display on the X-axis */
  frequencyRange: { min: number; max: number };
  /** Minimum dB value for the Y-axis */
  fftMin: number;
  /** Maximum dB value for the Y-axis */
  fftMax: number;
  
  /** (WebGPU only) The overlay renderer instance for the grid */
  gridOverlayRenderer?: OverlayTextureRenderer | null;
  /** (WebGPU only) The overlay renderer instance for markers/labels */
  markersOverlayRenderer?: OverlayTextureRenderer | null;
  /** An object containing dirty flags to trigger overlay updates */
  overlayDirty?: { grid: boolean; markers: boolean };
  
  /** Center frequency in MHz for marker placement */
  centerFrequencyMHz?: number;
  /** Whether the SDR device is currently connected (for marker visibility) */
  isDeviceConnected?: boolean;
  /** Hardware sample rate in Hz for block boundary markers */
  hardwareSampleRateHz?: number;
  /** The full unzoomed capture range used as an anchor for hardware blocks */
  fullCaptureRange?: { min: number; max: number };
  /** Whether I/Q recording is active (forces hardware block labels) */
  isIqRecordingActive?: boolean;
  /** Hardware limit markers derived from signals.yaml */
  limitMarkers?: SdrLimitMarker[];
  
  /** Visual customization: Main signal line color */
  lineColor?: string;
  /** Visual customization: Signal fill/shadow color */
  fillColor?: string;
  /** Visual customization: Canvas background color */
  backgroundColor?: string;

  /** (2D only) Whether to use high performance (minimal) drawing mode */
  highPerformanceMode?: boolean;
}

/**
 * A unified hook that abstracts away the complexity of switching between
 * WebGPU and Canvas2D rendering for the FFT spectrum.
 * 
 * It handles throttled overlay updates, backend selection, and coordinate
 * normalization across both rendering paths.
 */
export function useSpectrumRenderer() {
  const { drawWebGPUFFTSignal, cleanup: cleanupGPU } = useDrawWebGPUFFTSignal();
  const { draw2DFFTSignal, cleanup: cleanup2D } = useDraw2DFFTSignal();
  const { drawGridOnContext, drawMarkersOnContext } = useOverlayRenderer();
  
  const lastOverlayUploadMsRef = useRef({ grid: 0, markers: 0 });

  const drawSpectrum = useCallback((options: SpectrumRendererOptions) => {
    const {
      canvas,
      webgpuEnabled,
      isInitializingWebGPU,
      device,
      format,
      waveform,
      frequencyRange,
      fftMin,
      fftMax,
      gridOverlayRenderer,
      markersOverlayRenderer,
      overlayDirty,
      centerFrequencyMHz,
      isDeviceConnected = true,
      hardwareSampleRateHz,
      fullCaptureRange,
      isIqRecordingActive,
      limitMarkers = [],
      lineColor,
      fillColor,
      backgroundColor,
      highPerformanceMode = false
    } = options;

    if (!canvas) return false;

    // VERY IMPORTANT: If WebGPU is still initializing, we MUST NOT attempt
    // to get ANY context from the canvas yet. Once a '2d' context is requested,
    // a 'webgpu' context can NEVER be requested on the same canvas (and vice versa).
    if (isInitializingWebGPU) return false;

    // Use WebGPU if enabled and resources are ready
    if (webgpuEnabled && device && format) {
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;

      // Update grid/hardware-sample-rate labels if dirty or enough time passed
      if (gridOverlayRenderer && (overlayDirty?.grid || now - lastOverlayUploadMsRef.current.grid >= OVERLAY_MIN_INTERVAL_MS * 2)) {
        const ctx = gridOverlayRenderer.beginDraw(width, height, dpr);
        drawGridOnContext(
          ctx, 
          width, 
          height, 
          frequencyRange, 
          fftMin, 
          fftMax, 
          hardwareSampleRateHz, 
          fullCaptureRange, 
          isIqRecordingActive
        );
        gridOverlayRenderer.endDraw();
        if (overlayDirty) overlayDirty.grid = false;
        lastOverlayUploadMsRef.current.grid = now;
      }

      // Update center markers and hotspot labels
      if (markersOverlayRenderer && (overlayDirty?.markers || now - lastOverlayUploadMsRef.current.markers >= OVERLAY_MIN_INTERVAL_MS)) {
        const ctx = markersOverlayRenderer.beginDraw(width, height, dpr);
        if (centerFrequencyMHz !== undefined) {
          drawMarkersOnContext(
            ctx,
            width,
            height,
            frequencyRange,
            centerFrequencyMHz,
            isDeviceConnected,
            fullCaptureRange,
            limitMarkers,
          );
        }
        markersOverlayRenderer.endDraw();
        if (overlayDirty) overlayDirty.markers = false;
        lastOverlayUploadMsRef.current.markers = now;
      }

      // Perform the actual signal trace render
      return drawWebGPUFFTSignal({
        canvas,
        device,
        format,
        waveform: waveform instanceof Float32Array ? waveform : new Float32Array(waveform),
        frequencyRange,
        fftMin,
        fftMax,
        gridOverlayRenderer: gridOverlayRenderer ?? undefined,
        markersOverlayRenderer: markersOverlayRenderer ?? undefined,
        centerFrequencyMHz,
        isDeviceConnected,
        showGrid: true, // Internal to drawWebGPU - handled by the overlays above
        lineColor,
        fillColor,
        backgroundColor
      });
    } else {
      // Fallback to traditional Canvas 2D
      return draw2DFFTSignal({
        canvas,
        waveform: Array.from(waveform),
        frequencyRange,
        fftMin,
        fftMax,
        showGrid: true,
        centerFrequencyMHz,
        isDeviceConnected,
        hardwareSampleRateHz,
        fullCaptureRange,
        isIqRecordingActive,
        limitMarkers,
        highPerformanceMode
      });
    }
  }, [drawWebGPUFFTSignal, draw2DFFTSignal, drawGridOnContext, drawMarkersOnContext]);

  const cleanup = useCallback(() => {
    cleanupGPU();
    cleanup2D();
    lastOverlayUploadMsRef.current = { grid: 0, markers: 0 };
  }, [cleanupGPU, cleanup2D]);

  return { 
    drawSpectrum, 
    cleanup 
  };
}
