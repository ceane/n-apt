export type WaterfallDbAxisTheme = {
  background: string;
  grid: string;
  text: string;
};

export type WaterfallDbAxisOptions = {
  waterfallCanvas: HTMLCanvasElement;
  dbMin: number;
  dbMax: number;
  unit: "dB" | "dBm";
  theme: WaterfallDbAxisTheme;
  devicePixelRatio?: number;
  /** Destination plot dimensions matching the FFT snapshot grid. */
  referencePlotWidth?: number;
  referencePlotHeight?: number;
  /**
   * Pixel plot insets in source coordinates. Horizontal margins crop the image;
   * vertical insets bound the dB scale.
   */
  plotInsets?: { left?: number; right?: number; top?: number; bottom?: number };
  /** Keep a top stats/header row at full width instead of applying plot cropping. */
  uncroppedHeaderHeight?: number;
};

const AXIS_GUTTER_WIDTH_PX = 52;
const RIGHT_PADDING_PX = 40;
const BOTTOM_PADDING_PX = 40;
const BOTTOM_GUTTER_PX = 8;
const LABEL_FONT_SIZE_PX = 10;
const LABEL_INSET_PX = 10;

function clampInset(inset: number, size: number): number {
  return Number.isFinite(inset) ? Math.max(0, Math.min(size, inset)) : 0;
}

export function composeWaterfallCanvasWithDbAxis({
  waterfallCanvas,
  dbMin,
  dbMax,
  unit,
  theme,
  devicePixelRatio =
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  plotInsets,
  uncroppedHeaderHeight = 0,
  referencePlotWidth,
  referencePlotHeight,
}: WaterfallDbAxisOptions): HTMLCanvasElement {
  if (
    waterfallCanvas.width <= 0 ||
    waterfallCanvas.height <= 0 ||
    !Number.isFinite(dbMin) ||
    !Number.isFinite(dbMax) ||
    dbMax <= dbMin
  ) {
    return waterfallCanvas;
  }

  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const leftCrop = clampInset(plotInsets?.left ?? 0, waterfallCanvas.width);
  const rightCrop = clampInset(
    plotInsets?.right ?? 0,
    waterfallCanvas.width - leftCrop,
  );
  const plotWidth = waterfallCanvas.width - leftCrop - rightCrop;
  if (plotWidth <= 0) return waterfallCanvas;

  const labels = [`${dbMax}${unit}`, `${dbMin}`];
  // Reserve enough room for fractional values without clipping the left edge.
  const labelWidth = Math.max(...labels.map((label) => label.length)) * LABEL_FONT_SIZE_PX * 0.7;
  const gutterWidth = Math.ceil(Math.max(AXIS_GUTTER_WIDTH_PX, labelWidth + LABEL_INSET_PX) * dpr);
  const rightPadding = Math.round(RIGHT_PADDING_PX * dpr);
  const targetPlotWidth =
    typeof referencePlotWidth === "number" &&
    Number.isFinite(referencePlotWidth) &&
    referencePlotWidth > 0
      ? Math.round(referencePlotWidth)
      : plotWidth;

  const hasExplicitPlotInsets = plotInsets != null;
  const requestedTop = plotInsets?.top;
  const plotTop = clampInset(
    requestedTop !== undefined
      ? requestedTop
      : hasExplicitPlotInsets
        ? 0
        : 20 * dpr,
    waterfallCanvas.height,
  );
  const requestedBottom = plotInsets?.bottom;
  const sourceBottomInset = clampInset(
    requestedBottom !== undefined
      ? requestedBottom
      : hasExplicitPlotInsets
        ? 0
        : BOTTOM_PADDING_PX * dpr,
    waterfallCanvas.height - plotTop,
  );
  const sourcePlotBottom = waterfallCanvas.height - sourceBottomInset;
  const sourcePlotHeight = Math.max(0, sourcePlotBottom - plotTop);
  const targetPlotHeight =
    typeof referencePlotHeight === "number" &&
    Number.isFinite(referencePlotHeight) &&
    referencePlotHeight > 0
      ? Math.round(referencePlotHeight)
      : sourcePlotHeight;
  const visiblePlotHeight = Math.min(sourcePlotHeight, targetPlotHeight);
  if (visiblePlotHeight <= 0) return waterfallCanvas;

  // Keep source rows at native vertical scale. If the source extends past the
  // FFT plot bottom, crop that tail and leave a separate blank bottom gutter.
  const visibleContentHeight = plotTop + visiblePlotHeight;
  const bottomPadding = Math.round(BOTTOM_GUTTER_PX * dpr);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = targetPlotWidth + gutterWidth + rightPadding;
  outputCanvas.height = visibleContentHeight + bottomPadding;

  const context = outputCanvas.getContext("2d");
  if (!context) return waterfallCanvas;

  context.fillStyle = theme.background;
  context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  context.drawImage(
    waterfallCanvas,
    leftCrop,
    0,
    plotWidth,
    visibleContentHeight,
    gutterWidth,
    0,
    targetPlotWidth,
    visibleContentHeight,
  );

  const headerHeight = clampInset(uncroppedHeaderHeight, visibleContentHeight);
  if (headerHeight > 0) {
    context.drawImage(
      waterfallCanvas,
      0,
      0,
      waterfallCanvas.width,
      headerHeight,
      0,
      0,
      outputCanvas.width,
      headerHeight,
    );
  }

  const fontSize = LABEL_FONT_SIZE_PX * dpr;
  const markerInset = LABEL_INSET_PX * dpr;
  const markerTop = plotTop;
  const markerBottom = visibleContentHeight;
  const markerHeight = Math.max(0, markerBottom - markerTop);
  const markerY = (db: number) =>
    markerTop + ((dbMax - db) / (dbMax - dbMin)) * markerHeight;

  context.font = `${fontSize}px 'JetBrains Mono', monospace`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = theme.text;
  context.strokeStyle = theme.grid;
  context.lineWidth = Math.max(1, dpr);
  context.beginPath();

  const markers = [dbMax, dbMin];
  markers.forEach((db, index) => {
    const y = markerY(db);
    context.moveTo(gutterWidth - 4 * dpr, y);
    context.lineTo(gutterWidth, y);

    context.fillText(labels[index], gutterWidth - markerInset, y);
  });

  context.stroke();
  return outputCanvas;
}
