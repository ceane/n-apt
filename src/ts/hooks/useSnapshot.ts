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

export type SnapshotAspectRatio = "default" | "4:3" | "16:10" | "16:9" | "19.5:9";

export type SnapshotOptions = {
  whole: boolean;
  showWaterfall: boolean;
  showStats: boolean;
  showGeolocation: boolean;
  geolocation?: { lat: string; lon: string } | null;
  showGrid: boolean;
  format: "png" | "svg" | SnapshotVideoFormat;
  aspectRatio?: SnapshotAspectRatio;
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
  getVideoSourceCanvases?: () => {
    spectrum: HTMLCanvasElement | null;
    waterfall?: HTMLCanvasElement | null;
  };
  prepareVideoRecording?: () => void | Promise<void> | (() => void | Promise<void>);
};

export type SnapshotVideoFormat = "mp4" | "webm";

const SNAPSHOT_VIDEO_MIME_TYPES: Record<SnapshotVideoFormat, string[]> = {
  webm: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"],
  mp4: ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/mp4"],
};

export function getSupportedSnapshotVideoFormat(): SnapshotVideoFormat | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates: SnapshotVideoFormat[] = ["mp4", "webm"];
  for (const format of candidates) {
    if (SNAPSHOT_VIDEO_MIME_TYPES[format].some((type) => MediaRecorder.isTypeSupported(type))) {
      return format;
    }
  }

  return null;
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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

