import { useCallback, useRef } from "react";
import {
  LINE_COLOR,
  SHADOW_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  formatFrequency,
  formatFrequencyHighRes,
  findBestFrequencyRange,
  BOUNDARY_LINE_COLOR,
  BOUNDARY_TEXT_COLOR,
} from "@n-apt/consts";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";

const readCssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const getCanvasThemeColors = () => ({
  backgroundColor: readCssColor("--color-fft-background", "#000"),
  textColor: readCssColor("--color-fft-text", "#fff"),
  gridColor: readCssColor("--color-fft-grid", "rgba(50,50,50,1)"),
  boundaryLine: readCssColor("--color-fft-boundary-line", BOUNDARY_LINE_COLOR),
  boundaryText: readCssColor("--color-fft-boundary-text", BOUNDARY_TEXT_COLOR),
});

export interface Draw2DFFTSignalOptions {
  canvas: HTMLCanvasElement;
  waveform: Uint8Array | Float32Array | number[];
  frequencyRange: { min: number; max: number };
  fftMin?: number;
  fftMax?: number;
  powerScale?: "dB" | "dBm";
  showGrid?: boolean;
  centerFrequencyHz?: number;
  isDeviceConnected?: boolean;
  highPerformanceMode?: boolean;
  hardwareSampleRateHz?: number;
  fullCaptureRange?: { min: number; max: number };
  isIqRecordingActive?: boolean;
  limitMarkers?: SdrLimitMarker[];
  displayMode?: "fft" | "iq";
  textColor?: string;
  backgroundColor?: string;
}

