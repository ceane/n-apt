import { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  FFT_AREA_MIN,
  findBestFrequencyRange,
  DB_MARKERS,
} from "@n-apt/consts";
import { THEME_TOKENS } from "@n-apt/consts";
import {
  clearSnapshotProgress,
  setSnapshotProgress,
  useAppDispatch,
  useAppSelector,
  bumpSnapshotSectionPulse,
} from "@n-apt/redux";
import { useResolvedThemeMode } from "@n-apt/ui/Theme";
import type {
  SnapshotData,
  SnapshotDataOptions,
} from "@n-apt/spectrum/public/FFTCanvas";
import type { WholeChannelSnapshotSegment } from "@n-apt/capture/hooks/useCaptureWholeChannelSegments";
import type { DemodFocusOverlay } from "@n-apt/spectrum/public/useOverlayRenderer";
import { calculateCenterFrequency } from "@n-apt/math/centerFrequency";
import {
  CoordinateMapper,
  Range,
} from "@n-apt/layout/rendering/CoordinateMapper";
import {
  CanvasDrawingContext,
  SnapshotRenderer,
  SnapshotTheme,
  SVGDrawingContext,
  DrawingContext,
} from "@n-apt/layout/rendering/SnapshotRenderer";
import {
  acquireCanvas,
  ScratchCanvasPool,
} from "@n-apt/layout/rendering/scratchCanvas";
import { fmtTimestamp } from "@n-apt/layout/rendering/formatters";
import {
  stitchWholeChannelWaveform,
  getAntiAliasingParams,
} from "@n-apt/math/antiAliasing";
import { formatTimestampWithTimezone } from "@n-apt/math/formatters";
import {
  formatFrequency,
  formatFrequencyHighRes,
} from "@n-apt/math/frequency";
import {
  buildFrequencyAxisTheme,
  composeCanvasWithFrequencyAxis,
  getFrequencyAxisHeight,
  renderFrequencyAxisLayer,
  type FrequencyAxisTheme,
} from "@n-apt/layout/rendering/frequencyAxis";
import {
  createCanvasVfoAxisContext,
  drawVfoAxis,
  formatVfoAxisCenterLabel,
} from "@n-apt/layout/rendering/vfoAxis";
import {
  escapeAttr,
  sanitizeNumeric,
  sanitizeViewBox,
  sanitizeSVG,
} from "@n-apt/ui/sanitization";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import {
  normalizeWaterfallDbForColor,
  WATERFALL_ONSCREEN_COLOR_MAX,
} from "@n-apt/spectrum/public/waterfallColor";
import { useTheme } from "styled-components";
import type { AppStyledTheme } from "@n-apt/ui/Theme";
import { formatSnapshotLocationLine } from "@n-apt/capture/snapshotLocation";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SnapshotAspectRatio =
  "default" | "4:3" | "16:10" | "16:9" | "19.5:9";

export type SnapshotOptions = {
  whole: boolean;
  showWaterfall: boolean;
  showStats: boolean;
  showGeolocation: boolean;
  geolocation?: { lat: string; lon: string } | null;
  locationLabel?: string | null;
  showGrid: boolean;
  format: "png" | "svg" | SnapshotVideoFormat | SnapshotAnimatedFormat;
  getSnapshotData: () => SnapshotData | null;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalArea?: string;
  activeSignalAreaBounds?: { min: number; max: number } | null;
  sourceName?: string;
  gain?: number;
  ppm?: number;
  sdrSettingsLabel?: string;
  fftSize?: number | string;
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
    spectrumOverlay?: HTMLCanvasElement | null;
    waterfall?: HTMLCanvasElement | null;
  };
  prepareVideoRecording?: () =>
    void | Promise<void> | (() => void | Promise<void>);
  aspectRatio?: SnapshotAspectRatio;
  fileTimestamp?: string;
  stitchOptions?: { jsAntiAliasing: boolean; jsNoiseFloorMatching: boolean };
  useThemeColors?: boolean;
  canvasOnly?: {
    getCanvas: () => HTMLCanvasElement | null;
    filenamePrefix?: string;
  };
};

export type SnapshotVideoFormat = "mp4" | "webm";

export type SnapshotAnimatedFormat = "animated-svg";