async function recordSnapshotFramesToVideo(
  renderFrame: () => Promise<HTMLCanvasElement>,
  baseFilename: string,
  durationMs = 1000,
  preferredFormat: SnapshotVideoFormat | null = null,
): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

  const firstFrame = await renderFrame();
  const recordingCanvas = document.createElement("canvas");
  recordingCanvas.width = Math.max(1, firstFrame.width);
  recordingCanvas.height = Math.max(1, firstFrame.height);
  const ctx = recordingCanvas.getContext("2d");
  if (!ctx) throw new Error("Unable to initialize the video recording canvas.");

  ctx.drawImage(firstFrame, 0, 0);

  const stream = recordingCanvas.captureStream(30);
  const supportedMimeTypes = preferredFormat
    ? SNAPSHOT_VIDEO_MIME_TYPES[preferredFormat]
    : [...SNAPSHOT_VIDEO_MIME_TYPES.mp4, ...SNAPSHOT_VIDEO_MIME_TYPES.webm];
  const mimeType =
    supportedMimeTypes.find((type) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
    ) ?? "";

  if (!mimeType) {
    throw new Error("Your browser cannot record this canvas as a video.");
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];

  const stop = await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("Video recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.start(250);

    let rafId = 0;
    const tick = () => {
      void renderFrame().then((frame) => {
        if (recordingCanvas.width !== frame.width) recordingCanvas.width = Math.max(1, frame.width);
        if (recordingCanvas.height !== frame.height) recordingCanvas.height = Math.max(1, frame.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
        ctx.drawImage(frame, 0, 0);
      });
      rafId = window.requestAnimationFrame(tick);
    };
    tick();

    window.setTimeout(() => {
      window.cancelAnimationFrame(rafId);
      try {
        recorder.stop();
      } catch (error) {
        reject(error);
      }
    }, durationMs);
  });

  const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  downloadBlob(stop, `${baseFilename}.${extension}`);
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
  format: "png" | "svg" | SnapshotVideoFormat,
  fullCaptureRange?: Range,
   statsLines?: string[],
   waveform?: Float32Array,
   theme?: SnapshotTheme,
   aspectRatio?: SnapshotAspectRatio,
): HTMLCanvasElement | string {
const dpr = window.devicePixelRatio || 1;
    const logicalW = pixelWidth / dpr;
    const logicalH = pixelHeight / dpr;
    const plotLeft = Math.max(FFT_AREA_MIN.x, 52);
    const plotBottom = 38;
  
    // Calculate font scale and bottom padding based on aspect ratio
    const defaultLogicalH = 400;
    const heightRatio = logicalH / defaultLogicalH;
    // Use gentle scaling: 1 + 0.25 of the extra ratio, capped at 1.4x max
    const fontScale = Math.min(1.4, 1 + 0.25 * (heightRatio - 1));
    // Bottom padding increases with taller canvas (for 4:3 and wider)
const bottomPadding = Math.round(10 * heightRatio);
  
   const mapper = new CoordinateMapper(
     {
       x: plotLeft,
       y: FFT_AREA_MIN.y,
       width: logicalW - 40 - plotLeft,
       height: logicalH - plotBottom - FFT_AREA_MIN.y - bottomPadding,
     },
     frequencyRange,
     { min: data.dbMin, max: data.dbMax },
     dpr
   );
 
if (!theme) throw new Error("Snapshot theme is required");
    const renderer = new SnapshotRenderer(mapper, theme);

   if (format === "svg") {
     const dc = new SVGDrawingContext(logicalW, logicalH);
     renderToDC(dc, renderer, data, frequencyRange, showGrid, fullCaptureRange, statsLines, waveform, fontScale);
     return dc.getSVG();
   } else {
     const canvas = document.createElement("canvas");
     canvas.width = pixelWidth;
     canvas.height = pixelHeight;
     const ctx = canvas.getContext("2d")!;
     ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

     const dc = new CanvasDrawingContext(ctx);
     renderToDC(dc, renderer, data, frequencyRange, showGrid, fullCaptureRange, statsLines, waveform, fontScale);
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
  fontScale: number = 1,
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
  renderer.drawDbMarkers(dc, markers, unit, fontScale);
  renderer.drawHardwareGrid(dc, data.hardwareSampleRateHz || 0, fullCaptureRange);

  const traceWaveform = waveform ?? data.waveform;
  if (traceWaveform) {
    renderer.drawTrace(dc, traceWaveform);
  }

  renderer.drawFrequencyLabels(dc, 1, (frequencyRange.min + frequencyRange.max) / 2, fontScale);
  if (statsLines && traceWaveform) {
    renderer.drawStatsBox(dc, statsLines, traceWaveform, fontScale);
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
  aspectRatio?: SnapshotAspectRatio,
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
    aspectRatio,
  );
}

// Cache for segment positions in waterfall composition
// Key: segments array reference + fullRange + pixelWidth + pixelHeight
// Value: cached position calculations
const waterfallPositionCache = new WeakMap<
  object,
  Array<{
    targetX: number;
    targetWidth: number;
    plotPixelW: number;
    plotPixelH: number;
    plotPixelX: number;
    plotPixelY: number;
  }>
>();

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

  // Check if we have cached positions for these segments
  let cachedPositions = waterfallPositionCache.get(segments);
  
  // Validate cache: if dimensions changed, invalidate
  if (cachedPositions && cachedPositions.length === segments.length) {
    const firstPos = cachedPositions[0];
    if (firstPos.plotPixelW !== plotPixelW || firstPos.plotPixelH !== plotPixelH) {
      cachedPositions = undefined;
    }
  }

  // Build cache if not available
  if (!cachedPositions) {
    cachedPositions = segments.map((segment) => {
      const startRatio = (segment.visualRange.min - fullRange.min) / totalSpan;
      const endRatio = (segment.visualRange.max - fullRange.min) / totalSpan;
      const targetX = Math.round(Math.min(startRatio, endRatio) * plotPixelW);
      const targetRight = Math.round(Math.max(startRatio, endRatio) * plotPixelW);
      const targetWidth = Math.max(1, targetRight - targetX);
      return { targetX, targetWidth, plotPixelW, plotPixelH, plotPixelX, plotPixelY };
    });
    waterfallPositionCache.set(segments, cachedPositions);
  }

  let renderedAny = false;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const positions = cachedPositions[i];

    // Render segment to its own width
    const segmentCanvas = renderWaterfallSnapshotCanvas(
      segment.data,
      positions.targetWidth,
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
      positions.plotPixelX + positions.targetX,
      positions.plotPixelY,
      positions.targetWidth,
      plotPixelH,
    );
    renderedAny = true;
  }

  return renderedAny ? canvas : null;
}

// Cache for spectrum stitching metadata
// Key: segments array reference
// Value: cached stitching parameters (positions only, NOT src indices since waveform length changes each frame)
const spectrumStitchCache = new WeakMap<
  object,
  {
    stitchedBins: number;
    totalSpan: number;
    dbMin: number;
    segmentCaches: Array<{
      destStart: number;
      destEnd: number;
      destCount: number;
    }>;
  }
