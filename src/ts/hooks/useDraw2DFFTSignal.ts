import { useCallback, useRef } from "react";
import {
  FFT_GRID_COLOR,
  LINE_COLOR,
  SHADOW_COLOR,
  FFT_TEXT_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  FFT_CANVAS_BG,
  formatFrequency,
  findBestFrequencyRange,
} from "@n-apt/consts";

export interface Draw2DFFTSignalOptions {
  canvas: HTMLCanvasElement;
  waveform: number[];
  frequencyRange: { min: number; max: number };
  fftMin?: number;
  fftMax?: number;
  showGrid?: boolean;
  centerFrequencyMHz?: number;
  isDeviceConnected?: boolean;
  highPerformanceMode?: boolean;
  hardwareSampleRateHz?: number;
  fullCaptureRange?: { min: number; max: number };
  isIqRecordingActive?: boolean;
}

export function useDraw2DFFTSignal() {
  const lastRenderRef = useRef<{
    width: number;
    height: number;
    waveformLength: number;
  } | null>(null);

  // Inline rendering functions
  const drawSpectrumGrid = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      fftMin: number,
      fftMax: number,
      clearBackground: boolean,
      hardwareSampleRateHz?: number,
      fullCaptureRange?: { min: number; max: number },
      isIqRecordingActive?: boolean,
    ) => {
      const dpr = window.devicePixelRatio || 1;

      if (clearBackground) {
        ctx.fillStyle = FFT_CANVAS_BG;
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

      ctx.strokeStyle = FFT_GRID_COLOR;
      ctx.fillStyle = FFT_TEXT_COLOR;
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "right";
      ctx.lineWidth = 1 / dpr;

      const zeroDbY = fftAreaMax.y - (0 - fftMin) * scaleFactor;
      ctx.fillText("0dB", FFT_AREA_MIN.x - 10, Math.round(zeroDbY + 3));

      for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
        if (line === 0) continue;
        const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
        ctx.lineTo(fftAreaMax.x, Math.round(yPos));
        ctx.stroke();
        ctx.fillText(
          line.toString(),
          FFT_AREA_MIN.x - 10,
          Math.round(yPos + 3),
        );
      }

      ctx.textAlign = "center";
      for (let freq = lowerFreq; freq < upperFreq; freq += range) {
        const xPos = freqToX(freq);
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), fftAreaMax.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7);
        ctx.stroke();
        ctx.fillText(
          formatFrequency(freq),
          Math.round(xPos),
          fftAreaMax.y + 25,
        );
      }

      const xPos = fftAreaMax.x;
      const lastGridFreq = Math.floor((upperFreq - 1e-6) / range) * range;
      const lastGridX = freqToX(lastGridFreq);
      if (xPos - lastGridX > 50) {
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), fftAreaMax.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7);
        ctx.stroke();
        ctx.fillText(
          formatFrequency(maxFreq),
          Math.round(xPos),
          fftAreaMax.y + 25,
        );
      }

      ctx.strokeStyle = FFT_TEXT_COLOR;
      ctx.lineWidth = 1.0 / dpr;
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, fftAreaMax.y);
      ctx.lineTo(fftAreaMax.x, fftAreaMax.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, FFT_AREA_MIN.y);
      ctx.lineTo(FFT_AREA_MIN.x, fftAreaMax.y - 1);
      ctx.stroke();

      // Draw mathematical hardware block boundaries if applicable
      const anchorRange = fullCaptureRange || frequencyRange;
      const totalSpan = anchorRange.max - anchorRange.min;
      const hwSpanMHz = hardwareSampleRateHz ? hardwareSampleRateHz / 1e6 : 0;
      
      if (hwSpanMHz > 0 && totalSpan > hwSpanMHz + 0.001 && isIqRecordingActive) {
        ctx.save();
        ctx.strokeStyle = "rgba(220, 220, 220, 0.54)"; // User specified color
        ctx.setLineDash([4, 4]); // Dashed line
        ctx.lineWidth = 1 / dpr;
        ctx.fillStyle = "#ffb669";
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
            if (blockStart >= minFreq && blockStart <= maxFreq) {
              const lx = Math.round(freqToX(blockStart));
              ctx.beginPath();
              ctx.moveTo(lx, FFT_AREA_MIN.y);
              ctx.lineTo(lx, fftAreaMax.y);
              ctx.stroke();
            }

            // Draw right boundary
            if (blockEnd >= minFreq && blockEnd <= maxFreq) {
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
            
            if (visibleCenter >= minFreq && visibleCenter <= maxFreq) {
              const cx = Math.round(freqToX(visibleCenter));
              const label = isFullBlock ? "Hardware Sample Rate" : "Next sample";
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
      waveform: number[],
      fftMin: number,
      fftMax: number,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      if (!waveform || !Array.isArray(waveform) || waveform.length === 0)
        return;

      const fftAreaMax = { x: width - 40, y: height - 40 };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      const dataWidth = waveform.length;
      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      const idxToX = (idx: number) => {
        if (dataWidth <= 1) return FFT_AREA_MIN.x;
        return FFT_AREA_MIN.x + (idx / (dataWidth - 1)) * plotWidth;
      };

      const clampY = (dbVal: number) => {
        const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor;
        return Math.max(FFT_AREA_MIN.y + 1, Math.min(fftAreaMax.y, y));
      };

      ctx.fillStyle = SHADOW_COLOR;
      ctx.beginPath();
      ctx.moveTo(Math.round(idxToX(0)), fftAreaMax.y);
      for (let i = 0; i < dataWidth; i++) {
        ctx.lineTo(Math.round(idxToX(i)), Math.round(clampY(waveform[i])));
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
        const y = Math.round(clampY(waveform[i]));
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
      centerFrequencyMHz: number,
      isDeviceConnected: boolean,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      const minFreq = frequencyRange?.min ?? 0;
      const maxFreq = frequencyRange?.max ?? 3.2;
      const viewBandwidth = maxFreq - minFreq;
      if (viewBandwidth <= 0) return;

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
          ctx.strokeStyle = "rgba(220, 38, 38, 0.55)";
          ctx.lineWidth = 1 / dpr;
          ctx.beginPath();
          ctx.moveTo(x, FFT_AREA_MIN.y);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();
          ctx.restore();

          ctx.save();
          ctx.font = "11px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const tw = ctx.measureText(m.label).width;
          const lx = Math.max(
            FFT_AREA_MIN.x + tw / 2 + 4,
            Math.min(fftAreaMax.x - tw / 2 - 4, x),
          );
          ctx.fillStyle = "rgba(10, 10, 10, 0.75)";
          ctx.fillRect(lx - tw / 2 - 4, FFT_AREA_MIN.y + 4, tw + 8, 18);
          ctx.fillStyle = "rgba(220, 38, 38, 0.9)";
          ctx.fillText(m.label, lx, FFT_AREA_MIN.y + 6);
          ctx.restore();
        }
      }

      if (Number.isFinite(centerFrequencyMHz)) {
        // Always draw center line at the exact middle of the plot area
        // Using freqToX(centerFrequencyMHz) causes drift when zoomed
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

      const centerLabel =
        Number.isNaN(centerFrequencyMHz) || !Number.isFinite(centerFrequencyMHz)
          ? "✋  -- MHz"
          : centerFrequencyMHz < 1
            ? `✋  ${Math.round(centerFrequencyMHz * 1000)} kHz`
            : `✋  ${centerFrequencyMHz.toFixed(3)} MHz`;

      ctx.save();
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const labelW = ctx.measureText(centerLabel).width;
      const labelX = width / 2;
      const labelY = fftAreaMax.y + 25;
      ctx.fillStyle = "rgba(10, 10, 10, 0.9)";
      ctx.fillRect(labelX - labelW / 2 - 6, labelY - 13, labelW + 12, 17);
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
        showGrid = true,
        centerFrequencyMHz,
        isDeviceConnected = true,
        highPerformanceMode = false,
        hardwareSampleRateHz,
        fullCaptureRange,
        isIqRecordingActive,
      } = options;

      const ctx = canvas.getContext("2d");
      if (!ctx || !waveform || waveform.length === 0) return false;

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
              true,
              hardwareSampleRateHz,
              fullCaptureRange,
              isIqRecordingActive,
            );
          } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, cssWidth, cssHeight);
          }

          // Simple line drawing for performance
          drawSpectrumTrace(ctx, cssWidth, cssHeight, waveform, fftMin, fftMax);
        } else {
          // Full quality mode: complete spectrum rendering
          if (showGrid) {
            drawSpectrumGrid(
              ctx,
              cssWidth,
              cssHeight,
              frequencyRange,
              fftMin,
              fftMax,
              true,
              hardwareSampleRateHz,
              fullCaptureRange,
              isIqRecordingActive,
            );
          } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, cssWidth, cssHeight);
          }
          drawSpectrumTrace(ctx, cssWidth, cssHeight, waveform, fftMin, fftMax);
        }

        // Draw markers if needed
        if (centerFrequencyMHz !== undefined) {
          drawSpectrumMarkers(
            ctx,
            cssWidth,
            cssHeight,
            frequencyRange,
            centerFrequencyMHz,
            isDeviceConnected,
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