const SNAPSHOT_VIDEO_MIME_TYPES: Record<SnapshotVideoFormat, string[]> = {
  webm: [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
  mp4: [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
  ],
};

const SNAPSHOT_VIDEO_BITRATE = 12_000_000;

export function getSupportedSnapshotVideoFormat(): SnapshotVideoFormat | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates: SnapshotVideoFormat[] = ["mp4", "webm"];
  for (const format of candidates) {
    if (
      SNAPSHOT_VIDEO_MIME_TYPES[format].some((type) =>
        MediaRecorder.isTypeSupported(type),
      )
    ) {
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

function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  filenamePrefix: string,
): void {
  const link = document.createElement("a");
  link.download = `${filenamePrefix}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
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

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(firstFrame, 0, 0);

  const safeFrameRate = normalizeSnapshotVideoFrameRate(frameRate);
  const stream = recordingCanvas.captureStream(safeFrameRate);
  const supportedMimeTypes = preferredFormat
    ? SNAPSHOT_VIDEO_MIME_TYPES[preferredFormat]
    : [...SNAPSHOT_VIDEO_MIME_TYPES.mp4, ...SNAPSHOT_VIDEO_MIME_TYPES.webm];
  const mimeType =
    supportedMimeTypes.find(
      (type) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(type),
    ) ?? "";

  if (!mimeType) {
    throw new Error("Your browser cannot record this canvas as a video.");
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: SNAPSHOT_VIDEO_BITRATE,
  });
  const chunks: BlobPart[] = [];

  const stop = await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("Video recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.start(250);

    // Render only as often as the encoder samples the canvas; rendering at the
    // display refresh rate is 2-4x the work for no extra frames.
    const frameIntervalMs = 1000 / safeFrameRate;
    let timerId = 0;
    let stopped = false;
    const tick = () => {
      const startedAt = performance.now();
      void renderFrame().then((frame) => {
        if (stopped) return;
        if (recordingCanvas.width !== frame.width)
          recordingCanvas.width = Math.max(1, frame.width);
        if (recordingCanvas.height !== frame.height)
          recordingCanvas.height = Math.max(1, frame.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
        ctx.drawImage(frame, 0, 0);
        const spent = performance.now() - startedAt;
        timerId = window.setTimeout(tick, Math.max(0, frameIntervalMs - spent));
      });
    };
    tick();

    window.setTimeout(() => {
      stopped = true;
      window.clearTimeout(timerId);
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

  ctx.imageSmoothingEnabled = false;

  const supportedMimeTypes = preferredFormat
    ? SNAPSHOT_VIDEO_MIME_TYPES[preferredFormat]
    : [...SNAPSHOT_VIDEO_MIME_TYPES.mp4, ...SNAPSHOT_VIDEO_MIME_TYPES.webm];
  const mimeType =
    supportedMimeTypes.find(
      (type) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(type),
    ) ?? "";

  if (!mimeType) {
    throw new Error("Your browser cannot record this canvas as a video.");
  }

  const stream = recordingCanvas.captureStream(safeFrameRate);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: SNAPSHOT_VIDEO_BITRATE,
  });
  const chunks: BlobPart[] = [];
  const frameIntervalMs = 1000 / safeFrameRate;

  const drawFrame = (frame: HTMLCanvasElement) => {
    if (recordingCanvas.width !== frame.width)
      recordingCanvas.width = Math.max(1, frame.width);
    if (recordingCanvas.height !== frame.height)
      recordingCanvas.height = Math.max(1, frame.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
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
  if (data.powerScale === "dBm") return "dBm";
  if (data.powerScale === "dB") return "dB";
  return data.dbMax > 20 ? "dBm" : "dB";
}

type SignalAreaBounds = Record<string, { min: number; max: number }>;

function formatVisibleChannels(
  range: Range,
  signalAreaBounds?: SignalAreaBounds | null,
): string | null {
  if (!signalAreaBounds) return null;

  const visibleChannels = Object.entries(signalAreaBounds)
    .map(([name, bounds]) => {
      const channelMin = Math.min(bounds.min, bounds.max);
      const channelMax = Math.max(bounds.min, bounds.max);
      if (
        !Number.isFinite(channelMin) ||
        !Number.isFinite(channelMax) ||
        !(channelMax > channelMin)
      ) {
        return null;
      }

      const visibleMin = Math.max(channelMin, range.min);
      const visibleMax = Math.min(channelMax, range.max);
      if (!(visibleMax > visibleMin)) return null;

      const isWhole =
        range.min <= channelMin + 1 && range.max >= channelMax - 1;
      const channelLabel = name.trim() ? name.trim().toUpperCase() : "Unknown";
      return {
        min: channelMin,
        label: `${channelLabel} (${isWhole ? "whole" : "partial"})`,
      };
    })
    .filter((entry): entry is { min: number; label: string } => entry !== null)
    .sort((a, b) => a.min - b.min);

  if (!visibleChannels.length) return null;
  return `Channels ${visibleChannels.map((channel) => channel.label).join(", ")}`;
}

export function buildSnapshotStatsLines({
  range,
  timestampLabel,
  deviceName,
  channelName,
  fftSize,
  fftWindow,
  gain,
  ppm,
  gainLabel,
  modeLabel,
  activeSignalAreaBounds,
  signalAreaBounds,
  hardwareSampleRateHz,
  showGeolocation,
  geolocation,
  locationLabel,
  whole,
}: {
  range: Range;
  timestampLabel: string;
  deviceName?: string;
  channelName?: string;
  fftSize?: number | string;
  fftWindow?: string;
  gain?: number;
  ppm?: number;
  gainLabel?: string;
  modeLabel?: string;
  activeSignalAreaBounds?: { min: number; max: number } | null;
  signalAreaBounds?: SignalAreaBounds | null;
  hardwareSampleRateHz?: number;
  showGeolocation?: boolean;
  geolocation?: { lat: string; lon: string } | null;
  locationLabel?: string | null;
  whole?: boolean;
}): string[] {
  const renderedSpanHz = range.max - range.min;
  const activeChannelSpanHz =
    Number.isFinite(activeSignalAreaBounds?.max ?? Number.NaN) &&
    Number.isFinite(activeSignalAreaBounds?.min ?? Number.NaN)
      ? activeSignalAreaBounds!.max - activeSignalAreaBounds!.min
      : null;
  const wholeBySpan =
    activeChannelSpanHz != null &&
    Number.isFinite(renderedSpanHz) &&
    renderedSpanHz >= activeChannelSpanHz - 1;
  const wholeBySampleRate =
    !/rtl[- ]?sdr/i.test(deviceName ?? "") &&
    Number.isFinite(hardwareSampleRateHz ?? Number.NaN) &&
    Number.isFinite(renderedSpanHz) &&
    renderedSpanHz >= (hardwareSampleRateHz ?? 0) - 1;
  const isWholeChannel =
    modeLabel === "Whole Channel" || whole || wholeBySpan || wholeBySampleRate;

  const channelLabel =
    formatVisibleChannels(range, signalAreaBounds) ??
    (channelName
      ? isWholeChannel
        ? `Whole Channel ${channelName}`
        : `Onscreen / partial Channel ${channelName}`
      : "Onscreen");
  const fftWindowLabel =
    fftWindow && fftWindow !== "Rectangular" ? ` | Window: ${fftWindow}` : "";
  const gainValue = Number.isFinite(gain ?? Number.NaN)
    ? `${gain!.toFixed(1)}dB`
    : null;
  const ppmValue = Number.isFinite(ppm ?? Number.NaN) ? `${ppm}` : null;
  const derivedGainLabel =
    gainValue || ppmValue
      ? `Gain: ${gainValue ?? "Auto"} | PPM: ${ppmValue ?? "0"}`
      : null;
  const formatSnapshotRangeFrequency = (hz: number) =>
    formatFrequency(hz, {
      precisionMHz: 4,
      precisionKHz: 2,
      trimTrailingZeros: true,
    });
  const lines = [
    `${formatSnapshotRangeFrequency(range.min)} – ${formatSnapshotRangeFrequency(range.max)}`,
    timestampLabel,
    `Device Name: ${deviceName || "Unknown"}`,
    channelLabel,
    `FFT size (# of points): ${fftSize ?? "?"}${fftWindowLabel}`,
    gainLabel ?? derivedGainLabel ?? "Gain: Auto | PPM: 0",
  ];

  if (showGeolocation && geolocation) {
    lines.push(formatSnapshotLocationLine(geolocation, locationLabel));
  }

  return lines;
}

type SpectrumGeometry = {
  dpr: number;
  logicalW: number;
  logicalH: number;
  fontScale: number;
  zoom: number;
  mapper: CoordinateMapper;
};

function computeSpectrumGeometry(
  data: SnapshotData,
  frequencyRange: Range,
  pixelWidth: number,
  pixelHeight: number,
  fullCaptureRange?: Range,
): SpectrumGeometry {
  const dpr = window.devicePixelRatio || 1;
  const logicalW = pixelWidth / dpr;
  const logicalH = pixelHeight / dpr;
  const plotLeft = Math.max(FFT_AREA_MIN.x, 52);
  // Match the WebGPU renderer's exact plot area: top = FFT_AREA_MIN.y, bottom = logicalH - 40
  // The live GPU renderer uses: fftAreaMax.y = logicalHeight - 40, plotTop = FFT_AREA_MIN.y
  const PLOT_BOTTOM_MARGIN = 40;

  // Calculate font scale based on aspect ratio (visual-only, does not affect plot bounds)
  const defaultLogicalH = 400;
  const heightRatio = logicalH / defaultLogicalH;
  // Use gentle scaling: 1 + 0.25 of the extra ratio, capped at 1.4x max
  const fontScale = Math.min(1.4, 1 + 0.25 * (heightRatio - 1));

  const fullSpan = fullCaptureRange
    ? fullCaptureRange.max - fullCaptureRange.min
    : 0;
  const viewBandwidth = frequencyRange.max - frequencyRange.min;
  const zoom = fullSpan > 0 ? fullSpan / viewBandwidth : 1;

  const mapper = new CoordinateMapper(
    {
      x: plotLeft,
      y: FFT_AREA_MIN.y,
      width: logicalW - 40 - plotLeft,
      height: logicalH - PLOT_BOTTOM_MARGIN - FFT_AREA_MIN.y,
    },
    frequencyRange,
    { min: data.dbMin, max: data.dbMax },
    dpr,
  );

  return { dpr, logicalW, logicalH, fontScale, zoom, mapper };
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
  crispTrace: boolean = false,
  forceTraceSteps: boolean = false,
  activeSignalAreaBounds?: { min: number; max: number } | null,
  activeSignalAreaLabel?: string,
  pool?: ScratchCanvasPool | null,
): HTMLCanvasElement | string {
  const { dpr, logicalW, logicalH, fontScale, zoom, mapper } =
    computeSpectrumGeometry(
      data,
      frequencyRange,
      pixelWidth,
      pixelHeight,
      fullCaptureRange,
    );

  if (!theme) throw new Error("Snapshot theme is required");
  const renderer = new SnapshotRenderer(mapper, theme);

  if (format === "svg") {
    const dc = new SVGDrawingContext(logicalW, logicalH);
    renderToDC(
      dc,
      renderer,
      data,
      frequencyRange,
      showGrid,
      fullCaptureRange,
      statsLines,
      waveform,
      fontScale,
      zoom,
      crispTrace,
      forceTraceSteps,
      activeSignalAreaBounds,
      activeSignalAreaLabel,
    );
    return dc.getSVG();
  } else {
    const canvas = acquireCanvas(pool, "spectrum", pixelWidth, pixelHeight);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dc = new CanvasDrawingContext(ctx);
    renderToDC(
      dc,
      renderer,
      data,
      frequencyRange,
      showGrid,
      fullCaptureRange,
      statsLines,
      waveform,
      fontScale,
      zoom,
      crispTrace,
      forceTraceSteps,
      activeSignalAreaBounds,
      activeSignalAreaLabel,
    );
    return canvas;
  }
}

function getDbMarkers(data: SnapshotData): number[] {
  const vertRange = 10;
  const startLabel = Math.floor(data.dbMax / vertRange) * vertRange;
  const markers = [data.dbMax];
  for (let line = startLabel; line >= data.dbMin - 1; line -= vertRange) {
    if (Math.abs(line - data.dbMax) < 0.1) continue;
    markers.push(line);
  }
  return markers;
}

/**
 * Chrome drawn beneath the trace: background, axes, grid and dB markers.
 *
 * Split out from the trace so video recording can cache it — none of it
 * changes between frames unless the plot geometry or dB window changes.
 */
function drawSnapshotUnderlay(
  dc: DrawingContext,
  renderer: SnapshotRenderer,
  data: SnapshotData,
  showGrid: boolean,
  fontScale: number = 1,
): void {
  const markers = getDbMarkers(data);
  renderer.drawBackground(dc);
  renderer.drawAxes(dc);
  if (showGrid) renderer.drawGridLines(dc, markers);
  renderer.drawDbMarkers(dc, markers, getDbUnit(data), fontScale);
}

function drawSnapshotTrace(
  dc: DrawingContext,
  renderer: SnapshotRenderer,
  traceWaveform: Float32Array | null | undefined,
  crispTrace: boolean,
  forceTraceSteps: boolean,
): void {
  if (!traceWaveform?.length) return;
  renderer.drawTrace(dc, traceWaveform, undefined, {
    crispTrace,
    forceSteps: forceTraceSteps,
  });
}

/**
 * Chrome drawn above the trace: hardware-rate grid, frequency axis labels and
 * channel bounds. Also cacheable across recorded frames.
 */
function drawSnapshotOverlay(
  dc: DrawingContext,
  renderer: SnapshotRenderer,
  data: SnapshotData,
  frequencyRange: Range,
  fullCaptureRange?: Range,
  fontScale: number = 1,
  zoom: number = 1,
  activeSignalAreaBounds?: { min: number; max: number } | null,
  activeSignalAreaLabel?: string,
): void {
  renderer.drawHardwareGrid(
    dc,
    data.hardwareSampleRateHz || 0,
    fullCaptureRange,
  );
  const channelSpan = activeSignalAreaBounds
    ? activeSignalAreaBounds.max - activeSignalAreaBounds.min
    : 0;
  const hardwareSampleRateHz = data.hardwareSampleRateHz ?? 0;
  const shouldDrawChannelBounds =
    activeSignalAreaBounds != null &&
    Number.isFinite(channelSpan) &&
    channelSpan > 0 &&
    Number.isFinite(hardwareSampleRateHz) &&
    hardwareSampleRateHz > channelSpan + 1 &&
    frequencyRange.min <= activeSignalAreaBounds.min + 1 &&
    frequencyRange.max >= activeSignalAreaBounds.max - 1;

  renderer.drawFrequencyLabels(
    dc,
    zoom,
    (frequencyRange.min + frequencyRange.max) / 2,
    fontScale,
  );
  renderer.drawChannelBounds(
    dc,
    shouldDrawChannelBounds ? activeSignalAreaBounds : null,
    frequencyRange,
    activeSignalAreaLabel,
  );
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
  crispTrace: boolean = false,
  forceTraceSteps: boolean = false,
  activeSignalAreaBounds?: { min: number; max: number } | null,
  activeSignalAreaLabel?: string,
): void {
  drawSnapshotUnderlay(dc, renderer, data, showGrid, fontScale);
  drawSnapshotTrace(
    dc,
    renderer,
    waveform ?? data.waveform,
    crispTrace,
    forceTraceSteps,
  );
  drawSnapshotOverlay(
    dc,
    renderer,
    data,
    frequencyRange,
    fullCaptureRange,
    fontScale,
    zoom,
    activeSignalAreaBounds,
    activeSignalAreaLabel,
  );
}

export type SpectrumLayerCache = {
  key: string;
  underlay: HTMLCanvasElement | null;
  overlay: HTMLCanvasElement | null;
};

type SpectrumFrameArgs = {
  data: SnapshotData;
  frequencyRange: Range;
  showGrid: boolean;
  pixelWidth: number;
  pixelHeight: number;
  fullCaptureRange?: Range;
  waveform: Float32Array;
  theme: SnapshotTheme;
  crispTrace: boolean;
  forceTraceSteps: boolean;
  activeSignalAreaBounds?: { min: number; max: number } | null;
  activeSignalAreaLabel?: string;
};

/**
 * Everything the cached chrome layers depend on. The waveform is deliberately
 * absent: it is the only input that changes between recorded frames.
 */
function spectrumLayerKey(args: SpectrumFrameArgs): string {
  const {
    data,
    frequencyRange: range,
    fullCaptureRange: capture,
    theme,
  } = args;
  return [
    args.pixelWidth,
    args.pixelHeight,
    window.devicePixelRatio || 1,
    args.showGrid,
    data.dbMin,
    data.dbMax,
    data.powerScale ?? "",
    data.hardwareSampleRateHz ?? 0,
    range.min,
    range.max,
    capture?.min ?? "",
    capture?.max ?? "",
    args.activeSignalAreaBounds?.min ?? "",
    args.activeSignalAreaBounds?.max ?? "",
    args.activeSignalAreaLabel ?? "",
    theme.bg,
    theme.grid,
    theme.line,
    theme.shadow,
    theme.text,
    theme.hwLine,
    theme.hwText,
    theme.cfText,
  ].join("|");
}

/**
 * Render a spectrum frame by compositing cached chrome around a freshly drawn
 * trace.
 *
 * The background, grid, dB markers, frequency axis labels, hardware-rate grid
 * and channel bounds are all static for the duration of a recording, and text
 * rasterisation is the most expensive part of the frame. Caching them turns a
 * full re-render into two blits plus one path.
 */
function renderLayeredSpectrumFrame(
  args: SpectrumFrameArgs,
  pool: ScratchCanvasPool,
  layers: SpectrumLayerCache,
): HTMLCanvasElement {
  const {
    data,
    frequencyRange,
    showGrid,
    pixelWidth,
    pixelHeight,
    fullCaptureRange,
    waveform,
    theme,
    crispTrace,
    forceTraceSteps,
    activeSignalAreaBounds,
    activeSignalAreaLabel,
  } = args;

  const { dpr, fontScale, zoom, mapper } = computeSpectrumGeometry(
    data,
    frequencyRange,
    pixelWidth,
    pixelHeight,
    fullCaptureRange,
  );
  const renderer = new SnapshotRenderer(mapper, theme);

  const key = spectrumLayerKey(args);
  if (layers.key !== key || !layers.underlay || !layers.overlay) {
    layers.underlay = renderDetachedLayer(pixelWidth, pixelHeight, dpr, (dc) =>
      drawSnapshotUnderlay(dc, renderer, data, showGrid, fontScale),
    );
    layers.overlay = renderDetachedLayer(pixelWidth, pixelHeight, dpr, (dc) =>
      drawSnapshotOverlay(
        dc,
        renderer,
        data,
        frequencyRange,
        fullCaptureRange,
        fontScale,
        zoom,
        activeSignalAreaBounds,
        activeSignalAreaLabel,
      ),
    );
    layers.key = key;
  }

  const canvas = pool.acquire("spectrumFrame", pixelWidth, pixelHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (layers.underlay) ctx.drawImage(layers.underlay, 0, 0);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSnapshotTrace(
    new CanvasDrawingContext(ctx),
    renderer,
    waveform,
    crispTrace,
    forceTraceSteps,
  );

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (layers.overlay) ctx.drawImage(layers.overlay, 0, 0);

  return canvas;
}

/**
 * Layers are retained across frames, so they cannot come from the frame pool.
 */
function renderDetachedLayer(
  pixelWidth: number,
  pixelHeight: number,
  dpr: number,
  draw: (dc: DrawingContext) => void,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, pixelWidth);
  canvas.height = Math.max(1, pixelHeight);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(new CanvasDrawingContext(ctx));
  }
  return canvas;
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
    Math.min(colormap.length - 1, normalized * (colormap.length - 1)),
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

/**
 * ABGR lookup table per colormap. Rebuilding it costs 256 interpolations, which
 * is wasted work when the same colormap is used for every recorded frame.
 */
const waterfallLutCache = new WeakMap<number[][], Uint32Array>();

function getWaterfallLut(colormap: number[][]): Uint32Array {
  const cached = waterfallLutCache.get(colormap);
  if (cached) return cached;

  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = dbToColor(i, 0, 255, colormap);
    // On Little Endian systems, Uint32Array is ABGR: 0xAABBGGRR
    lut[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  }
  waterfallLutCache.set(colormap, lut);
  return lut;
}

function drawWaterfallToCanvas(
  canvas: HTMLCanvasElement,
  textureSnapshot: Uint8Array,
  meta: { width: number; height: number; writeRow: number },
  dbMin: number,
  dbMax: number,
  colormap: number[][],
  options?: {
    marginX?: number;
    marginY?: number;
    noBackground?: boolean;
    waterfallBg?: string;
    pool?: ScratchCanvasPool | null;
  },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const lw = canvas.width / dpr;
  const lh = canvas.height / dpr;
  const marginStart =
    options?.marginX !== undefined ? options.marginX : FFT_AREA_MIN.x;
  const marginEnd = options?.marginX !== undefined ? options.marginX : 40;
  const marginY = options?.marginY ?? 8;

  const displayW = Math.max(1, Math.round(lw - marginStart - marginEnd));
  const displayH = Math.max(1, Math.round(lh - marginY * 2));

  const textureBinsPerRow = meta.width;
  const totalRows = meta.height;

  // 1. Create a data-sized offscreen canvas to avoid per-pixel JS loops over the display resolution
  const dataCanvas = acquireCanvas(
    options?.pool,
    "waterfallData",
    textureBinsPerRow,
    totalRows,
  );
  const dataCtx = dataCanvas.getContext("2d");
  if (!dataCtx) return;

  const dataImgData = dataCtx.createImageData(textureBinsPerRow, totalRows);
  const pixels32 = new Uint32Array(dataImgData.data.buffer);

  // Use a Float32Array view to avoid expensive DataView allocations in the loop
  const floatView = new Float32Array(
    textureSnapshot.buffer,
    textureSnapshot.byteOffset,
    textureSnapshot.byteLength / 4,
  );

  const lut = getWaterfallLut(colormap);

  // Inline normalizeWaterfallDbForColor's on-screen branch with hoisted
  // constants: this runs once per texel (bins × rows) on every recorded frame.
  const span = Math.max(dbMax - dbMin, 0.001);
  const onscreenScale = (255 * WATERFALL_ONSCREEN_COLOR_MAX) / span;
  const onscreenCeiling = Math.round(255 * WATERFALL_ONSCREEN_COLOR_MAX);

  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    // FIFO: newest row at top (rowIdx=0), oldest at bottom
    const textureRow =
      (((meta.writeRow - 1 - rowIdx) % totalRows) + totalRows) % totalRows;
    const rowOffset = textureRow * textureBinsPerRow;
    const outOffset = rowIdx * textureBinsPerRow;

    for (let binIdx = 0; binIdx < textureBinsPerRow; binIdx++) {
      const dbVal = floatView[rowOffset + binIdx];
      let lutIdx: number;
      if (dbVal <= dbMin) {
        lutIdx = 0;
      } else if (dbVal <= dbMax) {
        lutIdx = Math.round((dbVal - dbMin) * onscreenScale);
        if (lutIdx > onscreenCeiling) lutIdx = onscreenCeiling;
      } else {
        lutIdx = Math.round(
          normalizeWaterfallDbForColor(dbVal, dbMin, dbMax) * 255,
        );
        if (lutIdx > 255) lutIdx = 255;
      }

      pixels32[outOffset + binIdx] = lut[lutIdx];
    }
  }

  dataCtx.putImageData(dataImgData, 0, 0);

  // 2. Draw the data-sized canvas to the main canvas using hardware-accelerated scaling
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false; // Keep the pixelated look for signal analysis
  ctx.drawImage(
    dataCanvas,
    0,
    0,
    textureBinsPerRow,
    totalRows,
    marginStart,
    marginY,
    displayW,
    displayH,
  );
}

function drawWaterfallFrom2DBuffer(
  canvas: HTMLCanvasElement,
  waterfallBuffer: Uint8ClampedArray,
  dims: { width: number; height: number },
  options?: {
    marginX?: number;
    marginY?: number;
    noBackground?: boolean;
    waterfallBg?: string;
    pool?: ScratchCanvasPool | null;
  },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const lw = canvas.width / dpr;
  const lh = canvas.height / dpr;
  const marginStart =
    options?.marginX !== undefined ? options.marginX : FFT_AREA_MIN.x;
  const marginEnd = options?.marginX !== undefined ? options.marginX : 40;
  const marginY = options?.marginY ?? 8;

  const displayW = Math.max(1, Math.round(lw - marginStart - marginEnd));
  const displayH = Math.max(1, Math.round(lh - marginY * 2));

  // Use an offscreen canvas to scale the buffer correctly using drawImage
  const dataCanvas = acquireCanvas(
    options?.pool,
    "waterfallData",
    dims.width,
    dims.height,
  );
  const dataCtx = dataCanvas.getContext("2d");
  if (!dataCtx) return;

  const imageData = dataCtx.createImageData(dims.width, dims.height);
  imageData.data.set(waterfallBuffer);
  dataCtx.putImageData(imageData, 0, 0);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    dataCanvas,
    0,
    0,
    dims.width,
    dims.height,
    marginStart,
    marginY,
    displayW,
    displayH,
  );
}

export function renderWaterfallSnapshotCanvas(
  data: SnapshotData,
  pixelWidth: number,
  pixelHeight: number,
  options?: {
    marginX?: number;
    marginY?: number;
    noBackground?: boolean;
    waterfallBg?: string;
    pool?: ScratchCanvasPool | null;
  },
): HTMLCanvasElement | null {
  const canvas = acquireCanvas(
    options?.pool,
    "waterfallOut",
    pixelWidth,
    pixelHeight,
  );

  if (options?.waterfallBg && !options?.noBackground) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = options.waterfallBg;
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    }
  }

  if (data.waterfallTextureSnapshot && data.waterfallTextureMeta) {
    drawWaterfallToCanvas(
      canvas,
      data.waterfallTextureSnapshot,
      data.waterfallTextureMeta,
      data.dbMin,
      data.dbMax,
      data.colormap?.length ? data.colormap : WATERFALL_COLORMAPS.classic,
      options,
    );
    return canvas;
  }

  if (data.waterfallBuffer && data.waterfallDims) {
    drawWaterfallFrom2DBuffer(
      canvas,
      data.waterfallBuffer,
      data.waterfallDims,
      options,
    );
    return canvas;
  }

  return null;
}

export function renderSpectrumSnapshotCanvas(
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
  crispTrace: boolean = false,
  forceTraceSteps: boolean = false,
  activeSignalAreaBounds?: { min: number; max: number } | null,
  activeSignalAreaLabel?: string,
  pool?: ScratchCanvasPool | null,
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
    crispTrace,
    forceTraceSteps,
    activeSignalAreaBounds,
    activeSignalAreaLabel,
    pool,
  ) as HTMLCanvasElement;
}

