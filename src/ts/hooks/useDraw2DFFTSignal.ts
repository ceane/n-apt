import { useCallback, useRef } from "react";
import {
  createCanvasVfoAxisContext,
  drawVfoAxis,
} from "@n-apt/utils/rendering/vfoAxis";
import {
  LINE_COLOR,
  SHADOW_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  formatFrequency,
  findBestFrequencyRange,
  BOUNDARY_LINE_COLOR,
  BOUNDARY_TEXT_COLOR,
} from "@n-apt/consts";
import { getTemporalResolutionLabel } from "@n-apt/utils/temporalResolution";
import { tickPrecisionForStep } from "@n-apt/utils/rendering/formatters";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";

export type LiveCanvasStatusRow = {
  sampleRateLabel: string;
  txModeLabel?: string;
  fftSizeLabel: string;
  fftWindowLabel: string;
  timingLabel: string;
};

export function formatLiveCanvasStatusRow({
  sampleRateHz,
  fftSize,
  fftWindow,
  temporalResolution,
}: {
  sampleRateHz: number;
  fftSize: number;
  fftWindow: string;
  temporalResolution: "low" | "medium" | "high";
}): LiveCanvasStatusRow {
  const sampleRateLabel = formatFrequency(sampleRateHz, {
    trimTrailingZeros: true,
    precisionMHz: 4,
    precisionKHz: 2,
    precisionGHz: 3,
  });

  return {
    sampleRateLabel: `${sampleRateLabel} sample rate`,
    fftSizeLabel: `FFT Size: ${fftSize.toLocaleString("en-US")}`,
    fftWindowLabel: `FFT Window: ${fftWindow}`,
    timingLabel: `Timing: ${getTemporalResolutionLabel(temporalResolution)}`,
  };
}

export function drawLiveCanvasStatusRow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: (
    | {
        sampleRateHz: number;
        fftSize: number;
        fftWindow: string;
        temporalResolution: "low" | "medium" | "high";
        statusRow?: never;
      }
    | {
        statusRow: LiveCanvasStatusRow;
        sampleRateHz?: never;
        fftSize?: never;
        fftWindow?: never;
        temporalResolution?: never;
      }
  ) & {
    textColor?: string;
    backgroundColor?: string;
    rowHeight?: number;
  },
) {
  const canvasTheme = getCanvasThemeColors();
  const status: LiveCanvasStatusRow =
    "statusRow" in options && options.statusRow
      ? options.statusRow
      : formatLiveCanvasStatusRow({
          sampleRateHz: options.sampleRateHz,
          fftSize: options.fftSize,
          fftWindow: options.fftWindow,
          temporalResolution: options.temporalResolution,
        });

  const dpr = window.devicePixelRatio || 1;
  const rowHeight = options.rowHeight ?? 56;
  const rowTop = height - rowHeight;
  const leftX = FFT_AREA_MIN.x;
  const rightX = width - 40;
  const centerX = width / 2;

  ctx.save();
  ctx.clearRect(leftX, rowTop, rightX - leftX, rowHeight);
  if (options.backgroundColor) {
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(leftX, rowTop, rightX - leftX, rowHeight);
  }
  ctx.strokeStyle = options.textColor ?? canvasTheme.textColor;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  ctx.moveTo(leftX, rowTop + 0.5);
  ctx.lineTo(rightX, rowTop + 0.5);
  ctx.stroke();

  ctx.fillStyle = options.textColor ?? canvasTheme.textColor;
  ctx.font = "11px JetBrains Mono";
  ctx.textBaseline = "middle";

  const sampleRateText = `⌞ ${status.sampleRateLabel} ⌟`;
  ctx.textAlign = "center";
  ctx.fillText(sampleRateText, centerX, rowTop + 18);
  if (status.txModeLabel) {
    const sampleRateLeftX = centerX - ctx.measureText(sampleRateText).width / 2;
    const txLabelX = leftX + 4;
    const txLabelMaxWidth = Math.max(0, sampleRateLeftX - txLabelX - 18);
    if (txLabelMaxWidth > 20) {
      ctx.textAlign = "left";
      ctx.fillText(status.txModeLabel, txLabelX, rowTop + 18, txLabelMaxWidth);
    }
  }
  ctx.textAlign = "left";
  ctx.fillText(status.fftSizeLabel, leftX + 4, rowTop + 40);
  ctx.textAlign = "center";
  ctx.fillText(status.fftWindowLabel, centerX, rowTop + 40);
  ctx.textAlign = "right";
  ctx.fillText(status.timingLabel, rightX - 4, rowTop + 40);
  ctx.restore();

  return status;
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
  backgroundColor: readCssColor("--color-fft-background", "#000"),
  textColor: readCssColor("--color-fft-text", "#fff"),
  gridColor: readCssColor("--color-fft-grid", "rgba(50,50,50,1)"),
  boundaryLine: readCssColor("--color-fft-boundary-line", BOUNDARY_LINE_COLOR),
  boundaryText: readCssColor("--color-fft-boundary-text", BOUNDARY_TEXT_COLOR),
  surfaceColor: readCssColor("--color-surface", "#fff"),
  borderColor: readCssColor("--color-border", "rgba(255,255,255,0.2)"),
  mutedTextColor: readCssColor("--color-text-muted", "#666"),
});

