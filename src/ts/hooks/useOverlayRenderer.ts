import { useCallback } from "react";
import {
  FFT_GRID_COLOR,
  FFT_TEXT_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  findBestFrequencyRange,
  SNAP_HW_RATE_LINE,
  SNAP_HW_RATE_TEXT,
  OFFSET_TICK_LINE_COLOR,
  OFFSET_TICK_TEXT_COLOR,
  CENTER_LINE_COLOR,
} from "@n-apt/consts";
import { formatFrequency, formatFrequencyHighRes } from "@n-apt/consts";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
import type { SpectrumSpikeMarker } from "@n-apt/hooks/useWasmSimdMath";

const readCssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const getCanvasThemeColors = () => ({
  gridColor: readCssColor("--color-fft-grid", FFT_GRID_COLOR),
  textColor: readCssColor("--color-fft-text", FFT_TEXT_COLOR),
  centerLineColor: readCssColor("--color-fft-center-line", CENTER_LINE_COLOR),
  offsetTickLine: readCssColor("--color-fft-offset-tick-line", OFFSET_TICK_LINE_COLOR),
  offsetTickText: readCssColor("--color-fft-offset-tick-text", OFFSET_TICK_TEXT_COLOR),
  snapHwRateLine: readCssColor("--color-snap-hw-rate-line", SNAP_HW_RATE_LINE),
  snapHwRateText: readCssColor("--color-snap-hw-rate-text", SNAP_HW_RATE_TEXT),
  centerLabelText: readCssColor("--color-snap-center-label-text", "#666"),
});

/**
 * Hook for rendering WebGPU overlay textures (grid and markers)
 * Provides functions to draw grid and markers onto OffscreenCanvas contexts
 */