export function composeWholeChannelWaterfallCanvas(
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
  const plotPixelW = Math.round(
    (pixelWidth / dpr - marginStart - marginEnd) * dpr,
  );
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
      { marginX: 0, marginY: 0, noBackground: true, waterfallBg },
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

export async function composeWholeChannelSpectrumCanvas(
  segments: WholeChannelSnapshotSegment[],
  fullRange: Range,
  showGrid: boolean,
  pixelWidth: number,
  pixelHeight: number,
  fullCaptureRange?: Range,
  statsLines?: string[],
  theme?: SnapshotTheme,
  stitchOptions?: { jsAntiAliasing: boolean; jsNoiseFloorMatching: boolean },
  crispTrace: boolean = false,
  activeSignalAreaBounds?: { min: number; max: number } | null,
  activeSignalAreaLabel?: string,
): Promise<HTMLCanvasElement | null> {
  if (!segments.length) return null;

  const totalSpan = fullRange.max - fullRange.min;
  if (!(totalSpan > 0)) return null;
  const first = segments[0];
  const stitched = await stitchWholeChannelWaveform(
    segments.flatMap((segment) => {
      const waveform = segment.data.waveform;
      return waveform?.length
        ? [
            {
              waveform,
              visualRange: segment.visualRange,
              dbMin: segment.data.dbMin,
            },
          ]
        : [];
    }),
    fullRange,
    getAntiAliasingParams(stitchOptions),
  );

  if (!stitched.length) return null;

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
    undefined,
    crispTrace,
    false,
    activeSignalAreaBounds,
    activeSignalAreaLabel,
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

  const sanitizedViewBox = escapeAttr(sanitizeViewBox(viewBox));
  const sanitizedContent = sanitizeSVG(content);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sanitizedViewBox}">
  <defs>
    <symbol id="spectrum-snapshot" viewBox="${sanitizedViewBox}" preserveAspectRatio="xMidYMid meet">
      ${sanitizedContent}
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
    // Sanitize frame content using DOMPurify
    const content = sanitizeSVG(extractSvgContent(frameContent));
    const frameStartTime = escapeAttr(
      sanitizeNumeric((index / frameCount) * totalDurationSeconds),
    );
    const sanitizedIndex = escapeAttr(sanitizeNumeric(index));
    const sanitizedDuration = escapeAttr(sanitizeNumeric(totalDurationSeconds));

    // Fade in at start, hold, fade out at end
    frameGroups += `  <g id="frame-${sanitizedIndex}" opacity="0">
    ${content}
    <animate attributeName="opacity" 
      values="0;1;1;0" 
      dur="${sanitizedDuration}s" 
      begin="${frameStartTime}s" 
      repeatCount="indefinite" />
  </g>\n`;
  });

  // Build the animated content with fallback
  const animatedContent = `  <!-- Fallback: first frame (shown when animations are not supported) -->
  <g id="fallback" class="fallback-frame">
    ${sanitizeSVG(firstFrameContent)}
  </g>
  <!-- Animated frames -->
${frameGroups}`;

  const sanitizedViewBox = escapeAttr(sanitizeViewBox(viewBox));
  const sanitizedWidth = escapeAttr(sanitizeNumeric(width));
  const sanitizedHeight = escapeAttr(sanitizeNumeric(height));

  // Wrap in symbol structure for reusability
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sanitizedViewBox}" width="${sanitizedWidth}" height="${sanitizedHeight}">
  <defs>
    <symbol id="animated-spectrum-snapshot" viewBox="${sanitizedViewBox}" preserveAspectRatio="xMidYMid meet">
${animatedContent}
    </symbol>
  </defs>
  <!-- Display the symbol by default -->
  <use href="#animated-spectrum-snapshot" width="100%" height="100%"/>
  <!-- Or reference it externally with: <use href="snapshot.svg#animated-spectrum-snapshot"/> -->
</svg>`;
}

// ── VFO Overlay and Fast Canvas Helpers ─────────────────────────────────────

// getComputedStyle forces a style recalculation, which is far too expensive to
// repeat for every overlay colour on every recorded frame. Theme changes are
// picked up on the next refresh window.
const CSS_COLOR_CACHE_MS = 500;
const cssColorCache = new Map<string, string>();
let cssColorCacheStamp = 0;

const readCssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined" || typeof document === "undefined")
    return fallback;

  const now = performance.now();
  if (now - cssColorCacheStamp > CSS_COLOR_CACHE_MS) {
    cssColorCache.clear();
    cssColorCacheStamp = now;
  }

  const cached = cssColorCache.get(name);
  if (cached !== undefined) return cached;

  const value =
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback;
  cssColorCache.set(name, value);
  return value;
};

export function drawDemodFocusOnContext2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frequencyRange: { min: number; max: number },
  demodFocus: DemodFocusOverlay | null | undefined,
  plotTop: number,
  plotBottom: number,
  plotLeft: number,
  plotRight: number,
) {
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

  if (bandMax <= minFreq || bandMin >= maxFreq) return;

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
  const dpr = window.devicePixelRatio || 1;
  const canvasTheme = {
    centerLineColor: readCssColor("--color-fft-center-line", "#ffff00"),
    spectrumOverlay: readCssColor(
      "--color-spectrum-overlay",
      "rgba(255, 255, 255, 0.08)",
    ),
    spectrumOverlayBorder: readCssColor(
      "--color-spectrum-overlay-border",
      "rgba(37, 64, 105, 0.78)",
    ),
  };

  // 1. Center Line (Themed)
  const centerLineX = freqToX(centerFrequencyHz);
  if (centerLineX >= plotLeft && centerLineX <= plotRight) {
    ctx.save();
    ctx.strokeStyle = canvasTheme.centerLineColor;
    ctx.lineWidth = Math.max(1, 2.5 / dpr);
    ctx.setLineDash([]); // Solid center line
    ctx.beginPath();
    ctx.moveTo(centerLineX, plotTop);
    ctx.lineTo(centerLineX, plotBottom);
    ctx.stroke();
    ctx.restore();
  }

  // 2. Background Highlight
  ctx.fillStyle = canvasTheme.spectrumOverlay;
  ctx.fillRect(leftX, plotTop, bandWidth, plotBottom - plotTop);

  // 3. Boundary lines (Dotted)
  ctx.strokeStyle = canvasTheme.spectrumOverlayBorder;
  ctx.lineWidth = Math.max(1, 2 / dpr);
  ctx.setLineDash([4, 4]);
  ctx.lineCap = "round";

  for (const x of [leftX, rightX]) {
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
  }

  // 4. Drawing text labels and markers box
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "bold 12px JetBrains Mono";

  const labelWidth = Math.max(
    ctx.measureText(label).width,
    ctx.measureText(subLabel).width,
  );
  const labelX = Math.max(
    plotLeft + labelWidth / 2 + 8,
    Math.min(plotRight - labelWidth / 2 - 8, centerX),
  );

  // Multi-line Label Background (Opaque white)
  const labelHeight = 38;
  ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
  ctx.fillRect(
    labelX - labelWidth / 2 - 8,
    plotTop + 10,
    labelWidth + 16,
    labelHeight,
  );

  ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    labelX - labelWidth / 2 - 8,
    plotTop + 10,
    labelWidth + 16,
    labelHeight,
  );

  ctx.fillStyle = "#07111f"; // Dark text on light label bg
  ctx.fillText(label, labelX, plotTop + 13);

  ctx.font = "bold 9px JetBrains Mono";
  ctx.fillStyle = "rgba(7, 17, 31, 0.8)";
  ctx.fillText(subLabel, labelX, plotTop + 28);

  ctx.restore();
}

export const FAST_WATERFALL_VFO_HEADER_HEIGHT = 48;

const FAST_FALLBACK_THEME: SnapshotTheme = {
  bg: "#05070d",
  grid: "rgba(110, 163, 255, 0.35)",
  line: "rgba(110, 163, 255, 0.35)",
  shadow: "rgba(0, 0, 0, 0)",
  text: "rgba(238, 243, 251, 0.7)",
  hwLine: "rgba(0, 0, 0, 0)",
  hwText: "rgba(0, 0, 0, 0)",
  cfText: "#eef3fb",
};

function drawFastSpectrumSnapshotCenterLabel(
  canvas: HTMLCanvasElement,
  frequencyRange: { min: number; max: number } | null | undefined,
  theme?: SnapshotTheme,
): void {
  if (!frequencyRange) return;
  const bandwidth = frequencyRange.max - frequencyRange.min;
  if (!(bandwidth > 0)) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;
  const plotLeft = FFT_AREA_MIN.x;
  const plotRight = logicalW - 40;
  const plotBottom = logicalH - 40;
  const centerFrequencyHz = (frequencyRange.min + frequencyRange.max) / 2;
  const centerX =
    plotLeft +
    ((centerFrequencyHz - frequencyRange.min) / bandwidth) *
      Math.max(1, plotRight - plotLeft);
  const labelY = plotBottom + 25;
  const stepHz = findBestFrequencyRange(bandwidth, 10);
  const useHighRes = bandwidth / Math.max(stepHz, 1) >= 100;
  const centerText = formatVfoAxisCenterLabel(
    centerFrequencyHz,
    useHighRes,
    stepHz,
  );
  const centerFontPx = centerText.includes("GHz") ? 11 : 12;
  const oldLabel = `👋  ${centerText}`;
  const nextLabel = `○  ${centerText}`;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "bold 12px JetBrains Mono, monospace";
  ctx.textBaseline = "alphabetic";
  const clearWidth =
    Math.max(
      ctx.measureText(oldLabel).width,
      ctx.measureText(nextLabel).width,
    ) + 28;
  ctx.fillStyle = theme?.bg ?? "rgba(10, 10, 10, 1)";
  ctx.fillRect(centerX - clearWidth / 2, labelY - 22, clearWidth, 34);

  drawVfoAxis({
    ctx: createCanvasVfoAxisContext(ctx),
    frequencyRange,
    centerFrequencyHz,
    bounds: {
      left: plotLeft,
      right: plotRight,
      top: FFT_AREA_MIN.y,
      bottom: plotBottom,
    },
    y: plotBottom,
    labelY,
    tickDirection: "down",
    showAxisLine: false,
    showEdgeLabels: false,
    showTickMarks: false,
    showTickLabels: false,
    showCenterLine: false,
    showCenterTick: false,
    icon: "circle",
    theme: {
      tick: theme?.text ?? "#ffffff",
      label: theme?.text ?? "#ffffff",
      center: theme?.cfText ?? "#ffffff",
    },
    fontPx: 12,
    centerFontPx,
    textBaseline: "alphabetic",
    useHighResLabels: useHighRes,
    vfoOptions: {
      visualState: "snapshot",
      drawingType: "canvas",
      orientation: "bottom",
      tickPrecision: "default",
    },
  });
  ctx.restore();
}

function cropCanvasVerticalInset(
  source: HTMLCanvasElement,
  insetPx: number,
  pool?: ScratchCanvasPool | null,
): HTMLCanvasElement {
  const inset = Math.max(0, Math.min(insetPx, Math.floor(source.height / 2)));
  if (inset === 0 || source.height <= inset * 2) {
    return source;
  }

  const canvas = acquireCanvas(
    pool,
    "verticalInset",
    source.width,
    source.height - inset * 2,
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    0,
    inset,
    source.width,
    canvas.height,
    0,
    0,
    source.width,
    canvas.height,
  );

  return canvas;
}

/**
 * Remembers how many transparent rows the previous frame had so a recording
 * loop can skip the pixel readback entirely on subsequent frames.
 */
export type TrimCache = { width: number; height: number; trimmed: number };

/**
 * Find the last row containing any opaque pixel, reading only the bottom of the
 * canvas and widening the band until an opaque row shows up. A full-canvas
 * getImageData stalls on GPU readback and allocates megabytes per call.
 */
function findLastOpaqueRow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  let bandHeight = Math.min(height, Math.max(16, Math.ceil(height / 8)));

  for (;;) {
    const bandTop = height - bandHeight;
    const band = ctx.getImageData(0, bandTop, width, bandHeight);
    const data = band.data;

    for (let row = bandHeight - 1; row >= 0; row--) {
      const rowStart = row * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[rowStart + x * 4 + 3] !== 0) return bandTop + row;
      }
    }

    if (bandHeight >= height) return -1;
    bandHeight = Math.min(height, bandHeight * 4);
  }
}

function trimTransparentBottomRows(
  source: HTMLCanvasElement,
  pool?: ScratchCanvasPool | null,
  cache?: TrimCache | null,
): HTMLCanvasElement {
  const ctx = source.getContext("2d");
  if (!ctx || source.width <= 0 || source.height <= 0) return source;

  let trimmed: number;
  if (
    cache &&
    cache.width === source.width &&
    cache.height === source.height &&
    cache.trimmed >= 0
  ) {
    trimmed = cache.trimmed;
  } else {
    const lastOpaqueRow = findLastOpaqueRow(ctx, source.width, source.height);
    trimmed = lastOpaqueRow < 0 ? 0 : source.height - 1 - lastOpaqueRow;
    if (cache) {
      cache.width = source.width;
      cache.height = source.height;
      cache.trimmed = trimmed;
    }
  }

  if (trimmed <= 0) return source;

  const height = source.height - trimmed;
  const canvas = acquireCanvas(pool, "trimmed", source.width, height);
  const outCtx = canvas.getContext("2d");
  if (!outCtx) return source;
  outCtx.drawImage(
    source,
    0,
    0,
    source.width,
    height,
    0,
    0,
    source.width,
    height,
  );
  return canvas;
}

type VideoSourceCanvases = ReturnType<
  NonNullable<SnapshotOptions["getVideoSourceCanvases"]>
>;

function buildLiveSpectrumSnapshotCanvas(
  canvases: VideoSourceCanvases | null | undefined,
  data: SnapshotData,
  frequencyRange: Range,
  showGrid: boolean,
  fullCaptureRange: Range | undefined,
  statsLines: string[],
  waveform: Float32Array,
  theme: SnapshotTheme,
  activeSignalAreaBounds?: { min: number; max: number } | null,
  activeSignalAreaLabel?: string,
): HTMLCanvasElement | null {
  const source = canvases?.spectrum;
  if (!source || source.width <= 0 || source.height <= 0) return null;

  return renderSpectrumSnapshotCanvas(
    data,
    frequencyRange,
    showGrid,
    source.width,
    source.height,
    fullCaptureRange,
    statsLines,
    waveform,
    theme,
    undefined,
    false,
    false,
    activeSignalAreaBounds,
    activeSignalAreaLabel,
  );
}

export function renderStatsRowCanvas(
  statsLines: string[],
  width: number,
  theme: SnapshotTheme,
  aspectRatio?: SnapshotAspectRatio,
  pool?: ScratchCanvasPool | null,
): HTMLCanvasElement | null {
  if (!statsLines.length) return null;

  const plotLeft = 52;
  const plotRight = 40;
  const padX = 12;
  const padY = 12;
  const fontBoost = aspectRatio && aspectRatio !== "default" ? 5 : 0;
  const baseFontSize = 17 + fontBoost;
  const lh = 24 + fontBoost;
  const lastLine = statsLines[statsLines.length - 1] ?? "";
  const hasFullWidthLocation =
    /^(?:Location:\s*)?[-+]?\d+(?:\.\d+)?,\s*[-+]?\d+(?:\.\d+)?(?:\s+–\s+.*)?$/.test(
      lastLine,
    );
  const columnLines = hasFullWidthLocation
    ? statsLines.slice(0, -1)
    : statsLines;
  const locationLine = hasFullWidthLocation ? lastLine : null;
  const splitIndex = Math.ceil(columnLines.length / 2);
  const leftLines = columnLines.slice(0, splitIndex);
  const rightLines = columnLines.slice(splitIndex);
  const columnRowCount = Math.max(leftLines.length, rightLines.length);
  const rowCount = columnRowCount + (locationLine ? 1 : 0);
  const dividerH = 1;
  const boxH = rowCount * lh + padY * 2 + dividerH;

  const canvas = acquireCanvas(pool, "statsRow", width, boxH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const divider = theme.grid;
  const textColor = theme.text;
  const rowBackground = theme.bg;
  const markerColor = textColor;
  const markerMutedColor = "rgba(0, 0, 0, 0.45)";

  ctx.fillStyle = rowBackground;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = divider;
  ctx.fillRect(
    plotLeft,
    0,
    Math.max(1, canvas.width - plotLeft - plotRight),
    dividerH,
  );

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${baseFontSize}px "JetBrains Mono", monospace`;

  const drawLine = (line: string, x: number, y: number) => {
    ctx.fillStyle = markerMutedColor;
    ctx.fillText("-", x, y);
    const pointWidth = ctx.measureText("-").width;
    ctx.fillStyle = markerColor;
    ctx.fillText(line, x + pointWidth + 4, y);
  };

  const availableWidth = Math.max(1, width - plotLeft - plotRight);
  const centerGap = Math.max(32, Math.round(availableWidth * 0.08));
  const leftColumnX = plotLeft;
  const rightColumnX = plotLeft + Math.round((availableWidth - centerGap) / 2);

  for (let i = 0; i < columnRowCount; i++) {
    const y = padY + (i + 0.8) * lh;
    if (leftLines[i]) drawLine(leftLines[i], leftColumnX, y);
    if (rightLines[i]) drawLine(rightLines[i], rightColumnX, y);
  }

  if (locationLine) {
    const y = padY + (columnRowCount + 0.8) * lh;
    drawLine(locationLine, leftColumnX, y);
  }

  return canvas;
}