const HARDWARE_LIMIT_LINE_COLOR = "rgba(255, 48, 48, 0.95)";
const HARDWARE_LIMIT_TEXT_COLOR = "rgba(255, 48, 48, 0.98)";

export interface Draw2DFFTSignalOptions {
  canvas: HTMLCanvasElement;
  waveform: Uint8Array | Float32Array | number[];
  frequencyRange: { min: number; max: number };
  fftMin?: number;
  fftMax?: number;
  powerScale?: "dB" | "dBm";
  nodePreview?: boolean;
  showGrid?: boolean;
  centerFrequencyHz?: number;
  isDeviceConnected?: boolean;
  highPerformanceMode?: boolean;
  hardwareSampleRateHz?: number;
  fullCaptureRange?: { min: number; max: number };
  isIqRecordingActive?: boolean;
  limitMarkers?: SdrLimitMarker[];
  fftSize?: number;
  fftWindow?: string;
  temporalResolution?: "low" | "medium" | "high";
  displayMode?: "fft" | "iq";
  textColor?: string;
  backgroundColor?: string;
  reservedBottomPx?: number;
  txSlider?: {
    visible: boolean;
    visibleMinHz: number;
    visibleMaxHz: number;
    txCenterHz: number;
    txSampleRateHz: number;
    signalLabel?: string;
    powerDbm?: number;
  } | null;
}

const TX_SLIDER_ROW_HEIGHT = 56;
const VFO_AXIS_ROW_HEIGHT = 40;

