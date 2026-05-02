import { useCallback } from "react";
import { FFT_AREA_MIN } from "@n-apt/consts";
import { THEME_TOKENS } from "@n-apt/consts";
import {
  clearSnapshotProgress,
  setSnapshotProgress,
  useAppDispatch,
  useAppSelector,
} from "@n-apt/redux";
import { useResolvedThemeMode } from "@n-apt/components/ui/Theme";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import type { WholeChannelSnapshotSegment } from "@n-apt/hooks/useCaptureWholeChannelSegments";
import { CoordinateMapper, Range } from "@n-apt/utils/rendering/CoordinateMapper";
import { CanvasDrawingContext, SnapshotRenderer, SnapshotTheme, SVGDrawingContext, DrawingContext } from "@n-apt/utils/rendering/SnapshotRenderer";
import { fmtFreq, fmtTimestamp } from "@n-apt/utils/rendering/formatters";
import { formatTimestampWithTimezone } from "@n-apt/utils/formatters";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SnapshotAspectRatio = "default" | "4:3" | "16:10" | "16:9" | "19.5:9";

export type SnapshotOptions = {
  whole: boolean;
  showWaterfall: boolean;
  showStats: boolean;
  showGeolocation: boolean;
  geolocation?: { lat: string; lon: string } | null;
  showGrid: boolean;
  format: "png" | "svg" | SnapshotVideoFormat | SnapshotAnimatedFormat;
  getSnapshotData: () => SnapshotData | null;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalArea?: string;
  sourceName?: string;
  sdrSettingsLabel?: string;
  modeLabel?: string;
  wholeChannelSegments?: WholeChannelSnapshotSegment[];
  getWholeChannelSegmentFrames?: () => AsyncGenerator<
    WholeChannelSnapshotSegment[],
    void,
    void
  >;
  videoFrameRate?: number;
  getVideoSourceCanvases?: () => {
    spectrum: HTMLCanvasElement | null;
    waterfall?: HTMLCanvasElement | null;
  };
  prepareVideoRecording?: () => void | Promise<void> | (() => void | Promise<void>);
  aspectRatio?: SnapshotAspectRatio;
  fileTimestamp?: string;
};

export type SnapshotVideoFormat = "mp4" | "webm";

export type SnapshotAnimatedFormat = "animated-svg";

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

export function normalizeSnapshotVideoFrameRate(frameRate?: number): number {
  return Number.isFinite(frameRate) && frameRate! > 0
    ? Math.round(frameRate!)
    : 30;
}

export function getWholeChannelRenderRange(
  data: SnapshotData,
  options: Pick<SnapshotOptions, "activeSignalArea" | "signalAreaBounds">,
  segments?: WholeChannelSnapshotSegment[],
): Range {
  const area = options.activeSignalArea?.toLowerCase();
  const bounds = area ? options.signalAreaBounds?.[area] : null;
  if (bounds) {
    return bounds;
  }

  if (segments?.length) {
    return {
      min: Math.min(...segments.map((segment) => segment.visualRange.min)),
      max: Math.max(...segments.map((segment) => segment.visualRange.max)),
    };
  }

  return data.frequencyRange;
}