function appendCanvasBelow(
  topCanvas: HTMLCanvasElement,
  bottomCanvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(topCanvas.width, bottomCanvas.width);
  canvas.height = topCanvas.height + bottomCanvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return topCanvas;
  ctx.drawImage(topCanvas, 0, 0);
  ctx.drawImage(bottomCanvas, 0, topCanvas.height);
  return canvas;
}

/**
 * Per-session reusable render targets for the fast snapshot path.
 *
 * Building a fast frame otherwise allocates four or five full-size canvases and
 * re-reads pixel data, which is what stalls frame progression while recording.
 * A scratch is only safe when each frame is consumed before the next is built.
 */
export type FastFrameScratch = {
  pool: ScratchCanvasPool;
  trim: TrimCache;
  statsKey: string;
  statsRow: HTMLCanvasElement | null;
  spectrumLayers: SpectrumLayerCache;
  axisKey: string;
  axisStrip: HTMLCanvasElement | null;
};

export function createFastFrameScratch(): FastFrameScratch {
  return {
    pool: new ScratchCanvasPool(),
    trim: { width: 0, height: 0, trimmed: -1 },
    statsKey: "",
    statsRow: null,
    spectrumLayers: { key: "", underlay: null, overlay: null },
    axisKey: "",
    axisStrip: null,
  };
}

export function disposeFastFrameScratch(scratch: FastFrameScratch): void {
  scratch.pool.dispose();
  scratch.statsRow = null;
  scratch.spectrumLayers = { key: "", underlay: null, overlay: null };
  scratch.axisStrip = null;
}

/**
 * Stats text only changes about once a second, so redraw the row when its
 * content actually changes and hand back the cached canvas otherwise.
 */
function renderReusableStatsRow(
  statsLines: string[],
  width: number,
  theme: SnapshotTheme,
  aspectRatio: SnapshotAspectRatio | undefined,
  scratch: FastFrameScratch | null | undefined,
): HTMLCanvasElement | null {
  if (!scratch) {
    return renderStatsRowCanvas(statsLines, width, theme, aspectRatio);
  }

  const key = `${width}|${aspectRatio ?? ""}|${theme.bg}|${theme.text}|${theme.grid}|${statsLines.join("\u0001")}`;
  if (scratch.statsKey === key && scratch.statsRow) return scratch.statsRow;

  scratch.statsRow = renderStatsRowCanvas(
    statsLines,
    width,
    theme,
    aspectRatio,
    scratch.pool,
  );
  scratch.statsKey = key;
  return scratch.statsRow;
}

export function buildFastSpectrumCanvas(
  snapshotData: SnapshotData | null,
  width: number,
  height: number,
  theme?: SnapshotTheme,
  canvases?: {
    spectrumGpu: HTMLCanvasElement | null;
    spectrumOverlay: HTMLCanvasElement | null;
  } | null,
  options?: {
    showStats?: boolean;
    showGeolocation?: boolean;
    geolocation?: { lat: string; lon: string } | null;
    locationLabel?: string | null;
    activeSignalArea?: string;
    signalAreaBounds?: Record<string, { min: number; max: number }> | null;
    activeSignalAreaBounds?: { min: number; max: number } | null;
    sourceName?: string;
    sdrSettingsLabel?: string;
    gain?: number;
    ppm?: number;
    fftSize?: number | string;
    aspectRatio?: SnapshotAspectRatio;
    scratch?: FastFrameScratch | null;
  },
): HTMLCanvasElement | null {
  if (
    !snapshotData ||
    !snapshotData.waveform ||
    snapshotData.waveform.length === 0
  ) {
    return null;
  }

  const { slicedWaveform, visualRange } =
    snapshotData.vizZoom > 1
      ? getZoomedSlice(
          snapshotData.waveform,
          snapshotData.frequencyRange,
          snapshotData.vizZoom,
          snapshotData.vizPanOffset,
        )
      : {
          slicedWaveform: snapshotData.waveform,
          visualRange: snapshotData.frequencyRange,
        };

  const statsLines = options?.showStats
    ? buildSnapshotStatsLines({
        range: visualRange,
        timestampLabel: fmtTimestamp(),
        deviceName:
          options?.sourceName ||
          (snapshotData.isDeviceConnected ? "SDR" : "Offline"),
        channelName: options?.activeSignalArea,
        activeSignalAreaBounds: options?.activeSignalAreaBounds,
        signalAreaBounds: options?.signalAreaBounds,
        whole: false,
        hardwareSampleRateHz: snapshotData.hardwareSampleRateHz,
        fftSize:
          options?.fftSize !== undefined
            ? options.fftSize
            : snapshotData.fftSize,
        fftWindow: snapshotData.fftWindow,
        gain: options?.gain,
        ppm: options?.ppm,
        gainLabel: options?.sdrSettingsLabel,
        showGeolocation: options?.showGeolocation ?? false,
        geolocation: options?.geolocation,
        locationLabel: options?.locationLabel,
      })
    : [];

  const scratch = options?.scratch ?? null;
  const resolvedTheme = theme ?? FAST_FALLBACK_THEME;
  const frameArgs: SpectrumFrameArgs = {
    data: { ...snapshotData, waveform: slicedWaveform },
    frequencyRange: visualRange,
    showGrid: true,
    pixelWidth: Math.max(1, width),
    pixelHeight: Math.max(1, height),
    fullCaptureRange: snapshotData.frequencyRange,
    waveform: slicedWaveform,
    theme: resolvedTheme,
    crispTrace: true,
    forceTraceSteps: false,
    activeSignalAreaBounds: options?.activeSignalAreaBounds,
    activeSignalAreaLabel: options?.activeSignalArea,
  };

  const spectrumCanvas = scratch
    ? renderLayeredSpectrumFrame(
        frameArgs,
        scratch.pool,
        scratch.spectrumLayers,
      )
    : renderSpectrumSnapshotCanvas(
        frameArgs.data,
        visualRange,
        true,
        frameArgs.pixelWidth,
        frameArgs.pixelHeight,
        snapshotData.frequencyRange,
        statsLines,
        slicedWaveform,
        theme,
        undefined,
        true,
        false,
        options?.activeSignalAreaBounds,
        options?.activeSignalArea,
      );

  if (!spectrumCanvas) {
    return null;
  }

  const statsRow = options?.showStats
    ? renderReusableStatsRow(
        statsLines,
        spectrumCanvas.width,
        resolvedTheme,
        options?.aspectRatio,
        scratch,
      )
    : null;

  if (!statsRow) {
    return trimTransparentBottomRows(
      spectrumCanvas,
      scratch?.pool,
      scratch?.trim,
    );
  }

  const composed = acquireCanvas(
    scratch?.pool,
    "spectrumComposed",
    spectrumCanvas.width,
    spectrumCanvas.height + statsRow.height,
  );
  const ctx = composed.getContext("2d");
  if (!ctx)
    return trimTransparentBottomRows(
      spectrumCanvas,
      scratch?.pool,
      scratch?.trim,
    );
  ctx.drawImage(spectrumCanvas, 0, 0);
  ctx.drawImage(statsRow, 0, spectrumCanvas.height);

  // Draw demodFocus overlay if present
  if (snapshotData.demodFocusOverlay) {
    const ctx = composed.getContext("2d");
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      const logicalW = composed.width / dpr;
      const logicalH = spectrumCanvas.height / dpr;
      const plotLeft = Math.max(FFT_AREA_MIN.x, 52);
      const plotRight = logicalW - 40;
      const plotTop = FFT_AREA_MIN.y;
      const plotBottom = logicalH - 40; // matching PLOT_BOTTOM_MARGIN inside renderSpectrumSnapshot
      drawDemodFocusOnContext2D(
        ctx,
        logicalW,
        logicalH,
        visualRange,
        snapshotData.demodFocusOverlay,
        plotTop,
        plotBottom,
        plotLeft,
        plotRight,
      );
    }
  }

  return trimTransparentBottomRows(composed, scratch?.pool, scratch?.trim);
}

export function drawFastWaterfallLabelStrip(
  ctx: CanvasRenderingContext2D,
  width: number,
  frequencyRange: { min: number; max: number } | null | undefined,
): void {
  // Fill background
  ctx.fillStyle = "rgba(10, 14, 22, 0.96)";
  ctx.fillRect(0, 0, width, FAST_WATERFALL_VFO_HEADER_HEIGHT);

  // Draw border
  ctx.strokeStyle = "rgba(110, 163, 255, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, FAST_WATERFALL_VFO_HEADER_HEIGHT - 1);

  if (!frequencyRange) {
    return;
  }

  const plotLeft = Math.max(FFT_AREA_MIN.x, 52);
  const plotRight = width - 40;
  const plotWidth = plotRight - plotLeft;

  const min = frequencyRange.min;
  const max = frequencyRange.max;
  const span = max - min;
  const center = calculateCenterFrequency(frequencyRange) ?? min + span / 2;
  const quarter1 = min + span * 0.25;
  const quarter3 = min + span * 0.75;

  // Draw dial axis line at y = 38
  ctx.strokeStyle = "rgba(110, 163, 255, 0.35)";
  ctx.beginPath();
  ctx.moveTo(plotLeft, 38);
  ctx.lineTo(plotRight, 38);
  ctx.stroke();

  // Draw major ticks: 7px tall, color rgba(110, 163, 255, 0.5) at y = 38 (going up to 31)
  ctx.strokeStyle = "rgba(110, 163, 255, 0.5)";
  ctx.beginPath();
  const majorXs = [
    plotLeft,
    plotLeft + plotWidth * 0.25,
    plotLeft + plotWidth * 0.5,
    plotLeft + plotWidth * 0.75,
    plotRight,
  ];
  for (const x of majorXs) {
    ctx.moveTo(x, 38);
    ctx.lineTo(x, 31);
  }
  ctx.stroke();

  // Draw 20 minor ticks: 4px tall, color rgba(110, 163, 255, 0.25) at y = 38 (going up to 34)
  // distributed evenly between the major ticks (5 ticks per interval)
  ctx.strokeStyle = "rgba(110, 163, 255, 0.25)";
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const xStart = plotLeft + i * (plotWidth / 4);
    for (let j = 1; j <= 5; j++) {
      const x = xStart + j * (plotWidth / 24);
      ctx.moveTo(x, 38);
      ctx.lineTo(x, 34);
    }
  }
  ctx.stroke();

  // Draw frequency labels at y = 18 using bold 13px 'JetBrains Mono', monospace
  const labels = [
    {
      x: plotLeft,
      align: "left" as const,
      text: formatFrequency(min, {
        showUnits: true,
        precisionMHz: 6,
        precisionGHz: 3,
        precisionKHz: 3,
        trimTrailingZeros: true,
      }),
    },
    {
      x: plotLeft + plotWidth * 0.25,
      align: "center" as const,
      text: formatFrequency(quarter1, {
        showUnits: true,
        precisionMHz: 6,
        precisionGHz: 3,
        precisionKHz: 3,
        trimTrailingZeros: true,
      }),
    },
    {
      x: plotLeft + plotWidth * 0.5,
      align: "center" as const,
      text: `○  ${formatFrequency(center, {
        showUnits: true,
        precisionMHz: 6,
        precisionGHz: 3,
        precisionKHz: 3,
        trimTrailingZeros: true,
      })}`,
      active: true,
    },
    {
      x: plotLeft + plotWidth * 0.75,
      align: "center" as const,
      text: formatFrequency(quarter3, {
        showUnits: true,
        precisionMHz: 6,
        precisionGHz: 3,
        precisionKHz: 3,
        trimTrailingZeros: true,
      }),
    },
    {
      x: plotRight,
      align: "right" as const,
      text: formatFrequency(max, {
        showUnits: true,
        precisionMHz: 6,
        precisionGHz: 3,
        precisionKHz: 3,
        trimTrailingZeros: true,
      }),
    },
  ];

  ctx.textBaseline = "middle";
  ctx.font = "bold 13px 'JetBrains Mono', monospace";
  for (const label of labels) {
    ctx.textAlign = label.align;
    ctx.fillStyle = label.active ? "#eef3fb" : "rgba(238, 243, 251, 0.7)";
    ctx.fillText(label.text, label.x, 18);
  }
}

function getSnapshotVisualFrequencyRange(
  snapshotData: SnapshotData | null,
  fallbackRange: { min: number; max: number } | null | undefined,
): { min: number; max: number } | null {
  if (!snapshotData) {
    return fallbackRange ?? null;
  }

  const baseRange = snapshotData.frequencyRange || fallbackRange;
  if (!baseRange) {
    return null;
  }

  if (
    snapshotData.vizZoom > 1 &&
    snapshotData.waveform &&
    snapshotData.waveform.length > 0
  ) {
    return getZoomedSlice(
      snapshotData.waveform,
      baseRange,
      snapshotData.vizZoom,
      snapshotData.vizPanOffset,
    ).visualRange;
  }

  return baseRange;
}

