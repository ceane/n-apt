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
  BOUNDARY_LINE_COLOR,
  BOUNDARY_TEXT_COLOR,
} from "@n-apt/consts";
import { formatFrequency } from "@n-apt/utils/frequency";
import { tickPrecisionForStep } from "@n-apt/utils/rendering/formatters";
import {
  createCanvasVfoAxisContext,
  drawVfoAxis,
} from "@n-apt/utils/rendering/vfoAxis";
import {
  drawLiveCanvasStatusRow,
  type LiveCanvasStatusRow,
} from "@n-apt/hooks/useDraw2DFFTSignal";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
import type { SpectrumSpikeMarker } from "@n-apt/hooks/useWasmSimdMath";

export type Alignment = "centered" | "start" | "end";

export interface DemodFocusOverlay {
  centerFrequencyHz: number;
  halfBandwidthHz: number;
  alignment?: Alignment;
}

export interface SelectionOverlay {
  minFrequencyHz: number;
  maxFrequencyHz: number;
}

export interface TxSliderOverlayState {
  visible: boolean;
  visibleMinHz: number;
  visibleMaxHz: number;
  txCenterHz: number;
  txSampleRateHz: number;
  isTransmitting?: boolean;
  signalLabel?: string;
  powerDbm?: number;
}

const readCssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined" || typeof document === "undefined")
    return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