export function useOverlayRenderer() {
  // formatFrequencyHighRes moved to shared.ts

  const drawGridOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      _frequencyRange: { min: number; max: number },
      _fftMin: number,
      _fftMax: number,
      powerScale: "dB" | "dBm" = "dB",
      _hardwareSampleRateHz?: number,
      fullCaptureRange?: { min: number; max: number },
      _isIqRecordingActive?: boolean,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

      const vertRange = _fftMax - _fftMin;
      const scaleFactor = fftHeight / vertRange;

      if (!_frequencyRange) return;
      const minFreq = _frequencyRange.min;
      const maxFreq = _frequencyRange.max;
      const viewBandwidth2 = maxFreq - minFreq;

      const fullSpan = fullCaptureRange ? (fullCaptureRange.max - fullCaptureRange.min) : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth2 : 1;
      const useHighRes = zoom >= 100;
      const formatFreq = (f: number) => useHighRes ? formatFrequencyHighRes(f) : formatFrequency(f);

      const clampLabelX = (x: number, text: string) => {
        const tw = ctx.measureText(text).width;
        const leftBound = FFT_AREA_MIN.x + tw / 2 + 8;
        const rightBound = fftAreaMax.x - tw / 2 - 2;
        return Math.max(leftBound, Math.min(rightBound, x));
      };

      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = canvasTheme.gridColor;
      ctx.fillStyle = canvasTheme.textColor;
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "right";
      ctx.lineWidth = 1 / dpr;

      // Ensure we start labeling from a clean multiple of VERTICAL_RANGE
      // We use a small epsilon to catch cases where fftMax is very close to a tick
      const labelStart = Math.floor((_fftMax + 0.1) / VERTICAL_RANGE) * VERTICAL_RANGE;
      
      // Always include the actual fftMax as the top label, even if it's not on a VERTICAL_RANGE boundary
      const labels = [];
      if (Math.abs(_fftMax - labelStart) > 0.1) {
        labels.push(_fftMax); // Add the actual max as first label
      }
      
      // Add the regular grid labels
      for (let line = labelStart; line >= _fftMin - 1; line -= VERTICAL_RANGE) {
        labels.push(line);
      }

      for (const line of labels) {
        const yPos = fftAreaMax.y - (line - _fftMin) * scaleFactor;
        
        // Bounds check with small padding
        if (yPos < FFT_AREA_MIN.y - 2 || yPos > fftAreaMax.y + 2) continue;

        ctx.beginPath();
        ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
        ctx.lineTo(fftAreaMax.x, Math.round(yPos));
        ctx.stroke();

        let label = `${Math.round(line)}`;
        // Append unit only to the top-most label (the first one in our array)
        if (line === labels[0]) {
          label += powerScale === "dBm" ? "dBm" : "dB";
        }

        ctx.fillText(
          label,
          FFT_AREA_MIN.x - 8,
          Math.round(yPos + 1),
        );
      }

      const step = findBestFrequencyRange(viewBandwidth2, 10);
      const formatTickLabel = (freq: number) => {
        if (!Number.isFinite(freq)) return "---";
        if (maxFreq < 1) return `${Math.round(freq * 1000)}kHz`;
        if (step >= 0.5) return freq.toFixed(1);
        if (step >= 0.01) return freq.toFixed(2);
        return freq.toFixed(3);
      };
      const lowerFreq2 = Math.ceil((minFreq + 0.000001) / step) * step;
      const upperFreq2 = maxFreq;

      const freqToX2 = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth2) * plotWidth;

      const visualCenterFreq = (minFreq + maxFreq) / 2;

      const centerTicksHz: number[] = [];
      if (viewBandwidth2 <= 5_000_000) centerTicksHz.push(500_000);
      if (viewBandwidth2 <= 1_000_000) centerTicksHz.push(100_000);
      if (viewBandwidth2 <= 500_000) {
        centerTicksHz.push(50_000);
        centerTicksHz.push(33_000);
      }
      if (viewBandwidth2 <= 250_000) centerTicksHz.push(25_000);
      if (viewBandwidth2 <= 100_000) centerTicksHz.push(10_000);
      if (viewBandwidth2 <= 50_000) centerTicksHz.push(5_000);
      if (viewBandwidth2 <= 10_000) centerTicksHz.push(1_000);

      const formatOffset = (hz: number) => {
        if (!Number.isFinite(hz)) return "---";
        const abs = Math.abs(hz);
        if (abs >= 1_000_000) return `${(hz / 1_000_000).toFixed(1)}MHz`;
        if (abs >= 1_000) return `${Math.round(hz / 1_000)}kHz`;
        return `${Math.round(hz)}Hz`;
      };

      ctx.strokeStyle = canvasTheme.gridColor;
      ctx.fillStyle = canvasTheme.textColor;
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "center";

      // ── Collision Avoidance Setup ──────────────────────────────────────────
      const occupiedRects: { x1: number; x2: number }[] = [];
      const startLabel = formatFreq(minFreq);
      const endLabel = formatFreq(maxFreq);
      const centerLabelText =
        Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
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
      const channelStartX = freqToX2(minFreq);
      ctx.beginPath();
      ctx.moveTo(Math.round(channelStartX), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(channelStartX), fftAreaMax.y + 7);
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillText(startLabel, FFT_AREA_MIN.x, fftAreaMax.y + 25);

      // Draw End Line + Label
      const channelEndX = freqToX2(maxFreq);
      ctx.beginPath();
      ctx.moveTo(Math.round(channelEndX), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(channelEndX), fftAreaMax.y + 7);
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.fillText(endLabel, fftAreaMax.x, fftAreaMax.y + 25);

      // Draw Ticks and Grid
      ctx.textAlign = "center";
      for (let freq = lowerFreq2; freq < upperFreq2 - 0.0001; freq += step) {
        const xPos = freqToX2(freq);
        const ix = Math.round(xPos);

        // Grid line
        ctx.strokeStyle = canvasTheme.gridColor;
        ctx.beginPath();
        ctx.moveTo(ix, FFT_AREA_MIN.y);
        ctx.lineTo(ix, fftAreaMax.y);
        ctx.stroke();

        // Tick mark
        ctx.strokeStyle = canvasTheme.textColor;
        ctx.beginPath();
        ctx.moveTo(ix, fftAreaMax.y);
        ctx.lineTo(ix, fftAreaMax.y + 7);
        ctx.stroke();

        // Tick label (with collision avoidance)
        // Zoomed out (step >= 0.5): just show x.x
        // Zoomed in: show more precision if needed, but no units as per request
        const label = formatTickLabel(freq);
        
        if (!isColliding(xPos, label)) {
          ctx.fillText(label, xPos, fftAreaMax.y + 25);
          // Don't mark as occupied to allow center label to "win" or other ticks to stay spaced
        }
      }

      // Top ticks
      if (centerTicksHz.length > 0 && Number.isFinite(visualCenterFreq)) {
        ctx.save();
        ctx.strokeStyle = canvasTheme.offsetTickLine;
        ctx.fillStyle = canvasTheme.offsetTickText;
        ctx.font = "10px JetBrains Mono";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        for (const s of centerTicksHz) {
          for (const sign of [-1, 1]) {
            const f = visualCenterFreq + s * sign;
            if (f <= minFreq || f >= maxFreq) continue;

            const x = Math.round(freqToX2(f));
            ctx.beginPath();
            ctx.moveTo(x, FFT_AREA_MIN.y);
            ctx.lineTo(x, fftAreaMax.y);
            ctx.stroke();

            const label = formatOffset(s);
            ctx.fillText(label, clampLabelX(x, label), FFT_AREA_MIN.y + 10);
          }
        }
        ctx.restore();
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

      // Draw mathematical hardware block boundaries if applicable
      const anchorRange = fullCaptureRange || _frequencyRange;
      const totalSpan = anchorRange.max - anchorRange.min;
        const hwSpanHz = _hardwareSampleRateHz ? _hardwareSampleRateHz : 0;
        const shouldShowHWGrid = totalSpan > hwSpanHz + 1 && hwSpanHz > 0;
        
        if (shouldShowHWGrid) {
          ctx.save();
          ctx.strokeStyle = canvasTheme.snapHwRateLine;
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1 / dpr;
          ctx.fillStyle = canvasTheme.snapHwRateText;
          ctx.font = "10px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";

          const formatOffset = (hz: number) => {
            if (!Number.isFinite(hz)) return "---";
            const abs = Math.abs(hz);
            if (abs >= 1_000_000) return `${(hz / 1_000_000).toFixed(1)}MHz`;
            if (abs >= 1_000) return `${Math.round(hz / 1_000)}kHz`;
            return `${Math.round(hz)}Hz`;
          };

          let currentFreq = anchorRange.min;
          while (currentFreq < anchorRange.max - 1) {
            const blockStart = currentFreq;
            const blockEnd = Math.min(blockStart + hwSpanHz, anchorRange.max);
            const blockWidth = blockEnd - blockStart;
            const isFullBlock = blockWidth >= hwSpanHz - 1;

            // Only draw if visible in the current zoomed frequency range
            if (blockEnd > minFreq && blockStart < maxFreq) {
              // Draw left boundary
              if (blockStart > anchorRange.min + 0.0001 && blockStart >= minFreq && blockStart <= maxFreq) {
                const lx = Math.round(freqToX2(blockStart));
                ctx.beginPath();
                ctx.moveTo(lx, FFT_AREA_MIN.y);
                ctx.lineTo(lx, fftAreaMax.y);
                ctx.stroke();
              }

              
              // Draw right boundary
              if (blockEnd < anchorRange.max - 0.0001 && blockEnd >= minFreq && blockEnd <= maxFreq) {
                const rx = Math.round(freqToX2(blockEnd));
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
                const cx = Math.round(freqToX2(visibleCenter));
                const label = isFullBlock ? "Hardware Sample Rate" : "Next Sample";
                const subLabel = formatOffset(blockWidth);
                ctx.fillText(label, cx, FFT_AREA_MIN.y + 20);
                ctx.fillText(subLabel, cx, FFT_AREA_MIN.y + 32);
              }
            }
            currentFreq = blockEnd;
          }
          ctx.restore();
        }
    },
    [formatFrequency, formatFrequencyHighRes],
  );

  const drawMarkersOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      _frequencyRange: { min: number; max: number },
      _centerFrequencyHz: number,
      _isDeviceConnected: boolean,
      _hardwareSampleRateHz?: number,
      _fullCaptureRange?: { min: number; max: number },
      _isIqRecordingActive?: boolean,
      _limitMarkers?: SdrLimitMarker[],
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = { x: width - 40, y: height - 40 };
      if (!_frequencyRange) return;
      const minFreq = _frequencyRange.min;
      const maxFreq = _frequencyRange.max;
      if (!Number.isFinite(minFreq) || !Number.isFinite(maxFreq)) return;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      const fullSpan = _fullCaptureRange ? _fullCaptureRange.max - _fullCaptureRange.min : 0;
      const zoom = fullSpan > 0 ? fullSpan / (maxFreq - minFreq) : 1;
      const useHighResLabels = zoom >= 100;
      const formatFreq = (f: number) =>
        useHighResLabels ? formatFrequencyHighRes(f) : formatFrequency(f);

      const centerLabel = formatFreq((minFreq + maxFreq) / 2);
      const centerX = (FFT_AREA_MIN.x + fftAreaMax.x) / 2;

      ctx.save();
      ctx.fillStyle = canvasTheme.centerLabelText;
      ctx.font = "bold 12px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText(`👋  ${centerLabel}`, centerX, fftAreaMax.y + 25);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = canvasTheme.centerLineColor;
      ctx.lineWidth = Math.max(.5 / dpr, 1);
      ctx.beginPath();
      ctx.moveTo(centerX, FFT_AREA_MIN.y);
      ctx.lineTo(centerX, fftAreaMax.y);
      ctx.stroke();
      ctx.restore();

      if (_limitMarkers?.length) {
        const viewBandwidth = maxFreq - minFreq;
        const freqToX = (freq: number) =>
          FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

        ctx.save();
        ctx.strokeStyle = "rgba(220, 38, 38, 0.75)";
        ctx.setLineDash([6, 4]);
        ctx.fillStyle = canvasTheme.textColor;
        ctx.font = "10px JetBrains Mono";
        ctx.textAlign = "center";

        for (const marker of _limitMarkers) {
          if (!Number.isFinite(marker.freq)) continue;
          if (marker.freq < minFreq || marker.freq > maxFreq) continue;
          const x = Math.round(freqToX(marker.freq));
          ctx.beginPath();
          ctx.moveTo(x, FFT_AREA_MIN.y);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();
          ctx.fillText(marker.label, x, FFT_AREA_MIN.y + 20);
        }

        ctx.restore();
      }
    },
    [],
  );

  const drawSpikeMarkersOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      waveformLength: number,
      fftMin: number,
      fftMax: number,
      spikeMarkers: SpectrumSpikeMarker[] = [],
    ) => {
      if (spikeMarkers.length === 0 || waveformLength < 2) return;
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const dynamicRange = fftMax - fftMin;
      if (dynamicRange <= 0) return;

      const idxToX = (idx: number) =>
        FFT_AREA_MIN.x + (idx / (waveformLength - 1)) * plotWidth;
      const valueToY = (value: number) =>
        Math.max(
          FFT_AREA_MIN.y + 2,
          Math.min(
            fftAreaMax.y - 2,
            fftAreaMax.y - ((value - fftMin) / dynamicRange) * fftHeight,
          ),
        );

      ctx.save();
      ctx.fillStyle = "rgba(255, 72, 72, 0.92)";
      ctx.strokeStyle = "rgba(255, 228, 228, 0.95)";
      ctx.shadowColor = "rgba(255, 72, 72, 0.7)";
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.25;

      for (const marker of spikeMarkers) {
        const x = idxToX(marker.index);
        const y = valueToY(marker.value) - marker.radius * 0.35;
        ctx.beginPath();
        ctx.arc(x, y, marker.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    },
    [],
  );

  return {
    drawGridOnContext,
    drawMarkersOnContext,
    drawSpikeMarkersOnContext,
  };
}
