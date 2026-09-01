import { FFT_AREA_MIN } from "@n-apt/consts";
import {
  CanvasDrawingContext,
  SnapshotRenderer,
  SVGDrawingContext,
  type SnapshotTheme,
} from "@n-apt/layout/rendering/SnapshotRenderer";
import { CoordinateMapper, type Range } from "@n-apt/layout/rendering/CoordinateMapper";
import { formatSnapshotLocationLine } from "@n-apt/capture/snapshotLocation";
import { formatFrequency } from "./frequency";

export type WebUsbSnapshotFormat = "png" | "svg";

export type WebUsbSnapshotMode = "image" | "svg" | "video";

/** Fast-snapshot order and labels used by the standalone control pill. */
export const WEBUSB_SNAPSHOT_MODES: ReadonlyArray<{
  id: WebUsbSnapshotMode;
  label: string;
  format: WebUsbSnapshotFormat;
}> = [
  { id: "image", label: "Image (2x wider)", format: "png" },
  { id: "svg", label: "SVG", format: "svg" },
  { id: "video", label: "Video", format: "png" },
];

export function getNextWebUsbSnapshotMode(
  current: 0 | 1 | 2,
  geolocationUnavailable: boolean,
): 0 | 1 | 2 {
  if (geolocationUnavailable) return current === 0 ? 1 : 0;
  return ((current + 1) % 3) as 0 | 1 | 2;
}

export type WebUsbSnapshotData = {
  waveform: Float32Array;
  centerFrequencyHz: number;
  sampleRateHz: number;
  fftSize: number;
  gainDb: number;
  ppm: number;
  deviceName: string;
  geolocation?: { lat: string; lon: string } | null;
};

export type WebUsbSnapshotOptions = {
  format: WebUsbSnapshotFormat;
  width: number;
  height: number;
  showStats: boolean;
  timestampLabel?: string;
};

const SNAPSHOT_THEME: SnapshotTheme = {
  bg: "#07111f",
  grid: "rgba(83, 117, 149, 0.38)",
  line: "#00d4ff",
  shadow: "rgba(0, 212, 255, 0.2)",
  text: "#8fa8c4",
  hwLine: "rgba(110, 163, 255, 0.35)",
  hwText: "#8fa8c4",
  cfText: "#ffffff",
};

const SNAPSHOT_MIN_DB = -120;
const SNAPSHOT_MAX_DB = 0;
const SNAPSHOT_STATS_LINE_HEIGHT = 30;
const SNAPSHOT_STATS_PADDING_Y = 12;
const SNAPSHOT_STATS_LOCATION_GAP = 6;
const SNAPSHOT_STATS_LOCATION_PATTERN =
  /^(?:Location:\s*)?[-+]?\d+(?:\.\d+)?,\s*[-+]?\d+(?:\.\d+)?(?:\s+–\s+.*)?$/;

function getFrequencyRange(data: WebUsbSnapshotData): Range {
  const halfRate = Math.max(1, data.sampleRateHz) / 2;
  return {
    min: data.centerFrequencyHz - halfRate,
    max: data.centerFrequencyHz + halfRate,
  };
}

function getDbMarkers(): number[] {
  const markers: number[] = [];
  for (let db = SNAPSHOT_MAX_DB; db >= SNAPSHOT_MIN_DB; db -= 10) {
    markers.push(db);
  }
  return markers;
}

function formatRangeFrequency(frequencyHz: number): string {
  return formatFrequency(frequencyHz, {
    precisionMHz: 4,
    precisionKHz: 2,
    trimTrailingZeros: true,
  });
}