const getDarkerColor = (colorStr: string) => {
  if (!colorStr) return "rgba(170, 30, 30, 0.8)";
  if (colorStr.startsWith("rgba")) {
    const match = colorStr.match(
      /rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
    );
    if (match) {
      const r = Math.max(0, Math.round(parseInt(match[1]) * 0.75));
      const g = Math.max(0, Math.round(parseInt(match[2]) * 0.75));
      const b = Math.max(0, Math.round(parseInt(match[3]) * 0.75));
      return `rgba(${r}, ${g}, ${b}, 0.8)`;
    }
  }
  if (colorStr.startsWith("rgb")) {
    const match = colorStr.match(
      /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/,
    );
    if (match) {
      const r = Math.max(0, Math.round(parseInt(match[1]) * 0.75));
      const g = Math.max(0, Math.round(parseInt(match[2]) * 0.75));
      const b = Math.max(0, Math.round(parseInt(match[3]) * 0.75));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  if (colorStr.startsWith("#")) {
    const hex = colorStr.substring(1);
    const num = parseInt(hex, 16);
    const r = Math.max(0, Math.round(((num >> 16) & 0xff) * 0.75));
    const g = Math.max(0, Math.round(((num >> 8) & 0xff) * 0.75));
    const b = Math.max(0, Math.round((num & 0xff) * 0.75));
    return `rgb(${r}, ${g}, ${b})`;
  }
  return "rgba(170, 30, 30, 0.8)";
};

const getCanvasThemeColors = () => ({
  gridColor: readCssColor("--color-fft-grid", FFT_GRID_COLOR),
  textColor: readCssColor("--color-fft-text", FFT_TEXT_COLOR),
  centerLineColor: readCssColor("--color-fft-center-line", CENTER_LINE_COLOR),
  offsetTickLine: readCssColor(
    "--color-fft-offset-tick-line",
    OFFSET_TICK_LINE_COLOR,
  ),
  offsetTickText: readCssColor(
    "--color-fft-offset-tick-text",
    OFFSET_TICK_TEXT_COLOR,
  ),
  snapHwRateLine: readCssColor("--color-snap-hw-rate-line", SNAP_HW_RATE_LINE),
  snapHwRateText: readCssColor("--color-snap-hw-rate-text", SNAP_HW_RATE_TEXT),
  centerLabelText: readCssColor("--color-snap-center-label-text", "#666"),
  boundaryLine: readCssColor("--color-fft-boundary-line", BOUNDARY_LINE_COLOR),
  boundaryText: readCssColor("--color-fft-boundary-text", BOUNDARY_TEXT_COLOR),
  spectrumOverlay: readCssColor(
    "--color-spectrum-overlay",
    "rgba(255, 255, 255, 0.08)",
  ),
  spectrumOverlayBorder: readCssColor(
    "--color-spectrum-overlay-border",
    "rgba(37, 64, 105, 0.78)",
  ),
  surfaceColor: readCssColor("--color-surface", "#ffffff"),
  powerLineColor: readCssColor(
    "--color-fft-power-line",
    "rgba(0, 212, 255, 0.85)",
  ),
  textPrimary: readCssColor("--color-text-primary", "#cccccc"),
});

const VFO_AXIS_ROW_HEIGHT = 40;
const LIVE_STATUS_ROW_HEIGHT = 56;
export const TX_SLIDER_ROW_HEIGHT = LIVE_STATUS_ROW_HEIGHT;
const HARDWARE_LIMIT_LINE_COLOR = "rgba(255, 48, 48, 0.95)";
const HARDWARE_LIMIT_TEXT_COLOR = "rgba(255, 48, 48, 0.98)";

/**
 * Hook for rendering WebGPU overlay textures (grid and markers)
 * Provides functions to draw grid and markers onto OffscreenCanvas contexts
 */
export function useOverlayRenderer() {
  // formatFrequencyHighRes moved to shared.ts

  const drawGridOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      _frequencyRange: { min: number; max: number },
      _fftMin: number,
      _fftMax: number,
      powerScale: "dB" | "dBm" = "dB",
      _hardwareSampleRateHz?: number,
      fullCaptureRange?: { min: number; max: number },
      _isIqRecordingActive?: boolean,
      reservedBottomPx: number = LIVE_STATUS_ROW_HEIGHT,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = {
        x: width - 40,
        y: height - VFO_AXIS_ROW_HEIGHT - reservedBottomPx,
      };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

      const vertRange = _fftMax - _fftMin;
      const scaleFactor = fftHeight / vertRange;

      if (!_frequencyRange) return;
      const minFreq = _frequencyRange.min;
      const maxFreq = _frequencyRange.max;
      const viewBandwidth2 = maxFreq - minFreq;

      const fullSpan = fullCaptureRange
        ? fullCaptureRange.max - fullCaptureRange.min
        : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth2 : 1;
      const formatFreq = (f: number) =>
        formatFrequency(f, {
          trimTrailingZeros: true,
          precisionMHz: 4,
          precisionKHz: 2,
          precisionGHz: 3,
        });

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
      const labelStart =
        Math.floor((_fftMax + 0.1) / VERTICAL_RANGE) * VERTICAL_RANGE;

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

        ctx.fillText(label, FFT_AREA_MIN.x - 8, Math.round(yPos + 1));
      }

      const step = findBestFrequencyRange(viewBandwidth2, 10);
      const tickPrecision = tickPrecisionForStep(step);
      const formatTickLabel = (freq: number) =>
        formatFrequency(freq, {
          trimTrailingZeros: true,
          precisionMHz: 4,
          precisionKHz: 2,
          precisionGHz: tickPrecision.precisionGHz,
        });
      const lowerFreq2 = Math.ceil(minFreq / step) * step;
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
        return formatFrequency(hz, { trimTrailingZeros: true });
      };

      const isGHzRange = Math.max(Math.abs(minFreq), Math.abs(maxFreq)) >= 1e9;
      const tickFontPx = isGHzRange ? 10 : 12;

      ctx.strokeStyle = canvasTheme.gridColor;
      ctx.fillStyle = canvasTheme.textColor;
      ctx.font = `${tickFontPx}px JetBrains Mono`;
      ctx.textAlign = "center";

      // ── Collision Avoidance Setup ──────────────────────────────────────────
      const occupiedRects: { x1: number; x2: number }[] = [];
      const startLabel = formatFreq(minFreq);
      const endLabel = formatFreq(maxFreq);
      const centerLabelText =
        Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
          ? "--MHz"
          : formatFrequency(visualCenterFreq, {
              trimTrailingZeros: true,
              precisionMHz: 4,
              precisionKHz: 2,
              precisionGHz: 3,
            });

      const startW = ctx.measureText(startLabel).width;
      const endW = ctx.measureText(endLabel).width;
      const centerW = ctx.measureText(`✋  ${centerLabelText}`).width;

      occupiedRects.push({
        x1: FFT_AREA_MIN.x - 5,
        x2: FFT_AREA_MIN.x + startW + 15,
      });
      occupiedRects.push({
        x1: fftAreaMax.x - endW - 15,
        x2: fftAreaMax.x + 5,
      });
      occupiedRects.push({
        x1: width / 2 - centerW / 2 - 15,
        x2: width / 2 + centerW / 2 + 15,
      });

      const isColliding = (x: number, text: string) => {
        const tw = ctx.measureText(text).width;
        const x1 = x - tw / 2 - 10;
        const x2 = x + tw / 2 + 10;
        return occupiedRects.some((r) => x1 < r.x2 && x2 > r.x1);
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
        const ix = xPos;

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
      const shouldShowHWGrid =
        !!_isIqRecordingActive && totalSpan > hwSpanHz + 1 && hwSpanHz > 0;

      if (shouldShowHWGrid) {
        ctx.save();
        ctx.strokeStyle = HARDWARE_LIMIT_LINE_COLOR;
        ctx.lineWidth = 1 / dpr;
        ctx.fillStyle = HARDWARE_LIMIT_TEXT_COLOR;
        ctx.font = "10px JetBrains Mono";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.setLineDash([4, 4]);

        const formatOffset = (hz: number) => {
          return formatFrequency(hz, { trimTrailingZeros: true });
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
            if (
              blockStart > anchorRange.min + 0.0001 &&
              blockStart >= minFreq &&
              blockStart <= maxFreq
            ) {
              const lx = freqToX2(blockStart);
              ctx.beginPath();
              ctx.moveTo(lx, FFT_AREA_MIN.y);
              ctx.lineTo(lx, fftAreaMax.y);
              ctx.stroke();
            }

            // Draw right boundary
            if (
              blockEnd < anchorRange.max - 0.0001 &&
              blockEnd >= minFreq &&
              blockEnd <= maxFreq
            ) {
              const rx = freqToX2(blockEnd);
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
              const cx = freqToX2(visibleCenter);
              const label = isFullBlock
                ? "Hardware Sample Rate"
                : "Next Sample";
              const subLabel = formatOffset(blockWidth);
              ctx.fillText(label, cx, FFT_AREA_MIN.y + 35);
              ctx.fillText(subLabel, cx, FFT_AREA_MIN.y + 32);
            }
          }
          currentFreq = blockEnd;
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    },
    [formatFrequency],
  );

  const drawMarkersOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      _frequencyRange: { min: number; max: number },
      _centerFrequencyHz: number,
      _isDeviceConnected: boolean,
      _hardwareSampleRateHz?: number,
      _fullCaptureRange?: { min: number; max: number },
      _isIqRecordingActive?: boolean,
      _limitMarkers?: SdrLimitMarker[],
      _fftSize?: number,
      _fftWindow?: string,
      _temporalResolution?: "low" | "medium" | "high",
      showStatusRow = true,
      reservedBottomPx: number = LIVE_STATUS_ROW_HEIGHT,
      _statusRow?: LiveCanvasStatusRow,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = {
        x: width - 40,
        y: height - VFO_AXIS_ROW_HEIGHT - reservedBottomPx,
      };
      if (!_frequencyRange) return;
      const minFreq = _frequencyRange.min;
      const maxFreq = _frequencyRange.max;
      if (!Number.isFinite(minFreq) || !Number.isFinite(maxFreq)) return;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      const fullSpan = _fullCaptureRange
        ? _fullCaptureRange.max - _fullCaptureRange.min
        : 0;
      const zoom = fullSpan > 0 ? fullSpan / (maxFreq - minFreq) : 1;
      drawVfoAxis({
        ctx: createCanvasVfoAxisContext(ctx),
        frequencyRange: { min: minFreq, max: maxFreq },
        centerFrequencyHz: (minFreq + maxFreq) / 2,
        bounds: {
          left: FFT_AREA_MIN.x,
          right: fftAreaMax.x,
          top: FFT_AREA_MIN.y,
          bottom: fftAreaMax.y,
        },
        y: fftAreaMax.y,
        labelY: fftAreaMax.y + 25,
        orientation: "bottom",
        tickDirection: "down",
        targetTicks: 10,
        showAxisLine: false,
        showEdgeLabels: false,
        showTickMarks: false,
        showTickLabels: false,
        showCenterLine: true,
        centerLineTop: FFT_AREA_MIN.y,
        centerLineBottom: fftAreaMax.y,
        icon: "wave",
        theme: {
          tick: canvasTheme.textColor,
          label: canvasTheme.textColor,
          center: canvasTheme.centerLabelText,
          centerLine: canvasTheme.centerLineColor,
        },
        fontPx: 12,
        centerFontPx: 12,
        textBaseline: "alphabetic",
        useHighResLabels: false,
        lineWidth: Math.max(0.5 / dpr, 1),
      });

      if (showStatusRow) {
        const statusRowOptions = _statusRow
          ? {
              statusRow: _statusRow,
              textColor: canvasTheme.textColor,
            }
          : typeof _hardwareSampleRateHz === "number" &&
              typeof _fftSize === "number" &&
              _fftWindow &&
              _temporalResolution
            ? {
                sampleRateHz: _hardwareSampleRateHz,
                fftSize: _fftSize,
                fftWindow: _fftWindow,
                temporalResolution: _temporalResolution,
                textColor: canvasTheme.textColor,
              }
            : null;
        if (statusRowOptions) {
          drawLiveCanvasStatusRow(
            ctx as CanvasRenderingContext2D,
            width,
            height,
            statusRowOptions,
          );
        }
      }

      const viewBandwidth = maxFreq - minFreq;
      const freqToX = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

      const limitMarkers = (_limitMarkers ?? []).filter(
        (marker) =>
          Number.isFinite(marker.freq) &&
          marker.freq >= minFreq &&
          marker.freq <= maxFreq,
      );

      if (limitMarkers.length > 0 && viewBandwidth > 0) {
        ctx.save();
        ctx.font = "11px JetBrains Mono, monospace";
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(1, 1 / dpr);

        for (const marker of limitMarkers) {
          const x = freqToX(marker.freq);
          const label = marker.label || formatFrequency(marker.freq);

          ctx.strokeStyle = HARDWARE_LIMIT_LINE_COLOR;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, FFT_AREA_MIN.y);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();

          ctx.setLineDash([]);
          ctx.fillStyle = HARDWARE_LIMIT_TEXT_COLOR;
          ctx.textAlign = x > width - 160 ? "right" : "left";
          ctx.fillText(
            label,
            x + (ctx.textAlign === "right" ? -6 : 6),
            FFT_AREA_MIN.y + 45,
          );
        }

        ctx.restore();
      }

      void _fullCaptureRange;
    },
    [],
  );

  const drawDemodFocusOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      demodFocus: DemodFocusOverlay | null | undefined,
      nodePreview = false,
      reservedBottomPx: number = LIVE_STATUS_ROW_HEIGHT,
    ) => {
      if (!demodFocus) return;

      const { centerFrequencyHz, halfBandwidthHz } = demodFocus;
      if (
        !Number.isFinite(centerFrequencyHz) ||
        !Number.isFinite(halfBandwidthHz) ||
        halfBandwidthHz <= 0
      ) {
        return;
      }

      const minFreq = frequencyRange.min;
      const maxFreq = frequencyRange.max;
      const viewBandwidth = maxFreq - minFreq;
      if (
        !Number.isFinite(minFreq) ||
        !Number.isFinite(maxFreq) ||
        viewBandwidth <= 0
      ) {
        return;
      }

      const bandMin = centerFrequencyHz - halfBandwidthHz;
      const bandMax = centerFrequencyHz + halfBandwidthHz;

      // Only return if off-screen in full mode; for nodePreview, we want to see it if possible
      if (!nodePreview && (bandMax <= minFreq || bandMin >= maxFreq)) return;

      const plotLeft = nodePreview ? 0 : FFT_AREA_MIN.x;
      const plotRight = nodePreview ? width : width - 40;
      const plotTop = nodePreview ? 0 : FFT_AREA_MIN.y;
      const plotBottom = nodePreview
        ? height
        : height - VFO_AXIS_ROW_HEIGHT - reservedBottomPx;
      const plotWidth = plotRight - plotLeft;
      if (plotWidth <= 0 || plotBottom <= plotTop) return;

      const freqToX = (freq: number) =>
        plotLeft + ((freq - minFreq) / viewBandwidth) * plotWidth;

      const leftX = Math.max(plotLeft, Math.min(plotRight, freqToX(bandMin)));
      const rightX = Math.max(plotLeft, Math.min(plotRight, freqToX(bandMax)));
      const bandWidth = Math.max(2, rightX - leftX);
      const centerX = Math.max(
        plotLeft + 28,
        Math.min(plotRight - 28, freqToX(centerFrequencyHz)),
      );
      const label = formatFrequency(centerFrequencyHz, {
        showUnits: true,
        precisionMHz: 6,
        precisionGHz: 3,
        precisionKHz: 3,
        trimTrailingZeros: true,
      });

      const alignment = demodFocus.alignment || "centered";
      const subLabel =
        alignment === "centered"
          ? `±${formatFrequency(halfBandwidthHz, {
              showUnits: true,
              precisionMHz: 6,
              precisionGHz: 3,
              precisionKHz: 3,
              trimTrailingZeros: true,
            })}`
          : formatFrequency(halfBandwidthHz * 2, {
              showUnits: true,
              precisionMHz: 6,
              precisionGHz: 3,
              precisionKHz: 3,
              trimTrailingZeros: true,
            });

      ctx.save();
      const canvasTheme = getCanvasThemeColors();

      // 1. Selection Box - Background Highlight (from theme)
      ctx.fillStyle = canvasTheme.spectrumOverlay;
      ctx.fillRect(leftX, plotTop, bandWidth, plotBottom - plotTop);

      // 2. Selection Box - Boundary lines
      ctx.strokeStyle = canvasTheme.spectrumOverlayBorder;
      ctx.lineWidth = Math.max(1, 2 / (window.devicePixelRatio || 1));
      ctx.lineCap = "round";

      for (const x of [leftX, rightX]) {
        ctx.beginPath();
        ctx.moveTo(x, plotTop);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
      }

      // 3. Center Line (Themed) - Drawn on top of the selection highlight so it stands out cleanly
      const centerLineX = freqToX(centerFrequencyHz);
      if (centerLineX >= plotLeft && centerLineX <= plotRight) {
        ctx.save();
        ctx.strokeStyle = canvasTheme.centerLineColor;
        ctx.lineWidth = Math.max(1, 2.5 / (window.devicePixelRatio || 1));
        ctx.beginPath();
        ctx.moveTo(centerLineX, plotTop);
        ctx.lineTo(centerLineX, plotBottom);
        ctx.stroke();
        ctx.restore();
      }

      // 4. Drawing text labels and markers box
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = nodePreview
        ? "bold 10px JetBrains Mono"
        : "bold 12px JetBrains Mono";

      const labelWidth = Math.max(
        ctx.measureText(label).width,
        ctx.measureText(subLabel).width,
      );
      const labelX = Math.max(
        plotLeft + labelWidth / 2 + 8,
        Math.min(plotRight - labelWidth / 2 - 8, centerX),
      );

      // Multi-line Label Background (Opaque white for maximum contrast)
      const labelHeight = nodePreview ? 26 : 38;
      ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
      ctx.fillRect(
        labelX - labelWidth / 2 - 8,
        plotTop + (nodePreview ? 4 : 10),
        labelWidth + 16,
        labelHeight,
      );

      // Optional: fine border for the label box
      ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        labelX - labelWidth / 2 - 8,
        plotTop + (nodePreview ? 4 : 10),
        labelWidth + 16,
        labelHeight,
      );

      ctx.fillStyle = "#07111f"; // Dark text on light label bg
      ctx.fillText(label, labelX, plotTop + (nodePreview ? 6 : 13));

      ctx.font = "bold 9px JetBrains Mono";
      ctx.fillStyle = "rgba(7, 17, 31, 0.8)";
      ctx.fillText(subLabel, labelX, plotTop + (nodePreview ? 17 : 28));

      ctx.restore();
    },
    [],
  );

  const drawSelectionOverlayOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      selectionRange: SelectionOverlay | null | undefined,
      nodePreview = false,
      reservedBottomPx: number = LIVE_STATUS_ROW_HEIGHT,
    ) => {
      if (!selectionRange) return;

      const { minFrequencyHz, maxFrequencyHz } = selectionRange;
      if (
        !Number.isFinite(minFrequencyHz) ||
        !Number.isFinite(maxFrequencyHz) ||
        maxFrequencyHz <= minFrequencyHz
      ) {
        return;
      }

      const minFreq = frequencyRange.min;
      const maxFreq = frequencyRange.max;
      const viewBandwidth = maxFreq - minFreq;
      if (
        !Number.isFinite(minFreq) ||
        !Number.isFinite(maxFreq) ||
        viewBandwidth <= 0
      ) {
        return;
      }

      const left = Math.max(minFreq, minFrequencyHz);
      const right = Math.min(maxFreq, maxFrequencyHz);
      if (right <= left) return;

      const plotLeft = nodePreview ? 0 : FFT_AREA_MIN.x;
      const plotRight = nodePreview ? width : width - 40;
      const plotTop = nodePreview ? 0 : FFT_AREA_MIN.y;
      const plotBottom = nodePreview
        ? height
        : height - VFO_AXIS_ROW_HEIGHT - reservedBottomPx;
      const plotWidth = plotRight - plotLeft;
      if (plotWidth <= 0 || plotBottom <= plotTop) return;

      const freqToX = (freq: number) =>
        plotLeft + ((freq - minFreq) / viewBandwidth) * plotWidth;

      const leftX = Math.max(plotLeft, Math.min(plotRight, freqToX(left)));
      const rightX = Math.max(plotLeft, Math.min(plotRight, freqToX(right)));
      const bandWidth = Math.max(2, rightX - leftX);

      ctx.save();
      const canvasTheme = getCanvasThemeColors();
      ctx.fillStyle = canvasTheme.spectrumOverlay;
      ctx.fillRect(leftX, plotTop, bandWidth, plotBottom - plotTop);
      ctx.strokeStyle = canvasTheme.spectrumOverlayBorder;
      ctx.lineWidth = Math.max(1, 2 / (window.devicePixelRatio || 1));
      ctx.lineCap = "round";
      ctx.setLineDash([4, 4]);
      for (const x of [leftX, rightX]) {
        ctx.beginPath();
        ctx.moveTo(x, plotTop);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
      }

      // Draw yellow dotted center line using the center frequency line color
      const centerX = (leftX + rightX) / 2;
      ctx.strokeStyle = canvasTheme.spectrumOverlayBorder;
      ctx.lineWidth = Math.max(1, 1.5 / (window.devicePixelRatio || 1));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(centerX, plotTop);
      ctx.lineTo(centerX, plotBottom);
      ctx.stroke();

      ctx.restore();
    },
    [],
  );

  const drawTxSliderOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      slider: TxSliderOverlayState | null | undefined,
      visualRange?: FrequencyRange,
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

      const canvasTheme = getCanvasThemeColors();
      const plotLeft = Math.min(50, width);
      const plotRight = Math.max(plotLeft, width - 40);
      const left = 4;
      const right = Math.max(left, width - 4);
      const top = Math.max(0, height - TX_SLIDER_ROW_HEIGHT);
      const bottom = Math.max(top + 1, height - 4);
      const trackLeft = plotLeft;
      const trackRight = Math.max(trackLeft + 80, plotRight);
      const trackWidth = Math.max(1, trackRight - trackLeft);
      const visRange = visualRange || {
        min: slider.visibleMinHz,
        max: slider.visibleMaxHz,
      };
      const visibleSpan = visRange.max - visRange.min;
      const bandwidth = Math.max(1, slider.txSampleRateHz);
      const bandMin = slider.txCenterHz - bandwidth / 2;
      const bandMax = slider.txCenterHz + bandwidth / 2;
      const toX = (hz: number) =>
        trackLeft + ((hz - visRange.min) / visibleSpan) * trackWidth;
      const rawBandLeft = toX(bandMin);
      const rawBandRight = toX(bandMax);
      const bandLeft = Math.max(trackLeft, Math.min(trackRight, rawBandLeft));
      const bandRight = Math.max(trackLeft, Math.min(trackRight, rawBandRight));
      const boundaryDashColor = slider.isTransmitting
        ? "rgba(0, 212, 255, 0.98)"
        : "rgba(148, 163, 184, 0.96)";
      ctx.save();
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";

      if (bandRight > bandLeft) {
        const plotBottom = Math.max(0, top - VFO_AXIS_ROW_HEIGHT);
        const plotTop = Math.min(20, height);
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
    [],
  );

  const drawTxSliderBackdropOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      slider: TxSliderOverlayState | null | undefined,
      visualRange?: FrequencyRange,
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
      const top = Math.max(0, height - TX_SLIDER_ROW_HEIGHT);
      const trackLeft = plotLeft;
      const trackRight = Math.max(trackLeft + 80, plotRight);
      const trackWidth = Math.max(1, trackRight - trackLeft);
      const visRange = visualRange || {
        min: slider.visibleMinHz,
        max: slider.visibleMaxHz,
      };
      const visibleSpan = visRange.max - visRange.min;
      if (!Number.isFinite(visibleSpan) || visibleSpan <= 0) return;

      const bandwidth = Math.max(1, slider.txSampleRateHz);
      const bandMin = slider.txCenterHz - bandwidth / 2;
      const bandMax = slider.txCenterHz + bandwidth / 2;
      const toX = (hz: number) =>
        trackLeft + ((hz - visRange.min) / visibleSpan) * trackWidth;
      const bandLeft = Math.max(trackLeft, Math.min(trackRight, toX(bandMin)));
      const bandRight = Math.max(trackLeft, Math.min(trackRight, toX(bandMax)));
      if (bandRight <= bandLeft) return;

      const blockLeft = bandLeft;
      const blockWidth = bandRight - bandLeft;
      const blockTop = Math.max(0, top - VFO_AXIS_ROW_HEIGHT + 2);
      const blockBottom = Math.max(blockTop + 1, height);
      ctx.save();
      ctx.fillStyle = slider.isTransmitting
        ? "rgba(0, 212, 255, 0.12)"
        : "rgba(100, 116, 139, 0.12)";
      ctx.beginPath();
      ctx.rect(blockLeft, blockTop, blockWidth, blockBottom - blockTop);
      ctx.fill();
      ctx.restore();
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
      const left = 0;
      const top = 0;
      const right = width;
      const bottom = height;
      const plotWidth = right - left;
      const fftHeight = bottom - top;
      const dynamicRange = fftMax - fftMin;
      if (dynamicRange <= 0) return;

      const idxToX = (idx: number) =>
        left + (idx / (waveformLength - 1)) * plotWidth;
      const valueToY = (value: number) =>
        Math.max(
          top + 2,
          Math.min(
            bottom - 2,
            bottom - ((value - fftMin) / dynamicRange) * fftHeight,
          ),
        );

      ctx.save();
      ctx.fillStyle = "rgba(255, 72, 72, 0.96)";
      ctx.strokeStyle = "rgba(255, 228, 228, 0.98)";
      ctx.shadowColor = "rgba(255, 72, 72, 0.45)";
      ctx.shadowBlur = 5;
      ctx.lineWidth = 1.15;
      ctx.lineCap = "round";

      for (const marker of spikeMarkers) {
        const x = idxToX(marker.index);
        const y = valueToY(marker.value);
        const dotRadius = Math.max(1.5, marker.radius * 0.4);
        const hoverOffset = Math.max(10, marker.radius * 2.2);
        const markerY = Math.max(top + 6, y - hoverOffset);
        const lineEndY = Math.max(top + 2, markerY - dotRadius - 3);
        ctx.beginPath();
        ctx.moveTo(x, top + 2);
        ctx.lineTo(x, lineEndY);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, markerY, dotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    },
    [],
  );

  const drawZoomMarkersOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      fullCaptureRange?: { min: number; max: number },
      reservedBottomPx: number = LIVE_STATUS_ROW_HEIGHT,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = {
        x: width - 40,
        y: height - VFO_AXIS_ROW_HEIGHT - reservedBottomPx,
      };
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

      if (!frequencyRange) return;
      const minFreq = frequencyRange.min;
      const maxFreq = frequencyRange.max;
      const viewBandwidth = maxFreq - minFreq;
      const visualCenterFreq = (minFreq + maxFreq) / 2;
      const isGhzRange =
        Math.abs(visualCenterFreq) >= 1_000_000_000 ||
        Math.abs(minFreq) >= 1_000_000_000 ||
        Math.abs(maxFreq) >= 1_000_000_000;

      const centerTicksHz: number[] = [];
      if (viewBandwidth <= 5_000_000) {
        centerTicksHz.push(isGhzRange ? 1_000_000 : 500_000);
      }
      if (viewBandwidth <= 1_000_000) centerTicksHz.push(100_000);
      if (viewBandwidth <= 500_000) {
        centerTicksHz.push(50_000);
        centerTicksHz.push(33_000);
      }
      if (viewBandwidth <= 250_000) centerTicksHz.push(25_000);
      if (viewBandwidth <= 100_000) centerTicksHz.push(10_000);
      if (viewBandwidth <= 50_000) centerTicksHz.push(5_000);
      if (viewBandwidth <= 10_000) centerTicksHz.push(1_000);

      const formatOffset = (hz: number) => {
        return formatFrequency(hz, { trimTrailingZeros: true });
      };

      const clampLabelX = (x: number, text: string) => {
        const tw = ctx.measureText(text).width;
        const leftBound = FFT_AREA_MIN.x + tw / 2 + 8;
        const rightBound = fftAreaMax.x - tw / 2 - 2;
        return Math.max(leftBound, Math.min(rightBound, x));
      };

      const freqToX = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

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

            const x = freqToX(f);
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
    },
    [formatFrequency],
  );

  const drawPowerLineOnContext = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      powerLineDb: number | null,
      fftMin: number,
      fftMax: number,
      powerScale: "dB" | "dBm" = "dB",
      reservedBottomPx: number = LIVE_STATUS_ROW_HEIGHT,
    ) => {
      if (powerLineDb === null || !Number.isFinite(powerLineDb)) return;

      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = {
        x: width - 40,
        y: height - VFO_AXIS_ROW_HEIGHT - reservedBottomPx,
      };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;

      const vertRange = fftMax - fftMin;
      if (vertRange <= 0) return;
      const scaleFactor = fftHeight / vertRange;

      const yPos = fftAreaMax.y - (powerLineDb - fftMin) * scaleFactor;

      // Bounds check with padding
      if (yPos < FFT_AREA_MIN.y || yPos > fftAreaMax.y) return;

      ctx.save();

      // Formulate label e.g., -35.4dBm or -35.4dB
      const label = `${powerLineDb.toFixed(1)}${powerScale}`;
      ctx.font = "12px JetBrains Mono";
      const textWidth = ctx.measureText(label).width;

      const ix = Math.round(yPos);

      // Measure label dimensions
      const paddingX = 6;
      const rectHeight = 18;
      const rectWidth = textWidth + paddingX * 2;
      const rectX = FFT_AREA_MIN.x + 4;
      const pillGap = 10;
      const topRectY = ix - rectHeight - pillGap;
      const bottomRectY = ix + pillGap;
      const shouldPlaceBelow = yPos <= FFT_AREA_MIN.y + fftHeight * 0.3;
      const rectY = shouldPlaceBelow
        ? Math.min(bottomRectY, fftAreaMax.y - rectHeight - 4)
        : topRectY >= FFT_AREA_MIN.y + 4
          ? topRectY
          : Math.min(bottomRectY, fftAreaMax.y - rectHeight - 4);

      // 1. Draw dashed line across the full plot width
      ctx.strokeStyle = canvasTheme.powerLineColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, ix);
      ctx.lineTo(fftAreaMax.x, ix);
      ctx.stroke();

      // 2. Draw background pill
      // Keep the badge neutral so it reads correctly in light mode.
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeStyle = canvasTheme.powerLineColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);

      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(rectX, rectY, rectWidth, rectHeight, 4);
      } else {
        ctx.rect(rectX, rectY, rectWidth, rectHeight);
      }
      ctx.fill();
      ctx.stroke();

      // 3. Draw text inside the pill
      ctx.fillStyle = canvasTheme.powerLineColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, rectX + rectWidth / 2, rectY + rectHeight / 2);

      ctx.restore();
    },
    [],
  );

  return {
    drawGridOnContext,
    drawMarkersOnContext,
    drawDemodFocusOnContext,
    drawSelectionOverlayOnContext,
    drawTxSliderOnContext,
    drawTxSliderBackdropOnContext,
    drawSpikeMarkersOnContext,
    drawZoomMarkersOnContext,
    drawPowerLineOnContext,
  };
}
