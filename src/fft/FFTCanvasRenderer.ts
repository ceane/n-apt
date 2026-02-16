/*
 * FFTCanvasRenderer.ts
 *
 * FFT Canvas - Visualizes radio signals as frequency spectrum
 *
 * Raw signal (SINE WAVE, ONE CYCLE):
 *
 *                  ⌄ peak
 *                 .--.
 *                /    \    /
 *                      \__/
 *                        ^
 *                        trough
 *
 * FFT output:   [3.2, 0.1, ...]  ← amplitude at each frequency
 *
 * Think of radio signals like music - they're made of many notes (frequencies)
 * playing at once. Fast Fourier Transform (FFT) is like a musical ear that
 * separates all the notes and tells you how loud each one is.
 *
 * FFT extracts the Y-POINTS (amplitude) of signal peaks and troughs
 * (ups and downs) for each frequency, transforming raw radio wave data into a
 * spectrum display showing signal strength at each frequency,
 * just like a music equalizer.
 *
 * NOTE: The FFT rendered is based on MAGNITUDE (0 → Fs/2, signals rise from
 * noise), not two-sided, zero-centered FFT of complex (I/Q) data
 * (-Fs/2 → +Fs/2, Signal symmetric about 0 Hz). This is a
 * simplified view of the signal's frequency.
 */

/**
 * Frequency range configuration for spectrum and waterfall displays
 */
export interface FrequencyRange {
  /** Minimum frequency in MHz */
  min: number;
  /** Maximum frequency in MHz */
  max: number;
}

/**
 * Rendering options for spectrum display
 */
export interface SpectrumRenderOptions {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D;
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Power spectrum data array in dB */
  waveform: number[];
  /** Frequency range to display */
  frequencyRange: FrequencyRange;
  /** Minimum dB level for spectrum display (default: -80) */
  fftMin?: number;
  /** Maximum dB level for spectrum display (default: 20) */
  fftMax?: number;
}

export interface SpectrumGridOptions {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D;
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Frequency range to display */
  frequencyRange: FrequencyRange;
  /** Minimum dB level for spectrum display (default: -80) */
  fftMin?: number;
  /** Maximum dB level for spectrum display (default: 20) */
  fftMax?: number;
  /** Whether to clear background before drawing (default: true) */
  clearBackground?: boolean;
  /** If set, hide axis frequency labels whose pixel position is within this many px of the given x coordinate */
  skipFreqLabelsNearX?: number;
}

export interface SpectrumMarkersOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  frequencyRange: FrequencyRange;
  centerFrequencyMHz: number;
}

import {
  FFT_GRID_COLOR,
  LINE_COLOR,
  SHADOW_COLOR,
  FFT_TEXT_COLOR,
  FFT_MIN_DB,
  FFT_MAX_DB,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  FFT_CANVAS_BG,
  formatFrequency as formatFreq,
  findBestFrequencyRange as findBestRange,
} from "@n-apt/consts";

/**
 * Draws spectrum analyzer display with SDR++ style rendering
 * @param options - Rendering options including canvas context, dimensions, and data
 */
export function drawSpectrum(options: SpectrumRenderOptions): void {
  drawSpectrumGrid({
    ctx: options.ctx,
    width: options.width,
    height: options.height,
    frequencyRange: options.frequencyRange,
    fftMin: options.fftMin,
    fftMax: options.fftMax,
    clearBackground: true,
  });
  drawSpectrumTrace(options);
}

/** Downsample waveform to at most maxPoints (max over buckets) for SVG path to avoid main-thread freeze. */
function downsampleWaveformForSvg(waveform: number[], maxPoints: number): number[] {
  if (!waveform.length || maxPoints >= waveform.length) return waveform;
  const out: number[] = [];
  const srcLen = waveform.length;
  for (let x = 0; x < maxPoints; x++) {
    const start = Math.floor((x * srcLen) / maxPoints);
    const end = Math.min(srcLen, Math.floor(((x + 1) * srcLen) / maxPoints));
    let maxVal = -Infinity;
    for (let i = start; i < end; i++) {
      const v = waveform[i];
      if (Number.isFinite(v) && v > maxVal) maxVal = v;
    }
    out.push(maxVal !== -Infinity ? maxVal : (waveform[Math.min(start, srcLen - 1)] ?? -120));
  }
  return out;
}