async function recordSnapshotFramesToVideo(
  renderFrame: () => Promise<HTMLCanvasElement>,
  baseFilename: string,
  durationMs = 1000,
  preferredFormat: SnapshotVideoFormat | null = null,
  frameRate = 30,
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

  const safeFrameRate = normalizeSnapshotVideoFrameRate(frameRate);
  const stream = recordingCanvas.captureStream(safeFrameRate);
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

async function recordCanvasFramesToVideo(
  frames: HTMLCanvasElement[],
  baseFilename: string,
  preferredFormat: SnapshotVideoFormat | null = null,
  frameRate = 30,
): Promise<void> {
  if (!frames.length) {
    throw new Error("No frames available for video snapshot.");
  }

  const safeFrameRate = normalizeSnapshotVideoFrameRate(frameRate);
  const recordingCanvas = document.createElement("canvas");
  recordingCanvas.width = Math.max(1, frames[0].width);
  recordingCanvas.height = Math.max(1, frames[0].height);
  const ctx = recordingCanvas.getContext("2d");
  if (!ctx) throw new Error("Unable to initialize the video recording canvas.");

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

  const stream = recordingCanvas.captureStream(safeFrameRate);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  const frameIntervalMs = 1000 / safeFrameRate;

  const drawFrame = (frame: HTMLCanvasElement) => {
    if (recordingCanvas.width !== frame.width) recordingCanvas.width = Math.max(1, frame.width);
    if (recordingCanvas.height !== frame.height) recordingCanvas.height = Math.max(1, frame.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
    ctx.drawImage(frame, 0, 0);
  };

  drawFrame(frames[0]);

  const blob = await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("Video recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.start();

    let frameIndex = 1;
    const advance = () => {
      if (frameIndex >= frames.length) {
        window.setTimeout(() => {
          try {
            recorder.stop();
          } catch (error) {
            reject(error);
          }
        }, frameIntervalMs);
        return;
      }

      drawFrame(frames[frameIndex]);
      frameIndex += 1;
      window.setTimeout(advance, frameIntervalMs);
    };

    window.setTimeout(advance, frameIntervalMs);
  });

  const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  downloadBlob(blob, `${baseFilename}.${extension}`);
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
  _aspectRatio?: SnapshotAspectRatio,
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

  const fullSpan = fullCaptureRange ? (fullCaptureRange.max - fullCaptureRange.min) : 0;
  const viewBandwidth = frequencyRange.max - frequencyRange.min;
  const zoom = fullSpan > 0 ? (fullSpan / viewBandwidth) : 1;

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
    renderToDC(dc, renderer, data, frequencyRange, showGrid, fullCaptureRange, statsLines, waveform, fontScale, zoom);
    return dc.getSVG();
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dc = new CanvasDrawingContext(ctx);
    renderToDC(dc, renderer, data, frequencyRange, showGrid, fullCaptureRange, statsLines, waveform, fontScale, zoom);
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
  zoom: number = 1,
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
  if (traceWaveform?.length) {
    renderer.drawTrace(dc, traceWaveform);
  }

  renderer.drawFrequencyLabels(dc, zoom, (frequencyRange.min + frequencyRange.max) / 2, fontScale);
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
  _aspectRatio?: SnapshotAspectRatio,
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
    _aspectRatio,
  ) as HTMLCanvasElement;
}

function composeWholeChannelWaterfallCanvas(
  segments: WholeChannelSnapshotSegment[],
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
  segments: WholeChannelSnapshotSegment[],
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

// ── Animated SVG Generation ─────────────────────────────────────────────────

async function recordSVGFramesToAnimatedSvg(
  renderFrame: () => Promise<string>,
  baseFilename: string,
  durationMs = 1000,
  frameRate = 30,
): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

  const safeFrameRate = normalizeSnapshotVideoFrameRate(frameRate);
  const frameIntervalMs = 1000 / safeFrameRate;
  const totalFrames = Math.ceil((durationMs / 1000) * safeFrameRate);
  
  // Collect all frames
  const frames: string[] = [];
  let frameCount = 0;
  
  const collectFrame = async () => {
    if (frameCount >= totalFrames) {
      // All frames collected, sample down to 12-15 frames evenly spaced
      const sampledFrames = sampleFramesEvenly(frames, 12);
      const animatedSvg = createAnimatedSvgFromFrames(sampledFrames);
      const blob = new Blob([animatedSvg], { type: "image/svg+xml" });
      downloadBlob(blob, `${baseFilename}.svg`);
      return;
    }
    
    try {
      const svgContent = await renderFrame();
      frames.push(svgContent);
      frameCount++;
      window.setTimeout(collectFrame, frameIntervalMs);
    } catch (error) {
      console.error("Error rendering SVG frame:", error);
    }
  };
  
  await collectFrame();
}

function sampleFramesEvenly(frames: string[], targetCount: number): string[] {
  if (frames.length <= targetCount) return frames;
  
  // Sample frames evenly across the entire capture duration
  // E.g., if we have 60 frames and want 12, we take frames at indices: 0, 5, 10, 15, ..., 55
  const sampled: string[] = [];
  for (let i = 0; i < targetCount; i++) {
    const index = Math.round((i / (targetCount - 1)) * (frames.length - 1));
    sampled.push(frames[index]);
  }
  return sampled;
}

