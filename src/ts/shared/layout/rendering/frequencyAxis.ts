import type { AppStyledTheme } from "@n-apt/ui/Theme";
import {
  createCanvasVfoAxisContext,
  drawVfoAxis,
} from "@n-apt/layout/rendering/vfoAxis";

export type FrequencyRangeLike = { min: number; max: number };

export type FrequencyAxisPlacement = "top" | "bottom";

export type FrequencyAxisDetail = "standard" | "dense";

export type FrequencyAxisTheme = {
  background: string;
  grid: string;
  tick: string;
  label: string;
  center: string;
};

export type FrequencyAxisComposeOptions = {
  baseCanvas: HTMLCanvasElement;
  /** Reuse this canvas as the composite target instead of allocating one. */
  outputCanvas?: HTMLCanvasElement | null;
  frequencyRange: FrequencyRangeLike;
  centerFrequencyHz?: number | null;
  placement?: FrequencyAxisPlacement;
  detail?: FrequencyAxisDetail;
  plotInsets?: { left: number; right: number };
  showBorder?: boolean;
  tickDirection?: "up" | "down";
  theme: FrequencyAxisTheme;
  devicePixelRatio?: number;
};

export function buildFrequencyAxisTheme(
  styledTheme: Partial<AppStyledTheme> & {
    colors?: Partial<AppStyledTheme["colors"]>;
  },
): FrequencyAxisTheme {
  const colors = styledTheme.colors ?? {};
  return {
    background:
      colors.background ?? styledTheme.background ?? "rgba(10, 10, 10, 1)",
    grid: colors.border ?? styledTheme.border ?? "rgba(50, 50, 50, 1)",
    tick: colors.textMuted ?? styledTheme.textMuted ?? "#666666",
    label: colors.textSecondary ?? styledTheme.textSecondary ?? "#888888",
    center: colors.textPrimary ?? styledTheme.textPrimary ?? "#cccccc",
  };
}

export function getFrequencyAxisHeight(detail: FrequencyAxisDetail): number {
  return detail === "dense" ? 58 : 40;
}

type PaintFrequencyAxisOptions = Omit<
  FrequencyAxisComposeOptions,
  "baseCanvas"
> & {
  outputWidth: number;
  outputHeight: number;
};

/**
 * Paint just the axis furniture onto an already-sized context. Kept separate
 * from compositing so callers that redraw the same axis every frame can cache
 * it in its own layer.
 */
function paintFrequencyAxis(
  ctx: CanvasRenderingContext2D,
  {
    frequencyRange,
    centerFrequencyHz,
    placement = "top",
    detail = "standard",
    plotInsets,
    showBorder = true,
    tickDirection = "down",
    theme,
    devicePixelRatio = window.devicePixelRatio || 1,
    outputWidth,
    outputHeight,
  }: PaintFrequencyAxisOptions,
): void {
  const axisHeight = getFrequencyAxisHeight(detail);
  const plotTop = placement === "top" ? axisHeight : 0;
  const leftPad = Math.round((plotInsets?.left ?? 50) * devicePixelRatio);
  const rightPad = Math.round((plotInsets?.right ?? 40) * devicePixelRatio);
  const plotLeft = leftPad;
  const plotRight = outputWidth - rightPad;
  const targetTicks = detail === "dense" ? 9 : 10;
  const labelFontPx = detail === "dense" ? 16 : 13;
  const centerFontPx = detail === "dense" ? 18 : 15;
  const tickLen = detail === "dense" ? 9 : 7;
  const minorTickLen = detail === "dense" ? 5 : 4;
  const labelY = placement === "top" ? 24 : outputHeight - 11;
  const tickTop =
    placement === "top" ? axisHeight - 16 : outputHeight - axisHeight + 3;
  const axisLineY =
    placement === "top" ? axisHeight - 1 : outputHeight - axisHeight;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, 0, plotRight - plotLeft, outputHeight);
  ctx.clip();

  drawVfoAxis({
    ctx: createCanvasVfoAxisContext(ctx),
    frequencyRange,
    centerFrequencyHz,
    bounds: {
      left: plotLeft,
      right: plotRight,
      top: plotTop,
      bottom: outputHeight,
    },
    y: showBorder ? axisLineY : tickTop,
    labelY,
    orientation: placement,
    tickDirection,
    targetTicks,
    showAxisLine: showBorder,
    icon: "circle",
    theme: {
      grid: theme.grid,
      tick: theme.tick,
      edgeTick: theme.center,
      label: theme.label,
      edgeLabel: theme.center,
      center: theme.center,
      centerLine: theme.center,
    },
    fontPx: labelFontPx,
    centerFontPx,
    tickLength: tickLen,
    centerTickLength: tickLen + 2,
    minorTickLength: minorTickLen,
    edgeReservePx: detail === "dense" ? 6 : 14,
    centerReservePx: detail === "dense" ? 10 : 10,
    vfoOptions: {
      visualState: detail === "dense" ? "snapshot" : "default",
      drawingType: "canvas",
      orientation: placement,
      tickPrecision: "default",
    },
  });

  ctx.restore();
  ctx.restore();
}