>();

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
  
  // Check cache for stitching metadata
  let stitchCache = spectrumStitchCache.get(segments);
  
  // Validate cache: if parameters changed, invalidate
  if (stitchCache && Math.abs(stitchCache.totalSpan - totalSpan) > 0.001) {
    stitchCache = undefined;
  }
  
  let stitchedBins: number;
  let segmentCaches: typeof stitchCache extends infer T ? T extends { segmentCaches: infer S } ? S : never : never;
  
  if (stitchCache) {
    // Use cached stitching parameters
    stitchedBins = stitchCache.stitchedBins;
    segmentCaches = stitchCache.segmentCaches;
  } else {
    // Calculate stitching parameters
    const baseBins = Math.max(
      2048,
      ...segments.map((segment) => segment.data.waveform?.length ?? 0),
    );
    stitchedBins = Math.max(
      baseBins,
      Math.round(
        baseBins *
          segments.reduce((maxRatio, segment) => {
            const segSpan = segment.visualRange.max - segment.visualRange.min;
            return Math.max(maxRatio, segSpan > 0 ? totalSpan / segSpan : 1);
          }, 1),
      ),
    );
    
    // Pre-calculate segment position mappings
    segmentCaches = segments.map((segment) => {
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
      
      // Return position info only - src indices calculated dynamically each frame
      // since waveform length changes between frames
      return { destStart, destEnd, destCount };
    });
    
    // Store in cache
    spectrumStitchCache.set(segments, {
      stitchedBins,
      totalSpan,
      dbMin: first.data.dbMin,
      segmentCaches,
    });
  }
  
  const stitched = new Float32Array(stitchedBins).fill(first.data.dbMin);
  const BLEND_BINS = 16;

  function hannWindow(t: number): number {
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }

  // Use cached position data for stitching
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx];
    const waveform = segment.data.waveform;
    if (!waveform?.length) continue;

    const { destStart, destCount } = segmentCaches[segIdx];

    for (let i = 0; i < destCount; i++) {
      // Calculate src index dynamically based on current waveform length
      const srcIdx = Math.min(
        waveform.length - 1,
        Math.round((i / Math.max(1, destCount - 1)) * (waveform.length - 1)),
      );
      const incoming = waveform[srcIdx];

      const existing = stitched[destStart + i];
      if (existing !== first.data.dbMin && BLEND_BINS > 0) {
        const blendFactor = hannWindow(i / BLEND_BINS);
        stitched[destStart + i] = existing * (1 - blendFactor) + incoming * blendFactor;
      } else {
        stitched[destStart + i] = incoming;
      }
    }
  }

  const hasData = stitched.some(x => x !== first.data.dbMin);
  if (!hasData) return null;

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

    const totalPixelH = hasWaterfall
      ? PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H
      : PIXEL_SPECTRUM_H;

    // Determine final canvas dimensions based on aspect ratio (cover mode)
    // Calculate BEFORE rendering so we render at target size from the start
    let finalPixelW = PIXEL_WIDTH;
    let finalPixelH = totalPixelH;
    let targetSpectrumH = PIXEL_SPECTRUM_H;
    let targetWaterfallH = PIXEL_WATERFALL_H;
    if (options.aspectRatio && options.aspectRatio !== "default") {
      const targetRatio = options.aspectRatio === "4:3" ? 4/3 : (options.aspectRatio === "16:10" ? 16/10 : (options.aspectRatio === "16:9" ? 16/9 : 19.5/9));
      const currentRatio = PIXEL_WIDTH / totalPixelH;
      if (currentRatio > targetRatio) {
        finalPixelH = Math.round(PIXEL_WIDTH / targetRatio);
        if (hasWaterfall) {
          const spectrumRatio = PIXEL_SPECTRUM_H / (PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H);
          targetSpectrumH = Math.round(finalPixelH * spectrumRatio);
          targetWaterfallH = finalPixelH - targetSpectrumH;
        } else {
          targetSpectrumH = finalPixelH;
          targetWaterfallH = 0;
        }
      } else {
        finalPixelW = Math.round(totalPixelH * targetRatio);
        if (hasWaterfall) {
          targetSpectrumH = PIXEL_SPECTRUM_H;
          targetWaterfallH = PIXEL_WATERFALL_H;
        } else {
          targetSpectrumH = totalPixelH;
          targetWaterfallH = 0;
        }
      }
    }

    console.log(options.wholeChannelSegments)

    const wholeChannelSpectrumCanvas =
      options.whole && options.wholeChannelSegments?.length
        ? composeWholeChannelSpectrumCanvas(
            options.wholeChannelSegments,
            rangeToRender,
            options.showGrid,
            finalPixelW,
            targetSpectrumH,
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
            finalPixelW,
            targetWaterfallH,
            waterfallBg,
          )
        : null;

    // ── SVG Vector path ───────────────────────────────────────────────────
    if (options.format === "svg") {
      const totalHLogical = hasWaterfall
        ? LOGICAL_SPECTRUM_H + LOGICAL_WATERFALL_H
        : LOGICAL_SPECTRUM_H;

      // Determine final canvas dimensions based on aspect ratio (cover mode)
      // Recalculate heights and re-render at target sizes (not scale)
      let finalLogicalW = LOGICAL_WIDTH;
      let finalLogicalH = totalHLogical;
      let targetSpectrumH = LOGICAL_SPECTRUM_H;
      let targetWaterfallH = LOGICAL_WATERFALL_H;
      if (options.aspectRatio && options.aspectRatio !== "default") {
        const targetRatio = options.aspectRatio === "4:3" ? 4/3 : (options.aspectRatio === "16:10" ? 16/10 : (options.aspectRatio === "16:9" ? 16/9 : 19.5/9));
        const currentRatio = LOGICAL_WIDTH / totalHLogical;
        if (currentRatio > targetRatio) {
          finalLogicalH = Math.round(LOGICAL_WIDTH / targetRatio);
          if (hasWaterfall) {
            const spectrumRatio = LOGICAL_SPECTRUM_H / (LOGICAL_SPECTRUM_H + LOGICAL_WATERFALL_H);
            targetSpectrumH = Math.round(finalLogicalH * spectrumRatio);
            targetWaterfallH = finalLogicalH - targetSpectrumH;
          } else {
            targetSpectrumH = finalLogicalH;
            targetWaterfallH = 0;
          }
        } else {
          finalLogicalW = Math.round(totalHLogical * targetRatio);
          if (hasWaterfall) {
            targetSpectrumH = LOGICAL_SPECTRUM_H;
            targetWaterfallH = LOGICAL_WATERFALL_H;
          } else {
            targetSpectrumH = totalHLogical;
            targetWaterfallH = 0;
          }
        }
      }

      // Render spectrum at target height (re-render, not scale)
      const spectrumSvg = renderSpectrumSnapshot(
        { ...data, waveform: waveformToRender },
        rangeToRender,
        options.showGrid,
        finalLogicalW,
        targetSpectrumH,
        "svg",
        captureRange,
        statsLines,
        waveformToRender,
        theme,
        options.aspectRatio,
      ) as string;
 
      // Render waterfall at target height (re-render, not scale)
      let waterfallSection = "";
      if (hasWaterfall) {
        const wfCanvas =
          wholeChannelWaterfallCanvas ??
          renderWaterfallSnapshotCanvas(data, finalLogicalW, targetWaterfallH, { waterfallBg, marginY: 0 });

        if (wfCanvas) {
          const wfDataUrl = wfCanvas.toDataURL("image/png");
          waterfallSection = `<image href="${wfDataUrl}" x="0" y="${targetSpectrumH}" width="${finalLogicalW}" height="${targetWaterfallH}"/>`;
        }
      }

      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${finalLogicalW} ${finalLogicalH}" width="${finalLogicalW}" height="${finalLogicalH}">
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

    if (options.format === "mp4" || options.format === "webm") {
      const restoreRecordingState = options.prepareVideoRecording
        ? await options.prepareVideoRecording()
        : undefined;

      try {
        const baseFilename = `spectrum-snapshot-${timestamp}`;
        
        // Pre-allocate mutable data template to avoid GC pressure during video recording
        // This object will be reused and updated for each frame
        const mutableDataTemplate: SnapshotData | null = options.wholeChannelSegments?.length 
          ? { ...options.wholeChannelSegments[0].data }
          : null;
        
        await recordSnapshotFramesToVideo(async () => {
          const currentData = options.getSnapshotData();
          if (!currentData || !currentData.waveform || currentData.waveform.length === 0) {
            throw new Error("No waveform data available for video snapshot.");
          }

          let currentWaveform: Float32Array;
          let currentRange: Range;
          if (options.whole) {
            currentWaveform = currentData.fullChannelWaveform ?? currentData.waveform;
            const area = options.activeSignalArea?.toLowerCase();
            const bounds = area ? options.signalAreaBounds?.[area] : null;
            currentRange = bounds ?? currentData.frequencyRange;
          } else if (currentData.vizZoom > 1) {
            const { slicedWaveform, visualRange } = getZoomedSlice(
              currentData.waveform,
              currentData.frequencyRange,
              currentData.vizZoom,
              currentData.vizPanOffset,
            );
            currentWaveform = slicedWaveform;
            currentRange = visualRange;
          } else {
            currentWaveform = currentData.waveform;
            currentRange = currentData.frequencyRange;
          }

          const currentCenterFreq = (currentRange.min + currentRange.max) / 2;
          let currentCaptureRange: Range;
          if (currentData.hardwareSampleRateHz && Number.isFinite(currentCenterFreq)) {
            const hwSpanMHz = currentData.hardwareSampleRateHz / 1e6;
            const dataSpan = currentRange.max - currentRange.min;
            if (dataSpan > hwSpanMHz + 0.001) {
              currentCaptureRange = currentRange;
            } else {
              currentCaptureRange = {
                min: currentCenterFreq - currentData.hardwareSampleRateHz / 2e6,
                max: currentCenterFreq + currentData.hardwareSampleRateHz / 2e6,
              };
            }
          } else {
            currentCaptureRange = currentData.frequencyRange;
          }

          // Calculate total height based on whether waterfall is shown
          const totalPixelH = options.showWaterfall
            ? PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H
            : PIXEL_SPECTRUM_H;

          // Use aspect ratio from options if set, otherwise default (no change)
          const videoAspectRatio = options.aspectRatio ?? "default";
          
          // Determine final canvas dimensions based on aspect ratio (cover mode)
          let finalVideoPixelW = PIXEL_WIDTH;
          let finalVideoPixelH = totalPixelH;
          let targetSpectrumH = PIXEL_SPECTRUM_H;
          let targetWaterfallH = options.showWaterfall ? PIXEL_WATERFALL_H : 0;
          if (videoAspectRatio && videoAspectRatio !== "default") {
            const targetRatio = options.aspectRatio === "4:3" ? 4/3 : (options.aspectRatio === "16:10" ? 16/10 : (options.aspectRatio === "16:9" ? 16/9 : 19.5/9));
            const currentRatio = PIXEL_WIDTH / totalPixelH;
            if (currentRatio > targetRatio) {
              finalVideoPixelH = Math.round(PIXEL_WIDTH / targetRatio);
              if (options.showWaterfall) {
                const spectrumRatio = PIXEL_SPECTRUM_H / (PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H);
                targetSpectrumH = Math.round(finalVideoPixelH * spectrumRatio);
                targetWaterfallH = finalVideoPixelH - targetSpectrumH;
              } else {
                targetSpectrumH = finalVideoPixelH;
                targetWaterfallH = 0;
              }
            } else {
              finalVideoPixelW = Math.round(totalPixelH * targetRatio);
              if (options.showWaterfall) {
                targetSpectrumH = PIXEL_SPECTRUM_H;
                targetWaterfallH = PIXEL_WATERFALL_H;
              } else {
                targetSpectrumH = totalPixelH;
                targetWaterfallH = 0;
              }
            }
          }

          const videoDbUnit = getDbUnit(currentData);
          const videoStatsLines = options.showStats ? [
            `${fmtFreq(currentRange.min)} – ${fmtFreq(currentRange.max)}`,
            fmtTimestamp(),
            `${options.modeLabel ?? (options.whole ? "Whole Channel" : "Onscreen")} | ${videoDbUnit}: ${currentData.dbMin} to ${currentData.dbMax}`,
            `FFT: ${currentData.fftSize ?? "?"} | Window: ${currentData.fftWindow ?? "?"}`,
            `Source: ${options.sourceName || "Unknown"}`,
            ...(options.sdrSettingsLabel ? [options.sdrSettingsLabel] : []),
          ] : [];

          if (options.showStats && options.showGeolocation) {
            if (options.geolocation) {
              videoStatsLines.push(`Location: ${options.geolocation.lat}, ${options.geolocation.lon}`);
            }
          }

          // For whole channel video, update segments with fresh data for each frame
          // This creates a dynamic video instead of a static image
          // Optimization: Reuse segment objects and data template to reduce GC pressure
          let segmentsToRender = options.wholeChannelSegments;
          if (options.whole && mutableDataTemplate && segmentsToRender?.length) {
            // Update the mutable template with fresh data (reuses same object)
            mutableDataTemplate.waveform = currentData.fullChannelWaveform ?? currentData.waveform;
            mutableDataTemplate.waterfallTextureSnapshot = currentData.waterfallTextureSnapshot;
            mutableDataTemplate.waterfallTextureMeta = currentData.waterfallTextureMeta;
            mutableDataTemplate.waterfallBuffer = currentData.waterfallBuffer;
            mutableDataTemplate.waterfallDims = currentData.waterfallDims;
            // Update all segments with the mutable template (avoids creating new objects)
            for (let i = 0; i < segmentsToRender.length; i++) {
              (segmentsToRender[i] as { data: SnapshotData }).data = mutableDataTemplate;
            }
          }

          const currentWholeSpectrumCanvas =
            options.whole && segmentsToRender?.length
              ? composeWholeChannelSpectrumCanvas(
                  segmentsToRender,
                  currentRange,
                  options.showGrid,
                  finalVideoPixelW,
                  targetSpectrumH,
                  currentCaptureRange,
                  videoStatsLines,
                  theme,
                )
              : null;
          const currentWholeWaterfallCanvas =
            options.showWaterfall && options.whole && segmentsToRender?.length
              ? composeWholeChannelWaterfallCanvas(
                  segmentsToRender,
                  currentRange,
                  finalVideoPixelW,
                  targetWaterfallH,
                  waterfallBg,
                )
              : null;

          const frameCanvas = document.createElement("canvas");
          frameCanvas.width = finalVideoPixelW;
          frameCanvas.height = finalVideoPixelH;
          const frameCtx = frameCanvas.getContext("2d");
          if (!frameCtx) throw new Error("Unable to initialize the snapshot frame canvas.");
          frameCtx.fillStyle = theme.bg;
          frameCtx.fillRect(0, 0, finalVideoPixelW, finalVideoPixelH);
          
          // Draw re-rendered content at target size
          const spectrumCanvas =
            currentWholeSpectrumCanvas ??
            renderSpectrumSnapshotCanvas(
              { ...currentData, waveform: currentWaveform },
              currentRange,
              options.showGrid,
              finalVideoPixelW,
              targetSpectrumH,
              currentCaptureRange,
              videoStatsLines,
              currentWaveform,
              theme,
              options.aspectRatio,
            );
          frameCtx.drawImage(spectrumCanvas, 0, 0);
          if (options.showWaterfall) {
            const waterfallCanvas =
              currentWholeWaterfallCanvas ??
              renderWaterfallSnapshotCanvas(currentData, finalVideoPixelW, targetWaterfallH, {
                waterfallBg,
                marginY: 0,
              });
            if (waterfallCanvas) {
              frameCtx.drawImage(waterfallCanvas, 0, targetSpectrumH);
            }
          }
          return frameCanvas;
        }, baseFilename, 1000, options.format);
        return;
      } finally {
        if (restoreRecordingState) {
          await restoreRecordingState();
        }
      }
    }

// ── PNG path ──────────────────────────────────────────────────────────

    // Render spectrum at target size
    const renderData = { ...data, waveform: waveformToRender };
    const spectrumCanvas =
      wholeChannelSpectrumCanvas ??
      renderSpectrumSnapshotCanvas(
        renderData,
        rangeToRender,
        options.showGrid,
        finalPixelW,
        targetSpectrumH,
        captureRange,
        statsLines,
        waveformToRender,
        theme,
        options.aspectRatio,
      );
  
    // Render waterfall at target size
    let waterfallCanvas: HTMLCanvasElement | null = null;
    if (hasWaterfall) {
      waterfallCanvas =
        wholeChannelWaterfallCanvas ??
        renderWaterfallSnapshotCanvas(data, finalPixelW, targetWaterfallH, { waterfallBg, marginY: 0 });
    }

    // Composite to final canvas (no scaling - already at target size)
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = finalPixelW;
    finalCanvas.height = finalPixelH;
    const ctx = finalCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, finalPixelW, finalPixelH);
    ctx.drawImage(spectrumCanvas, 0, 0);
    if (waterfallCanvas) {
      ctx.drawImage(waterfallCanvas, 0, targetSpectrumH);
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