function timestampLabel(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function buildWebUsbSnapshotStatsLines(
  data: WebUsbSnapshotData,
  timestamp = timestampLabel(),
): string[] {
  const range = getFrequencyRange(data);
  const lines = [
    `${formatRangeFrequency(range.min)} – ${formatRangeFrequency(range.max)}`,
    timestamp,
    `Device Name: ${data.deviceName || "Unknown"}`,
    "Onscreen",
    `FFT size (# of points): ${data.fftSize}`,
    `Gain: ${data.gainDb.toFixed(1)}dB | PPM: ${data.ppm}`,
  ];
  if (data.geolocation) {
    lines.push(formatSnapshotLocationLine(data.geolocation));
  }
  return lines;
}

function createMapper(
  width: number,
  height: number,
  range: Range,
  dpr: number,
): CoordinateMapper {
  const plotLeft = Math.max(FFT_AREA_MIN.x, 52);
  return new CoordinateMapper(
    {
      x: plotLeft,
      y: FFT_AREA_MIN.y,
      width: Math.max(1, width - plotLeft - 40),
      height: Math.max(1, height - 40 - FFT_AREA_MIN.y),
    },
    range,
    { min: SNAPSHOT_MIN_DB, max: SNAPSHOT_MAX_DB },
    dpr,
  );
}

function drawSpectrumFrame(
  dc: CanvasDrawingContext | SVGDrawingContext,
  renderer: SnapshotRenderer,
  data: WebUsbSnapshotData,
  range: Range,
): void {
  renderer.drawBackground(dc);
  renderer.drawAxes(dc);
  renderer.drawGridLines(dc, getDbMarkers());
  renderer.drawDbMarkers(dc, getDbMarkers(), " dB");
  renderer.drawTrace(dc, data.waveform, range, {
    crispTrace: true,
  });
  renderer.drawFrequencyLabels(dc, 1, data.centerFrequencyHz);
}

function getStatsRowLayout(lines: string[], width: number): {
  height: number;
  leftLines: string[];
  rightLines: string[];
  locationLine: string | null;
  leftColumnX: number;
  rightColumnX: number;
  columnRowCount: number;
} {
  const lastLine = lines[lines.length - 1] ?? "";
  const locationLine = SNAPSHOT_STATS_LOCATION_PATTERN.test(lastLine)
    ? lastLine
    : null;
  const columnLines = locationLine ? lines.slice(0, -1) : lines;
  const splitIndex = Math.ceil(columnLines.length / 2);
  const leftLines = columnLines.slice(0, splitIndex);
  const rightLines = columnLines.slice(splitIndex);
  const columnRowCount = Math.max(leftLines.length, rightLines.length);
  const rowCount = columnRowCount + (locationLine ? 1 : 0);
  const availableWidth = Math.max(1, width - 52 - 40);
  const centerGap = Math.max(32, Math.round(availableWidth * 0.08));
  return {
    height:
      rowCount * SNAPSHOT_STATS_LINE_HEIGHT +
      SNAPSHOT_STATS_PADDING_Y * 2 +
      1 +
      (locationLine ? SNAPSHOT_STATS_LOCATION_GAP : 0),
    leftLines,
    rightLines,
    locationLine,
    leftColumnX: 52,
    rightColumnX: 52 + Math.round((availableWidth - centerGap) / 2),
    columnRowCount,
  };
}

function getStatsRowHeight(hasLocation: boolean): number {
  return getStatsRowLayout(
    hasLocation
      ? ["", "", "", "", "", "", "Location: 0, 0"]
      : ["", "", "", "", "", ""],
    800,
  ).height;
}

function drawStatsRowCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: string[],
  dpr: number,
): void {
  const layout = getStatsRowLayout(lines, width);
  context.save();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = SNAPSHOT_THEME.bg;
  context.fillRect(0, height, width, layout.height);
  context.fillStyle = SNAPSHOT_THEME.grid;
  context.fillRect(Math.max(FFT_AREA_MIN.x, 52), height, width - 92, 1);
  context.font = "17px JetBrains Mono, monospace";
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  const drawLine = (line: string, x: number, y: number) => {
    context.fillStyle = "rgba(0, 0, 0, 0.45)";
    context.fillText("-", x, y);
    const pointWidth = context.measureText("-").width;
    context.fillStyle = SNAPSHOT_THEME.text;
    context.fillText(line, x + pointWidth + 4, y);
  };
  for (let index = 0; index < layout.columnRowCount; index += 1) {
    const y = height + SNAPSHOT_STATS_PADDING_Y + (index + 0.8) * SNAPSHOT_STATS_LINE_HEIGHT;
    if (layout.leftLines[index]) drawLine(layout.leftLines[index], layout.leftColumnX, y);
    if (layout.rightLines[index]) drawLine(layout.rightLines[index], layout.rightColumnX, y);
  }
  if (layout.locationLine) {
    const y = height + SNAPSHOT_STATS_PADDING_Y +
      (layout.columnRowCount + 0.8) * SNAPSHOT_STATS_LINE_HEIGHT +
      SNAPSHOT_STATS_LOCATION_GAP;
    drawLine(layout.locationLine, layout.leftColumnX, y);
  }
  context.restore();
}

