import { useCallback } from "react";
import {
  FFT_GRID_COLOR,
  LINE_COLOR,
  SHADOW_COLOR,
  FFT_TEXT_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  FFT_CANVAS_BG,
  WATERFALL_CANVAS_BG,
  DEFAULT_COLOR_MAP,
  findBestFrequencyRange,
} from "@n-apt/consts";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SnapshotOptions = {
  whole: boolean;
  showWaterfall: boolean;
  showStats: boolean;
  showGrid: boolean;
  format: "png" | "svg";
  getSnapshotData: () => SnapshotData | null;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalArea?: string;
  sourceName?: string;
  sdrSettingsLabel?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Format MHz value for display — trims trailing zeros, always includes unit. */
export function fmtFreq(mhz: number): string {
  if (Math.abs(mhz) < 1) {
    const khz = mhz * 1000;
    // Trim trailing zeros: 500.0 → 500, 123.45 → 123.45
    return `${parseFloat(khz.toPrecision(6))} kHz`;
  }
  // Trim trailing zeros: 3.0000 → 3, 1.2300 → 1.23
  return `${parseFloat(mhz.toPrecision(6))} MHz`;
}

/** Format a frequency for tick labels — same as fmtFreq but used for grid ticks. */
function fmtFreqTick(mhz: number): string {
  return fmtFreq(mhz);
}

function fmtTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── Zoom/pan slice ──────────────────────────────────────────────────────────

export function getZoomedSlice(
  fullWaveform: Float32Array,
  fullRange: { min: number; max: number },
  zoom: number,
  panOffset: number,
): { slicedWaveform: Float32Array; visualRange: { min: number; max: number } } {
  if (zoom <= 1) {
    return { slicedWaveform: fullWaveform, visualRange: fullRange };
  }

  const totalBins = fullWaveform.length;
  const visibleBins = Math.max(1, Math.floor(totalBins / zoom));
  const fullSpan = fullRange.max - fullRange.min;
  const halfSpan = fullSpan / (2 * zoom);
  const maxPan = fullSpan / 2 - halfSpan;
  const clampedPan = Math.max(-Math.abs(maxPan), Math.min(Math.abs(maxPan), panOffset));
  const centerFreq = (fullRange.min + fullRange.max) / 2;
  const visualCenter = centerFreq + clampedPan;
  const visualCenterBin = Math.round(((visualCenter - fullRange.min) / fullSpan) * totalBins);
  let startBin = Math.round(visualCenterBin - visibleBins / 2);
  startBin = Math.max(0, Math.min(totalBins - visibleBins, startBin));

  const slicedWaveform = fullWaveform.subarray(startBin, startBin + visibleBins);
  const visualRange = {
    min: visualCenter - halfSpan,
    max: visualCenter + halfSpan,
  };

  return { slicedWaveform, visualRange };
}

/** Max-pooling decimation to extract signal envelope when points > pixels */
function decimateWaveform(waveform: number[], targetWidth: number): number[] {
  const len = waveform.length;
  if (len <= targetWidth * 2 || targetWidth <= 0) return waveform;
  const out = new Array(targetWidth);
  const factor = len / targetWidth;
  for (let i = 0; i < targetWidth; i++) {
    const start = Math.floor(i * factor);
    const end = Math.min(len, Math.floor((i + 1) * factor));
    let max = -Infinity;
    for (let j = start; j < end; j++) {
      if (waveform[j] > max) max = waveform[j];
    }
    out[i] = max === -Infinity ? -120 : max;
  }
  return out;
}

// ── Canvas spectrum renderer ────────────────────────────────────────────────

function drawSpectrumToCanvas(
  canvas: HTMLCanvasElement,
  waveform: number[],
  frequencyRange: { min: number; max: number },
  fftMin: number,
  fftMax: number,
  showGrid: boolean,
  centerFrequencyMHz: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !waveform || waveform.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width;   // already DPR-scaled
  const height = canvas.height;

  // Scale context so all coordinates are in logical pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const lw = width / dpr;
  const lh = height / dpr;

  const fftAreaMax = { x: lw - 40, y: lh - 40 };
  const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
  const vertRange = fftMax - fftMin;
  const scaleFactor = fftHeight / vertRange;

  // Background
  ctx.fillStyle = FFT_CANVAS_BG;
  ctx.fillRect(0, 0, lw, lh);

  // ── Always draw ticks + labels (axes frame) ────────────────────────────────

  const FREQ_FONT = "12px JetBrains Mono";
  const FREQ_LABEL_Y = fftAreaMax.y + 20; // unified baseline for all freq labels

  const minFreq = frequencyRange.min;
  const maxFreq = frequencyRange.max;
  const viewBandwidth = maxFreq - minFreq;
  const range = findBestFrequencyRange(viewBandwidth, 10);
  const lowerFreq = Math.ceil(minFreq / range) * range;
  const freqToX = (freq: number) =>
    FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

  ctx.fillStyle = FFT_TEXT_COLOR;
  ctx.font = FREQ_FONT;
  ctx.lineWidth = 1 / dpr;

  // dB labels + optional grid
  ctx.textAlign = "right";
  const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
  const zeroDbY = fftAreaMax.y - (0 - fftMin) * scaleFactor;
  ctx.fillText("0dB", FFT_AREA_MIN.x - 10, Math.round(zeroDbY + 3));

  for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
    if (line === 0) continue;
    const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
    if (showGrid) {
      ctx.strokeStyle = FFT_GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
      ctx.lineTo(fftAreaMax.x, Math.round(yPos));
      ctx.stroke();
    }
    ctx.fillStyle = FFT_TEXT_COLOR;
    ctx.fillText(line.toString(), FFT_AREA_MIN.x - 10, Math.round(yPos + 3));
  }

  // ── Edge frequency labels (always drawn — they take priority) ──────────────
  ctx.font = FREQ_FONT;
  const startLabel = fmtFreq(minFreq);
  const endLabel = fmtFreq(maxFreq);

  // Measure edge label pixel widths for collision avoidance
  const startLabelW = ctx.measureText(startLabel).width;
  const endLabelW = ctx.measureText(endLabel).width;
  // Start label is left-aligned at FFT_AREA_MIN.x, so it occupies [FFT_AREA_MIN.x, FFT_AREA_MIN.x + startLabelW]
  const edgeLeftEnd = FFT_AREA_MIN.x + startLabelW + 12;
  // End label is right-aligned at fftAreaMax.x, so it occupies [fftAreaMax.x - endLabelW, fftAreaMax.x]
  const edgeRightStart = fftAreaMax.x - endLabelW - 12;

  // ── Tick frequency labels + grid (skip ticks that collide with edges) ──────
  ctx.font = FREQ_FONT;
  for (let freq = lowerFreq; freq < maxFreq; freq += range) {
    const xPos = freqToX(freq);
    const tickX = Math.round(xPos);

    // Always draw vertical grid line if grid is on
    if (showGrid) {
      ctx.strokeStyle = FFT_GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(tickX, FFT_AREA_MIN.y);
      ctx.lineTo(tickX, fftAreaMax.y);
      ctx.stroke();
    }

    // Always draw tick mark
    ctx.strokeStyle = FFT_TEXT_COLOR;
    ctx.beginPath();
    ctx.moveTo(tickX, fftAreaMax.y);
    ctx.lineTo(tickX, fftAreaMax.y + 7);
    ctx.stroke();

    // Skip label if it would collide with edge labels
    if (tickX < edgeLeftEnd || tickX > edgeRightStart) continue;

    ctx.fillStyle = FFT_TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.fillText(fmtFreqTick(freq), tickX, FREQ_LABEL_Y);
  }

  // Draw edge labels last (on top)
  ctx.fillStyle = FFT_TEXT_COLOR;
  ctx.font = FREQ_FONT;
  ctx.textAlign = "left";
  ctx.fillText(startLabel, FFT_AREA_MIN.x, FREQ_LABEL_Y);
  ctx.textAlign = "right";
  ctx.fillText(endLabel, fftAreaMax.x, FREQ_LABEL_Y);

  // Axes border
  ctx.strokeStyle = FFT_TEXT_COLOR;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  ctx.moveTo(FFT_AREA_MIN.x, fftAreaMax.y);
  ctx.lineTo(fftAreaMax.x, fftAreaMax.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(FFT_AREA_MIN.x, FFT_AREA_MIN.y);
  ctx.lineTo(FFT_AREA_MIN.x, fftAreaMax.y - 1);
  ctx.stroke();

  // ── Trace ─────────────────────────────────────────────────────────────────

  const decimatedWaveform = decimateWaveform(waveform, Math.ceil(plotWidth));
  const dataWidth = decimatedWaveform.length;
  const pixelsPerBin = plotWidth / Math.max(1, dataWidth);
  const isSteps = pixelsPerBin >= 3; // box/square mode when zoomed in

  const idxToX = (idx: number) => {
    if (dataWidth <= 1) return FFT_AREA_MIN.x;
    return FFT_AREA_MIN.x + (idx / (dataWidth - 1)) * plotWidth;
  };
  const clampY = (dbVal: number) => {
    const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor;
    return Math.max(FFT_AREA_MIN.y + 1, Math.min(fftAreaMax.y, y));
  };

  if (isSteps) {
    // Box/step mode: each bin is a filled rectangle
    const binW = plotWidth / dataWidth;
    for (let i = 0; i < dataWidth; i++) {
      const x = FFT_AREA_MIN.x + i * binW;
      const y = Math.round(clampY(decimatedWaveform[i]));
      const w = Math.ceil(binW);
      const h = fftAreaMax.y - y;

      // Shadow fill
      ctx.fillStyle = SHADOW_COLOR;
      ctx.fillRect(Math.round(x), y, w, h);

      // Stroke top edge
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(x), y);
      ctx.lineTo(Math.round(x + binW), y);
      ctx.stroke();

      // Stroke vertical edges connecting to neighbors
      if (i > 0) {
        const prevY = Math.round(clampY(decimatedWaveform[i - 1]));
        ctx.beginPath();
        ctx.moveTo(Math.round(x), prevY);
        ctx.lineTo(Math.round(x), y);
        ctx.stroke();
      }
    }
  } else {
    // Smooth line mode
    ctx.fillStyle = SHADOW_COLOR;
    ctx.beginPath();
    ctx.moveTo(Math.round(idxToX(0)), fftAreaMax.y);
    for (let i = 0; i < dataWidth; i++) {
      ctx.lineTo(Math.round(idxToX(i)), Math.round(clampY(decimatedWaveform[i])));
    }
    ctx.lineTo(Math.round(idxToX(dataWidth - 1)), fftAreaMax.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 0.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < dataWidth; i++) {
      const x = Math.round(idxToX(i));
      const y = Math.round(clampY(decimatedWaveform[i]));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ── Center frequency label (no line, ○ instead of ✋) ─────────────────────

  const centerLabel =
    Number.isNaN(centerFrequencyMHz) || !Number.isFinite(centerFrequencyMHz)
      ? "○  -- MHz"
      : `○  ${fmtFreq(centerFrequencyMHz)}`;

  ctx.save();
  ctx.font = "12px JetBrains Mono";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const labelW = ctx.measureText(centerLabel).width;
  const labelX = lw / 2;
  const labelY = fftAreaMax.y + 25;
  ctx.fillStyle = "rgba(10, 10, 10, 0.9)";
  ctx.fillRect(labelX - labelW / 2 - 6, labelY - 13, labelW + 12, 17);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(centerLabel, labelX, labelY);
  ctx.restore();
}

// ── Waterfall renderers ─────────────────────────────────────────────────────

export function dbToColor(db: number, minDb: number, maxDb: number): [number, number, number] {
  const normalized = (db - minDb) / (maxDb - minDb);
  const index = Math.max(0, Math.min(DEFAULT_COLOR_MAP.length - 1, normalized * (DEFAULT_COLOR_MAP.length - 1)));
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.min(DEFAULT_COLOR_MAP.length - 1, lowerIndex + 1);
  const fraction = index - lowerIndex;
  const lower = DEFAULT_COLOR_MAP[lowerIndex];
  const upper = DEFAULT_COLOR_MAP[upperIndex];
  return [
    lower[0] + (upper[0] - lower[0]) * fraction,
    lower[1] + (upper[1] - lower[1]) * fraction,
    lower[2] + (upper[2] - lower[2]) * fraction,
  ];
}

function drawWaterfallToCanvas(
  canvas: HTMLCanvasElement,
  textureSnapshot: Uint8Array,
  meta: { width: number; height: number; writeRow: number },
  dbMin: number,
  dbMax: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const lw = canvas.width / dpr;
  const lh = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = WATERFALL_CANVAS_BG;
  ctx.fillRect(0, 0, lw, lh);

  const marginX = 40;
  const marginY = 8;
  const displayW = Math.max(1, Math.round(lw - marginX * 2));
  const displayH = Math.max(1, Math.round(lh - marginY * 2));

  const textureBinsPerRow = meta.width;
  const bytesPerRow = textureBinsPerRow * 4;
  const totalRows = meta.height;

  // Need to render at pixel level — reset transform for putImageData
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pixelW = Math.round(displayW * dpr);
  const pixelH = Math.round(displayH * dpr);
  const imgData = ctx.createImageData(pixelW, pixelH);
  const pixels = imgData.data;

  for (let outY = 0; outY < pixelH; outY++) {
    // FIFO: newest row at top (outY=0), oldest at bottom
    // Scale outY proportionally to totalRows to avoid banding when pixelH > totalRows
    const rowOffset_from_newest = Math.floor((outY / pixelH) * totalRows);
    const textureRow = ((meta.writeRow - 1 - rowOffset_from_newest) % totalRows + totalRows) % totalRows;
    const rowOffset = textureRow * bytesPerRow;

    for (let outX = 0; outX < pixelW; outX++) {
      const binIdx = Math.floor((outX / pixelW) * textureBinsPerRow);
      const byteOffset = rowOffset + binIdx * 4;

      let dbVal = -120;
      if (byteOffset + 4 <= textureSnapshot.length) {
        const view = new DataView(textureSnapshot.buffer, textureSnapshot.byteOffset + byteOffset, 4);
        dbVal = view.getFloat32(0, true);
      }

      const [r, g, b] = dbToColor(dbVal, dbMin, dbMax);
      const pixelIdx = (outY * pixelW + outX) * 4;
      pixels[pixelIdx] = r;
      pixels[pixelIdx + 1] = g;
      pixels[pixelIdx + 2] = b;
      pixels[pixelIdx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, Math.round(marginX * dpr), Math.round(marginY * dpr));
}

function drawWaterfallFrom2DBuffer(
  canvas: HTMLCanvasElement,
  waterfallBuffer: Uint8ClampedArray,
  dims: { width: number; height: number },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const lw = canvas.width / dpr;
  const lh = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = WATERFALL_CANVAS_BG;
  ctx.fillRect(0, 0, lw, lh);

  const marginX = 40;
  const marginY = 8;
  const expectedSize = dims.width * dims.height * 4;
  const safeBuffer = new Uint8ClampedArray(expectedSize);
  const copyLen = Math.min(expectedSize, waterfallBuffer.length);
  safeBuffer.set(waterfallBuffer.subarray(0, copyLen));
  const imageData = new ImageData(safeBuffer, dims.width, dims.height);

  // putImageData ignores transforms, so scale manually
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(imageData, Math.round(marginX * dpr), Math.round(marginY * dpr));
}

// ── SVG Vector Generation ───────────────────────────────────────────────────

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function generateSpectrumSVG(
  waveform: number[],
  frequencyRange: { min: number; max: number },
  fftMin: number,
  fftMax: number,
  showGrid: boolean,
  centerFrequencyMHz: number,
  svgW: number,
  svgH: number,
): string {
  const parts: string[] = [];

  const fftAreaMax = { x: svgW - 40, y: svgH - 40 };
  const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
  const vertRange = fftMax - fftMin;
  const scaleFactor = fftHeight / vertRange;

  const minFreq = frequencyRange.min;
  const maxFreq = frequencyRange.max;
  const viewBandwidth = maxFreq - minFreq;
  const range = findBestFrequencyRange(viewBandwidth, 10);
  const lowerFreq = Math.ceil(minFreq / range) * range;
  const freqToX = (freq: number) =>
    FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

  // Background
  parts.push(`<rect width="${svgW}" height="${svgH}" fill="${FFT_CANVAS_BG}"/>`);

  // dB labels + optional grid
  const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
  const zeroDbY = fftAreaMax.y - (0 - fftMin) * scaleFactor;
  parts.push(`<text x="${FFT_AREA_MIN.x - 10}" y="${Math.round(zeroDbY + 3)}" text-anchor="end" fill="${FFT_TEXT_COLOR}" font-family="JetBrains Mono, monospace" font-size="12">0dB</text>`);

  for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
    if (line === 0) continue;
    const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
    if (showGrid) {
      parts.push(`<line x1="${FFT_AREA_MIN.x}" y1="${Math.round(yPos)}" x2="${fftAreaMax.x}" y2="${Math.round(yPos)}" stroke="${FFT_GRID_COLOR}" stroke-width="0.5"/>`);
    }
    parts.push(`<text x="${FFT_AREA_MIN.x - 10}" y="${Math.round(yPos + 3)}" text-anchor="end" fill="${FFT_TEXT_COLOR}" font-family="JetBrains Mono, monospace" font-size="12">${line}</text>`);
  }

  // ── Edge + tick frequency labels (same approach as canvas) ─────────────────
  const FREQ_LABEL_Y_SVG = fftAreaMax.y + 20;
  const startLabel = fmtFreq(minFreq);
  const endLabel = fmtFreq(maxFreq);
  // Approximate text width for collision (7px per char for monospace 12px)
  const charW = 7.2;
  const startLabelW = startLabel.length * charW;
  const endLabelW = endLabel.length * charW;
  const edgeLeftEnd = FFT_AREA_MIN.x + startLabelW + 12;
  const edgeRightStart = fftAreaMax.x - endLabelW - 12;

  for (let freq = lowerFreq; freq < maxFreq; freq += range) {
    const xPos = Math.round(freqToX(freq));
    if (showGrid) {
      parts.push(`<line x1="${xPos}" y1="${FFT_AREA_MIN.y}" x2="${xPos}" y2="${fftAreaMax.y}" stroke="${FFT_GRID_COLOR}" stroke-width="0.5"/>`);
    }
    parts.push(`<line x1="${xPos}" y1="${fftAreaMax.y}" x2="${xPos}" y2="${fftAreaMax.y + 7}" stroke="${FFT_TEXT_COLOR}" stroke-width="0.5"/>`);
    // Skip label if it would collide with edge labels
    if (xPos >= edgeLeftEnd && xPos <= edgeRightStart) {
      parts.push(`<text x="${xPos}" y="${FREQ_LABEL_Y_SVG}" text-anchor="middle" fill="${FFT_TEXT_COLOR}" font-family="JetBrains Mono, monospace" font-size="12">${escapeXml(fmtFreqTick(freq))}</text>`);
    }
  }

  // Axes
  parts.push(`<line x1="${FFT_AREA_MIN.x}" y1="${fftAreaMax.y}" x2="${fftAreaMax.x}" y2="${fftAreaMax.y}" stroke="${FFT_TEXT_COLOR}" stroke-width="1"/>`);
  parts.push(`<line x1="${FFT_AREA_MIN.x}" y1="${FFT_AREA_MIN.y}" x2="${FFT_AREA_MIN.x}" y2="${fftAreaMax.y - 1}" stroke="${FFT_TEXT_COLOR}" stroke-width="1"/>`);

  // Edge labels (drawn last, take priority)
  parts.push(`<text x="${FFT_AREA_MIN.x}" y="${FREQ_LABEL_Y_SVG}" text-anchor="start" fill="${FFT_TEXT_COLOR}" font-family="JetBrains Mono, monospace" font-size="12">${escapeXml(startLabel)}</text>`);
  parts.push(`<text x="${fftAreaMax.x}" y="${FREQ_LABEL_Y_SVG}" text-anchor="end" fill="${FFT_TEXT_COLOR}" font-family="JetBrains Mono, monospace" font-size="12">${escapeXml(endLabel)}</text>`);

  // Trace — step-aware rendering
  const decimatedWaveform = decimateWaveform(waveform, Math.ceil(plotWidth));
  const dataWidth = decimatedWaveform.length;
  const pixelsPerBin = plotWidth / Math.max(1, dataWidth);
  const isSteps = pixelsPerBin >= 3;

  const idxToX = (idx: number) => {
    if (dataWidth <= 1) return FFT_AREA_MIN.x;
    return FFT_AREA_MIN.x + (idx / (dataWidth - 1)) * plotWidth;
  };
  const clampY = (dbVal: number) => {
    const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor;
    return Math.max(FFT_AREA_MIN.y + 1, Math.min(fftAreaMax.y, y));
  };

  if (isSteps) {
    // Box/step mode: each bin is a filled rectangle
    const binW = plotWidth / dataWidth;
    // Shadow fill: one rect per bin
    for (let i = 0; i < dataWidth; i++) {
      const x = Math.round(FFT_AREA_MIN.x + i * binW);
      const y = Math.round(clampY(decimatedWaveform[i]));
      const w = Math.ceil(binW);
      const h = fftAreaMax.y - y;
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${SHADOW_COLOR}"/>`);
    }
    // Stroke: step path (horizontal + vertical segments)
    let stepPath = "";
    for (let i = 0; i < dataWidth; i++) {
      const x = Math.round(FFT_AREA_MIN.x + i * binW);
      const xEnd = Math.round(FFT_AREA_MIN.x + (i + 1) * binW);
      const y = Math.round(clampY(decimatedWaveform[i]));
      if (i === 0) {
        stepPath = `M${x},${y}`;
      } else {
        const prevY = Math.round(clampY(decimatedWaveform[i - 1]));
        stepPath += ` L${x},${prevY} L${x},${y}`;
      }
      stepPath += ` L${xEnd},${y}`;
    }
    parts.push(`<path d="${stepPath}" fill="none" stroke="${LINE_COLOR}" stroke-width="0.5"/>`);
  } else {
    // Smooth line mode
    let fillPath = `M${Math.round(idxToX(0))},${fftAreaMax.y}`;
    for (let i = 0; i < dataWidth; i++) {
      fillPath += ` L${Math.round(idxToX(i))},${Math.round(clampY(decimatedWaveform[i]))}`;
    }
    fillPath += ` L${Math.round(idxToX(dataWidth - 1))},${fftAreaMax.y} Z`;
    parts.push(`<path d="${fillPath}" fill="${SHADOW_COLOR}" stroke="none"/>`);

    let strokePath = "";
    for (let i = 0; i < dataWidth; i++) {
      const x = Math.round(idxToX(i));
      const y = Math.round(clampY(decimatedWaveform[i]));
      strokePath += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
    }
    parts.push(`<path d="${strokePath}" fill="none" stroke="${LINE_COLOR}" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  // Center frequency label (no line, ○)
  const centerLabel =
    Number.isNaN(centerFrequencyMHz) || !Number.isFinite(centerFrequencyMHz)
      ? "○  -- MHz"
      : `○  ${fmtFreq(centerFrequencyMHz)}`;
  const labelX = svgW / 2;
  const labelY = fftAreaMax.y + 25;
  // approximate width for background
  const approxLabelW = centerLabel.length * 7.5;
  parts.push(`<rect x="${labelX - approxLabelW / 2 - 6}" y="${labelY - 13}" width="${approxLabelW + 12}" height="17" fill="rgba(10,10,10,0.9)"/>`);
  parts.push(`<text x="${labelX}" y="${labelY}" text-anchor="middle" fill="#ffffff" font-family="JetBrains Mono, monospace" font-size="12">${escapeXml(centerLabel)}</text>`);

  return parts.join("\n  ");
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useSnapshot(
  _frequencyRange: { min: number; max: number } | null,
  _isConnected: boolean,
) {
  const handleSnapshot = useCallback(
    async (options: SnapshotOptions) => {
      const data = options.getSnapshotData();
      if (!data || !data.waveform || data.waveform.length === 0) {
        console.warn("[Snapshot] No waveform data available");
        return;
      }

      // Determine waveform + range
      let waveformToRender: Float32Array;
      let rangeToRender: { min: number; max: number };

      if (options.whole) {
        waveformToRender = data.waveform;
        const area = options.activeSignalArea?.toLowerCase();
        const bounds = area ? options.signalAreaBounds?.[area] : null;
        rangeToRender = bounds ?? data.frequencyRange;
      } else {
        if (data.vizZoom > 1) {
          const { slicedWaveform, visualRange } = getZoomedSlice(
            data.waveform,
            data.frequencyRange,
            data.vizZoom,
            data.vizPanOffset,
          );
          waveformToRender = slicedWaveform;
          rangeToRender = visualRange;
        } else {
          waveformToRender = data.waveform;
          rangeToRender = data.frequencyRange;
        }
      }

      // Dimensions
      const dpr = window.devicePixelRatio || 1;
      const LOGICAL_WIDTH = 1200;
      const LOGICAL_SPECTRUM_H = 400;
      const LOGICAL_WATERFALL_H = 300;
      const PIXEL_WIDTH = Math.round(LOGICAL_WIDTH * dpr);
      const PIXEL_SPECTRUM_H = Math.round(LOGICAL_SPECTRUM_H * dpr);
      const PIXEL_WATERFALL_H = Math.round(LOGICAL_WATERFALL_H * dpr);

      const hasWaterfall =
        options.showWaterfall &&
        ((data.webgpuEnabled && data.waterfallTextureSnapshot && data.waterfallTextureMeta) ||
         (!data.webgpuEnabled && data.waterfallBuffer && data.waterfallDims));

      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

      // ── SVG Vector path ───────────────────────────────────────────────────
      if (options.format === "svg") {
        const totalH = hasWaterfall ? LOGICAL_SPECTRUM_H + LOGICAL_WATERFALL_H : LOGICAL_SPECTRUM_H;

        const spectrumSvg = generateSpectrumSVG(
          Array.from(waveformToRender),
          rangeToRender,
          data.dbMin,
          data.dbMax,
          options.showGrid,
          data.centerFrequencyMHz,
          LOGICAL_WIDTH,
          LOGICAL_SPECTRUM_H,
        );

        // Waterfall as embedded PNG bitmap (vectors don't make sense for heatmaps)
        let waterfallSection = "";
        if (hasWaterfall) {
          const wfCanvas = document.createElement("canvas");
          wfCanvas.width = PIXEL_WIDTH;
          wfCanvas.height = PIXEL_WATERFALL_H;

          if (data.webgpuEnabled && data.waterfallTextureSnapshot && data.waterfallTextureMeta) {
            drawWaterfallToCanvas(wfCanvas, data.waterfallTextureSnapshot, data.waterfallTextureMeta, data.dbMin, data.dbMax);
          } else if (data.waterfallBuffer && data.waterfallDims) {
            drawWaterfallFrom2DBuffer(wfCanvas, data.waterfallBuffer, data.waterfallDims);
          }

          const wfDataUrl = wfCanvas.toDataURL("image/png");
          waterfallSection = `<image href="${wfDataUrl}" x="0" y="${LOGICAL_SPECTRUM_H}" width="${LOGICAL_WIDTH}" height="${LOGICAL_WATERFALL_H}"/>`;
        }

        // Stats overlay
        let statsSection = "";
        if (options.showStats) {
          const statsLines = [
            `${fmtFreq(rangeToRender.min)} – ${fmtFreq(rangeToRender.max)}`,
            fmtTimestamp(),
            `${options.whole ? "Whole" : "Onscreen"} | dB: ${data.dbMin} to ${data.dbMax}`,
            `Source: ${options.sourceName || "Unknown"}`,
          ];
          if (options.sdrSettingsLabel) {
            statsLines.push(options.sdrSettingsLabel);
          }

          // Smart placement
          let placeLeft = false;
          if (waveformToRender.length > 0) {
            const marginBins = Math.max(1, Math.floor(waveformToRender.length * 0.15));
            let leftMax = -Infinity;
            for (let i = 0; i < marginBins; i++) leftMax = Math.max(leftMax, waveformToRender[i]);
            let rightMax = -Infinity;
            for (let i = waveformToRender.length - marginBins; i < waveformToRender.length; i++) rightMax = Math.max(rightMax, waveformToRender[i]);
            if (leftMax < rightMax) placeLeft = true;
          }

          const statsW = 310;
          const statsX = placeLeft ? 8 : LOGICAL_WIDTH - statsW - 8;
          const statsY = 4;
          statsSection = `<rect x="${statsX}" y="${statsY}" width="${statsW}" height="${statsLines.length * 16 + 8}" rx="4" fill="rgba(0,0,0,0.7)"/>`;
          statsLines.forEach((line, i) => {
            statsSection += `\n  <text x="${statsX + 8}" y="${statsY + 16 + i * 16}" fill="#ccc" font-family="monospace" font-size="12">${escapeXml(line)}</text>`;
          });
        }

        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGICAL_WIDTH} ${totalH}" width="${LOGICAL_WIDTH}" height="${totalH}">
  ${spectrumSvg}
  ${waterfallSection}
  ${statsSection}
</svg>`;

        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `spectrum-snapshot-${timestamp}.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      // ── PNG path ──────────────────────────────────────────────────────────

      const totalPixelH = hasWaterfall ? PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H : PIXEL_SPECTRUM_H;

      // Spectrum
      const spectrumCanvas = document.createElement("canvas");
      spectrumCanvas.width = PIXEL_WIDTH;
      spectrumCanvas.height = PIXEL_SPECTRUM_H;
      drawSpectrumToCanvas(
        spectrumCanvas,
        Array.from(waveformToRender),
        rangeToRender,
        data.dbMin,
        data.dbMax,
        options.showGrid,
        data.centerFrequencyMHz,
      );

      // Waterfall
      let waterfallCanvas: HTMLCanvasElement | null = null;
      if (hasWaterfall) {
        waterfallCanvas = document.createElement("canvas");
        waterfallCanvas.width = PIXEL_WIDTH;
        waterfallCanvas.height = PIXEL_WATERFALL_H;

        if (data.webgpuEnabled && data.waterfallTextureSnapshot && data.waterfallTextureMeta) {
          drawWaterfallToCanvas(waterfallCanvas, data.waterfallTextureSnapshot, data.waterfallTextureMeta, data.dbMin, data.dbMax);
        } else if (data.waterfallBuffer && data.waterfallDims) {
          drawWaterfallFrom2DBuffer(waterfallCanvas, data.waterfallBuffer, data.waterfallDims);
        }
      }

      // Composite
      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = PIXEL_WIDTH;
      finalCanvas.height = totalPixelH;
      const ctx = finalCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(spectrumCanvas, 0, 0);
      if (waterfallCanvas) {
        ctx.drawImage(waterfallCanvas, 0, PIXEL_SPECTRUM_H);
      }

      // Stats overlay (smart placement)
      if (options.showStats) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const logicalW = PIXEL_WIDTH / dpr;

        const statsLines = [
          `${fmtFreq(rangeToRender.min)} – ${fmtFreq(rangeToRender.max)}`,
          fmtTimestamp(),
          `${options.whole ? "Whole" : "Onscreen"} | dB: ${data.dbMin} to ${data.dbMax}`,
          `Source: ${options.sourceName || "Unknown"}`,
        ];
        if (options.sdrSettingsLabel) {
          statsLines.push(options.sdrSettingsLabel);
        }

        // Smart placement
        let placeLeft = false;
        if (waveformToRender.length > 0) {
          const marginBins = Math.max(1, Math.floor(waveformToRender.length * 0.15));
          let leftMax = -Infinity;
          for (let i = 0; i < marginBins; i++) leftMax = Math.max(leftMax, waveformToRender[i]);
          let rightMax = -Infinity;
          for (let i = waveformToRender.length - marginBins; i < waveformToRender.length; i++) rightMax = Math.max(rightMax, waveformToRender[i]);
          if (leftMax < rightMax) placeLeft = true;
        }

        ctx.font = "12px monospace";
        const maxTextW = Math.max(...statsLines.map((l) => ctx.measureText(l).width));
        const boxW = maxTextW + 16;
        const boxH = statsLines.length * 16 + 8;
        const boxX = placeLeft ? 8 : logicalW - boxW - 8;
        const boxY = 4;

        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 4);
        ctx.fill();

        ctx.fillStyle = "#ccc";
        ctx.font = "12px monospace";
        statsLines.forEach((line, i) => {
          ctx.fillText(line, boxX + 8, boxY + 16 + i * 16);
        });
      }

      // Export PNG
      const dataUrl = finalCanvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `spectrum-snapshot-${timestamp}.png`;
      link.href = dataUrl;
      link.click();
    },
    [],
  );

  return { handleSnapshot };
}