function extractSvgContent(svgString: string): string {
  // Extract just the inner content from an SVG string
  const match = svgString.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  return match ? match[1].trim() : svgString;
}

function generateSvgWithSymbols(svgString: string): string {
  // Takes a full SVG and wraps the content into a <symbol> structure
  // for easy reuse with <use> elements
  const svgMatch = svgString.match(/<svg[^>]*>/);
  if (!svgMatch) return svgString;

  const svgTag = svgMatch[0];
  const viewBoxMatch = svgTag.match(/viewBox="([^"]*)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 1200 700";
  const content = extractSvgContent(svgString);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <defs>
    <symbol id="spectrum-snapshot" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
      ${content}
    </symbol>
  </defs>
  <!-- Display the symbol by default -->
  <use href="#spectrum-snapshot" width="100%" height="100%"/>
  <!-- Or reference it externally with: <use href="snapshot.svg#spectrum-snapshot"/> -->
</svg>`;
}

function createAnimatedSvgFromFrames(frames: string[]): string {
  // Creates a smooth 1-second looping animation from sampled frames
  // Using SMIL animate elements for reliable frame-by-frame playback
  // Each frame fades in and out at the right time in the cycle
  
  if (!frames.length) return "";
  
  const firstSvgMatch = frames[0].match(/<svg[^>]*>/);
  if (!firstSvgMatch) return "";
  
  const svgTag = firstSvgMatch[0];
  const viewBoxMatch = svgTag.match(/viewBox="([^"]*)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 1200 700";
  const widthMatch = svgTag.match(/width="([^"]*)"/);
  const heightMatch = svgTag.match(/height="([^"]*)"/);
  const width = widthMatch ? widthMatch[1] : "1200";
  const height = heightMatch ? heightMatch[1] : "700";
  
  const totalDurationSeconds = 1.0;
  const frameCount = frames.length;
  
  // Extract first frame for fallback (shown when animations not supported)
  const firstFrameContent = extractSvgContent(frames[0]);
  
  // Create individual group elements for each frame with SMIL animation
  // Each frame gets its own begin time offset for sequential display
  let frameGroups = "";
  frames.forEach((frameContent, index) => {
    const content = extractSvgContent(frameContent);
    const frameStartTime = (index / frameCount) * totalDurationSeconds;

    
    // Fade in at start, hold, fade out at end
    frameGroups += `  <g id="frame-${index}" opacity="0">
    ${content}
    <animate attributeName="opacity" 
      values="0;1;1;0" 
      dur="${totalDurationSeconds}s" 
      begin="${frameStartTime}s" 
      repeatCount="indefinite" />
  </g>\n`;
  });
  
  // Build the animated content with fallback
  const animatedContent = `  <!-- Fallback: first frame (shown when animations are not supported) -->
  <g id="fallback" class="fallback-frame">
    ${firstFrameContent}
  </g>
  <!-- Animated frames -->
