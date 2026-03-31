import { useCallback } from "react";
import { FFT_AREA_MIN } from "@n-apt/consts";
import { THEME_TOKENS } from "@n-apt/consts";
import { useAppSelector } from "@n-apt/redux";
import { useResolvedThemeMode } from "@n-apt/components/ui/Theme";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import { CoordinateMapper, Range } from "@n-apt/utils/rendering/CoordinateMapper";
import { CanvasDrawingContext, SnapshotRenderer, SnapshotTheme, SVGDrawingContext, DrawingContext } from "@n-apt/utils/rendering/SnapshotRenderer";
import { fmtFreq, fmtTimestamp } from "@n-apt/utils/rendering/formatters";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SnapshotOptions = {
  whole: boolean;
  showWaterfall: boolean;
  showStats: boolean;
  showGeolocation: boolean;
  geolocation?: { lat: string; lon: string } | null;
  showGrid: boolean;
  format: "png" | "svg";
  getSnapshotData: () => SnapshotData | null;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalArea?: string;
  sourceName?: string;
  sdrSettingsLabel?: string;
  modeLabel?: string;
  wholeChannelSegments?: Array<{
    data: SnapshotData;
    visualRange: { min: number; max: number };
  }>;
};

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
  const clampedPan = Math.max(
    -Math.abs(maxPan),
    Math.min(Math.abs(maxPan), panOffset),
  );
  const centerFreq = (fullRange.min + fullRange.max) / 2;
  const visualCenter = centerFreq + clampedPan;
  const visualCenterBin = Math.round(
    ((visualCenter - fullRange.min) / fullSpan) * totalBins,
  );
  let startBin = Math.round(visualCenterBin - visibleBins / 2);
  startBin = Math.max(0, Math.min(totalBins - visibleBins, startBin));

  const slicedWaveform = fullWaveform.subarray(
    startBin,
    startBin + visibleBins,
  );
  const visualRange = {
    min: visualCenter - halfSpan,
    max: visualCenter + halfSpan,
  };

  return { slicedWaveform, visualRange };
}


// THEME constant removed - now computed dynamically inside useSnapshot hook

function getDbUnit(data: SnapshotData): "dB" | "dBm" {
  return data.dbMax > 20 ? "dBm" : "dB";
}

function renderSpectrumSnapshot(
  data: SnapshotData,
  frequencyRange: Range,
  showGrid: boolean,
  pixelWidth: number,
  pixelHeight: number,
  format: "png" | "svg",
  fullCaptureRange?: Range,
   statsLines?: string[],
   waveform?: Float32Array,
   theme?: SnapshotTheme,
): HTMLCanvasElement | string {
   const dpr = window.devicePixelRatio || 1;
   const logicalW = pixelWidth / dpr;
   const logicalH = pixelHeight / dpr;
   const plotLeft = Math.max(FFT_AREA_MIN.x, 52);
   const plotBottom = 38;
 
   const mapper = new CoordinateMapper(
     {
       x: plotLeft,
       y: FFT_AREA_MIN.y,
       width: logicalW - 40 - plotLeft,
       height: logicalH - plotBottom - FFT_AREA_MIN.y,
     },
     frequencyRange,
     { min: data.dbMin, max: data.dbMax },
     dpr
   );
 
   if (!theme) throw new Error("Snapshot theme is required");
   const renderer = new SnapshotRenderer(mapper, theme);

  if (format === "svg") {
    const dc = new SVGDrawingContext(logicalW, logicalH);
    renderToDC(dc, renderer, data, frequencyRange, showGrid, fullCaptureRange, statsLines, waveform);
    return dc.getSVG();
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dc = new CanvasDrawingContext(ctx);
    renderToDC(dc, renderer, data, frequencyRange, showGrid, fullCaptureRange, statsLines, waveform);
    return canvas;
  }
}