export function buildFastWaterfallCanvas(
  snapshotData: SnapshotData | null,
  width: number,
  height: number,
  frequencyRange: { min: number; max: number } | null | undefined,
  canvases?: {
    waterfallGpu: HTMLCanvasElement | null;
    waterfallOverlay: HTMLCanvasElement | null;
  } | null,
  axisTheme?: FrequencyAxisTheme,
  options?: {
    showStats?: boolean;
    showGeolocation?: boolean;
    geolocation?: { lat: string; lon: string } | null;
    locationLabel?: string | null;
    activeSignalArea?: string;
    signalAreaBounds?: Record<string, { min: number; max: number }> | null;
    activeSignalAreaBounds?: { min: number; max: number } | null;
    sourceName?: string;
    sdrSettingsLabel?: string;
    gain?: number;
    ppm?: number;
    fftSize?: number | string;
    aspectRatio?: SnapshotAspectRatio;
    scratch?: FastFrameScratch | null;
  },
  themeOption?: SnapshotTheme,
): HTMLCanvasElement | null {
  const scratch = options?.scratch ?? null;
  const pool = scratch?.pool ?? null;
  const fallbackAxisTheme =
    axisTheme ??
    buildFrequencyAxisTheme({
      colors: {
        background: "#05070d",
        border: "rgba(110, 163, 255, 0.35)",
        textMuted: "rgba(238, 243, 251, 0.7)",
        textSecondary: "rgba(238, 243, 251, 0.7)",
        textPrimary: "#eef3fb",
      },
    });

  const effectiveRange = getSnapshotVisualFrequencyRange(
    snapshotData,
    frequencyRange,
  );
  const statsLines =
    options?.showStats && snapshotData
      ? buildSnapshotStatsLines({
          range: effectiveRange ?? { min: 0, max: 1 },
          timestampLabel: fmtTimestamp(),
          deviceName:
            options?.sourceName ||
            (snapshotData.isDeviceConnected ? "SDR" : "Offline"),
          channelName: options?.activeSignalArea,
          activeSignalAreaBounds: options?.activeSignalAreaBounds,
          signalAreaBounds: options?.signalAreaBounds,
          whole: false,
          hardwareSampleRateHz: snapshotData.hardwareSampleRateHz,
          fftSize:
            options?.fftSize !== undefined
              ? options.fftSize
              : snapshotData.fftSize,
          fftWindow: snapshotData.fftWindow,
          gain: options?.gain,
          ppm: options?.ppm,
          gainLabel: options?.sdrSettingsLabel,
          showGeolocation: options?.showGeolocation ?? false,
          geolocation: options?.geolocation,
          locationLabel: options?.locationLabel,
        })
      : [];
  const sourceCanvas = renderFastWaterfallBase(
    snapshotData,
    width,
    height,
    canvases,
    pool,
    // Colourising the texture in JS costs bins × rows per frame; while
    // recording, blit the waterfall the GPU has already drawn instead.
    scratch != null,
  );

  const composed = composeFrequencyAxis(
    sourceCanvas ?? acquireCanvas(pool, "waterfallEmptyBase", 1, 1),
    effectiveRange ?? { min: 0, max: 1 },
    fallbackAxisTheme,
    scratch,
  );

  const statsRow = options?.showStats
    ? renderReusableStatsRow(
        statsLines,
        composed.width,
        themeOption ?? FAST_FALLBACK_THEME,
        options?.aspectRatio,
        scratch,
      )
    : null;

  if (statsRow) {
    const combined = acquireCanvas(
      pool,
      "waterfallCombined",
      composed.width,
      statsRow.height + composed.height,
    );
    const ctx = combined.getContext("2d");
    if (ctx) {
      ctx.drawImage(statsRow, 0, 0);
      ctx.drawImage(composed, 0, statsRow.height);
      return combined;
    }
  }

  if (snapshotData?.demodFocusOverlay && composed) {
    const ctx = composed.getContext("2d");
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      const plotLeft = Math.round(40 * dpr);
      const plotRight = composed.width - Math.round(40 * dpr);
      const plotTop = FAST_WATERFALL_VFO_HEADER_HEIGHT;
      const plotBottom = composed.height;

      drawDemodFocusOnContext2D(
        ctx,
        composed.width,
        composed.height,
        effectiveRange || { min: 0, max: 1 },
        snapshotData.demodFocusOverlay,
        plotTop,
        plotBottom,
        plotLeft,
        plotRight,
      );
    }
  }

  return composed;
}

/**
 * The waterfall image itself, either recoloured from the captured texture or
 * blitted from the canvas the GPU renderer already produced.
 */
function renderFastWaterfallBase(
  snapshotData: SnapshotData | null,
  width: number,
  height: number,
  canvases:
    | {
        waterfallGpu: HTMLCanvasElement | null;
        waterfallOverlay: HTMLCanvasElement | null;
      }
    | null
    | undefined,
  pool: ScratchCanvasPool | null,
  preferLiveCanvas: boolean,
): HTMLCanvasElement | null {
  const liveGpu = canvases?.waterfallGpu;
  const hasCapturedTexture =
    snapshotData != null &&
    (snapshotData.waterfallTextureSnapshot != null ||
      snapshotData.waterfallBuffer != null);

  if (liveGpu && (preferLiveCanvas || !hasCapturedTexture)) {
    // WebGPU canvases can read back blank after presenting, so the renderer
    // keeps the last presented frame alongside them.
    const srcGpu =
      (liveGpu as HTMLCanvasElement & { _lastFrameCanvas?: HTMLCanvasElement })
        ._lastFrameCanvas ?? liveGpu;
    const liveCanvas = acquireCanvas(
      pool,
      "waterfallLive",
      srcGpu.width,
      srcGpu.height,
    );
    const ctx = liveCanvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(srcGpu, 0, 0);
      if (canvases?.waterfallOverlay) {
        ctx.drawImage(canvases.waterfallOverlay, 0, 0);
      }
      return cropCanvasVerticalInset(
        liveCanvas,
        Math.round(8 * (window.devicePixelRatio || 1)),
        pool,
      );
    }
  }

  if (hasCapturedTexture && snapshotData) {
    return renderWaterfallSnapshotCanvas(
      snapshotData,
      Math.max(1, width),
      Math.max(1, height),
      { waterfallBg: "#05070d", marginX: 40, marginY: 0, pool },
    );
  }

  return null;
}

/**
 * Compose the waterfall under its frequency axis, caching the axis layer when a
 * recording scratch is supplied — the tick labels only change on retune.
 */
function composeFrequencyAxis(
  baseCanvas: HTMLCanvasElement,
  frequencyRange: { min: number; max: number },
  axisTheme: FrequencyAxisTheme,
  scratch: FastFrameScratch | null,
): HTMLCanvasElement {
  const centerFrequencyHz = calculateCenterFrequency(frequencyRange);
  const axisOptions = {
    frequencyRange,
    centerFrequencyHz,
    detail: "dense" as const,
    plotInsets: { left: 40, right: 40 },
    showBorder: false,
    tickDirection: "down" as const,
    theme: axisTheme,
  };

  if (!scratch) {
    return composeCanvasWithFrequencyAxis({ baseCanvas, ...axisOptions });
  }

  const axisHeight = getFrequencyAxisHeight("dense");
  const outputWidth = baseCanvas.width;
  const outputHeight = baseCanvas.height + axisHeight;
  const key = [
    outputWidth,
    outputHeight,
    frequencyRange.min,
    frequencyRange.max,
    centerFrequencyHz ?? "",
    axisTheme.background,
    axisTheme.center,
    axisTheme.label,
    axisTheme.tick,
    axisTheme.grid,
  ].join("|");

  if (scratch.axisKey !== key || !scratch.axisStrip) {
    scratch.axisStrip = renderFrequencyAxisLayer({
      ...axisOptions,
      outputWidth,
      outputHeight,
    });
    scratch.axisKey = key;
  }

  const output = scratch.pool.acquire(
    "waterfallComposed",
    outputWidth,
    outputHeight,
  );
  const ctx = output.getContext("2d");
  if (!ctx) return baseCanvas;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = axisTheme.background;
  ctx.fillRect(0, 0, outputWidth, outputHeight);
  ctx.drawImage(baseCanvas, 0, axisHeight);
  ctx.drawImage(scratch.axisStrip, 0, 0);

  return output;
}

const FAST_RECORDING_MAX_MS = 30_000;
const FAST_RECORDING_FRAME_RATE = 30;
const FRAME_INTERVAL_MS = 1000 / FAST_RECORDING_FRAME_RATE;

/**
 * On a HiDPI display the live canvas is often 3000+ device pixels wide. Both
 * the per-frame capture copy and the encoder scale with pixel count, so cap the
 * encoded size; the composite is still built at full resolution and downscaled.
 */
const FAST_RECORDING_MAX_ENCODE_WIDTH = 1920;
/**
 * Ceiling on the fraction of wall-clock time the capture loop may spend on the
 * main thread. Everything else is left to the live visualisation.
 */
const FAST_RECORDING_MAX_THREAD_SHARE = 0.25;
const FAST_RECORDING_MIN_BITRATE = 2_000_000;
const FAST_RECORDING_MAX_BITRATE = 12_000_000;

function getRecordingEncodeSize(
  frameWidth: number,
  frameHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, FAST_RECORDING_MAX_ENCODE_WIDTH / frameWidth);
  // H.264 requires even dimensions; odd sizes force the encoder to pad.
  const toEven = (value: number) =>
    Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: toEven(frameWidth), height: toEven(frameHeight) };
}

function getRecordingBitrate({
  width,
  height,
}: {
  width: number;
  height: number;
}): number {
  const bitsPerPixelPerFrame = 0.1;
  const target = Math.round(
    width * height * FAST_RECORDING_FRAME_RATE * bitsPerPixelPerFrame,
  );
  return Math.min(
    FAST_RECORDING_MAX_BITRATE,
    Math.max(FAST_RECORDING_MIN_BITRATE, target),
  );
}

/**
 * Per-stage frame timing for the recording loop. Enable from the console with
 * `window.__NAPT_PROFILE_SNAPSHOT__ = true` to get a one-line summary each
 * second instead of guessing at which stage is stalling the live view.
 */
function createRecordingProfiler() {
  const totals = { snapshot: 0, build: 0, blit: 0, frames: 0 };
  let lastReport = performance.now();

  const enabled = () =>
    (globalThis as { __NAPT_PROFILE_SNAPSHOT__?: boolean })
      .__NAPT_PROFILE_SNAPSHOT__ === true;

  return {
    time<T>(stage: "snapshot" | "build" | "blit", run: () => T): T {
      if (!enabled()) return run();
      const startedAt = performance.now();
      const result = run();
      totals[stage] += performance.now() - startedAt;
      return result;
    },
    endFrame(frameCostMs: number): void {
      if (!enabled()) return;
      totals.frames += 1;
      const now = performance.now();
      if (now - lastReport < 1000) return;
      const per = (value: number) => (value / totals.frames).toFixed(2);
      console.info(
        `[snapshot] ${totals.frames} frames/s | snapshotData ${per(totals.snapshot)}ms | buildFrame ${per(totals.build)}ms | blit ${per(totals.blit)}ms | frame ${frameCostMs.toFixed(2)}ms`,
      );
      totals.snapshot = 0;
      totals.build = 0;
      totals.blit = 0;
      totals.frames = 0;
      lastReport = now;
    },
  };
}

const FAST_RECORDING_MIME_TYPES: Record<SnapshotVideoFormat, string[]> = {
  mp4: ["video/mp4;codecs=avc1.42E01E", "video/mp4"],
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
};

const getFastRecordingMimeType = (
  format: SnapshotVideoFormat | null,
): string => {
  if (typeof MediaRecorder === "undefined") return "";
  if (!format) return "";
  return (
    FAST_RECORDING_MIME_TYPES[format].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ""
  );
};

const downloadFastRecording = (
  blob: Blob,
  filenamePrefix: string,
  mimeType: string,
): void => {
  const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `${filenamePrefix}-${Date.now()}.${extension}`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
};

export type FastRecordingTarget = "spectrum" | "waterfall";

type FastRecordingOptions = {
  showStats?: boolean;
  showGeolocation?: boolean;
  geolocation?: { lat: string; lon: string } | null;
  locationLabel?: string | null;
  activeSignalArea?: string;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalAreaBounds?: { min: number; max: number } | null;
  getActiveSignalArea?: () => string;
  getActiveSignalAreaBounds?: () => { min: number; max: number } | null;
  sourceName?: string;
  sdrSettingsLabel?: string;
  gain?: number;
  ppm?: number;
  fftSize?: number | string;
  getSdrSettingsLabel?: () => string | undefined;
  getSourceName?: () => string | undefined;
};

export function pinFastRecordingOptions(
  options: FastRecordingOptions,
): FastRecordingOptions {
  const activeSignalAreaBounds = options.getActiveSignalAreaBounds
    ? options.getActiveSignalAreaBounds()
    : options.activeSignalAreaBounds;
  return {
    ...options,
    activeSignalArea:
      options.getActiveSignalArea?.() ?? options.activeSignalArea,
    activeSignalAreaBounds: activeSignalAreaBounds
      ? { ...activeSignalAreaBounds }
      : activeSignalAreaBounds,
    signalAreaBounds: options.signalAreaBounds
      ? Object.fromEntries(
          Object.entries(options.signalAreaBounds).map(([name, bounds]) => [
            name,
            { ...bounds },
          ]),
        )
      : options.signalAreaBounds,
    sdrSettingsLabel:
      options.getSdrSettingsLabel?.() ?? options.sdrSettingsLabel,
    sourceName: options.getSourceName?.() ?? options.sourceName,
    getActiveSignalArea: undefined,
    getActiveSignalAreaBounds: undefined,
    getSdrSettingsLabel: undefined,
    getSourceName: undefined,
  };
}

export type FastCanvases = {
  spectrumGpu: HTMLCanvasElement | null;
  spectrumOverlay: HTMLCanvasElement | null;
  waterfallGpu: HTMLCanvasElement | null;
  waterfallOverlay: HTMLCanvasElement | null;
};

export type GetFastCanvases = () => FastCanvases | null;

/**
 * Publishes the recording countdown without routing it through React state,
 * so a ticking second only re-renders its own label.
 */
export type RecordingCountdownStore = {
  subscribe: (listener: () => void) => () => void;
  getSecondsRemaining: () => number | null;
};

export type FastRecordingSession = {
  target: FastRecordingTarget;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  filenamePrefix: string;
  rafId?: number;
  timerId?: number;
  stream: MediaStream;
  recordingCanvas: HTMLCanvasElement;
  scratch: FastFrameScratch;
};

/**
 * Recording only ever needs the waveform; the waterfall comes from the live GPU
 * canvas. Skipping the copies avoids several megabytes of allocation per frame,
 * and the returned buffers are consumed before this tick yields.
 */
const RECORDING_SNAPSHOT_DATA_OPTIONS = {
  includeWaterfall: false,
  copyWaveforms: false,
} as const;

// ── Hook ────────────────────────────────────────────────────────────────────