${frameGroups}`;

  // Wrap in symbol structure for reusability
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">
  <defs>
    <symbol id="animated-spectrum-snapshot" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
${animatedContent}
    </symbol>
  </defs>
  <!-- Display the symbol by default -->
  <use href="#animated-spectrum-snapshot" width="100%" height="100%"/>
  <!-- Or reference it externally with: <use href="snapshot.svg#animated-spectrum-snapshot"/> -->
</svg>`;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useSnapshot(
  _frequencyRange: { min: number; max: number } | null,
  _isConnected: boolean,
) {
  const appMode = useAppSelector((state) => state.theme.appMode);
  const dispatch = useAppDispatch();
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
    dispatch(setSnapshotProgress({
      stage: "started",
      message: "Preparing snapshot",
      current: null,
      total: null,
    }));
    try {
      const data = options.getSnapshotData();
      if (!data || !data.waveform || data.waveform.length === 0) {
        console.warn("[Snapshot] No waveform data available");
        dispatch(setSnapshotProgress({
          stage: "error",
          message: "No waveform data available",
          current: null,
          total: null,
        }));
        return;
      }

    // Determine waveform + range
    let waveformToRender: Float32Array;
    let rangeToRender: { min: number; max: number };

    if (options.whole) {
      waveformToRender = data.fullChannelWaveform ?? data.waveform;
      rangeToRender = getWholeChannelRenderRange(
        data,
        options,
        options.wholeChannelSegments,
      );
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
      const hwSpanHz = data.hardwareSampleRateHz;
      const dataSpan = rangeToRender.max - rangeToRender.min;
      if (dataSpan > hwSpanHz + 1) {
        captureRange = rangeToRender;
      } else {
        captureRange = { 
          min: centerFreqToRender - (data.hardwareSampleRateHz / 2), 
          max: centerFreqToRender + (data.hardwareSampleRateHz / 2) 
        };
      }
    } else {
      captureRange = data.frequencyRange;
    }

    // Dimensions
    const dpr = window.devicePixelRatio || 1;
    const hardwareSpanHz =
      data.hardwareSampleRateHz && data.hardwareSampleRateHz > 0
        ? data.hardwareSampleRateHz
        : null;
    const rangeSpanHz = rangeToRender.max - rangeToRender.min;
    const wholeWidthScale =
      options.whole && hardwareSpanHz && rangeSpanHz > 0
        ? Math.min(2.25, Math.max(1.15, rangeSpanHz / hardwareSpanHz))
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
    const timestampLabel = options.fileTimestamp
      ? formatTimestampWithTimezone(options.fileTimestamp)
      : fmtTimestamp();
    const statsLines = options.showStats ? [
      `${fmtFreq(rangeToRender.min)} – ${fmtFreq(rangeToRender.max)}`,
      timestampLabel,
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

    const buildRenderState = (
      currentData: SnapshotData,
      wholeChannelSegments?: WholeChannelSnapshotSegment[],
    ) => {
      let currentWaveform: Float32Array;
      let currentRange: Range;

      if (options.whole) {
        currentWaveform = currentData.fullChannelWaveform ?? currentData.waveform ?? new Float32Array();
        currentRange = getWholeChannelRenderRange(
          currentData,
          options,
          wholeChannelSegments,
        );
      } else if (currentData.vizZoom > 1 && currentData.waveform) {
        const { slicedWaveform, visualRange } = getZoomedSlice(
          currentData.waveform,
          currentData.frequencyRange,
          currentData.vizZoom,
          currentData.vizPanOffset,
        );
        currentWaveform = slicedWaveform;
        currentRange = visualRange;
      } else {
        currentWaveform = currentData.waveform ?? new Float32Array();
        currentRange = currentData.frequencyRange;
      }

      const currentCenterFreq = (currentRange.min + currentRange.max) / 2;
      let currentCaptureRange: Range;
      if (currentData.hardwareSampleRateHz && Number.isFinite(currentCenterFreq)) {
        const hwSpanHz = currentData.hardwareSampleRateHz;
        const dataSpan = currentRange.max - currentRange.min;
        if (dataSpan > hwSpanHz + 1) {
          currentCaptureRange = currentRange;
        } else {
          currentCaptureRange = {
            min: currentCenterFreq - currentData.hardwareSampleRateHz / 2,
            max: currentCenterFreq + currentData.hardwareSampleRateHz / 2,
          };
        }
      } else {
        currentCaptureRange = currentData.frequencyRange;
      }

      const currentDbUnit = getDbUnit(currentData);
      const currentTimestampLabel = options.fileTimestamp
        ? formatTimestampWithTimezone(options.fileTimestamp)
        : fmtTimestamp();
      const currentStatsLines = options.showStats ? [
        `${fmtFreq(currentRange.min)} – ${fmtFreq(currentRange.max)}`,
        currentTimestampLabel,
        `${options.modeLabel ?? (options.whole ? "Whole Channel" : "Onscreen")} | ${currentDbUnit}: ${currentData.dbMin} to ${currentData.dbMax}`,
        `FFT: ${currentData.fftSize ?? "?"} | Window: ${currentData.fftWindow ?? "?"}`,
        `Source: ${options.sourceName || "Unknown"}`,
        ...(options.sdrSettingsLabel ? [options.sdrSettingsLabel] : []),
      ] : [];

      if (options.showStats && options.showGeolocation && options.geolocation) {
        currentStatsLines.push(`Location: ${options.geolocation.lat}, ${options.geolocation.lon}`);
      }

      return {
        currentWaveform,
        currentRange,
        currentCaptureRange,
        currentStatsLines,
      };
    };

    const renderVideoFrameCanvas = (
      currentData: SnapshotData,
      wholeChannelSegments?: WholeChannelSnapshotSegment[],
    ) => {
      const {
        currentWaveform,
        currentRange,
        currentCaptureRange,
        currentStatsLines,
      } = buildRenderState(currentData, wholeChannelSegments);
      const frameSegments = wholeChannelSegments?.length
        ? wholeChannelSegments
        : options.wholeChannelSegments;

      // Calculate target dimensions first, before rendering
      const totalPixelH = options.showWaterfall
        ? PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H
        : PIXEL_SPECTRUM_H;
      let targetFrameW = PIXEL_WIDTH;
      let targetFrameH = totalPixelH;
      let targetSpectrumH = PIXEL_SPECTRUM_H;
      let targetWaterfallH = options.showWaterfall ? PIXEL_WATERFALL_H : 0;
      if (options.aspectRatio && options.aspectRatio !== "default") {
        const targetRatio = options.aspectRatio === "4:3" ? 4/3 : (options.aspectRatio === "16:10" ? 16/10 : (options.aspectRatio === "16:9" ? 16/9 : 19.5/9));
        const currentRatio = PIXEL_WIDTH / totalPixelH;
        if (currentRatio > targetRatio) {
          targetFrameH = Math.round(PIXEL_WIDTH / targetRatio);
          if (options.showWaterfall) {
            const spectrumRatio = PIXEL_SPECTRUM_H / (PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H);
            targetSpectrumH = Math.round(targetFrameH * spectrumRatio);
            targetWaterfallH = targetFrameH - targetSpectrumH;
          } else {
            targetSpectrumH = targetFrameH;
          }
        } else {
          targetFrameW = Math.round(totalPixelH * targetRatio);
          if (options.showWaterfall) {
            targetSpectrumH = PIXEL_SPECTRUM_H;
            targetWaterfallH = PIXEL_WATERFALL_H;
          } else {
            targetSpectrumH = totalPixelH;
          }
        }
      }

      // Now render with target dimensions
      const currentWholeSpectrumCanvas =
        options.whole && frameSegments?.length
          ? composeWholeChannelSpectrumCanvas(
              frameSegments,
              currentRange,
              options.showGrid,
              targetFrameW,
              targetSpectrumH,
              currentCaptureRange,
              currentStatsLines,
              theme,
            )
          : null;
      const currentWholeWaterfallCanvas =
        options.showWaterfall && options.whole && frameSegments?.length
          ? composeWholeChannelWaterfallCanvas(
              frameSegments,
              currentRange,
              targetFrameW,
              targetWaterfallH,
              waterfallBg,
            )
          : null;

      const frameCanvas = document.createElement("canvas");
      frameCanvas.width = targetFrameW;
      frameCanvas.height = targetFrameH;
      const frameCtx = frameCanvas.getContext("2d");
      if (!frameCtx) throw new Error("Unable to initialize the snapshot frame canvas.");
      frameCtx.fillStyle = theme.bg;
      frameCtx.fillRect(0, 0, targetFrameW, targetFrameH);

      // For whole channel, use the already-rendered canvases at target dimensions
      let spectrumCanvas: HTMLCanvasElement;
      if (currentWholeSpectrumCanvas) {
        spectrumCanvas = currentWholeSpectrumCanvas;
      } else {
        spectrumCanvas = renderSpectrumSnapshotCanvas(
          { ...currentData, waveform: currentWaveform },
          currentRange,
          options.showGrid,
          targetFrameW,
          targetSpectrumH,
          currentCaptureRange,
          currentStatsLines,
          currentWaveform,
          theme,
        );
      }
      frameCtx.drawImage(spectrumCanvas, 0, 0, targetFrameW, targetSpectrumH);

      if (options.showWaterfall) {
        let waterfallCanvas: HTMLCanvasElement | null = null;
        if (currentWholeWaterfallCanvas) {
          waterfallCanvas = currentWholeWaterfallCanvas;
        } else {
          waterfallCanvas = renderWaterfallSnapshotCanvas(currentData, targetFrameW, targetWaterfallH, {
            waterfallBg,
            marginY: 0,
          });
        }
        if (waterfallCanvas) {
          frameCtx.drawImage(waterfallCanvas, 0, targetSpectrumH, targetFrameW, targetWaterfallH);
        }
      }

      return frameCanvas;
    };

// ── SVG Vector path ───────────────────────────────────────────────────
     if (options.format === "svg") {
      const totalHLogical = hasWaterfall
        ? LOGICAL_SPECTRUM_H + LOGICAL_WATERFALL_H
        : LOGICAL_SPECTRUM_H;

      // Determine final canvas dimensions based on aspect ratio (cover mode)
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

      // Convert to pixel dimensions for rendering with proper DPR handling
      const dpr = window.devicePixelRatio || 1;
      const pixelW = Math.round(finalLogicalW * dpr);
      const pixelSpectrumH = Math.round(targetSpectrumH * dpr);
      const pixelWaterfallH = Math.round(targetWaterfallH * dpr);

      // Render whole channel canvases at target dimensions
      const wholeChannelSpectrumCanvas =
        options.whole && options.wholeChannelSegments?.length
          ? composeWholeChannelSpectrumCanvas(
              options.wholeChannelSegments,
              rangeToRender,
              options.showGrid,
              pixelW,
              pixelSpectrumH,
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
              pixelW,
              pixelWaterfallH,
              waterfallBg,
            )
          : null;

      let spectrumSvg = "";
      if (options.whole && wholeChannelSpectrumCanvas) {
        spectrumSvg = `<image href="${wholeChannelSpectrumCanvas.toDataURL("image/png")}" x="0" y="0" width="${finalLogicalW}" height="${targetSpectrumH}"/>`;
      } else {
        const svgResult = renderSpectrumSnapshot(
          { ...data, waveform: waveformToRender },
          rangeToRender,
          options.showGrid,
          pixelW,
          pixelSpectrumH,
          "svg",
          captureRange,
          statsLines,
          waveformToRender,
          theme,
          options.aspectRatio,
        );
        spectrumSvg = typeof svgResult === "string" ? svgResult : "";
      }

      let waterfallSection = "";
      if (hasWaterfall) {
        let wfDataUrl = "";
        if (wholeChannelWaterfallCanvas) {
          wfDataUrl = wholeChannelWaterfallCanvas.toDataURL("image/png");
        } else {
          const wfCanvas = renderWaterfallSnapshotCanvas(data, pixelW, pixelWaterfallH, { waterfallBg, marginY: 0 });
          if (wfCanvas) wfDataUrl = wfCanvas.toDataURL("image/png");
        }

        if (wfDataUrl) {
          waterfallSection = `<image href="${wfDataUrl}" x="0" y="${targetSpectrumH}" width="${finalLogicalW}" height="${targetWaterfallH}"/>`;
        }
      }

       const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${finalLogicalW} ${finalLogicalH}" width="${finalLogicalW}" height="${finalLogicalH}">
   ${spectrumSvg}
   ${waterfallSection}
 </svg>`;

       // Wrap in symbol structure for reusability
       const wrappedSvgContent = generateSvgWithSymbols(svgContent);

       const blob = new Blob([wrappedSvgContent], { type: "image/svg+xml" });
       const url = URL.createObjectURL(blob);
       const link = document.createElement("a");
       link.download = `spectrum-snapshot-${timestamp}.svg`;
       link.href = url;
       link.click();
       URL.revokeObjectURL(url);
      dispatch(setSnapshotProgress({
        stage: "done",
        message: "Snapshot saved",
        current: null,
        total: null,
      }));
      window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
      return;
    }

    if (options.format === "animated-svg") {
      const baseFilename = `spectrum-snapshot-${timestamp}`;
      const animatedFrameRate = options.videoFrameRate || 30;

      dispatch(setSnapshotProgress({
        stage: "encoding",
        message: "Rendering animated SVG",
        current: null,
        total: null,
      }));

      try {
        const renderAnimatedSvgFrame = async () => {
          const currentData = options.getSnapshotData();
          if (!currentData || !currentData.waveform || currentData.waveform.length === 0) {
            throw new Error("No waveform data available for animated SVG.");
          }

          const {
            currentWaveform,
            currentRange,
            currentCaptureRange,
            currentStatsLines,
          } = buildRenderState(currentData);

          // Determine final SVG dimensions based on aspect ratio
          const totalHLogical = hasWaterfall
            ? LOGICAL_SPECTRUM_H + LOGICAL_WATERFALL_H
            : LOGICAL_SPECTRUM_H;

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

          const dpr = window.devicePixelRatio || 1;
          const pixelW = Math.round(finalLogicalW * dpr);
          const pixelSpectrumH = Math.round(targetSpectrumH * dpr);
          const pixelWaterfallH = Math.round(targetWaterfallH * dpr);

          const wholeChannelSpectrumCanvas =
            options.whole && options.wholeChannelSegments?.length
              ? composeWholeChannelSpectrumCanvas(
                  options.wholeChannelSegments,
                  currentRange,
                  options.showGrid,
                  pixelW,
                  pixelSpectrumH,
                  currentCaptureRange,
                  currentStatsLines,
                  theme,
                )
              : null;

          let spectrumSvg = "";
          if (options.whole && wholeChannelSpectrumCanvas) {
            spectrumSvg = `<image href="${wholeChannelSpectrumCanvas.toDataURL("image/png")}" x="0" y="0" width="${finalLogicalW}" height="${targetSpectrumH}"/>`;
          } else {
            const svgResult = renderSpectrumSnapshot(
              { ...currentData, waveform: currentWaveform },
              currentRange,
              options.showGrid,
              pixelW,
              pixelSpectrumH,
              "svg",
              currentCaptureRange,
              currentStatsLines,
              currentWaveform,
              theme,
              options.aspectRatio,
            );
            spectrumSvg = typeof svgResult === "string" ? svgResult : "";
          }

          let waterfallSection = "";
          if (hasWaterfall) {
            const wfCanvas = renderWaterfallSnapshotCanvas(currentData, pixelW, pixelWaterfallH, { waterfallBg, marginY: 0 });
            if (wfCanvas) {
              const wfDataUrl = wfCanvas.toDataURL("image/png");
              waterfallSection = `<image href="${wfDataUrl}" x="0" y="${targetSpectrumH}" width="${finalLogicalW}" height="${targetWaterfallH}"/>`;
            }
          }

          const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${finalLogicalW} ${finalLogicalH}" width="${finalLogicalW}" height="${finalLogicalH}">
  ${spectrumSvg}
  ${waterfallSection}
</svg>`;

          return svgContent;
        };

        await recordSVGFramesToAnimatedSvg(
          renderAnimatedSvgFrame,
          baseFilename,
          1000,
          animatedFrameRate,
        );

        dispatch(setSnapshotProgress({
          stage: "done",
          message: "Animated SVG saved",
          current: null,
          total: null,
        }));
        window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
        return;
      } catch (error) {
        dispatch(setSnapshotProgress({
          stage: "error",
          message: error instanceof Error ? error.message : "Animated SVG generation failed",
          current: null,
          total: null,
        }));
        window.setTimeout(() => dispatch(clearSnapshotProgress()), 1800);
        throw error;
      }
    }

    if (options.format === "mp4" || options.format === "webm") {
      const restoreRecordingState = options.prepareVideoRecording
        ? await options.prepareVideoRecording()
        : undefined;

      try {
        const baseFilename = `spectrum-snapshot-${timestamp}`;
        const videoFrameRate = normalizeSnapshotVideoFrameRate(options.videoFrameRate);

        if (options.whole && options.getWholeChannelSegmentFrames) {
          const renderedFrames: HTMLCanvasElement[] = [];
          const expectedFrames = normalizeSnapshotVideoFrameRate(
            options.videoFrameRate,
          );
          const maxIterations = expectedFrames * 2;
          let iterationCount = 0;

          for await (const wholeChannelFrameSegments of options.getWholeChannelSegmentFrames()) {
            iterationCount++;
            if (iterationCount > maxIterations) {
              break;
            }
            if (!wholeChannelFrameSegments.length) {
              continue;
            }
            dispatch(setSnapshotProgress({
              stage: "collecting",
              message: `Rendering stitched frame ${renderedFrames.length + 1} of ${expectedFrames}`,
              current: renderedFrames.length + 1,
              total: expectedFrames,
            }));
            renderedFrames.push(
              renderVideoFrameCanvas(
                wholeChannelFrameSegments[0].data,
                wholeChannelFrameSegments,
              ),
            );
            if (renderedFrames.length >= expectedFrames) {
              break;
            }
          }

          if (!renderedFrames.length && options.wholeChannelSegments?.length) {
            renderedFrames.push(
              renderVideoFrameCanvas(
                options.wholeChannelSegments[0].data,
                options.wholeChannelSegments,
              ),
            );
          }

          if (!renderedFrames.length) {
            dispatch(setSnapshotProgress({
              stage: "error",
              message: "No stitched whole-channel frames were captured",
              current: null,
              total: null,
            }));
            throw new Error("No stitched whole-channel frames were captured for video snapshot.");
          }

          dispatch(setSnapshotProgress({
            stage: "encoding",
            message: `Encoding ${renderedFrames.length} frames`,
            current: renderedFrames.length,
            total: renderedFrames.length,
          }));
          await recordCanvasFramesToVideo(
            renderedFrames,
            baseFilename,
            options.format,
            videoFrameRate,
          );
          dispatch(setSnapshotProgress({
            stage: "done",
            message: "Video snapshot saved",
            current: null,
            total: null,
          }));
          window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
          return;
        }

        dispatch(setSnapshotProgress({
          stage: "encoding",
          message: "Recording video snapshot",
          current: null,
          total: null,
        }));
        await recordSnapshotFramesToVideo(async () => {
          const currentData = options.getSnapshotData();
          if (!currentData || !currentData.waveform || currentData.waveform.length === 0) {
            throw new Error("No waveform data available for video snapshot.");
          }
          return renderVideoFrameCanvas(currentData);
        }, baseFilename, 1000, options.format, videoFrameRate);
        dispatch(setSnapshotProgress({
          stage: "done",
          message: "Video snapshot saved",
          current: null,
          total: null,
        }));
        window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
        return;
      } finally {
        if (restoreRecordingState) {
          await restoreRecordingState();
        }
      }
    }

    // ── PNG path ──────────────────────────────────────────────────────────

    const totalPixelH = hasWaterfall
      ? PIXEL_SPECTRUM_H + PIXEL_WATERFALL_H
      : PIXEL_SPECTRUM_H;

    // Determine final canvas dimensions based on aspect ratio (cover mode)
    let finalPixelW = PIXEL_WIDTH;
    let finalPixelH = totalPixelH;
    let targetSpectrumH = PIXEL_SPECTRUM_H;
    let targetWaterfallH = hasWaterfall ? PIXEL_WATERFALL_H : 0;
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

    // Render whole channel canvases at target dimensions
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
 
    // Waterfall
    let waterfallCanvas: HTMLCanvasElement | null = null;
    if (hasWaterfall) {
      waterfallCanvas =
        wholeChannelWaterfallCanvas ??
        renderWaterfallSnapshotCanvas(data, finalPixelW, targetWaterfallH, { waterfallBg, marginY: 0 });
    }

    // Composite
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = finalPixelW;
    finalCanvas.height = finalPixelH;
    const ctx = finalCanvas.getContext("2d");
    if (!ctx) return;

    // Fill with background to prevent gaps
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
    dispatch(setSnapshotProgress({
      stage: "done",
      message: "Snapshot saved",
      current: null,
      total: null,
    }));
    window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
    } catch (error) {
      dispatch(setSnapshotProgress({
        stage: "error",
        message: error instanceof Error ? error.message : "Snapshot failed",
        current: null,
        total: null,
      }));
      window.setTimeout(() => dispatch(clearSnapshotProgress()), 1800);
      throw error;
    }
  }, [dispatch, theme, waterfallBg]);

  return { handleSnapshot };
}