function renderToDC(
  dc: DrawingContext,
  renderer: SnapshotRenderer,
  data: SnapshotData,
  frequencyRange: Range,
  showGrid: boolean,
  fullCaptureRange?: Range,
  statsLines?: string[],
  waveform?: Float32Array,
): void {
  const vertRange = 10;
  const startLabel = Math.floor((data.dbMax + 0.1) / vertRange) * vertRange;
  const markers = [];
  for (let line = startLabel; line >= data.dbMin - 1; line -= vertRange) {
    markers.push(line);
  }
  const unit = getDbUnit(data);

  renderer.drawBackground(dc);
  renderer.drawAxes(dc);
  if (showGrid) renderer.drawGridLines(dc, markers);
  renderer.drawDbMarkers(dc, markers, unit);
  renderer.drawHardwareGrid(dc, data.hardwareSampleRateHz || 0, fullCaptureRange);

  const traceWaveform = waveform ?? data.waveform;
  if (traceWaveform) {
    renderer.drawTrace(dc, traceWaveform);
  }

  renderer.drawFrequencyLabels(dc, 1, (frequencyRange.min + frequencyRange.max) / 2);
  if (statsLines && traceWaveform) {
    renderer.drawStatsBox(dc, statsLines, traceWaveform);
  }
}

// ── Waterfall renderers ─────────────────────────────────────────────────────

export function dbToColor(
  db: number,
  minDb: number,
  maxDb: number,
  colormap: number[][],
): [number, number, number] {
  if (!colormap || colormap.length === 0) return [0, 0, 0];
  const normalized = (db - minDb) / (maxDb - minDb);
  const index = Math.max(
    0,
    Math.min(
      colormap.length - 1,
      normalized * (colormap.length - 1),
    ),
  );
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.min(colormap.length - 1, lowerIndex + 1);
  const fraction = index - lowerIndex;
  const lower = colormap[lowerIndex];
  const upper = colormap[upperIndex];
  return [
    Math.round(lower[0] + (upper[0] - lower[0]) * fraction),
    Math.round(lower[1] + (upper[1] - lower[1]) * fraction),
    Math.round(lower[2] + (upper[2] - lower[2]) * fraction),
  ];
}

function drawWaterfallToCanvas(
  canvas: HTMLCanvasElement,
  textureSnapshot: Uint8Array,
  meta: { width: number; height: number; writeRow: number },
  dbMin: number,
  dbMax: number,
  colormap: number[][],
  options?: { marginX?: number; marginY?: number; noBackground?: boolean; waterfallBg?: string }
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const lw = canvas.width / dpr;
  const lh = canvas.height / dpr;
  const marginStart = options?.marginX !== undefined ? options.marginX : FFT_AREA_MIN.x;
  const marginEnd = options?.marginX !== undefined ? options.marginX : 40;
  const marginY = options?.marginY ?? 8;

  const displayW = Math.max(1, Math.round(lw - marginStart - marginEnd));
  const displayH = Math.max(1, Math.round(lh - marginY * 2));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
    const textureRow =
      (((meta.writeRow - 1 - rowOffset_from_newest) % totalRows) + totalRows) %
      totalRows;
    const rowOffset = textureRow * bytesPerRow;

    for (let outX = 0; outX < pixelW; outX++) {
      const binIdx = Math.floor((outX / pixelW) * textureBinsPerRow);
      const byteOffset = rowOffset + binIdx * 4;

      let dbVal = -120;
      if (byteOffset + 4 <= textureSnapshot.length) {
        const view = new DataView(
          textureSnapshot.buffer,
          textureSnapshot.byteOffset + byteOffset,
          4,
        );
        dbVal = view.getFloat32(0, true);
      }

      const [r, g, b] = dbToColor(dbVal, dbMin, dbMax, colormap);
      const pixelIdx = (outY * pixelW + outX) * 4;
      pixels[pixelIdx] = r;
      pixels[pixelIdx + 1] = g;
      pixels[pixelIdx + 2] = b;
      pixels[pixelIdx + 3] = 255;
    }
  }

  ctx.putImageData(
    imgData,
    Math.round(marginStart * dpr),
    Math.round(marginY * dpr),
  );
}

