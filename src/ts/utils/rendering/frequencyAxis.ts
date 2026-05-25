import type { AppStyledTheme } from "@n-apt/components/ui/Theme";
import {
  createCanvasVfoAxisContext,
  drawVfoAxis,
} from "@n-apt/utils/rendering/vfoAxis";

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

export function composeCanvasWithFrequencyAxis({
  baseCanvas,
  frequencyRange,
  centerFrequencyHz,
  placement = "top",
  detail = "standard",
  plotInsets,
  showBorder = true,
  tickDirection = "down",
  theme,
  devicePixelRatio = window.devicePixelRatio || 1,
}: FrequencyAxisComposeOptions): HTMLCanvasElement {
  const axisHeight = detail === "dense" ? 58 : 40;
  const output = document.createElement("canvas");
  output.width = baseCanvas.width;
  output.height = baseCanvas.height + axisHeight;

  const ctx = output.getContext("2d");
  if (!ctx) {
    return baseCanvas;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, output.width, output.height);

  const plotTop = placement === "top" ? axisHeight : 0;
  ctx.drawImage(baseCanvas, 0, plotTop);

  const axisWidth = output.width;
  const leftPad = Math.round((plotInsets?.left ?? 50) * devicePixelRatio);
  const rightPad = Math.round((plotInsets?.right ?? 40) * devicePixelRatio);
  const plotLeft = leftPad;
  const plotRight = axisWidth - rightPad;
  const targetTicks = detail === "dense" ? 7 : 10;
  const labelFontPx = detail === "dense" ? 16 : 13;
  const centerFontPx = detail === "dense" ? 18 : 15;
  const tickLen = detail === "dense" ? 9 : 7;
  const minorTickLen = detail === "dense" ? 5 : 4;
  const labelY = placement === "top" ? 24 : output.height - 11;
  const tickTop =
    placement === "top" ? axisHeight - 16 : output.height - axisHeight + 3;
  const axisLineY =
    placement === "top" ? axisHeight - 1 : output.height - axisHeight;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, 0, plotRight - plotLeft, output.height);
  ctx.clip();

  drawVfoAxis({
    ctx: createCanvasVfoAxisContext(ctx),
    frequencyRange,
    centerFrequencyHz,
    bounds: {
      left: plotLeft,
      right: plotRight,
      top: plotTop,
      bottom: output.height,
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
      label: theme.label,
      center: theme.center,
      centerLine: theme.center,
    },
    fontPx: labelFontPx,
    centerFontPx,
    tickLength: tickLen,
    centerTickLength: tickLen + 2,
    minorTickLength: minorTickLen,
    edgeReservePx: detail === "dense" ? 22 : 14,
    centerReservePx: detail === "dense" ? 16 : 10,
  });

  ctx.restore();
  ctx.restore();
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