function drawStatsRowSvg(
  context: SVGDrawingContext,
  width: number,
  height: number,
  lines: string[],
): void {
  const layout = getStatsRowLayout(lines, width);
  context.setFill(SNAPSHOT_THEME.bg);
  context.fillRect(0, height, width, layout.height);
  context.setFill(SNAPSHOT_THEME.grid);
  context.fillRect(Math.max(FFT_AREA_MIN.x, 52), height, width - 92, 1);
  context.setFont("17px JetBrains Mono, monospace");
  context.setTextBaseline("alphabetic");
  context.setTextAlign("left");
  const drawLine = (line: string, x: number, y: number) => {
    context.setFill("rgba(0, 0, 0, 0.45)");
    context.fillText("-", x, y);
    const pointWidth = context.measureTextWidth("-");
    context.setFill(SNAPSHOT_THEME.text);
    context.fillText(line, x + pointWidth + 4, y);
  };
  for (let index = 0; index < layout.columnRowCount; index += 1) {
    const y = height + SNAPSHOT_STATS_PADDING_Y + (index + 0.8) * SNAPSHOT_STATS_LINE_HEIGHT;
    if (layout.leftLines[index]) drawLine(layout.leftLines[index], layout.leftColumnX, y);
    if (layout.rightLines[index]) drawLine(layout.rightLines[index], layout.rightColumnX, y);
  }
  if (layout.locationLine) {
    const y = height + SNAPSHOT_STATS_PADDING_Y +
      (layout.columnRowCount + 0.8) * SNAPSHOT_STATS_LINE_HEIGHT +
      SNAPSHOT_STATS_LOCATION_GAP;
    drawLine(layout.locationLine, layout.leftColumnX, y);
  }
}

export function renderWebUsbSnapshot(
  data: WebUsbSnapshotData,
  options: WebUsbSnapshotOptions,
): HTMLCanvasElement | string {
  const width = Math.max(320, Math.floor(options.width));
  const height = Math.max(240, Math.floor(options.height));
  const range = getFrequencyRange(data);
  const lines = options.showStats
    ? buildWebUsbSnapshotStatsLines(data, options.timestampLabel)
    : [];
  const outputHeight = height +
    (options.showStats ? getStatsRowLayout(lines, width).height : 0);

  if (options.format === "svg") {
    const context = new SVGDrawingContext(width, outputHeight);
    const renderer = new SnapshotRenderer(
      createMapper(width, height, range, 1),
      SNAPSHOT_THEME,
    );
    drawSpectrumFrame(context, renderer, data, range);
    if (options.showStats) drawStatsRowSvg(context, width, height, lines);
    return context.getSVG();
  }

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(outputHeight * dpr);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D rendering is unavailable.");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const renderer = new SnapshotRenderer(
    createMapper(width, height, range, dpr),
    SNAPSHOT_THEME,
  );
  drawSpectrumFrame(
    new CanvasDrawingContext(context),
    renderer,
    data,
    range,
  );
  if (options.showStats) drawStatsRowCanvas(context, width, height, lines, dpr);
  return canvas;
}

export function getWebUsbSnapshotFilename(
  format: WebUsbSnapshotFormat,
  timestamp = new Date().toISOString().replace(/:/g, "-"),
): string {
  return `webusb-spectrum-${timestamp}.${format}`;
}

export function getWebUsbSnapshotStatsHeight(hasLocation = false): number {
  return getStatsRowHeight(hasLocation);
}

export function getWebUsbSnapshotOutputHeight(
  height: number,
  showStats: boolean,
  hasLocation = false,
): number {
  return Math.max(240, Math.floor(height)) +
    (showStats ? getWebUsbSnapshotStatsHeight(hasLocation) : 0);
}