function drawWaterfallFrom2DBuffer(
  canvas: HTMLCanvasElement,
  waterfallBuffer: Uint8ClampedArray,
  dims: { width: number; height: number },
  options?: { marginX?: number; marginY?: number; noBackground?: boolean; waterfallBg?: string }
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const marginStart = options?.marginX !== undefined ? options.marginX : FFT_AREA_MIN.x;
  const marginY = options?.marginY ?? 8;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const expectedSize = dims.width * dims.height * 4;
  const safeBuffer = new Uint8ClampedArray(expectedSize);
  const copyLen = Math.min(expectedSize, waterfallBuffer.length);
  safeBuffer.set(waterfallBuffer.subarray(0, copyLen));
  const imageData = new ImageData(safeBuffer, dims.width, dims.height);

  // putImageData ignores transforms, so scale manually
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(
    imageData,
    Math.round(marginStart * dpr),
    Math.round(marginY * dpr),
  );
}

function renderWaterfallSnapshotCanvas(
  data: SnapshotData,
  pixelWidth: number,
  pixelHeight: number,
  options?: { marginX?: number; marginY?: number; noBackground?: boolean; waterfallBg?: string }
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  if (options?.waterfallBg && !options?.noBackground) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = options.waterfallBg;
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    }
  }

  if (
    data.webgpuEnabled &&
    data.waterfallTextureSnapshot &&
    data.waterfallTextureMeta
  ) {
    drawWaterfallToCanvas(
      canvas,
      data.waterfallTextureSnapshot,
      data.waterfallTextureMeta,
      data.dbMin,
      data.dbMax,
      data.colormap,
      options
    );
    return canvas;
  }

  if (data.waterfallBuffer && data.waterfallDims) {
    drawWaterfallFrom2DBuffer(canvas, data.waterfallBuffer, data.waterfallDims, options);
    return canvas;
  }

  return null;
}

function renderSpectrumSnapshotCanvas(
  data: SnapshotData,
  frequencyRange: Range,
  showGrid: boolean,
  pixelWidth: number,
  pixelHeight: number,
  fullCaptureRange?: Range,
  statsLines?: string[],
  waveform?: Float32Array,
  theme?: SnapshotTheme,
): HTMLCanvasElement {
  return renderSpectrumSnapshot(
    data,
    frequencyRange,
    showGrid,
    pixelWidth,
    pixelHeight,
    "png",
    fullCaptureRange,
    statsLines,
    waveform,
    theme,
  ) as HTMLCanvasElement;
}