export function useSnapshot(
  frequencyRange: { min: number; max: number } | null,
  isConnected: boolean,
) {
  const appMode = useAppSelector((state) => state.theme.appMode);
  const dispatch = useAppDispatch();
  const resolvedMode = useResolvedThemeMode(appMode);
  const staticThemeColors = THEME_TOKENS.colors[resolvedMode];
  const styledTheme = useTheme() as Partial<AppStyledTheme> & {
    colors?: Partial<AppStyledTheme["colors"]>;
  };

  const [fastRecordingTarget, setFastRecordingTarget] =
    useState<FastRecordingTarget | null>(null);
  // The countdown ticks while the whole route is busy rendering frames, so it
  // is published through a store rather than component state: only the label
  // that reads it re-renders, instead of the entire spectrum tree once a
  // second.
  const secondsRemainingRef = useRef<number | null>(null);
  const secondsListenersRef = useRef(new Set<() => void>());
  const recordingCountdown = useMemo<RecordingCountdownStore>(
    () => ({
      subscribe: (listener) => {
        const listeners = secondsListenersRef.current;
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSecondsRemaining: () => secondsRemainingRef.current,
    }),
    [],
  );
  const setRecordingSecondsRemaining = useCallback((value: number | null) => {
    if (secondsRemainingRef.current === value) return;
    secondsRemainingRef.current = value;
    secondsListenersRef.current.forEach((listener) => listener());
  }, []);
  const fastRecordingSessionRef = useRef<FastRecordingSession | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const lastSecondsRef = useRef<number>(-1);

  const supportedFastRecordingFormat = useMemo(
    () => getSupportedSnapshotVideoFormat(),
    [],
  );

  const resetFastRecordingState = useCallback(() => {
    setFastRecordingTarget(null);
    setRecordingSecondsRemaining(null);
    recordingStartTimeRef.current = 0;
    lastSecondsRef.current = -1;
  }, [setRecordingSecondsRemaining]);

  const renderFastRecordingFrame = useCallback(
    (
      target: FastRecordingTarget,
      snapshotData: SnapshotData | null,
      width: number,
      height: number,
      theme: SnapshotTheme,
      canvases?: FastCanvases | null,
      options?: {
        showStats?: boolean;
        showGeolocation?: boolean;
        geolocation?: { lat: string; lon: string } | null;
        locationLabel?: string | null;
        activeSignalArea?: string;
        signalAreaBounds?: Record<string, { min: number; max: number }> | null;
        activeSignalAreaBounds?: { min: number; max: number } | null;
        sourceName?: string;
        sdrSettingsLabel?: string;
        gain?: number;
        ppm?: number;
        fftSize?: number | string;
        aspectRatio?: SnapshotAspectRatio;
        scratch?: FastFrameScratch | null;
      },
    ): HTMLCanvasElement | null => {
      if (!snapshotData) {
        return null;
      }

      if (target === "spectrum") {
        return buildFastSpectrumCanvas(
          snapshotData,
          width,
          height,
          theme,
          canvases,
          options,
        );
      }

      const waterfallAxisTheme = buildFrequencyAxisTheme({
        colors: {
          background: staticThemeColors.waterfallBackground,
          border: staticThemeColors.waterfallGrid,
          textMuted: staticThemeColors.waterfallText,
          textSecondary: staticThemeColors.waterfallText,
          textPrimary: staticThemeColors.snapCenterLabelText,
        },
      });

      return buildFastWaterfallCanvas(
        snapshotData,
        width,
        height,
        snapshotData.frequencyRange || frequencyRange,
        canvases,
        waterfallAxisTheme,
        options,
        theme,
      );
    },
    [frequencyRange, staticThemeColors],
  );

  const buildSnapshotTheme = useCallback(
    (useThemeColors?: boolean): SnapshotTheme => {
      const fftLine = useThemeColors
        ? (styledTheme.fft ??
          styledTheme.colors?.fftLine ??
          staticThemeColors.fftLine)
        : staticThemeColors.fftLine;
      const fftShadow = useThemeColors
        ? (styledTheme.colors?.fftShadow ?? staticThemeColors.fftShadow)
        : staticThemeColors.fftShadow;

      return {
        bg: escapeAttr(staticThemeColors.fftBackground),
        grid: escapeAttr(staticThemeColors.fftGrid),
        line: escapeAttr(fftLine),
        shadow: escapeAttr(fftShadow),
        text: escapeAttr(staticThemeColors.fftText),
        hwLine: escapeAttr(staticThemeColors.snapHwRateLine),
        hwText: escapeAttr(staticThemeColors.snapHwRateText),
        cfText: escapeAttr(staticThemeColors.snapCenterLabelText),
      };
    },
    [staticThemeColors, styledTheme.fft, styledTheme.colors],
  );

  const waterfallBg = staticThemeColors.waterfallBackground;

  const handleSnapshot = useCallback(
    async (options: SnapshotOptions) => {
      dispatch(
        setSnapshotProgress({
          stage: "started",
          message: "Preparing snapshot",
          current: null,
          total: null,
        }),
      );
      try {
        if (options.canvasOnly) {
          const canvas = options.canvasOnly.getCanvas();
          if (!canvas || canvas.width === 0 || canvas.height === 0) {
            dispatch(
              setSnapshotProgress({
                stage: "error",
                message: "No canvas data available",
                current: null,
                total: null,
                pulseToken: 0,
              }),
            );
            return;
          }

          const timestamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, "-");
          downloadCanvasAsPng(
            canvas,
            `${options.canvasOnly.filenamePrefix ?? "canvas-snapshot"}-${timestamp}`,
          );
          dispatch(
            setSnapshotProgress({
              stage: "done",
              message: "Snapshot saved",
              current: null,
              total: null,
              pulseToken: 0,
            }),
          );
          window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
          return;
        }

        const data = options.getSnapshotData();
        if (!data || !data.waveform || data.waveform.length === 0) {
          console.warn("[Snapshot] No waveform data available");
          dispatch(
            setSnapshotProgress({
              stage: "error",
              message: "No waveform data available",
              current: null,
              total: null,
              pulseToken: 0,
            }),
          );
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
              min: centerFreqToRender - data.hardwareSampleRateHz / 2,
              max: centerFreqToRender + data.hardwareSampleRateHz / 2,
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
        const timestamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/:/g, "-");

        const hasWaterfall =
          options.showWaterfall &&
          ((data.webgpuEnabled &&
            data.waterfallTextureSnapshot &&
            data.waterfallTextureMeta) ||
            (!data.webgpuEnabled &&
              data.waterfallBuffer &&
              data.waterfallDims));

        const theme = buildSnapshotTheme(options.useThemeColors);
        const timestampLabel = options.fileTimestamp
          ? formatTimestampWithTimezone(options.fileTimestamp)
          : fmtTimestamp();
        const statsLines = options.showStats
          ? buildSnapshotStatsLines({
              range: rangeToRender,
              timestampLabel,
              deviceName: options.sourceName,
              channelName: options.activeSignalArea,
              activeSignalAreaBounds: options.activeSignalAreaBounds,
              signalAreaBounds: options.signalAreaBounds,
              whole: options.whole,
              hardwareSampleRateHz: data.hardwareSampleRateHz,
              fftSize: data.fftSize,
              fftWindow: data.fftWindow,
              gain: options.gain,
              ppm: options.ppm,
              gainLabel: options.sdrSettingsLabel,
              modeLabel: options.modeLabel,
              showGeolocation: options.showGeolocation ?? false,
              geolocation: options.geolocation,
              locationLabel: options.locationLabel,
            })
          : [];

        if (options.showStats && options.showGeolocation && !options.geolocation) {
          try {
            const pos = await new Promise<GeolocationPosition>(
              (resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                  enableHighAccuracy: false,
                  timeout: 5000,
                  maximumAge: 60000,
                });
              },
            );
            const lat = pos.coords.latitude.toFixed(6);
            const lon = pos.coords.longitude.toFixed(6);
            statsLines.push(`Location: ${lat}, ${lon}`);
          } catch (err) {
            console.warn("[Snapshot] Geolocation failed:", err);
          }
        }

        const buildRenderState = (
          currentData: SnapshotData,
          wholeChannelSegments?: WholeChannelSnapshotSegment[],
        ) => {
          let currentWaveform: Float32Array;
          let currentRange: Range;

          if (options.whole) {
            currentWaveform =
              currentData.fullChannelWaveform ??
              currentData.waveform ??
              new Float32Array();
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
          if (
            currentData.hardwareSampleRateHz &&
            Number.isFinite(currentCenterFreq)
          ) {
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

          const currentTimestampLabel = options.fileTimestamp
            ? formatTimestampWithTimezone(options.fileTimestamp)
            : fmtTimestamp();
          const currentStatsLines = options.showStats
            ? buildSnapshotStatsLines({
                range: currentRange,
                timestampLabel: currentTimestampLabel,
                deviceName: options.sourceName,
                channelName: options.activeSignalArea,
                activeSignalAreaBounds: options.activeSignalAreaBounds,
                signalAreaBounds: options.signalAreaBounds,
                whole: options.whole,
                hardwareSampleRateHz: currentData.hardwareSampleRateHz,
                fftSize: currentData.fftSize,
                fftWindow: currentData.fftWindow,
                gain: options.gain,
                ppm: options.ppm,
                gainLabel: options.sdrSettingsLabel,
                modeLabel: options.modeLabel,
                showGeolocation: false,
                locationLabel: options.locationLabel,
              })
            : [];

          if (
            options.showStats &&
            options.showGeolocation &&
            options.geolocation
          ) {
            currentStatsLines.push(
              formatSnapshotLocationLine(options.geolocation, options.locationLabel),
            );
          }

          return {
            currentWaveform,
            currentRange,
            currentCaptureRange,
            currentStatsLines,
          };
        };

        const renderVideoFrameCanvas = async (
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
          const liveSpectrumSourceCanvases =
            !options.whole &&
            (!options.aspectRatio || options.aspectRatio === "default")
              ? (options.getVideoSourceCanvases?.() ?? null)
              : null;
          const liveSpectrumCanvas =
            liveSpectrumSourceCanvases?.spectrum ?? null;
          const basePixelW = liveSpectrumCanvas?.width ?? PIXEL_WIDTH;
          const baseSpectrumH = liveSpectrumCanvas?.height ?? PIXEL_SPECTRUM_H;

          // Calculate target dimensions first, before rendering
          const totalPixelH = options.showWaterfall
            ? baseSpectrumH + PIXEL_WATERFALL_H
            : baseSpectrumH;
          let targetFrameW = basePixelW;
          let targetFrameH = totalPixelH;
          let targetSpectrumH = baseSpectrumH;
          let targetWaterfallH = options.showWaterfall ? PIXEL_WATERFALL_H : 0;
          if (options.aspectRatio && options.aspectRatio !== "default") {
            const targetRatio =
              options.aspectRatio === "4:3"
                ? 4 / 3
                : options.aspectRatio === "16:10"
                  ? 16 / 10
                  : options.aspectRatio === "16:9"
                    ? 16 / 9
                    : 19.5 / 9;
            const currentRatio = basePixelW / totalPixelH;
            if (currentRatio > targetRatio) {
              targetFrameH = Math.round(basePixelW / targetRatio);
              if (options.showWaterfall) {
                const spectrumRatio =
                  baseSpectrumH / (baseSpectrumH + PIXEL_WATERFALL_H);
                targetSpectrumH = Math.round(targetFrameH * spectrumRatio);
                targetWaterfallH = targetFrameH - targetSpectrumH;
              } else {
                targetSpectrumH = targetFrameH;
              }
            } else {
              targetFrameW = Math.round(totalPixelH * targetRatio);
              if (options.showWaterfall) {
                targetSpectrumH = baseSpectrumH;
                targetWaterfallH = PIXEL_WATERFALL_H;
              } else {
                targetSpectrumH = totalPixelH;
              }
            }
          }

          const statsRow = options.showStats
            ? renderStatsRowCanvas(
                currentStatsLines,
                targetFrameW,
                theme,
                options.aspectRatio,
              )
            : null;
          if (statsRow) {
            targetFrameH += statsRow.height;
          }

          // Now render with target dimensions
          const currentWholeSpectrumCanvas =
            options.whole && frameSegments?.length
              ? await composeWholeChannelSpectrumCanvas(
                  frameSegments,
                  currentRange,
                  options.showGrid,
                  targetFrameW,
                  targetSpectrumH,
                  currentCaptureRange,
                  currentStatsLines,
                  theme,
                  options.stitchOptions,
                  true,
                  options.activeSignalAreaBounds ?? null,
                  options.activeSignalArea,
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
          if (!frameCtx)
            throw new Error("Unable to initialize the snapshot frame canvas.");
          frameCtx.fillStyle = theme.bg;
          frameCtx.fillRect(0, 0, targetFrameW, targetFrameH);
          frameCtx.imageSmoothingEnabled = false;

          // For whole channel, use the already-rendered canvases at target dimensions
          let spectrumCanvas: HTMLCanvasElement;
          if (currentWholeSpectrumCanvas) {
            spectrumCanvas = currentWholeSpectrumCanvas;
          } else {
            spectrumCanvas =
              buildLiveSpectrumSnapshotCanvas(
                liveSpectrumSourceCanvases,
                { ...currentData, waveform: currentWaveform },
                currentRange,
                options.showGrid,
                currentCaptureRange,
                currentStatsLines,
                currentWaveform,
                theme,
                options.activeSignalAreaBounds ?? null,
                options.activeSignalArea,
              ) ??
              renderSpectrumSnapshotCanvas(
                { ...currentData, waveform: currentWaveform },
                currentRange,
                options.showGrid,
                targetFrameW,
                targetSpectrumH,
                currentCaptureRange,
                currentStatsLines,
                currentWaveform,
                theme,
                undefined,
                false,
                false,
                options.activeSignalAreaBounds ?? null,
                options.activeSignalArea,
              );
          }
          frameCtx.drawImage(
            spectrumCanvas,
            0,
            0,
            targetFrameW,
            targetSpectrumH,
          );

          if (options.showWaterfall) {
            let waterfallCanvas: HTMLCanvasElement | null = null;
            if (currentWholeWaterfallCanvas) {
              waterfallCanvas = currentWholeWaterfallCanvas;
            } else {
              waterfallCanvas = renderWaterfallSnapshotCanvas(
                currentData,
                targetFrameW,
                targetWaterfallH,
                {
                  waterfallBg,
                  marginY: 0,
                },
              );
            }
            if (waterfallCanvas) {
              frameCtx.drawImage(
                waterfallCanvas,
                0,
                targetSpectrumH,
                targetFrameW,
                targetWaterfallH,
              );
            }
          }

          if (statsRow) {
            frameCtx.drawImage(
              statsRow,
              0,
              targetSpectrumH + (options.showWaterfall ? targetWaterfallH : 0),
            );
          }

          return frameCanvas;
        };

        // ── SVG Vector path ───────────────────────────────────────────────────
        if (options.format === "svg") {
          const dpr = window.devicePixelRatio || 1;
          const liveSpectrumSourceCanvases =
            !options.whole &&
            (!options.aspectRatio || options.aspectRatio === "default")
              ? (options.getVideoSourceCanvases?.() ?? null)
              : null;
          const liveSpectrumCanvas =
            liveSpectrumSourceCanvases?.spectrum ?? null;
          const baseLogicalW = liveSpectrumCanvas
            ? liveSpectrumCanvas.width / dpr
            : LOGICAL_WIDTH;
          const baseSpectrumLogicalH = liveSpectrumCanvas
            ? liveSpectrumCanvas.height / dpr
            : LOGICAL_SPECTRUM_H;
          const totalHLogical = hasWaterfall
            ? baseSpectrumLogicalH + LOGICAL_WATERFALL_H
            : baseSpectrumLogicalH;

          // Determine final canvas dimensions based on aspect ratio (cover mode)
          let finalLogicalW = baseLogicalW;
          let finalLogicalH = totalHLogical;
          let targetSpectrumH = baseSpectrumLogicalH;
          let targetWaterfallH = LOGICAL_WATERFALL_H;
          if (options.aspectRatio && options.aspectRatio !== "default") {
            const targetRatio =
              options.aspectRatio === "4:3"
                ? 4 / 3
                : options.aspectRatio === "16:10"
                  ? 16 / 10
                  : options.aspectRatio === "16:9"
                    ? 16 / 9
                    : 19.5 / 9;
            const currentRatio = baseLogicalW / totalHLogical;
            if (currentRatio > targetRatio) {
              finalLogicalH = Math.round(baseLogicalW / targetRatio);
              if (hasWaterfall) {
                const spectrumRatio =
                  baseSpectrumLogicalH /
                  (baseSpectrumLogicalH + LOGICAL_WATERFALL_H);
                targetSpectrumH = Math.round(finalLogicalH * spectrumRatio);
                targetWaterfallH = finalLogicalH - targetSpectrumH;
              } else {
                targetSpectrumH = finalLogicalH;
                targetWaterfallH = 0;
              }
            } else {
              finalLogicalW = Math.round(totalHLogical * targetRatio);
              if (hasWaterfall) {
                targetSpectrumH = baseSpectrumLogicalH;
                targetWaterfallH = LOGICAL_WATERFALL_H;
              } else {
                targetSpectrumH = totalHLogical;
                targetWaterfallH = 0;
              }
            }
          }

          // Convert to pixel dimensions for rendering with proper DPR handling
          const pixelW =
            liveSpectrumCanvas?.width ?? Math.round(finalLogicalW * dpr);
          const pixelSpectrumH =
            liveSpectrumCanvas?.height ?? Math.round(targetSpectrumH * dpr);
          const pixelWaterfallH = Math.round(targetWaterfallH * dpr);

          const statsRow = options.showStats
            ? renderStatsRowCanvas(
                statsLines,
                pixelW,
                theme,
                options.aspectRatio,
              )
            : null;
          const statsLogicalH = statsRow ? statsRow.height / dpr : 0;
          if (statsRow) {
            finalLogicalH += statsLogicalH;
          }

          // Render whole channel canvases at target dimensions
          const wholeChannelSpectrumCanvas =
            options.whole && options.wholeChannelSegments?.length
              ? await composeWholeChannelSpectrumCanvas(
                  options.wholeChannelSegments,
                  rangeToRender,
                  options.showGrid,
                  pixelW,
                  pixelSpectrumH,
                  captureRange,
                  statsLines,
                  theme,
                  options.stitchOptions,
                  true,
                  options.activeSignalAreaBounds ?? null,
                  options.activeSignalArea,
                )
              : null;
          const wholeChannelWaterfallCanvas =
            options.showWaterfall &&
            options.whole &&
            options.wholeChannelSegments?.length
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
            const liveSpectrumSnapshotCanvas = buildLiveSpectrumSnapshotCanvas(
              liveSpectrumSourceCanvases,
              { ...data, waveform: waveformToRender },
              rangeToRender,
              options.showGrid,
              captureRange,
              statsLines,
              waveformToRender,
              theme,
              options.activeSignalAreaBounds ?? null,
              options.activeSignalArea,
            );
            if (liveSpectrumSnapshotCanvas) {
              spectrumSvg = `<image href="${liveSpectrumSnapshotCanvas.toDataURL("image/png")}" x="0" y="0" width="${finalLogicalW}" height="${targetSpectrumH}"/>`;
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
                false,
                false,
                options.activeSignalAreaBounds ?? null,
                options.activeSignalArea,
              );
              spectrumSvg = typeof svgResult === "string" ? svgResult : "";
            }
          }

          let waterfallSection = "";
          if (hasWaterfall) {
            let wfDataUrl = "";
            if (wholeChannelWaterfallCanvas) {
              wfDataUrl = wholeChannelWaterfallCanvas.toDataURL("image/png");
            } else {
              const wfCanvas = renderWaterfallSnapshotCanvas(
                data,
                pixelW,
                pixelWaterfallH,
                { waterfallBg, marginY: 0 },
              );
              if (wfCanvas) wfDataUrl = wfCanvas.toDataURL("image/png");
            }

            if (wfDataUrl) {
              waterfallSection = `<image href="${wfDataUrl}" x="0" y="${targetSpectrumH}" width="${finalLogicalW}" height="${targetWaterfallH}"/>`;
            }
          }

          let statsSection = "";
          if (statsRow) {
            const statsDataUrl = statsRow.toDataURL("image/png");
            statsSection = `<image href="${statsDataUrl}" x="0" y="${targetSpectrumH + (hasWaterfall ? targetWaterfallH : 0)}" width="${finalLogicalW}" height="${statsLogicalH}"/>`;
          }

          const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${finalLogicalW} ${finalLogicalH}" width="${finalLogicalW}" height="${finalLogicalH}">
   ${spectrumSvg}
   ${waterfallSection}
   ${statsSection}
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
          dispatch(
            setSnapshotProgress({
              stage: "done",
              message: "Snapshot saved",
              current: null,
              total: null,
            }),
          );
          window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
          return;
        }

        if (options.format === "animated-svg") {
          const baseFilename = `spectrum-snapshot-${timestamp}`;
          const animatedFrameRate = options.videoFrameRate || 30;

          dispatch(
            setSnapshotProgress({
              stage: "encoding",
              message: "Rendering animated SVG",
              current: null,
              total: null,
            }),
          );

          try {
            const renderAnimatedSvgFrame = async () => {
              const currentData = options.getSnapshotData();
              if (
                !currentData ||
                !currentData.waveform ||
                currentData.waveform.length === 0
              ) {
                throw new Error("No waveform data available for animated SVG.");
              }

              const {
                currentWaveform,
                currentRange,
                currentCaptureRange,
                currentStatsLines,
              } = buildRenderState(currentData);

              // Determine final SVG dimensions based on aspect ratio
              const dpr = window.devicePixelRatio || 1;
              const liveSpectrumSourceCanvases =
                !options.whole &&
                (!options.aspectRatio || options.aspectRatio === "default")
                  ? (options.getVideoSourceCanvases?.() ?? null)
                  : null;
              const liveSpectrumCanvas =
                liveSpectrumSourceCanvases?.spectrum ?? null;
              const baseLogicalW = liveSpectrumCanvas
                ? liveSpectrumCanvas.width / dpr
                : LOGICAL_WIDTH;
              const baseSpectrumLogicalH = liveSpectrumCanvas
                ? liveSpectrumCanvas.height / dpr
                : LOGICAL_SPECTRUM_H;
              const totalHLogical = hasWaterfall
                ? baseSpectrumLogicalH + LOGICAL_WATERFALL_H
                : baseSpectrumLogicalH;

              let finalLogicalW = baseLogicalW;
              let finalLogicalH = totalHLogical;
              let targetSpectrumH = baseSpectrumLogicalH;
              let targetWaterfallH = LOGICAL_WATERFALL_H;
              if (options.aspectRatio && options.aspectRatio !== "default") {
                const targetRatio =
                  options.aspectRatio === "4:3"
                    ? 4 / 3
                    : options.aspectRatio === "16:10"
                      ? 16 / 10
                      : options.aspectRatio === "16:9"
                        ? 16 / 9
                        : 19.5 / 9;
                const currentRatio = baseLogicalW / totalHLogical;
                if (currentRatio > targetRatio) {
                  finalLogicalH = Math.round(baseLogicalW / targetRatio);
                  if (hasWaterfall) {
                    const spectrumRatio =
                      baseSpectrumLogicalH /
                      (baseSpectrumLogicalH + LOGICAL_WATERFALL_H);
                    targetSpectrumH = Math.round(finalLogicalH * spectrumRatio);
                    targetWaterfallH = finalLogicalH - targetSpectrumH;
                  } else {
                    targetSpectrumH = finalLogicalH;
                    targetWaterfallH = 0;
                  }
                } else {
                  finalLogicalW = Math.round(totalHLogical * targetRatio);
                  if (hasWaterfall) {
                    targetSpectrumH = baseSpectrumLogicalH;
                    targetWaterfallH = LOGICAL_WATERFALL_H;
                  } else {
                    targetSpectrumH = totalHLogical;
                    targetWaterfallH = 0;
                  }
                }
              }

              const pixelW =
                liveSpectrumCanvas?.width ?? Math.round(finalLogicalW * dpr);
              const pixelSpectrumH =
                liveSpectrumCanvas?.height ?? Math.round(targetSpectrumH * dpr);
              const pixelWaterfallH = Math.round(targetWaterfallH * dpr);

              const statsRow = options.showStats
                ? renderStatsRowCanvas(
                    currentStatsLines,
                    pixelW,
                    theme,
                    options.aspectRatio,
                  )
                : null;
              const statsLogicalH = statsRow ? statsRow.height / dpr : 0;
              if (statsRow) {
                finalLogicalH += statsLogicalH;
              }

              const wholeChannelSpectrumCanvas =
                options.whole && options.wholeChannelSegments?.length
                  ? await composeWholeChannelSpectrumCanvas(
                      options.wholeChannelSegments,
                      currentRange,
                      options.showGrid,
                      pixelW,
                      pixelSpectrumH,
                      currentCaptureRange,
                      currentStatsLines,
                      theme,
                      options.stitchOptions,
                      true,
                      options.activeSignalAreaBounds ?? null,
                      options.activeSignalArea,
                    )
                  : null;

              let spectrumSvg = "";
              if (options.whole && wholeChannelSpectrumCanvas) {
                spectrumSvg = `<image href="${wholeChannelSpectrumCanvas.toDataURL("image/png")}" x="0" y="0" width="${finalLogicalW}" height="${targetSpectrumH}"/>`;
              } else {
                const liveSpectrumSnapshotCanvas =
                  buildLiveSpectrumSnapshotCanvas(
                    liveSpectrumSourceCanvases,
                    { ...currentData, waveform: currentWaveform },
                    currentRange,
                    options.showGrid,
                    currentCaptureRange,
                    currentStatsLines,
                    currentWaveform,
                    theme,
                    options.activeSignalAreaBounds ?? null,
                    options.activeSignalArea,
                  );
                if (liveSpectrumSnapshotCanvas) {
                  spectrumSvg = `<image href="${liveSpectrumSnapshotCanvas.toDataURL("image/png")}" x="0" y="0" width="${finalLogicalW}" height="${targetSpectrumH}"/>`;
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
                    false,
                    false,
                    options.activeSignalAreaBounds ?? null,
                    options.activeSignalArea,
                  );
                  spectrumSvg = typeof svgResult === "string" ? svgResult : "";
                }
              }

              let waterfallSection = "";
              if (hasWaterfall) {
                const wfCanvas = renderWaterfallSnapshotCanvas(
                  currentData,
                  pixelW,
                  pixelWaterfallH,
                  { waterfallBg, marginY: 0 },
                );
                if (wfCanvas) {
                  const wfDataUrl = wfCanvas.toDataURL("image/png");
                  waterfallSection = `<image href="${wfDataUrl}" x="0" y="${targetSpectrumH}" width="${finalLogicalW}" height="${targetWaterfallH}"/>`;
                }
              }

              let statsSection = "";
              if (statsRow) {
                const statsDataUrl = statsRow.toDataURL("image/png");
                statsSection = `<image href="${statsDataUrl}" x="0" y="${targetSpectrumH + (hasWaterfall ? targetWaterfallH : 0)}" width="${finalLogicalW}" height="${statsLogicalH}"/>`;
              }

              const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${finalLogicalW} ${finalLogicalH}" width="${finalLogicalW}" height="${finalLogicalH}">
  ${spectrumSvg}
  ${waterfallSection}
  ${statsSection}
</svg>`;

              return svgContent;
            };

            await recordSVGFramesToAnimatedSvg(
              renderAnimatedSvgFrame,
              baseFilename,
              1000,
              animatedFrameRate,
            );

            dispatch(
              setSnapshotProgress({
                stage: "done",
                message: "Animated SVG saved",
                current: null,
                total: null,
              }),
            );
            window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
            return;
          } catch (error) {
            dispatch(
              setSnapshotProgress({
                stage: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Animated SVG generation failed",
                current: null,
                total: null,
              }),
            );
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
            const videoFrameRate = normalizeSnapshotVideoFrameRate(
              options.videoFrameRate,
            );

            if (options.whole && options.getWholeChannelSegmentFrames) {
              const recordedSegmentFrames: WholeChannelSnapshotSegment[][] = [];
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
                recordedSegmentFrames.push(wholeChannelFrameSegments);
                if (recordedSegmentFrames.length >= expectedFrames) {
                  break;
                }
              }

              if (
                !recordedSegmentFrames.length &&
                options.wholeChannelSegments?.length
              ) {
                recordedSegmentFrames.push(options.wholeChannelSegments);
              }

              if (!recordedSegmentFrames.length) {
                dispatch(
                  setSnapshotProgress({
                    stage: "error",
                    message: "No stitched whole-channel frames were captured",
                    current: null,
                    total: null,
                  }),
                );
                throw new Error(
                  "No stitched whole-channel frames were captured for video snapshot.",
                );
              }

              const renderedFrames: HTMLCanvasElement[] = [];
              for (const wholeChannelFrameSegments of recordedSegmentFrames) {
                dispatch(
                  setSnapshotProgress({
                    stage: "encoding",
                    message: `Rendering stitched frame ${renderedFrames.length + 1} of ${recordedSegmentFrames.length}`,
                    current: renderedFrames.length + 1,
                    total: recordedSegmentFrames.length,
                  }),
                );
                renderedFrames.push(
                  await renderVideoFrameCanvas(
                    wholeChannelFrameSegments[0].data,
                    wholeChannelFrameSegments,
                  ),
                );
              }

              dispatch(
                setSnapshotProgress({
                  stage: "encoding",
                  message: `Encoding ${renderedFrames.length} frames`,
                  current: renderedFrames.length,
                  total: renderedFrames.length,
                }),
              );
              await recordCanvasFramesToVideo(
                renderedFrames,
                baseFilename,
                options.format,
                videoFrameRate,
              );
              dispatch(
                setSnapshotProgress({
                  stage: "done",
                  message: "Video snapshot saved",
                  current: null,
                  total: null,
                }),
              );
              window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
              return;
            }

            dispatch(
              setSnapshotProgress({
                stage: "encoding",
                message: "Recording video snapshot",
                current: null,
                total: null,
              }),
            );
            await recordSnapshotFramesToVideo(
              async () => {
                const currentData = options.getSnapshotData();
                if (
                  !currentData ||
                  !currentData.waveform ||
                  currentData.waveform.length === 0
                ) {
                  throw new Error(
                    "No waveform data available for video snapshot.",
                  );
                }
                return await renderVideoFrameCanvas(currentData);
              },
              baseFilename,
              1000,
              options.format,
              videoFrameRate,
            );
            dispatch(
              setSnapshotProgress({
                stage: "done",
                message: "Video snapshot saved",
                current: null,
                total: null,
              }),
            );
            window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
            return;
          } finally {
            if (restoreRecordingState) {
              await restoreRecordingState();
            }
          }
        }

        // ── PNG path ──────────────────────────────────────────────────────────

        const liveSpectrumSourceCanvases =
          !options.whole &&
          (!options.aspectRatio || options.aspectRatio === "default")
            ? (options.getVideoSourceCanvases?.() ?? null)
            : null;
        const liveSpectrumCanvas = liveSpectrumSourceCanvases?.spectrum ?? null;
        const basePixelW = liveSpectrumCanvas?.width ?? PIXEL_WIDTH;
        const baseSpectrumH = liveSpectrumCanvas?.height ?? PIXEL_SPECTRUM_H;
        const totalPixelH = hasWaterfall
          ? baseSpectrumH + PIXEL_WATERFALL_H
          : baseSpectrumH;

        // Determine final canvas dimensions based on aspect ratio (cover mode)
        let finalPixelW = basePixelW;
        let finalPixelH = totalPixelH;
        let targetSpectrumH = baseSpectrumH;
        let targetWaterfallH = hasWaterfall ? PIXEL_WATERFALL_H : 0;
        if (options.aspectRatio && options.aspectRatio !== "default") {
          const targetRatio =
            options.aspectRatio === "4:3"
              ? 4 / 3
              : options.aspectRatio === "16:10"
                ? 16 / 10
                : options.aspectRatio === "16:9"
                  ? 16 / 9
                  : 19.5 / 9;
          const currentRatio = basePixelW / totalPixelH;
          if (currentRatio > targetRatio) {
            finalPixelH = Math.round(basePixelW / targetRatio);
            if (hasWaterfall) {
              const spectrumRatio =
                baseSpectrumH / (baseSpectrumH + PIXEL_WATERFALL_H);
              targetSpectrumH = Math.round(finalPixelH * spectrumRatio);
              targetWaterfallH = finalPixelH - targetSpectrumH;
            } else {
              targetSpectrumH = finalPixelH;
              targetWaterfallH = 0;
            }
          } else {
            finalPixelW = Math.round(totalPixelH * targetRatio);
            if (hasWaterfall) {
              targetSpectrumH = baseSpectrumH;
              targetWaterfallH = PIXEL_WATERFALL_H;
            } else {
              targetSpectrumH = totalPixelH;
              targetWaterfallH = 0;
            }
          }
        }

        const statsRow = options.showStats
          ? renderStatsRowCanvas(
              statsLines,
              finalPixelW,
              theme,
              options.aspectRatio,
            )
          : null;
        if (statsRow) {
          finalPixelH += statsRow.height;
        }

        // Render whole channel canvases at target dimensions
        const wholeChannelSpectrumCanvas =
          options.whole && options.wholeChannelSegments?.length
            ? await composeWholeChannelSpectrumCanvas(
                options.wholeChannelSegments,
                rangeToRender,
                options.showGrid,
                finalPixelW,
                targetSpectrumH,
                captureRange,
                statsLines,
                theme,
                options.stitchOptions,
                true,
                options.activeSignalAreaBounds ?? null,
                options.activeSignalArea,
              )
            : null;
        const wholeChannelWaterfallCanvas =
          options.showWaterfall &&
          options.whole &&
          options.wholeChannelSegments?.length
            ? composeWholeChannelWaterfallCanvas(
                options.wholeChannelSegments,
                rangeToRender,
                finalPixelW,
                targetWaterfallH,
                waterfallBg,
              )
            : null;

        const renderData = { ...data, waveform: waveformToRender };
        const liveSpectrumSnapshotCanvas = wholeChannelSpectrumCanvas
          ? null
          : buildLiveSpectrumSnapshotCanvas(
              liveSpectrumSourceCanvases,
              renderData,
              rangeToRender,
              options.showGrid,
              captureRange,
              statsLines,
              waveformToRender,
              theme,
              options.activeSignalAreaBounds ?? null,
              options.activeSignalArea,
            );
        const spectrumCanvas =
          wholeChannelSpectrumCanvas ??
          liveSpectrumSnapshotCanvas ??
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
            false,
            false,
            options.activeSignalAreaBounds ?? null,
            options.activeSignalArea,
          );

        // Waterfall
        let waterfallCanvas: HTMLCanvasElement | null = null;
        if (hasWaterfall) {
          waterfallCanvas =
            wholeChannelWaterfallCanvas ??
            renderWaterfallSnapshotCanvas(data, finalPixelW, targetWaterfallH, {
              waterfallBg,
              marginY: 0,
            });
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
        if (statsRow) {
          ctx.drawImage(
            statsRow,
            0,
            targetSpectrumH + (waterfallCanvas ? targetWaterfallH : 0),
          );
        }

        // Export PNG
        const dataUrl = finalCanvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.download = `spectrum-snapshot-${timestamp}.png`;
        link.href = dataUrl;
        link.click();
        dispatch(
          setSnapshotProgress({
            stage: "done",
            message: "Snapshot saved",
            current: null,
            total: null,
            pulseToken: 0,
          }),
        );
        window.setTimeout(() => dispatch(clearSnapshotProgress()), 1200);
      } catch (error) {
        dispatch(
          setSnapshotProgress({
            stage: "error",
            message: error instanceof Error ? error.message : "Snapshot failed",
            current: null,
            total: null,
            pulseToken: 0,
          }),
        );
        window.setTimeout(() => dispatch(clearSnapshotProgress()), 1800);
        throw error;
      }
    },
    [dispatch, buildSnapshotTheme, waterfallBg],
  );

  const stopFastRecording = useCallback(() => {
    const session = fastRecordingSessionRef.current;
    if (!session) return;

    if (session.rafId !== undefined) {
      window.cancelAnimationFrame(session.rafId);
    }
    if (session.timerId !== undefined) {
      window.clearTimeout(session.timerId);
    }
    try {
      session.recorder.requestData();
    } catch {
      // ignore
    }
    if (session.recorder.state !== "inactive") {
      session.recorder.stop();
    }
  }, []);

  const startFastRecording = useCallback(
    (
      target: FastRecordingTarget,
      getSnapshotData: (
        dataOptions?: SnapshotDataOptions,
      ) => SnapshotData | null,
      getCanvasDimensions: () => { width: number; height: number },
      filenamePrefix: string,
      getCanvases: GetFastCanvases,
      options?: FastRecordingOptions,
    ) => {
      if (fastRecordingSessionRef.current) {
        stopFastRecording();
        return;
      }

      const mimeType = getFastRecordingMimeType(supportedFastRecordingFormat);
      if (!mimeType) return;

      const snapshotData = getSnapshotData(RECORDING_SNAPSHOT_DATA_OPTIONS);
      if (!snapshotData) return;
      const pinnedOptions = pinFastRecordingOptions(options ?? {});

      const theme = buildSnapshotTheme(true);
      const dimensions = getCanvasDimensions();
      const initialCanvases = getCanvases();
      const scratch = createFastFrameScratch();

      let minFftSize = snapshotData.fftSize ?? 0;
      let fftSizeChanged = false;

      const initialFrame = renderFastRecordingFrame(
        target,
        snapshotData,
        dimensions.width,
        dimensions.height,
        theme,
        initialCanvases,
        {
          showStats: pinnedOptions.showStats,
          showGeolocation: pinnedOptions.showGeolocation,
          geolocation: pinnedOptions.geolocation,
          locationLabel: pinnedOptions.locationLabel,
          activeSignalArea: pinnedOptions.activeSignalArea,
          signalAreaBounds: pinnedOptions.signalAreaBounds,
          activeSignalAreaBounds: pinnedOptions.activeSignalAreaBounds,
          sourceName: pinnedOptions.sourceName,
          sdrSettingsLabel: pinnedOptions.sdrSettingsLabel,
          gain: pinnedOptions.gain,
          ppm: pinnedOptions.ppm,
          fftSize: minFftSize || undefined,
          scratch,
        },
      );
      if (!initialFrame) {
        disposeFastFrameScratch(scratch);
        return;
      }

      // captureStream works on a detached canvas. Keeping a multi-megapixel
      // canvas in the document costs a compositor layer for no benefit.
      const recordingCanvas = document.createElement("canvas");
      const encodeSize = getRecordingEncodeSize(
        initialFrame.width,
        initialFrame.height,
      );
      recordingCanvas.width = encodeSize.width;
      recordingCanvas.height = encodeSize.height;

      // An opaque context skips per-frame alpha compositing during capture.
      const ctx = recordingCanvas.getContext("2d", { alpha: false });
      if (!ctx) {
        disposeFastFrameScratch(scratch);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(
        initialFrame,
        0,
        0,
        initialFrame.width,
        initialFrame.height,
        0,
        0,
        encodeSize.width,
        encodeSize.height,
      );

      // A zero-fps stream only emits the frames we explicitly request, so the
      // encoder never samples the canvas mid-composite and we never render a
      // frame it would discard. Safari has no requestFrame, so detect support
      // on the prototype: capturing a canvas twice to feature-test leaves the
      // discarded stream attached to it there and stalls the live one.
      const manualFrames =
        typeof window.CanvasCaptureMediaStreamTrack !== "undefined" &&
        typeof window.CanvasCaptureMediaStreamTrack.prototype.requestFrame ===
          "function";
      const stream = recordingCanvas.captureStream(
        manualFrames ? 0 : FAST_RECORDING_FRAME_RATE,
      );
      const videoTrack = stream.getVideoTracks()[0] as
        | CanvasCaptureMediaStreamTrack
        | undefined;

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: getRecordingBitrate(encodeSize),
      });
      const chunks: BlobPart[] = [];

      fastRecordingSessionRef.current = {
        target,
        recorder,
        chunks,
        filenamePrefix,
        stream,
        recordingCanvas,
        scratch,
      };

      setFastRecordingTarget(target);
      const profiler = createRecordingProfiler();
      const startedAt = performance.now();
      recordingStartTimeRef.current = startedAt;
      lastSecondsRef.current = Math.ceil(FAST_RECORDING_MAX_MS / 1000);
      setRecordingSecondsRemaining(lastSecondsRef.current);

      // Rolling estimate of what one frame costs the main thread, used to keep
      // the capture loop inside its share of the frame budget.
      let frameCostMs = 0;
      let nextFrameTime = performance.now();

      const drawFrame = () => {
        const session = fastRecordingSessionRef.current;
        if (!session) return;
        if (recorder.state === "inactive") return;

        const frameStartedAt = performance.now();
        const elapsed = frameStartedAt - recordingStartTimeRef.current;
        if (elapsed >= FAST_RECORDING_MAX_MS) {
          stopFastRecording();
          return;
        }

        const remaining = Math.max(0, FAST_RECORDING_MAX_MS - elapsed);
        const seconds = Math.ceil(remaining / 1000);
        if (seconds !== lastSecondsRef.current) {
          lastSecondsRef.current = seconds;
          setRecordingSecondsRemaining(seconds);
        }

        const currentSnapshotData = profiler.time("snapshot", () =>
          getSnapshotData(RECORDING_SNAPSHOT_DATA_OPTIONS),
        );
        const currentCanvases = getCanvases();
        if (currentSnapshotData) {
          const currentFftSize = currentSnapshotData.fftSize ?? 0;
          if (currentFftSize > 0) {
            if (minFftSize === 0) {
              minFftSize = currentFftSize;
            } else if (currentFftSize !== minFftSize) {
              fftSizeChanged = true;
              if (currentFftSize < minFftSize) {
                minFftSize = currentFftSize;
              }
            }
          }
          const fftSizeToReport = fftSizeChanged
            ? `${minFftSize} (Varying)`
            : currentFftSize || undefined;

          const currentTheme = buildSnapshotTheme(true);
          const frameCanvas = profiler.time("build", () =>
            renderFastRecordingFrame(
              target,
              currentSnapshotData,
              dimensions.width,
              dimensions.height,
              currentTheme,
              currentCanvases,
              {
                showStats: pinnedOptions.showStats,
                showGeolocation: pinnedOptions.showGeolocation,
                geolocation: pinnedOptions.geolocation,
                locationLabel: pinnedOptions.locationLabel,
                activeSignalArea: pinnedOptions.activeSignalArea,
                signalAreaBounds: pinnedOptions.signalAreaBounds,
                activeSignalAreaBounds: pinnedOptions.activeSignalAreaBounds,
                sdrSettingsLabel: pinnedOptions.sdrSettingsLabel,
                sourceName: pinnedOptions.sourceName,
                gain: pinnedOptions.gain,
                ppm: pinnedOptions.ppm,
                fftSize: fftSizeToReport,
                scratch,
              },
            ),
          );
          if (frameCanvas) {
            profiler.time("blit", () => {
              ctx.drawImage(
                frameCanvas,
                0,
                0,
                frameCanvas.width,
                frameCanvas.height,
                0,
                0,
                recordingCanvas.width,
                recordingCanvas.height,
              );
              if (manualFrames) videoTrack!.requestFrame();
            });
          }
        }

        const spent = performance.now() - frameStartedAt;
        frameCostMs = frameCostMs === 0 ? spent : frameCostMs * 0.8 + spent * 0.2;

        profiler.endFrame(frameCostMs);
        scheduleNextFrame();
      };

      const scheduleNextFrame = () => {
        const session = fastRecordingSessionRef.current;
        if (!session) return;

        const now = performance.now();
        // Never let capture consume more than a fixed share of the main
        // thread. On slower engines a frame can cost more than the nominal
        // interval, and a fixed cadence would then schedule back-to-back and
        // starve the live visualisation. Backing off keeps recording cheap at
        // the cost of a lower frame rate.
        const budgetedInterval = Math.max(
          FRAME_INTERVAL_MS,
          frameCostMs / FAST_RECORDING_MAX_THREAD_SHARE,
        );
        nextFrameTime = Math.max(now, nextFrameTime + budgetedInterval);
        session.timerId = window.setTimeout(drawFrame, nextFrameTime - now);
      };

      scheduleNextFrame();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        disposeFastFrameScratch(scratch);
        resetFastRecordingState();
        fastRecordingSessionRef.current = null;
      };
      recorder.onstop = () => {
        const session = fastRecordingSessionRef.current;
        if (session?.rafId !== undefined) {
          window.cancelAnimationFrame(session.rafId);
        }
        if (session?.timerId !== undefined) {
          window.clearTimeout(session.timerId);
        }
        stream.getTracks().forEach((track) => track.stop());
        disposeFastFrameScratch(scratch);
        resetFastRecordingState();
        fastRecordingSessionRef.current = null;

        if (chunks.length > 0) {
          downloadFastRecording(
            new Blob(chunks, { type: mimeType }),
            filenamePrefix,
            mimeType,
          );
        }
      };

      recorder.start(250);
    },
    [
      supportedFastRecordingFormat,
      buildSnapshotTheme,
      renderFastRecordingFrame,
      stopFastRecording,
      resetFastRecordingState,
    ],
  );

  useEffect(() => {
    return () => {
      stopFastRecording();
    };
  }, [stopFastRecording]);

  const takeFastSnapshot = useCallback(
    async (
      target: "spectrum" | "waterfall",
      getSnapshotData: (
        dataOptions?: SnapshotDataOptions,
      ) => SnapshotData | null,
      width: number,
      height: number,
      getCanvases: GetFastCanvases,
      options?: {
        showStats?: boolean;
        showGeolocation?: boolean;
        geolocation?: { lat: string; lon: string } | null;
        locationLabel?: string | null;
        activeSignalArea?: string;
        signalAreaBounds?: Record<string, { min: number; max: number }> | null;
        activeSignalAreaBounds?: { min: number; max: number } | null;
        sourceName?: string;
        sdrSettingsLabel?: string;
        gain?: number;
        ppm?: number;
        fftSize?: number | string;
        aspectRatio?: SnapshotAspectRatio;
      },
    ) => {
      dispatch(bumpSnapshotSectionPulse());
      const snapshotData = getSnapshotData();
      const theme = buildSnapshotTheme(false);
      const waterfallAxisTheme = buildFrequencyAxisTheme({
        colors: {
          background: staticThemeColors.waterfallBackground,
          border: staticThemeColors.waterfallGrid,
          textMuted: staticThemeColors.waterfallText,
          textSecondary: staticThemeColors.waterfallText,
          textPrimary: staticThemeColors.snapCenterLabelText,
        },
      });
      const waterfallFrequencyRange =
        snapshotData?.frequencyRange || frequencyRange;

      const getCanvas = () => {
        const canvases = getCanvases();
        return target === "spectrum"
          ? buildFastSpectrumCanvas(
              snapshotData,
              width,
              height,
              theme,
              canvases,
              options,
            )
          : buildFastWaterfallCanvas(
              snapshotData,
              width,
              height,
              waterfallFrequencyRange,
              canvases,
              waterfallAxisTheme,
              options,
              theme,
            );
      };

      const filenamePrefix =
        target === "spectrum" ? "fast-fft-snapshot" : "fast-waterfall-snapshot";

      await handleSnapshot({
        whole: false,
        showWaterfall: false,
        showStats: options?.showStats ?? false,
        showGeolocation: options?.showGeolocation ?? false,
        geolocation: options?.geolocation,
        locationLabel: options?.locationLabel,
        showGrid: false,
        format: "png",
        useThemeColors: false,
        getSnapshotData: () => snapshotData,
        canvasOnly: {
          getCanvas,
          filenamePrefix,
        },
      });
    },
    [
      dispatch,
      buildSnapshotTheme,
      frequencyRange,
      handleSnapshot,
      staticThemeColors,
    ],
  );

  return {
    handleSnapshot,
    isRecording: fastRecordingTarget,
    recordingCountdown,
    supportedVideoFormat: supportedFastRecordingFormat,
    startFastRecording,
    stopFastRecording,
    takeFastSnapshot,
  };
}