export function useDraw2DFFTSignal() {
  const lastRenderRef = useRef<{
    width: number;
    height: number;
    waveformLength: number;
  } | null>(null);

  const toFloat32Waveform = useCallback(
    (waveform: Uint8Array | Float32Array | number[]) => {
      if (waveform instanceof Float32Array) return waveform;
      return Float32Array.from(waveform);
    },
    [],
  );

  // Inline rendering functions
  const drawSpectrumGrid = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      fftMin: number,
      fftMax: number,
      _powerScale: "dB" | "dBm",
      clearBackground: boolean,
      hardwareSampleRateHz?: number,
      fullCaptureRange?: { min: number; max: number },
      limitMarkers: SdrLimitMarker[] = [],
      textColor?: string,
      backgroundColor?: string,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();

      if (clearBackground) {
        ctx.fillStyle = backgroundColor ?? canvasTheme.backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      const fftAreaMax = { x: width - 40, y: height - 40 };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

      const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      const minFreq = frequencyRange?.min ?? 0;
      const maxFreq = frequencyRange?.max ?? 3.2;
      const viewBandwidth = maxFreq - minFreq;
      const range = findBestFrequencyRange(viewBandwidth, 10);
      const lowerFreq = Math.ceil(minFreq / range) * range;
      const upperFreq = maxFreq;
      const freqToX = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

      ctx.strokeStyle = canvasTheme.gridColor;
      ctx.fillStyle = textColor ?? canvasTheme.textColor;
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "right";
      ctx.lineWidth = 1 / dpr;

      // Labeling is now handled by useOverlayRenderer.ts to prevent clobbering
      // We only draw grid lines here if needed, but labeled ticks should be central.

      for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
        const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
        ctx.lineTo(fftAreaMax.x, Math.round(yPos));
        ctx.stroke();
        // Labeling is handled by overlay renderer
      }

      // (Removed old grid loop)

      const fullSpan = fullCaptureRange ? (fullCaptureRange.max - fullCaptureRange.min) : 0;
      const zoom = (fullSpan > 0) ? fullSpan / viewBandwidth : 1;
      const useHighRes = zoom >= 100;
      const formatFreq = (f: number) => useHighRes ? formatFrequencyHighRes(f) : formatFrequency(f);

      const visualCenterFreq = (minFreq + maxFreq) / 2;

      // ── Collision Avoidance Setup ──────────────────────────────────────────
      const occupiedRects: { x1: number; x2: number }[] = [];
      const startLabel = formatFreq(minFreq);
      const endLabel = formatFreq(maxFreq);
      const centerLabelText = Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
        ? "-- MHz"
        : formatFreq(visualCenterFreq);

      const startW = ctx.measureText(startLabel).width;
      const endW = ctx.measureText(endLabel).width;
      const centerW = ctx.measureText(`✋  ${centerLabelText}`).width;

      occupiedRects.push({ x1: FFT_AREA_MIN.x - 5, x2: FFT_AREA_MIN.x + startW + 15 });
      occupiedRects.push({ x1: fftAreaMax.x - endW - 15, x2: fftAreaMax.x + 5 });
      occupiedRects.push({ x1: width / 2 - centerW / 2 - 15, x2: width / 2 + centerW / 2 + 15 });

      const isColliding = (x: number, text: string) => {
        const tw = ctx.measureText(text).width;
        const x1 = x - tw / 2 - 10;
        const x2 = x + tw / 2 + 10;
        return occupiedRects.some(r => (x1 < r.x2 && x2 > r.x1));
      };
      // ───────────────────────────────────────────────────────────────────────

      // Draw Start Line + Label
      ctx.textAlign = "left";
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, FFT_AREA_MIN.y);
      ctx.lineTo(FFT_AREA_MIN.x, fftAreaMax.y + 7);
      ctx.stroke();
      ctx.fillText(startLabel, FFT_AREA_MIN.x, fftAreaMax.y + 25);

      // Draw End Line + Label
      ctx.textAlign = "right";
      ctx.beginPath();
      ctx.moveTo(fftAreaMax.x, FFT_AREA_MIN.y);
      ctx.lineTo(fftAreaMax.x, fftAreaMax.y + 7);
      ctx.stroke();
      ctx.fillText(endLabel, fftAreaMax.x, fftAreaMax.y + 25);

      ctx.textAlign = "center";
      for (let freq = lowerFreq; freq < upperFreq - 0.0001; freq += range) {
        const xPos = freqToX(freq);
        const ix = Math.round(xPos);

        // Grid line
        ctx.strokeStyle = canvasTheme.gridColor;
        ctx.beginPath();
        ctx.moveTo(ix, FFT_AREA_MIN.y);
        ctx.lineTo(ix, fftAreaMax.y);
        ctx.stroke();

        // Tick mark
        ctx.strokeStyle = textColor ?? canvasTheme.textColor;
        ctx.beginPath();
        ctx.moveTo(ix, fftAreaMax.y);
        ctx.lineTo(ix, fftAreaMax.y + 7);
        ctx.stroke();

        // Tick label
        const tickLabel =
          maxFreq < 1
            ? `${Math.round(freq * 1000)}kHz`
            : range >= 0.5
              ? freq.toFixed(1)
              : range >= 0.01
                ? freq.toFixed(2)
                : freq.toFixed(3);
        if (!isColliding(xPos, tickLabel)) {
          ctx.fillText(tickLabel, ix, fftAreaMax.y + 25);
        }
      }

      ctx.strokeStyle = canvasTheme.textColor;
      ctx.lineWidth = 1.0 / dpr;
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, fftAreaMax.y);
      ctx.lineTo(fftAreaMax.x, fftAreaMax.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, FFT_AREA_MIN.y);
      ctx.lineTo(FFT_AREA_MIN.x, fftAreaMax.y - 1);
      ctx.stroke();

      if (limitMarkers.length > 0) {
        ctx.save();
        ctx.strokeStyle = canvasTheme.boundaryLine;
        ctx.fillStyle = canvasTheme.boundaryText;
        ctx.lineWidth = 1 / dpr;
        ctx.font = "10px JetBrains Mono";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        for (const marker of limitMarkers) {
          if (!Number.isFinite(marker.freq)) continue;
          if (marker.freq < minFreq || marker.freq > maxFreq) continue;

          const x = Math.round(freqToX(marker.freq)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, FFT_AREA_MIN.y);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();

          const textX = Math.max(FFT_AREA_MIN.x + 45, Math.min(fftAreaMax.x - 45, x));
          ctx.fillText(marker.label, textX, FFT_AREA_MIN.y + 45);
        }

        ctx.restore();
      }

      // Draw mathematical hardware block boundaries if applicable
      const anchorRange = fullCaptureRange || frequencyRange;
      const totalSpan = anchorRange.max - anchorRange.min;
      const hwSpanMHz = hardwareSampleRateHz ? hardwareSampleRateHz / 1e6 : 0;
      const shouldShowHWGrid = totalSpan > hwSpanMHz + 0.001 && hwSpanMHz > 0;
      
      if (shouldShowHWGrid) {
        ctx.save();
        ctx.strokeStyle = "rgba(220, 220, 220, 0.54)"; // User specified color
        ctx.setLineDash([4, 4]); // Dashed line
        ctx.lineWidth = 1 / dpr;
        ctx.fillStyle = textColor ?? canvasTheme.textColor;
        ctx.font = "10px JetBrains Mono";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const formatOffset = (mhz: number) => {
          const abs = Math.abs(mhz);
          if (abs >= 1) return `${mhz.toFixed(1)}MHz`;
          if (abs >= 0.001) return `${Math.round(mhz * 1000)}kHz`;
          return `${Math.round(mhz * 1_000_000)}Hz`;
        };

        let currentFreq = anchorRange.min;
        while (currentFreq < anchorRange.max - 0.001) {
          const blockStart = currentFreq;
          const blockEnd = Math.min(blockStart + hwSpanMHz, anchorRange.max);
          const blockWidth = blockEnd - blockStart;
          const isFullBlock = blockWidth >= hwSpanMHz - 0.001;

          // Only draw if visible in the current zoomed frequency range
          if (blockEnd > minFreq && blockStart < maxFreq) {
            // Draw left boundary
            if (blockStart > anchorRange.min + 0.0001 && blockStart >= minFreq && blockStart <= maxFreq) {
              const lx = Math.round(freqToX(blockStart));
              ctx.beginPath();
              ctx.moveTo(lx, FFT_AREA_MIN.y);
              ctx.lineTo(lx, fftAreaMax.y);
              ctx.stroke();
            }

            // Draw right boundary
            if (blockEnd < anchorRange.max - 0.0001 && blockEnd >= minFreq && blockEnd <= maxFreq) {
              const rx = Math.round(freqToX(blockEnd));
              ctx.beginPath();
              ctx.moveTo(rx, FFT_AREA_MIN.y);
              ctx.lineTo(rx, fftAreaMax.y);
              ctx.stroke();
            }

            // Draw center label - clamp to visible region so it doesn't disappear when zoomed
            const visibleStart = Math.max(blockStart, minFreq);
            const visibleEnd = Math.min(blockEnd, maxFreq);
            const visibleCenter = (visibleStart + visibleEnd) / 2;
            
            if (
              visibleCenter >= minFreq &&
              visibleCenter <= maxFreq
            ) {
              const cx = Math.round(freqToX(visibleCenter));
              const label = isFullBlock ? "Hardware Sample Rate" : "Next Sample";
              const subLabel = formatOffset(blockWidth);
              ctx.fillText(label, cx, FFT_AREA_MIN.y + 4);
              ctx.fillText(subLabel, cx, FFT_AREA_MIN.y + 16);
            }
          }
          currentFreq = blockEnd;
        }
        ctx.restore();
      }
    },
    [],
  );

  const drawSpectrumTrace = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      waveform: Uint8Array | Float32Array | number[],
      fftMin: number,
      fftMax: number,
      displayMode: "fft" | "iq" = "fft",
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const waveformArray = toFloat32Waveform(waveform);
      if (!waveformArray || waveformArray.length === 0)
        return;

      const fftAreaMax = { x: width - 40, y: height - 40 };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      const dataWidth = waveformArray.length;
      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      const idxToX = (idx: number) => {
        if (dataWidth <= 1) return FFT_AREA_MIN.x;
        return FFT_AREA_MIN.x + (idx / (dataWidth - 1)) * plotWidth;
      };

      const clampY = (dbVal: number) => {
        if (displayMode === "iq") {
          // I/Q values are typically in range [-1, 1] or similar
          // We'll normalize them to the canvas height. 
          // Let's assume the input is already somewhat scaled or we can just draw it centered.
          const y = (height / 2) - (dbVal * (height / 3)); // Scale 1.0 to 1/3 height
          return Math.max(0, Math.min(height, y));
        }
        const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor;
        return Math.max(FFT_AREA_MIN.y + 1, Math.min(fftAreaMax.y, y));
      };

      ctx.fillStyle = SHADOW_COLOR;
      ctx.beginPath();
      ctx.moveTo(Math.round(idxToX(0)), fftAreaMax.y);
      for (let i = 0; i < dataWidth; i++) {
        ctx.lineTo(Math.round(idxToX(i)), Math.round(clampY(waveformArray[i])));
      }
      ctx.lineTo(Math.round(idxToX(dataWidth - 1)), fftAreaMax.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = (width < 700 ? 0.5 : 1) / dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < dataWidth; i++) {
        const x = Math.round(idxToX(i));
        const y = Math.round(clampY(waveformArray[i]));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    [],
  );

  const drawSpectrumMarkers = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      centerFrequencyHz: number,
      isDeviceConnected: boolean,
      fullCaptureRange?: { min: number; max: number },
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      const minFreq = frequencyRange?.min ?? 0;
      const maxFreq = frequencyRange?.max ?? 3.2;
      const viewBandwidth = maxFreq - minFreq;
      if (viewBandwidth <= 0) return;

      const fullSpan = fullCaptureRange ? (fullCaptureRange.max - fullCaptureRange.min) : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth : 1;
      const useHighRes = zoom >= 100;
      const formatFreq = (f: number) => useHighRes ? formatFrequencyHighRes(f) : formatFrequency(f);

      const freqToX = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

      const markers: { freq: number; label: string }[] = [
        { freq: 0.5, label: "500kHz / RTL-SDR v4 lower limit" },
        { freq: 28.8, label: "28.8MHz / Potential hardware spur" },
      ];

      if (isDeviceConnected) {
        for (const m of markers) {
          if (m.freq < minFreq || m.freq > maxFreq) continue;
          const x = Math.round(freqToX(m.freq)) + 0.5;
          ctx.save();
          ctx.strokeStyle = canvasTheme.boundaryLine;
          ctx.lineWidth = 1 / dpr;
          ctx.beginPath();
          ctx.moveTo(x, FFT_AREA_MIN.y);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();
          ctx.restore();

          ctx.save();
          ctx.fillStyle = canvasTheme.boundaryText;
          ctx.font = "11px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const tw = ctx.measureText(m.label).width;
          const lx = Math.max(
            FFT_AREA_MIN.x + tw / 2 + 4,
            Math.min(fftAreaMax.x - tw / 2 - 4, x),
          );
          ctx.fillText(m.label, lx, FFT_AREA_MIN.y + 45);
          ctx.restore();
        }
      }

      if (Number.isFinite(centerFrequencyHz)) {
        // Always draw center line at the exact middle of the plot area
        // Using freqToX(centerFrequencyHz) causes drift when zoomed
        const cx = Math.round((FFT_AREA_MIN.x + fftAreaMax.x) / 2) + 0.5;
        ctx.save();
        ctx.strokeStyle = "rgba(220, 255, 0, 0.7)";
        ctx.lineWidth = 1 / dpr;
        ctx.beginPath();
        ctx.moveTo(cx, FFT_AREA_MIN.y);
        ctx.lineTo(cx, fftAreaMax.y);
        ctx.stroke();
        ctx.restore();
      }

      const visualCenterFreq = (minFreq + maxFreq) / 2;
      const centerLabel =
        Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
          ? "✋  -- MHz"
          : `✋  ${formatFreq(visualCenterFreq)}`;

      ctx.save();
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const labelX = width / 2;
      const labelY = fftAreaMax.y + 25;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(centerLabel, labelX, labelY);
      ctx.restore();
    },
    [],
  );

  const draw2DFFTSignal = useCallback(
    (options: Draw2DFFTSignalOptions) => {
      const {
        canvas,
        waveform,
        frequencyRange,
        fftMin = -80,
        fftMax = 20,
        powerScale = "dB",
        showGrid = true,
        centerFrequencyHz,
        isDeviceConnected = true,
        highPerformanceMode = false,
        hardwareSampleRateHz,
        fullCaptureRange,
        limitMarkers = [],
        displayMode = "fft",
      } = options;

      const ctx = canvas.getContext("2d");
      const waveformArray = toFloat32Waveform(waveform);
      if (!ctx || waveformArray.length === 0) return false;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement?.getBoundingClientRect();
      const cssWidth = rect?.width || canvas.clientWidth || 800;
      const cssHeight = rect?.height || canvas.clientHeight || 400;

      // Update internal resolution for High-DPI displays
      if (
        canvas.width !== Math.floor(cssWidth * dpr) ||
        canvas.height !== Math.floor(cssHeight * dpr)
      ) {
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }

      // Reset transform and scale by DPR
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      try {
        if (highPerformanceMode) {
          // High performance mode: minimal drawing
          if (showGrid) {
            drawSpectrumGrid(
              ctx,
              cssWidth,
              cssHeight,
              frequencyRange,
              fftMin,
              fftMax,
              powerScale,
              true,
              hardwareSampleRateHz,
              fullCaptureRange,
              limitMarkers,
            );
          } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, cssWidth, cssHeight);
          }

          // Simple line drawing for performance
          drawSpectrumTrace(ctx, cssWidth, cssHeight, waveformArray, fftMin, fftMax, displayMode);
        } else {
          // Full quality mode: complete spectrum rendering
          if (showGrid && displayMode === "fft") {
            drawSpectrumGrid(
              ctx,
              cssWidth,
              cssHeight,
              frequencyRange,
              fftMin,
              fftMax,
              powerScale,
              true,
              hardwareSampleRateHz,
              fullCaptureRange
            );
          } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, cssWidth, cssHeight);
          }
          drawSpectrumTrace(ctx, cssWidth, cssHeight, waveformArray, fftMin, fftMax, displayMode);
        }

        // Draw markers if needed
        if (centerFrequencyHz !== undefined) {
          drawSpectrumMarkers(
            ctx,
            cssWidth,
            cssHeight,
            frequencyRange,
            centerFrequencyHz,
            isDeviceConnected,
            fullCaptureRange,
          );
        }

        return true;
      } catch (error) {
        console.error("2D FFT rendering failed:", error);
        return false;
      }
    },
    [drawSpectrumGrid, drawSpectrumTrace, drawSpectrumMarkers],
  );

  const cleanup = useCallback(() => {
    lastRenderRef.current = null;
  }, []);

  return {
    draw2DFFTSignal,
    cleanup,
  };
}