function composeWholeChannelWaterfallCanvas(
  segments: Array<{
    data: SnapshotData;
    visualRange: { min: number; max: number };
  }>,
  fullRange: { min: number; max: number },
  pixelWidth: number,
  pixelHeight: number,
  waterfallBg?: string,
): HTMLCanvasElement | null {
  if (!segments.length) return null;

  const totalSpan = fullRange.max - fullRange.min;
  if (!(totalSpan > 0)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (waterfallBg) {
    ctx.fillStyle = waterfallBg;
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  }

  const dpr = window.devicePixelRatio || 1;
  const marginStart = FFT_AREA_MIN.x;
  const marginEnd = 40;
  const marginY = 0;
  const plotPixelW = Math.round((pixelWidth / dpr - marginStart - marginEnd) * dpr);
  const plotPixelH = Math.round((pixelHeight / dpr - marginY * 2) * dpr);
  const plotPixelX = Math.round(marginStart * dpr);
  const plotPixelY = Math.round(marginY * dpr);

  let renderedAny = false;
  for (const segment of segments) {
    const startRatio = (segment.visualRange.min - fullRange.min) / totalSpan;
    const endRatio = (segment.visualRange.max - fullRange.min) / totalSpan;
    const targetX = Math.round(Math.min(startRatio, endRatio) * plotPixelW);
    const targetRight = Math.round(Math.max(startRatio, endRatio) * plotPixelW);
    const targetWidth = Math.max(1, targetRight - targetX);

    // Render segment to its own width
    const segmentCanvas = renderWaterfallSnapshotCanvas(
      segment.data,
      targetWidth,
      plotPixelH,
      { marginX: 0, marginY: 0, noBackground: true, waterfallBg }
    );
    if (!segmentCanvas) continue;

    ctx.drawImage(
      segmentCanvas,
      0,
      0,
      segmentCanvas.width,
      segmentCanvas.height,
      plotPixelX + targetX,
      plotPixelY,
      targetWidth,
      plotPixelH,
    );
    renderedAny = true;
  }

  return renderedAny ? canvas : null;
}

function composeWholeChannelSpectrumCanvas(
  segments: Array<{
    data: SnapshotData;
    visualRange: Range;
  }>,
  fullRange: Range,
  showGrid: boolean,
  pixelWidth: number,
  pixelHeight: number,
  fullCaptureRange?: Range,
  statsLines?: string[],
  theme?: SnapshotTheme,
): HTMLCanvasElement | null {
  if (!segments.length) return null;

  const totalSpan = fullRange.max - fullRange.min;
  if (!(totalSpan > 0)) return null;
  const first = segments[0];
  const baseBins = Math.max(
    2048,
    ...segments.map((segment) => segment.data.waveform?.length ?? 0),
  );
  const stitchedBins = Math.max(
    baseBins,
    Math.round(
      baseBins *
        segments.reduce((maxRatio, segment) => {
          const segSpan = segment.visualRange.max - segment.visualRange.min;
          return Math.max(maxRatio, segSpan > 0 ? totalSpan / segSpan : 1);
        }, 1),
    ),
  );
  const stitched = new Float32Array(stitchedBins).fill(first.data.dbMin);
  let filledAny = false;

  for (const segment of segments) {
    const waveform = segment.data.waveform;
    if (!waveform?.length) continue;

    const startRatio = Math.max(
      0,
      (segment.visualRange.min - fullRange.min) / totalSpan,
    );
    const endRatio = Math.min(
      1,
      (segment.visualRange.max - fullRange.min) / totalSpan,
    );
    const destStart = Math.max(
      0,
      Math.min(stitchedBins - 1, Math.round(startRatio * stitchedBins)),
    );
    const destEnd = Math.max(
      destStart + 1,
      Math.min(stitchedBins, Math.round(endRatio * stitchedBins)),
    );
    const destCount = Math.max(1, destEnd - destStart);

    for (let i = 0; i < destCount; i++) {
      const srcIdx = Math.min(
        waveform.length - 1,
        Math.round((i / Math.max(1, destCount - 1)) * (waveform.length - 1)),
      );
      stitched[destStart + i] = waveform[srcIdx];
    }
    filledAny = true;
  }

  if (!filledAny) return null;

  return renderSpectrumSnapshotCanvas(
    {
      ...first.data,
      waveform: stitched,
    },
    fullRange,
    showGrid,
    pixelWidth,
    pixelHeight,
    fullCaptureRange,
    statsLines,
    stitched,
    theme,
  );
}

// SVG Vector Generation has been unified into SnapshotRenderer.

// ── Hook ────────────────────────────────────────────────────────────────────

export function useSnapshot(
  _frequencyRange: { min: number; max: number } | null,
  _isConnected: boolean,
) {
  const appMode = useAppSelector((state) => state.theme.appMode);
  const resolvedMode = useResolvedThemeMode(appMode);
  const themeColors = THEME_TOKENS.colors[resolvedMode];

  const theme: SnapshotTheme = {
    bg: themeColors.fftBackground,
    grid: themeColors.fftGrid,
    line: themeColors.fftLine,
    shadow: themeColors.fftShadow,
    text: themeColors.fftText,
    hwLine: themeColors.snapHwRateLine,
    hwText: themeColors.snapHwRateText,
    cfText: themeColors.snapCenterLabelText,
  };

  const waterfallBg = themeColors.waterfallBackground;

  const handleSnapshot = useCallback(async (options: SnapshotOptions) => {
    const data = options.getSnapshotData();
    if (!data || !data.waveform || data.waveform.length === 0) {
      console.warn("[Snapshot] No waveform data available");
      return;
    }

    // Determine waveform + range
    let waveformToRender: Float32Array;
    let rangeToRender: { min: number; max: number };

    if (options.whole) {
      waveformToRender = data.fullChannelWaveform ?? data.waveform;
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

    // Capture range for hardware grid
    const centerFreqToRender = (rangeToRender.min + rangeToRender.max) / 2;
    let captureRange: Range;
    if (data.hardwareSampleRateHz && Number.isFinite(centerFreqToRender)) {
      const hwSpanMHz = data.hardwareSampleRateHz / 1e6;
      const dataSpan = rangeToRender.max - rangeToRender.min;
      if (dataSpan > hwSpanMHz + 0.001) {
        captureRange = rangeToRender;
      } else {
        captureRange = { 
          min: centerFreqToRender - (data.hardwareSampleRateHz / 2e6), 
          max: centerFreqToRender + (data.hardwareSampleRateHz / 2e6) 
        };
      }
    } else {
      captureRange = data.frequencyRange;
    }

    // Dimensions
    const dpr = window.devicePixelRatio || 1;
    const hardwareSpanMHz =
      data.hardwareSampleRateHz && data.hardwareSampleRateHz > 0
        ? data.hardwareSampleRateHz / 1_000_000
        : null;
    const rangeSpanMHz = rangeToRender.max - rangeToRender.min;
    const wholeWidthScale =
      options.whole && hardwareSpanMHz && rangeSpanMHz > 0
        ? Math.min(2.25, Math.max(1.15, rangeSpanMHz / hardwareSpanMHz))
        : 1;
    const LOGICAL_WIDTH = Math.round(1200 * wholeWidthScale);
    const LOGICAL_SPECTRUM_H = 400;
    const LOGICAL_WATERFALL_H = 300;
    const PIXEL_WIDTH = Math.round(LOGICAL_WIDTH * dpr);
    const PIXEL_SPECTRUM_H = Math.round(LOGICAL_SPECTRUM_H * dpr);
    const PIXEL_WATERFALL_H = Math.round(LOGICAL_WATERFALL_H * dpr);
    const modeLabel = options.modeLabel ?? (options.whole ? "Whole Channel" : "Onscreen");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

    const hasWaterfall =
      options.showWaterfall &&
      (
        (data.webgpuEnabled &&
          data.waterfallTextureSnapshot &&
          data.waterfallTextureMeta) ||
        (!data.webgpuEnabled && data.waterfallBuffer && data.waterfallDims)
      );

    const dbUnit = getDbUnit(data);
    const statsLines = options.showStats ? [
      `${fmtFreq(rangeToRender.min)} – ${fmtFreq(rangeToRender.max)}`,
      fmtTimestamp(),
      `${modeLabel} | ${dbUnit}: ${data.dbMin} to ${data.dbMax}`,
      `FFT: ${data.fftSize ?? "?"} | Window: ${data.fftWindow ?? "?"}`,
      `Source: ${options.sourceName || "Unknown"}`,
      ...(options.sdrSettingsLabel ? [options.sdrSettingsLabel] : [])
    ] : [];

    if (options.showStats && options.showGeolocation) {
      if (options.geolocation) {
        statsLines.push(`Location: ${options.geolocation.lat}, ${options.geolocation.lon}`);
      } else {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 5000,
              maximumAge: 60000
            });
          });
          const lat = pos.coords.latitude.toFixed(6);
          const lon = pos.coords.longitude.toFixed(6);
          statsLines.push(`Location: ${lat}, ${lon}`);
        } catch (err) {
          console.warn("[Snapshot] Geolocation failed:", err);
        }
      }
    }

    const wholeChannelSpectrumCanvas =
      options.whole && options.wholeChannelSegments?.length
        ? composeWholeChannelSpectrumCanvas(
            options.wholeChannelSegments,
            rangeToRender,
            options.showGrid,
            PIXEL_WIDTH,
            PIXEL_SPECTRUM_H,
            captureRange,
            statsLines,
            theme,
          )
        : null;
    const wholeChannelWaterfallCanvas =
      options.showWaterfall && options.whole && options.wholeChannelSegments?.length
        ? composeWholeChannelWaterfallCanvas(
            options.wholeChannelSegments,
            rangeToRender,
            PIXEL_WIDTH,
            PIXEL_WATERFALL_H,
            waterfallBg,
          )
        : null;

    // ── SVG Vector path ───────────────────────────────────────────────────
    if (options.format === "svg") {
      const totalH = hasWaterfall
        ? LOGICAL_SPECTRUM_H + LOGICAL_WATERFALL_H
        : LOGICAL_SPECTRUM_H;

      const spectrumSvg = renderSpectrumSnapshot(
        { ...data, waveform: waveformToRender },
        rangeToRender,
        options.showGrid,
        PIXEL_WIDTH,
        PIXEL_SPECTRUM_H,
        "svg",
        captureRange,
        statsLines,
        waveformToRender,
        theme,
      ) as string;
 
      // Waterfall as embedded PNG bitmap
      let waterfallSection = "";
      if (hasWaterfall) {
        const wfCanvas =
          wholeChannelWaterfallCanvas ??
          renderWaterfallSnapshotCanvas(data, PIXEL_WIDTH, PIXEL_WATERFALL_H, { waterfallBg, marginY: 0 });

        if (wfCanvas) {
          const wfDataUrl = wfCanvas.toDataURL("image/png");
          waterfallSection = `<image href="${wfDataUrl}" x="0" y="${LOGICAL_SPECTRUM_H}" width="${LOGICAL_WIDTH}" height="${LOGICAL_WATERFALL_H}"/>`;
        }
      }

      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGICAL_WIDTH} ${totalH}" width="${LOGICAL_WIDTH}" height="${totalH}">
  ${spectrumSvg}
  ${waterfallSection}
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

    const totalPixelH = hasWaterfall
      ? PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H
      : PIXEL_SPECTRUM_H;

    const renderData = { ...data, waveform: waveformToRender };
    const spectrumCanvas =
      wholeChannelSpectrumCanvas ??
      renderSpectrumSnapshotCanvas(
        renderData,
        rangeToRender,
        options.showGrid,
        PIXEL_WIDTH,
        PIXEL_SPECTRUM_H,
        captureRange,
        statsLines,
        waveformToRender,
        theme,
      );
 
    // Waterfall
    let waterfallCanvas: HTMLCanvasElement | null = null;
    if (hasWaterfall) {
      waterfallCanvas =
        wholeChannelWaterfallCanvas ??
        renderWaterfallSnapshotCanvas(data, PIXEL_WIDTH, PIXEL_WATERFALL_H, { waterfallBg, marginY: 0 });
    }

    // Composite
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = PIXEL_WIDTH;
    finalCanvas.height = totalPixelH;
    const ctx = finalCanvas.getContext("2d");
    if (!ctx) return;

    // Fill with background to prevent gaps
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, PIXEL_WIDTH, totalPixelH);

    ctx.drawImage(spectrumCanvas, 0, 0);
    if (waterfallCanvas) {
      ctx.drawImage(waterfallCanvas, 0, PIXEL_SPECTRUM_H);
    }

    // Export PNG
    const dataUrl = finalCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `spectrum-snapshot-${timestamp}.png`;
    link.href = dataUrl;
    link.click();
  }, [theme, waterfallBg]);

  return { handleSnapshot };
}
