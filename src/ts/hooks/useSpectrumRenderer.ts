import { useCallback, useRef } from "react";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDraw3DWaterfallSignal } from "@n-apt/hooks/useDraw3DWaterfallSignal";
import { useOverlayRenderer } from "@n-apt/hooks/useOverlayRenderer";
import { OverlayTextureRenderer } from "@n-apt/hooks/useWebGPUInit";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
import type { SpectrumSpikeMarker } from "@n-apt/hooks/useWasmSimdMath";

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
  /** Whether the WebGPU spike overlay should be drawn */
  showSpikeOverlay?: boolean;
  /** Precomputed prominent spike markers for the current visible waveform */
  spikeMarkers?: SpectrumSpikeMarker[];
  
  /** Visual customization: Main signal line color */
  lineColor?: string;
  /** Visual customization: Signal fill/shadow color */
  fillColor?: string;

  /** Whether to render in 3D waterfall mode */
  drawSignal3D?: boolean;
  /** Display mode: FFT or IQ */
  displayMode?: "fft" | "iq";
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
  const { draw3DWaterfallSignal, cleanup: cleanup3D } = useDraw3DWaterfallSignal();
  const { drawGridOnContext, drawMarkersOnContext, drawSpikeMarkersOnContext } = useOverlayRenderer();
  
  const lastOverlayUploadMsRef = useRef({ grid: 0, markers: 0, spikes: 0 });

  const drawSpectrum = useCallback((options: SpectrumRendererOptions) => {
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
      spikesOverlayRenderer,
      overlayDirty,
      centerFrequencyMHz,
      isDeviceConnected = true,
      hardwareSampleRateHz,
      fullCaptureRange,
      isIqRecordingActive,
      limitMarkers = [],
      showSpikeOverlay = false,
      spikeMarkers = [],
      lineColor,
      fillColor,
      drawSignal3D = false,
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
        centerFrequencyMHz,
        isDeviceConnected,
      });
    }

    if (device && format) {
      const now = performance.now();
      const shouldShowSpikes = showSpikeOverlay && isDeviceConnected;
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
          powerScale,
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
            hardwareSampleRateHz,
            fullCaptureRange,
            isIqRecordingActive,
            limitMarkers,
          );
        }
        markersOverlayRenderer.endDraw();
        if (overlayDirty) overlayDirty.markers = false;
        lastOverlayUploadMsRef.current.markers = now;
      }

      if (
        spikesOverlayRenderer &&
        shouldShowSpikes &&
        (overlayDirty?.spikes || now - lastOverlayUploadMsRef.current.spikes >= OVERLAY_MIN_INTERVAL_MS)
      ) {
        const ctx = spikesOverlayRenderer.beginDraw(width, height, dpr);
        drawSpikeMarkersOnContext(
          ctx,
          width,
          height,
          waveform.length,
          fftMin,
          fftMax,
          spikeMarkers,
        );
        spikesOverlayRenderer.endDraw();
        if (overlayDirty) overlayDirty.spikes = false;
        lastOverlayUploadMsRef.current.spikes = now;
      } else if (
        spikesOverlayRenderer &&
        (!shouldShowSpikes || overlayDirty?.spikes)
      ) {
        spikesOverlayRenderer.beginDraw(width, height, dpr);
        spikesOverlayRenderer.endDraw();
        if (overlayDirty) overlayDirty.spikes = false;
        lastOverlayUploadMsRef.current.spikes = now;
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
        spikesOverlayRenderer: shouldShowSpikes ? (spikesOverlayRenderer ?? undefined) : undefined,
        centerFrequencyMHz,
        isDeviceConnected,
        showGrid: true, // Internal to drawWebGPU - handled by the overlays above
        lineColor,
        fillColor,
      });
    } else {
      return false;
    }
  }, [
    drawWebGPUFFTSignal,
    draw3DWaterfallSignal,
    drawGridOnContext,
    drawMarkersOnContext,
    drawSpikeMarkersOnContext,
  ]);

  const cleanup = useCallback(() => {
    cleanupGPU();
    cleanup3D();
    lastOverlayUploadMsRef.current = { grid: 0, markers: 0, spikes: 0 };
  }, [cleanupGPU, cleanup3D]);

  return { 
    drawSpectrum, 
    cleanup 
  };
}