export function renderSpectrumSvg(options: {
  width: number;
  height: number;
  waveform: number[];
  frequencyRange: FrequencyRange;
  centerFrequencyMHz: number;
  showGrid: boolean;
  isDeviceConnected?: boolean;
}): string {
  const {
    width,
    height,
    waveform,
    frequencyRange,
    centerFrequencyMHz,
    showGrid,
    isDeviceConnected = true,
  } = options;

  const fftAreaMax = { x: width - 40, y: height - 40 };
  const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

  const minFreq = frequencyRange?.min ?? 0;
  const maxFreq = frequencyRange?.max ?? 3.2;
  const viewBandwidth = maxFreq - minFreq;
  if (viewBandwidth <= 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }

  const freqToX = (freq: number) => FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

  const fftMin = FFT_MIN_DB;
  const fftMax = FFT_MAX_DB;
  const vertRange = fftMax - fftMin;
  const scaleFactor = fftHeight / vertRange;
  const dbToY = (dbVal: number) => {
    const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor;
    return Math.max(FFT_AREA_MIN.y + 1, Math.min(fftAreaMax.y, y));
  };

  // Cap path points to avoid main-thread freeze (full FFT can be 32k+ points; SVG path doesn't need that)
  const maxPathPoints = Math.min(waveform.length, Math.max(Math.round(plotWidth), 2048));
  const pathWaveform = waveform.length <= maxPathPoints ? waveform : downsampleWaveformForSvg(waveform, maxPathPoints);


  const pathLen = pathWaveform.length;
  const idxToX = (idx: number) => {
    if (pathLen <= 1) return FFT_AREA_MIN.x;
    return FFT_AREA_MIN.x + (idx / (pathLen - 1)) * plotWidth;
  };

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="${FFT_CANVAS_BG}"/>`;

  if (showGrid) {
    const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
    const range = findBestRange(viewBandwidth, 10);
    const lowerFreq = Math.ceil(minFreq / range) * range;
    const upperFreq = maxFreq;

    svg += `<g stroke="${FFT_GRID_COLOR}" stroke-width="0.5" fill="${FFT_TEXT_COLOR}" font-family="JetBrains Mono" font-size="12">`;

    // dB labels + horizontal grid lines
    const zeroDbY = dbToY(0);
    svg += `<text x="${FFT_AREA_MIN.x - 10}" y="${Math.round(zeroDbY + 3)}" text-anchor="end">0dB</text>`;

    for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
      if (line === 0) continue;
      const yPos = dbToY(line);
      svg += `<line x1="${FFT_AREA_MIN.x}" y1="${Math.round(yPos)}" x2="${fftAreaMax.x}" y2="${Math.round(yPos)}" stroke-width="0.5"/>`;
      svg += `<text x="${FFT_AREA_MIN.x - 10}" y="${Math.round(yPos + 3)}" text-anchor="end">${line}</text>`;
    }

    // frequency grid lines + labels
    svg += `<g text-anchor="middle">`;
    for (let freq = lowerFreq; freq < upperFreq; freq += range) {
      const xPos = freqToX(freq);
      svg += `<line x1="${Math.round(xPos)}" y1="${FFT_AREA_MIN.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y}" stroke-width="0.5"/>`;
      svg += `<line x1="${Math.round(xPos)}" y1="${fftAreaMax.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y + 7}" stroke-width="0.5"/>`;
      svg += `<text x="${Math.round(xPos)}" y="${fftAreaMax.y + 25}">${esc(formatFreq(freq))}</text>`;
    }
    // right-edge max frequency label if not too close
    {
      const xPos = fftAreaMax.x;
      const lastGridFreq = Math.floor((upperFreq - 1e-6) / range) * range;
      const lastGridX = freqToX(lastGridFreq);
      if (xPos - lastGridX > 50) {
        svg += `<line x1="${Math.round(xPos)}" y1="${FFT_AREA_MIN.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y}" stroke-width="0.5"/>`;
        svg += `<line x1="${Math.round(xPos)}" y1="${fftAreaMax.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y + 7}" stroke-width="0.5"/>`;
        svg += `<text x="${Math.round(xPos)}" y="${fftAreaMax.y + 25}">${esc(formatFreq(maxFreq))}</text>`;
      }
    }
    svg += `</g>`;

    // axes
    svg += `<g stroke="${FFT_TEXT_COLOR}" stroke-width="0.5">`;
    svg += `<line x1="${FFT_AREA_MIN.x}" y1="${fftAreaMax.y}" x2="${fftAreaMax.x}" y2="${fftAreaMax.y}" stroke-width="0.5"/>`;
    svg += `<line x1="${FFT_AREA_MIN.x}" y1="${FFT_AREA_MIN.y}" x2="${FFT_AREA_MIN.x}" y2="${fftAreaMax.y - 1}" stroke-width="0.5"/>`;
    svg += `</g>`;

    svg += `</g>`;
  }

  // Spectrum fill + trace (use pathWaveform so we never loop 32k+ times)
  if (pathWaveform.length > 0) {
    let dFill = `M ${Math.round(idxToX(0))} ${fftAreaMax.y}`;
    for (let i = 0; i < pathWaveform.length; i++) {
      const x = Math.round(idxToX(i));
      const y = Math.round(dbToY(pathWaveform[i]));
      dFill += ` L ${x} ${y}`;
    }
    dFill += ` L ${Math.round(idxToX(pathWaveform.length - 1))} ${fftAreaMax.y} Z`;
    svg += `<path d="${dFill}" fill="${SHADOW_COLOR}" stroke="none"/>`;

    let dTrace = "";
    for (let i = 0; i < pathWaveform.length; i++) {
      const x = Math.round(idxToX(i));
      const y = Math.round(dbToY(pathWaveform[i]));
      dTrace += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    svg += `<path d="${dTrace}" fill="none" stroke="${LINE_COLOR}" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // Markers (mirrors drawSpectrumMarkers)
  {
    const markers: { freq: number; label: string }[] = Array.from({ length: 2 }, (_, i) => ({
      freq: [0.5, 28.8][i],
      label: [ "500kHz / RTL-SDR v4 lower limit", "28.8MHz / Potential hardware spur"][i],
    }));

    if (isDeviceConnected) {
      for (const m of markers) {
        if (m.freq < minFreq || m.freq > maxFreq) continue;
        const x = Math.round(freqToX(m.freq)) + 0.5;
        svg += `<g>`;
        svg += `<line x1="${x}" y1="${FFT_AREA_MIN.y}" x2="${x}" y2="${fftAreaMax.y}" stroke="rgba(220, 38, 38, 0.55)" stroke-width="0.5"/>`;

        const approxCharW = 7; // ~11px monospace average width
        const padding = 8;
        const tw = m.label.length * approxCharW;
        const boxW = tw + padding * 2;
        const boxH = 18;
        const minX = FFT_AREA_MIN.x + boxW / 2 + 4;
        const maxX = fftAreaMax.x - boxW / 2 - 4;
        const lx = Math.max(minX, Math.min(maxX, x));
        const boxX = Math.round(lx - boxW / 2);
        const boxY = FFT_AREA_MIN.y + 4;
        svg += `<rect x="${boxX}" y="${boxY}" width="${Math.round(boxW)}" height="${boxH}" fill="rgba(10, 10, 10, 0.75)"/>`;
        svg += `<text x="${Math.round(lx)}" y="${FFT_AREA_MIN.y + 17}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="rgba(220, 38, 38, 0.9)">${esc(m.label)}</text>`;
        svg += `</g>`;
      }
    }

    if (centerFrequencyMHz >= minFreq && centerFrequencyMHz <= maxFreq) {
      const cx = Math.round(freqToX(centerFrequencyMHz)) + 0.5;
      svg += `<line x1="${cx}" y1="${FFT_AREA_MIN.y}" x2="${cx}" y2="${fftAreaMax.y}" stroke="rgba(234, 179, 8, 0.35)" stroke-width="0.5"/>`;
    }

    const centerLabel =
      centerFrequencyMHz < 1
        ? `✋  ${Math.round(centerFrequencyMHz * 1000)} kHz`
        : `✋  ${centerFrequencyMHz.toFixed(3)} MHz`;

    const labelX = width / 2;
    const labelY = fftAreaMax.y + 25;
    svg += `<rect x="${Math.round(labelX - 80)}" y="${Math.round(labelY - 13)}" width="160" height="17" fill="rgba(10, 10, 10, 0.9)"/>`;
    svg += `<text x="${Math.round(labelX)}" y="${Math.round(labelY)}" text-anchor="middle" font-family="JetBrains Mono" font-size="12" fill="#ffffff">${esc(centerLabel)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/** Full range (e.g. 0–4.47 MHz) SVG: one grid, multiple window path segments. */
export function renderFullRangeSpectrumSvg(options: {
  width: number;
  height: number;
  windows: Array<{ min: number; max: number; waveform: number[] }>;
  fullRange: FrequencyRange;
  showGrid: boolean;
  isDeviceConnected?: boolean;
}): string {
  const { width, height, windows, fullRange, showGrid, isDeviceConnected = true } = options;
  const fftAreaMax = { x: width - 40, y: height - 40 };
  const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
  const fullMin = fullRange.min;
  const fullMax = fullRange.max;
  const viewBandwidth = fullMax - fullMin;
  if (viewBandwidth <= 0 || !windows.length) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }
  const fftMin = FFT_MIN_DB;
  const fftMax = FFT_MAX_DB;
  const scaleFactor = fftHeight / (fftMax - fftMin);
  const dbToY = (dbVal: number) => {
    const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor;
    return Math.max(FFT_AREA_MIN.y + 1, Math.min(fftAreaMax.y, y));
  };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="${FFT_CANVAS_BG}"/>`;

  if (showGrid) {
    const range = findBestRange(viewBandwidth, 10);
    const lowerFreq = Math.ceil(fullMin / range) * range;
    const upperFreq = fullMax;
    const freqToX = (freq: number) => FFT_AREA_MIN.x + ((freq - fullMin) / viewBandwidth) * plotWidth;
    const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
    svg += `<g stroke="${FFT_GRID_COLOR}" stroke-width="0.5" fill="${FFT_TEXT_COLOR}" font-family="JetBrains Mono" font-size="12">`;
    const zeroDbY = fftAreaMax.y - (0 - fftMin) * scaleFactor;
    svg += `<text x="${FFT_AREA_MIN.x - 10}" y="${Math.round(zeroDbY + 3)}" text-anchor="end">0dB</text>`;
    for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
      if (line === 0) continue;
      const yPos = dbToY(line);
      svg += `<line x1="${FFT_AREA_MIN.x}" y1="${Math.round(yPos)}" x2="${fftAreaMax.x}" y2="${Math.round(yPos)}" stroke-width="0.5"/>`;
      svg += `<text x="${FFT_AREA_MIN.x - 10}" y="${Math.round(yPos + 3)}" text-anchor="end">${line}</text>`;
    }
    svg += `<g text-anchor="middle">`;
    for (let freq = lowerFreq; freq < upperFreq; freq += range) {
      const xPos = freqToX(freq);
      svg += `<line x1="${Math.round(xPos)}" y1="${FFT_AREA_MIN.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y}" stroke-width="0.5"/>`;
      svg += `<line x1="${Math.round(xPos)}" y1="${fftAreaMax.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y + 7}" stroke-width="0.5"/>`;
      svg += `<text x="${Math.round(xPos)}" y="${fftAreaMax.y + 25}">${esc(formatFreq(freq))}</text>`;
    }
    const xPos = fftAreaMax.x;
    const lastGridFreq = Math.floor((upperFreq - 1e-6) / range) * range;
    const lastGridX = freqToX(lastGridFreq);
    if (xPos - lastGridX > 50) {
      svg += `<line x1="${Math.round(xPos)}" y1="${FFT_AREA_MIN.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y}" stroke-width="0.5"/>`;
      svg += `<line x1="${Math.round(xPos)}" y1="${fftAreaMax.y}" x2="${Math.round(xPos)}" y2="${fftAreaMax.y + 7}" stroke-width="0.5"/>`;
      svg += `<text x="${Math.round(xPos)}" y="${fftAreaMax.y + 25}">${esc(formatFreq(fullMax))}</text>`;
    }
    svg += `</g>`;
    svg += `<g stroke="${FFT_TEXT_COLOR}" stroke-width="0.5">`;
    svg += `<line x1="${FFT_AREA_MIN.x}" y1="${fftAreaMax.y}" x2="${fftAreaMax.x}" y2="${fftAreaMax.y}" stroke-width="0.5"/>`;
    svg += `<line x1="${FFT_AREA_MIN.x}" y1="${FFT_AREA_MIN.y}" x2="${FFT_AREA_MIN.x}" y2="${fftAreaMax.y - 1}" stroke-width="0.5"/>`;
    svg += `</g></g>`;
  }

  const maxPathPointsPerWindow = Math.max(512, Math.round(plotWidth / windows.length));
  let dFill = "";
  let dTrace = "";
  for (let wi = 0; wi < windows.length; wi++) {
    const w = windows[wi];
    const winSpan = w.max - w.min;
    const windowPlotLeft = FFT_AREA_MIN.x + ((w.min - fullMin) / viewBandwidth) * plotWidth;
    const windowPlotWidth = (winSpan / viewBandwidth) * plotWidth;
    const pathWave = w.waveform.length <= maxPathPointsPerWindow
      ? w.waveform
      : downsampleWaveformForSvg(w.waveform, maxPathPointsPerWindow);
    const n = pathWave.length;
    if (n === 0) continue;
    const idxToX = (idx: number) => windowPlotLeft + (idx / Math.max(1, n - 1)) * windowPlotWidth;
    if (wi === 0) {
      dFill = `M ${Math.round(idxToX(0))} ${fftAreaMax.y}`;
    }
    for (let i = 0; i < n; i++) {
      const x = Math.round(idxToX(i));
      const y = Math.round(dbToY(pathWave[i]));
      dFill += ` L ${x} ${y}`;
      if (wi === 0 && i === 0) dTrace = `M ${x} ${y}`;
      else if (i === 0) dTrace += ` M ${x} ${y}`;
      else dTrace += ` L ${x} ${y}`;
    }
    dFill += ` L ${Math.round(idxToX(n - 1))} ${fftAreaMax.y}`;
    if (wi < windows.length - 1) {
      dFill += ` L ${Math.round(windowPlotLeft + windowPlotWidth)} ${fftAreaMax.y}`;
    }
  }
  if (dFill) {
    dFill += ` L ${FFT_AREA_MIN.x} ${fftAreaMax.y} Z`;
    svg += `<path d="${dFill}" fill="${SHADOW_COLOR}" stroke="none"/>`;
  }
  if (dTrace) {
    svg += `<path d="${dTrace}" fill="none" stroke="${LINE_COLOR}" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  const centerLabel = `✋  0 – ${fullMax.toFixed(2)} MHz`;
  const labelX = width / 2;
  const labelY = fftAreaMax.y + 25;
  svg += `<rect x="${Math.round(labelX - 80)}" y="${Math.round(labelY - 13)}" width="160" height="17" fill="rgba(10, 10, 10, 0.9)"/>`;
  svg += `<text x="${Math.round(labelX)}" y="${Math.round(labelY)}" text-anchor="middle" font-family="JetBrains Mono" font-size="12" fill="#ffffff">${esc(centerLabel)}</text>`;
  svg += `</svg>`;
  return svg;
}

export function drawSpectrumGrid(options: SpectrumGridOptions): void {
  const {
    ctx,
    width,
    height,
    frequencyRange,
    fftMin = FFT_MIN_DB,
    fftMax = FFT_MAX_DB,
    clearBackground = true,
  } = options;

  // Get device pixel ratio for line width compensation
  const dpr = window.devicePixelRatio || 1;

  if (clearBackground) {
    ctx.fillStyle = FFT_CANVAS_BG;
    ctx.fillRect(0, 0, width, height);
  }

  // SDR++ style layout constants
  const fftAreaMax = { x: width - 40, y: height - 40 };
  const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

  // Calculate scaling factors (SDR++ style)
  const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
  const vertRange = fftMax - fftMin;
  const scaleFactor = fftHeight / vertRange;

  const minFreq = frequencyRange?.min ?? 0;
  const maxFreq = frequencyRange?.max ?? 3.2;
  const viewBandwidth = maxFreq - minFreq;
  const range = findBestRange(viewBandwidth, 10);
  const lowerFreq = Math.ceil(minFreq / range) * range;
  const upperFreq = maxFreq;
  const freqToX = (freq: number) => FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

  // Draw vertical grid lines and labels (SDR++ style)
  ctx.strokeStyle = FFT_GRID_COLOR;
  ctx.fillStyle = FFT_TEXT_COLOR;
  ctx.font = "12px JetBrains Mono"; // Smaller font
  ctx.textAlign = "right";
  ctx.lineWidth = 1 / dpr; // Compensate for DPR scaling

  // Add "0dB" marker at 0dB position
  const zeroDbY = fftAreaMax.y - (0 - fftMin) * scaleFactor;
  ctx.fillText("0dB", FFT_AREA_MIN.x - 10, Math.round(zeroDbY + 3));

  for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
    // Skip 0dB line since we already draw "0dB" marker
    if (line === 0) continue;

    const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
    ctx.lineTo(fftAreaMax.x, Math.round(yPos));
    ctx.stroke();

    ctx.fillText(line.toString(), FFT_AREA_MIN.x - 10, Math.round(yPos + 3));
  }

  // Draw horizontal grid lines and frequency labels (SDR++ style)
  ctx.textAlign = "center";
  ctx.font = "12px JetBrains Mono"; // Smaller font for frequency labels too

  for (let freq = lowerFreq; freq < upperFreq; freq += range) {
    const xPos = freqToX(freq);

    // Grid line - extend to full canvas height
    ctx.beginPath();
    ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y);
    ctx.lineTo(Math.round(xPos), fftAreaMax.y);
    ctx.stroke();

    // Frequency tick
    ctx.beginPath();
    ctx.moveTo(Math.round(xPos), fftAreaMax.y);
    ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7);
    ctx.stroke();

    // Frequency label — skip if too close to center-frequency overlay
    if (
      options.skipFreqLabelsNearX === undefined ||
      Math.abs(xPos - options.skipFreqLabelsNearX) > 50
    ) {
      ctx.fillText(formatFreq(freq), Math.round(xPos), fftAreaMax.y + 25);
    }
  }

  // Always draw an explicit right-edge max frequency tick/label
  // Only if it's not too close to the last grid label to prevent collision
  {
    const xPos = fftAreaMax.x;
    const lastGridFreq = Math.floor((upperFreq - 1e-6) / range) * range;
    const lastGridX = freqToX(lastGridFreq);
    const minDistance = 50; // Minimum pixels between labels to prevent collision

    if (xPos - lastGridX > minDistance) {
      const skipNear = options.skipFreqLabelsNearX;
      const tooClose = skipNear !== undefined && Math.abs(xPos - skipNear) <= 50;

      ctx.beginPath();
      ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(xPos), fftAreaMax.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(Math.round(xPos), fftAreaMax.y);
      ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7);
      ctx.stroke();

      if (!tooClose) {
        ctx.fillText(formatFreq(maxFreq), Math.round(xPos), fftAreaMax.y + 25);
      }
    }
  }

  // Draw axes
  ctx.strokeStyle = FFT_TEXT_COLOR;
  ctx.lineWidth = 1.0 / dpr; // Compensate for DPR scaling

  // X-axis
  ctx.beginPath();
  ctx.moveTo(FFT_AREA_MIN.x, fftAreaMax.y);
  ctx.lineTo(fftAreaMax.x, fftAreaMax.y);
  ctx.stroke();

  // Y-axis
  ctx.beginPath();
  ctx.moveTo(FFT_AREA_MIN.x, FFT_AREA_MIN.y);
  ctx.lineTo(FFT_AREA_MIN.x, fftAreaMax.y - 1);
  ctx.stroke();
}

export function drawSpectrumTrace(options: SpectrumRenderOptions): void {
  const { ctx, width, height, waveform, fftMin = FFT_MIN_DB, fftMax = FFT_MAX_DB } = options;

  // Get device pixel ratio for line width compensation
  const dpr = window.devicePixelRatio || 1;

  if (!waveform || !Array.isArray(waveform) || waveform.length === 0) {
    return;
  }

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

  // Draw fill: single path tracing the line, then closing along the bottom
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.moveTo(Math.round(idxToX(0)), fftAreaMax.y);
  for (let i = 0; i < dataWidth; i++) {
    ctx.lineTo(Math.round(idxToX(i)), Math.round(clampY(waveform[i])));
  }
  ctx.lineTo(Math.round(idxToX(dataWidth - 1)), fftAreaMax.y);
  ctx.closePath();
  ctx.fill();

  // Draw trace line on top
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = (width < 700 ? 0.5 : 1) / dpr; // Compensate for DPR scaling
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  for (let i = 0; i < dataWidth; i++) {
    const x = Math.round(idxToX(i));
    const y = Math.round(clampY(waveform[i]));
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

/**
 * Draws spectrum overlay markers: red limit lines with labels, yellow center line, center frequency label.
 * Should be called AFTER drawSpectrumGrid on the same 2D context.
 */
export function drawSpectrumMarkers(
  options: SpectrumMarkersOptions & { isDeviceConnected?: boolean },
): void {
  const {
    ctx,
    width,
    height,
    frequencyRange,
    centerFrequencyMHz,
    isDeviceConnected = true,
  } = options;

  // Get device pixel ratio for line width compensation
  const dpr = window.devicePixelRatio || 1;

  const fftAreaMax = { x: width - 40, y: height - 40 };
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
  const minFreq = frequencyRange?.min ?? 0;
  const maxFreq = frequencyRange?.max ?? 3.2;
  const viewBandwidth = maxFreq - minFreq;
  if (viewBandwidth <= 0) return;

  const freqToX = (freq: number) => FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

  // --- Red limit markers ---
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
      ctx.lineWidth = 1 / dpr; // Compensate for DPR scaling
      ctx.beginPath();
      ctx.moveTo(x, FFT_AREA_MIN.y);
      ctx.lineTo(x, fftAreaMax.y);
      ctx.stroke();
      ctx.restore();

      // Top label
      ctx.save();
      ctx.font = "11px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const tw = ctx.measureText(m.label).width;
      const lx = Math.max(FFT_AREA_MIN.x + tw / 2 + 4, Math.min(fftAreaMax.x - tw / 2 - 4, x));
      ctx.fillStyle = "rgba(10, 10, 10, 0.75)";
      ctx.fillRect(lx - tw / 2 - 4, FFT_AREA_MIN.y + 4, tw + 8, 18);
      ctx.fillStyle = "rgba(220, 38, 38, 0.9)";
      ctx.fillText(m.label, lx, FFT_AREA_MIN.y + 6);
      ctx.restore();
    }
  }

  // --- Yellow center frequency line ---
  if (centerFrequencyMHz >= minFreq && centerFrequencyMHz <= maxFreq) {
    const cx = Math.round(freqToX(centerFrequencyMHz)) + 0.5;
    ctx.save();
    ctx.strokeStyle = "rgba(234, 179, 8, 0.35)";
    ctx.lineWidth = 1 / dpr; // Compensate for DPR scaling
    ctx.beginPath();
    ctx.moveTo(cx, FFT_AREA_MIN.y);
    ctx.lineTo(cx, fftAreaMax.y);
    ctx.stroke();
    ctx.restore();
  }

  // --- Center frequency label (bottom center, with background mask) ---
  const centerLabel =
    centerFrequencyMHz < 1
      ? `✋  ${Math.round(centerFrequencyMHz * 1000)} kHz`
      : `✋  ${centerFrequencyMHz.toFixed(3)} MHz`;

  ctx.save();
  ctx.font = "12px JetBrains Mono";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const labelW = ctx.measureText(centerLabel).width;
  const labelX = width / 2;
  const labelY = fftAreaMax.y + 25;
  // Background mask to cover axis labels underneath
  ctx.fillStyle = "rgba(10, 10, 10, 0.9)";
  ctx.fillRect(labelX - labelW / 2 - 6, labelY - 13, labelW + 12, 17);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(centerLabel, labelX, labelY);
  ctx.restore();
}

/**
 * Applies zoom to FFT data (SDR++ style implementation)
 * @param input - Input FFT data array
 * @param offset - Starting offset for zoom
 * @param width - Width of zoomed region
 * @param outputSize - Size of output array
 * @returns Zoomed FFT data array
 */
export function zoomFFT(input: number[], offset: number, width: number, outputSize: number): number[] {
  if (offset < 0) offset = 0;
  if (width > 524288) width = 524288;

  const output: number[] = Array.from({ length: outputSize });
  const factor = width / outputSize;
  const sFactor = Math.ceil(factor);

  let id = offset;
  for (let i = 0; i < outputSize; i++) {
    let maxVal = -Infinity;
    const sId = Math.trunc(id);
    const uFactor = Math.min(sFactor, input.length - sId);

    for (let j = 0; j < uFactor; j++) {
      const val = input[sId + j];
      if (val > maxVal) maxVal = val;
    }
    output[i] = maxVal;
    id += factor;
  }

  return output;
}