/**
 * Render the axis alone onto a transparent canvas the same size as the eventual
 * composite, so it can be blitted over a base canvas without redrawing text.
 */
export function renderFrequencyAxisLayer(
  options: PaintFrequencyAxisOptions,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, options.outputWidth);
  canvas.height = Math.max(1, options.outputHeight);
  const ctx = canvas.getContext("2d");
  if (ctx) paintFrequencyAxis(ctx, options);
  return canvas;
}

export function composeCanvasWithFrequencyAxis({
  baseCanvas,
  outputCanvas,
  ...options
}: FrequencyAxisComposeOptions): HTMLCanvasElement {
  const axisHeight = getFrequencyAxisHeight(options.detail ?? "standard");
  const output = outputCanvas ?? document.createElement("canvas");
  const width = baseCanvas.width;
  const height = baseCanvas.height + axisHeight;
  if (output.width !== width) output.width = width;
  if (output.height !== height) output.height = height;

  const ctx = output.getContext("2d");
  if (!ctx) {
    return baseCanvas;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = options.theme.background;
  ctx.fillRect(0, 0, width, height);

  const plotTop = (options.placement ?? "top") === "top" ? axisHeight : 0;
  ctx.drawImage(baseCanvas, 0, plotTop);

  paintFrequencyAxis(ctx, {
    ...options,
    outputWidth: width,
    outputHeight: height,
  });

  return output;
}

export type FastWaterfallSnapshotCanvasOptions = {
  waterfallCanvas: HTMLCanvasElement | null;
  waterfallOverlayCanvas?: HTMLCanvasElement | null;
  frequencyRange: FrequencyRangeLike | null;
  centerFrequencyHz?: number | null;
  detail?: FrequencyAxisDetail;
  theme: FrequencyAxisTheme;
};

export function composeWaterfallSnapshotCanvas({
  waterfallCanvas,
  waterfallOverlayCanvas = null,
  frequencyRange,
  centerFrequencyHz = null,
  detail = "dense",
  theme,
}: FastWaterfallSnapshotCanvasOptions): HTMLCanvasElement | null {
  if (!waterfallCanvas) {
    return null;
  }

  const srcCanvas =
    (waterfallCanvas as any)._lastFrameCanvas || waterfallCanvas;
  const base = document.createElement("canvas");
  base.width = srcCanvas.width;
  base.height = srcCanvas.height;

  const ctx = base.getContext("2d");
  if (!ctx) {
    return srcCanvas;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(srcCanvas, 0, 0);
  if (waterfallOverlayCanvas) {
    ctx.drawImage(waterfallOverlayCanvas, 0, 0);
  }

  if (!frequencyRange) {
    return base;
  }

  return composeCanvasWithFrequencyAxis({
    baseCanvas: base,
    frequencyRange,
    centerFrequencyHz,
    placement: "top",
    detail,
    plotInsets: { left: 40, right: 40 },
    showBorder: false,
    tickDirection: "down",
    theme,
  });
}