const getReservedBottomPx = (
  nodePreview: boolean,
  txSlider: Draw2DFFTSignalOptions["txSlider"],
  reservedBottomPx?: number,
) => {
  if (nodePreview) return 0;
  if (
    typeof reservedBottomPx === "number" &&
    Number.isFinite(reservedBottomPx)
  ) {
    return Math.max(0, reservedBottomPx);
  }
  return txSlider?.visible ? TX_SLIDER_ROW_HEIGHT : 0;
};

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
      nodePreview: boolean,
      hardwareSampleRateHz?: number,
      fullCaptureRange?: { min: number; max: number },
      limitMarkers: SdrLimitMarker[] = [],
      textColor?: string,
      backgroundColor?: string,
      reservedBottomPx = 0,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();

      if (clearBackground) {
        ctx.fillStyle = backgroundColor ?? canvasTheme.backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      const leftPad = nodePreview ? 0 : FFT_AREA_MIN.x;
      const topPad = nodePreview ? 0 : FFT_AREA_MIN.y;
      const rightPad = nodePreview ? 0 : 40;
      const bottomPad = nodePreview
        ? 0
        : VFO_AXIS_ROW_HEIGHT + reservedBottomPx;
      const fftAreaMax = { x: width - rightPad, y: height - bottomPad };
      const fftHeight = fftAreaMax.y - topPad;
      const plotWidth = fftAreaMax.x - leftPad;

      const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      const minFreq = frequencyRange?.min ?? 0;
      const maxFreq = frequencyRange?.max ?? 3.2;
      const viewBandwidth = maxFreq - minFreq;
      const range = findBestFrequencyRange(viewBandwidth, 10);
      const tickPrecision = tickPrecisionForStep(range);
      const lowerFreq = Math.ceil(minFreq / range) * range;
      const upperFreq = maxFreq;
      const freqToX = (freq: number) =>
        leftPad + ((freq - minFreq) / viewBandwidth) * plotWidth;

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
        ctx.moveTo(leftPad, Math.round(yPos));
        ctx.lineTo(fftAreaMax.x, Math.round(yPos));
        ctx.stroke();
        // Labeling is handled by overlay renderer
      }

      // (Removed old grid loop)

      const fullSpan = fullCaptureRange
        ? fullCaptureRange.max - fullCaptureRange.min
        : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth : 1;
      const formatFreq = (f: number) =>
        formatFrequency(f, {
          trimTrailingZeros: true,
          precisionMHz: 4,
          precisionKHz: 2,
          precisionGHz: tickPrecision.precisionGHz,
        });

      const visualCenterFreq = (minFreq + maxFreq) / 2;

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

      occupiedRects.push({
        x1: leftPad - 5,
        x2: leftPad + startW + 15,
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
      ctx.textAlign = "left";
      ctx.beginPath();
      ctx.moveTo(leftPad, topPad);
      ctx.lineTo(leftPad, fftAreaMax.y + 7);
      ctx.stroke();
      ctx.fillText(startLabel, leftPad, fftAreaMax.y + 25);

      // Draw End Line + Label
      ctx.textAlign = "right";
      ctx.beginPath();
      ctx.moveTo(fftAreaMax.x, topPad);
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
        ctx.moveTo(ix, topPad);
        ctx.lineTo(ix, fftAreaMax.y);
        ctx.stroke();

        // Tick mark
        ctx.strokeStyle = textColor ?? canvasTheme.textColor;
        ctx.beginPath();
        ctx.moveTo(ix, fftAreaMax.y);
        ctx.lineTo(ix, fftAreaMax.y + 7);
        ctx.stroke();

        // Tick label
        const tickLabel = formatFreq(freq);
        if (!isColliding(xPos, tickLabel)) {
          ctx.fillText(tickLabel, ix, fftAreaMax.y + 25);
        }
      }

      ctx.strokeStyle = canvasTheme.textColor;
      ctx.lineWidth = 1.0 / dpr;
      ctx.beginPath();
      ctx.moveTo(leftPad, fftAreaMax.y);
      ctx.lineTo(fftAreaMax.x, fftAreaMax.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(leftPad, topPad);
      ctx.lineTo(leftPad, fftAreaMax.y - 1);
      ctx.stroke();

      const visibleLimitMarkers = limitMarkers.filter((marker) => {
        if (!Number.isFinite(marker.freq)) return false;
        const markerFreq =
          Math.abs(marker.freq) > 1_000_000 && maxFreq < 1_000_000
            ? marker.freq / 1_000_000
            : marker.freq;
        return markerFreq >= minFreq && markerFreq <= maxFreq;
      });

      if (visibleLimitMarkers.length > 0) {
        ctx.save();
        ctx.font = "11px JetBrains Mono, monospace";
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(1, 1 / dpr);

        for (const marker of visibleLimitMarkers) {
          const markerFreq =
            Math.abs(marker.freq) > 1_000_000 && maxFreq < 1_000_000
              ? marker.freq / 1_000_000
              : marker.freq;
          const x = freqToX(markerFreq);
          const label = marker.label || formatFreq(markerFreq);

          ctx.strokeStyle = HARDWARE_LIMIT_LINE_COLOR;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, topPad);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();

          ctx.setLineDash([]);
          ctx.fillStyle = HARDWARE_LIMIT_TEXT_COLOR;
          ctx.textAlign = x > width - 160 ? "right" : "left";
          ctx.fillText(
            label,
            x + (ctx.textAlign === "right" ? -6 : 6),
            topPad + 60,
          );
        }

        ctx.restore();
      }

      void fullCaptureRange;

      // Draw mathematical hardware block boundaries if applicable
      const anchorRange = fullCaptureRange || frequencyRange;
      const totalSpan = anchorRange.max - anchorRange.min;
      const hwSpanMHz = hardwareSampleRateHz ? hardwareSampleRateHz / 1e6 : 0;
      const shouldShowHWGrid = totalSpan > hwSpanMHz + 0.001 && hwSpanMHz > 0;

      if (shouldShowHWGrid) {
        ctx.save();
        ctx.strokeStyle = HARDWARE_LIMIT_LINE_COLOR;
        ctx.lineWidth = 1 / dpr;
        ctx.fillStyle = HARDWARE_LIMIT_TEXT_COLOR;
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
            if (
              blockStart > anchorRange.min + 0.0001 &&
              blockStart >= minFreq &&
              blockStart <= maxFreq
            ) {
              const lx = Math.round(freqToX(blockStart));
              ctx.beginPath();
              ctx.moveTo(lx, topPad);
              ctx.lineTo(lx, fftAreaMax.y);
              ctx.stroke();
            }

            // Draw right boundary
            if (
              blockEnd < anchorRange.max - 0.0001 &&
              blockEnd >= minFreq &&
              blockEnd <= maxFreq
            ) {
              const rx = Math.round(freqToX(blockEnd));
              ctx.beginPath();
              ctx.moveTo(rx, topPad);
              ctx.lineTo(rx, fftAreaMax.y);
              ctx.stroke();
            }

            // Draw center label - clamp to visible region so it doesn't disappear when zoomed
            const visibleStart = Math.max(blockStart, minFreq);
            const visibleEnd = Math.min(blockEnd, maxFreq);
            const visibleCenter = (visibleStart + visibleEnd) / 2;

            if (visibleCenter >= minFreq && visibleCenter <= maxFreq) {
              const cx = Math.round(freqToX(visibleCenter));
              const label = isFullBlock
                ? "Hardware Sample Rate"
                : "Next Sample";
              const subLabel = formatOffset(blockWidth);
              ctx.fillText(label, cx, topPad + 19);
              ctx.fillText(subLabel, cx, topPad + 16);
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
      nodePreview = false,
      reservedBottomPx = 0,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const waveformArray = toFloat32Waveform(waveform);
      if (!waveformArray || waveformArray.length === 0) return;

      const leftPad = nodePreview ? 0 : FFT_AREA_MIN.x;
      const topPad = nodePreview ? 0 : FFT_AREA_MIN.y;
      const rightPad = nodePreview ? 0 : 40;
      const bottomPad = nodePreview
        ? 0
        : VFO_AXIS_ROW_HEIGHT + reservedBottomPx;
      const fftAreaMax = { x: width - rightPad, y: height - bottomPad };
      const fftHeight = fftAreaMax.y - topPad;
      const plotWidth = fftAreaMax.x - leftPad;
      const dataWidth = waveformArray.length;
      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      const idxToX = (idx: number) => {
        if (dataWidth <= 1) return leftPad;
        return leftPad + (idx / (dataWidth - 1)) * plotWidth;
      };

      const clampY = (dbVal: number) => {
        if (displayMode === "iq") {
          // I/Q values are typically in range [-1, 1] or similar
          // We'll normalize them to the canvas height.
          // Let's assume the input is already somewhat scaled or we can just draw it centered.
          const y = height / 2 - dbVal * (height / 3); // Scale 1.0 to 1/3 height
          return Math.max(0, Math.min(height, y));
        }
        const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor;
        return Math.max(topPad + 1, Math.min(fftAreaMax.y, y));
      };

      ctx.fillStyle = SHADOW_COLOR;
      ctx.beginPath();
      ctx.moveTo(idxToX(0), fftAreaMax.y);
      for (let i = 0; i < dataWidth; i++) {
        ctx.lineTo(idxToX(i), clampY(waveformArray[i]));
      }
      ctx.lineTo(idxToX(dataWidth - 1), fftAreaMax.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = Math.max(1, (width < 700 ? 0.75 : 1.5) / dpr);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < dataWidth; i++) {
        const x = idxToX(i);
        const y = clampY(waveformArray[i]);
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
      nodePreview: boolean,
      fullCaptureRange?: { min: number; max: number },
      reservedBottomPx = 0,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const leftPad = nodePreview ? 0 : FFT_AREA_MIN.x;
      const topPad = nodePreview ? 0 : FFT_AREA_MIN.y;
      const rightPad = nodePreview ? 0 : 40;
      const bottomPad = nodePreview
        ? 0
        : VFO_AXIS_ROW_HEIGHT + reservedBottomPx;
      const fftAreaMax = { x: width - rightPad, y: height - bottomPad };
      const plotWidth = fftAreaMax.x - leftPad;
      const minFreq = frequencyRange?.min ?? 0;
      const maxFreq = frequencyRange?.max ?? 3.2;
      const viewBandwidth = maxFreq - minFreq;
      if (viewBandwidth <= 0) return;

      const fullSpan = fullCaptureRange
        ? fullCaptureRange.max - fullCaptureRange.min
        : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth : 1;
      const formatFreq = (f: number) =>
        formatFrequency(f, {
          trimTrailingZeros: true,
          precisionMHz: 4,
          precisionKHz: 2,
        });

      const freqToX = (freq: number) =>
        leftPad + ((freq - minFreq) / viewBandwidth) * plotWidth;

      const markers: { freq: number; label: string }[] = [
        { freq: 0.5, label: "500kHz / RTL-SDR v4 lower limit" },
        { freq: 28.8, label: "28.8MHz / Potential hardware spur" },
      ];

      if (isDeviceConnected) {
        for (const m of markers) {
          if (m.freq < minFreq || m.freq > maxFreq) continue;
          const x = Math.round(freqToX(m.freq)) + 0.5;
          ctx.save();
          ctx.strokeStyle = HARDWARE_LIMIT_LINE_COLOR;
          ctx.lineWidth = 1 / dpr;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, topPad);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();
          ctx.restore();

          ctx.save();
          ctx.fillStyle = HARDWARE_LIMIT_TEXT_COLOR;
          ctx.font = "11px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const tw = ctx.measureText(m.label).width;
          const lx = Math.max(
            leftPad + tw / 2 + 4,
            Math.min(fftAreaMax.x - tw / 2 - 4, x),
          );
          ctx.fillText(m.label, lx, topPad + 60);
          ctx.restore();
        }
      }

      const visualCenterFreq = (minFreq + maxFreq) / 2;
      drawVfoAxis({
        ctx: createCanvasVfoAxisContext(ctx),
        frequencyRange: { min: minFreq, max: maxFreq },
        centerFrequencyHz: Number.isFinite(visualCenterFreq)
          ? visualCenterFreq
          : centerFrequencyHz,
        bounds: {
          left: leftPad,
          right: fftAreaMax.x,
          top: topPad,
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
        showCenterLine: Number.isFinite(centerFrequencyHz),
        showCenterLabel: false,
        centerLineTop: topPad,
        centerLineBottom: fftAreaMax.y,
        icon: "hand",
        theme: {
          tick: canvasTheme.textColor,
          label: canvasTheme.textColor,
          center: "#ffffff",
          centerLine: "rgba(220, 255, 0, 0.7)",
        },
        fontPx: 12,
        centerFontPx: 12,
        textBaseline: "alphabetic",
        useHighResLabels: false,
        lineWidth: 1 / dpr,
      });
    },
    [],
  );

  const drawTxSliderRow = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      slider: NonNullable<Draw2DFFTSignalOptions["txSlider"]>,
      visualRange?: FrequencyRange,
      powerScale: "dB" | "dBm" = "dB",
    ) => {
      if (
        !slider.visible ||
        !Number.isFinite(slider.visibleMinHz) ||
        !Number.isFinite(slider.visibleMaxHz) ||
        slider.visibleMaxHz <= slider.visibleMinHz ||
        !Number.isFinite(slider.txCenterHz) ||
        !Number.isFinite(slider.txSampleRateHz)
      ) {
        return;
      }

      const canvasTheme = getCanvasThemeColors();
      const left = 4;
      const right = Math.max(left, width - 4);
      const top = Math.max(0, height - TX_SLIDER_ROW_HEIGHT);
      const bottom = Math.max(top + 1, height - 4);
      const trackLeft = FFT_AREA_MIN.x;
      const trackRight = Math.max(trackLeft + 80, width - 40);
      const trackWidth = Math.max(1, trackRight - trackLeft);
      const visRange = visualRange || {
        min: slider.visibleMinHz,
        max: slider.visibleMaxHz,
      };
      const visibleSpan = visRange.max - visRange.min;
      const bandwidth = Math.max(
        1,
        Math.min(visibleSpan, slider.txSampleRateHz),
      );
      const bandMin = slider.txCenterHz - bandwidth / 2;
      const bandMax = slider.txCenterHz + bandwidth / 2;
      const toX = (hz: number) =>
        trackLeft + ((hz - visRange.min) / visibleSpan) * trackWidth;
      const rawBandLeft = toX(bandMin);
      const rawBandRight = toX(bandMax);
      const bandLeft = Math.max(trackLeft, Math.min(trackRight, rawBandLeft));
      const bandRight = Math.max(trackLeft, Math.min(trackRight, rawBandRight));
      const centerX = Math.max(
        trackLeft,
        Math.min(trackRight, toX(slider.txCenterHz)),
      );
      const trackY = top + 30;
      const labelY = top + 14;
      const powerY = bottom - 10;

      ctx.save();
      ctx.clearRect(left, top, right - left, TX_SLIDER_ROW_HEIGHT);
      ctx.fillStyle = "rgba(4, 10, 22, 0.94)";
      ctx.strokeStyle = "rgba(86, 201, 246, 0.78)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(left, top, right - left, bottom - top, 8);
      } else {
        ctx.rect(left, top, right - left, bottom - top);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = canvasTheme.textColor;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = "12px JetBrains Mono, monospace";
      ctx.fillText("Tx", left + 14, trackY);

      ctx.strokeStyle = "rgba(148, 163, 184, 0.68)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(trackLeft, trackY);
      ctx.lineTo(trackRight, trackY);
      ctx.stroke();

      ctx.strokeStyle = "rgba(96, 211, 246, 1)";
      ctx.lineWidth = bandwidth < 200_000 ? 5 : 7;
      ctx.beginPath();
      ctx.moveTo(bandLeft, trackY);
      ctx.lineTo(bandRight, trackY);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 206, 84, 0.96)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, top + 7);
      ctx.lineTo(centerX, bottom - 7);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255, 218, 92, 1)";
      ctx.font = "700 12px JetBrains Mono, monospace";
      const signalLabel =
        slider.signalLabel === "wifi"
          ? "Mock WiFi"
          : slider.signalLabel === "d_sharp"
            ? "D#"
            : slider.signalLabel === "5g"
              ? "Mock 5G"
              : slider.signalLabel ?? "TX";
      ctx.fillText(signalLabel, centerX, labelY);

      const hasTxPowerDot =
        powerScale === "dBm" &&
        typeof slider.powerDbm === "number" &&
        Number.isFinite(slider.powerDbm);

      if (
        typeof slider.powerDbm === "number" &&
        Number.isFinite(slider.powerDbm)
      ) {
        ctx.fillStyle = "rgba(226, 232, 240, 0.86)";
        ctx.font = "10px JetBrains Mono, monospace";
        const powerLabel = `${slider.powerDbm.toFixed(0)} dBm`;
        ctx.fillText(powerLabel, centerX, powerY);

        if (hasTxPowerDot) {
          const labelWidth = ctx.measureText(powerLabel).width;
          const dotX = centerX - labelWidth / 2 - 8;
          const dotY = powerY - 1;
          ctx.save();
          ctx.fillStyle = "rgba(255, 206, 84, 0.96)";
          ctx.strokeStyle = "rgba(255, 245, 214, 0.96)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(dotX, dotY, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

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
        nodePreview = false,
        showGrid = true,
        centerFrequencyHz,
        isDeviceConnected = true,
        highPerformanceMode = false,
        hardwareSampleRateHz,
        fullCaptureRange,
        limitMarkers = [],
        fftSize,
        fftWindow,
        temporalResolution,
        displayMode = "fft",
        textColor,
        backgroundColor,
        reservedBottomPx,
        txSlider,
      } = options;

      const ctx = canvas.getContext("2d");
      const waveformArray = toFloat32Waveform(waveform);
      if (!ctx || waveformArray.length === 0) return false;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement?.getBoundingClientRect();
      const cssWidth = rect?.width || canvas.clientWidth || 800;
      const cssHeight = rect?.height || canvas.clientHeight || 400;
      const bottomReservedPx = getReservedBottomPx(
        nodePreview,
        txSlider,
        reservedBottomPx,
      );

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
              nodePreview,
              hardwareSampleRateHz,
              fullCaptureRange,
              limitMarkers,
              textColor,
              backgroundColor,
              bottomReservedPx,
            );
          } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, cssWidth, cssHeight);
          }

          // Simple line drawing for performance
          drawSpectrumTrace(
            ctx,
            cssWidth,
            cssHeight,
            waveformArray,
            fftMin,
            fftMax,
            displayMode,
            nodePreview,
            bottomReservedPx,
          );
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
              nodePreview,
              hardwareSampleRateHz,
              fullCaptureRange,
              limitMarkers,
              textColor,
              backgroundColor,
              bottomReservedPx,
            );
          } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, cssWidth, cssHeight);
          }
          drawSpectrumTrace(
            ctx,
            cssWidth,
            cssHeight,
            waveformArray,
            fftMin,
            fftMax,
            displayMode,
            nodePreview,
            bottomReservedPx,
          );
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
            nodePreview,
            fullCaptureRange,
            bottomReservedPx,
          );
        }

        if (
          !nodePreview &&
          !txSlider?.visible &&
          typeof hardwareSampleRateHz === "number" &&
          typeof fftSize === "number" &&
          fftWindow &&
          temporalResolution
        ) {
          drawLiveCanvasStatusRow(ctx, cssWidth, cssHeight, {
            sampleRateHz: hardwareSampleRateHz,
            fftSize,
            fftWindow,
            temporalResolution,
            textColor,
            backgroundColor,
            rowHeight: TX_SLIDER_ROW_HEIGHT,
          });
        }

        if (!nodePreview && txSlider?.visible) {
          drawTxSliderRow(
            ctx,
            cssWidth,
            cssHeight,
            txSlider,
            frequencyRange,
            powerScale,
          );
        }

        return true;
      } catch (error) {
        console.error("2D FFT rendering failed:", error);
        return false;
      }
    },
    [drawSpectrumGrid, drawSpectrumTrace, drawSpectrumMarkers, drawTxSliderRow],
  );

  const cleanup = useCallback(() => {
    lastRenderRef.current = null;
  }, []);

  return {
    draw2DFFTSignal,
    cleanup,
  };
}
