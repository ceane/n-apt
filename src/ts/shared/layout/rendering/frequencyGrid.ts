/**
 * Shared frequency-axis grid furniture for the live spectrum canvases.
 *
 * Both the 2D signal renderer and the overlay renderer draw the same axis:
 * edge lines with their edge labels, vertical grid lines, tick marks, and tick
 * labels that are dropped when they would collide with the edge or center
 * labels. The two callers differ only in cosmetic inputs (whether geometry is
 * rounded to whole pixels, whether grid lines are drawn at an overlay alpha,
 * and which formatters they use for edge vs. tick labels), so those are
 * options here and the drawing itself is shared.
 *
 * `fillStyle` is set from `labelColor`; callers own `font` and text metrics.
 */

type FrequencyGridContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export type FrequencyGridOptions = {
  ctx: FrequencyGridContext;
  minFreq: number;
  maxFreq: number;
  stepHz: number;
  /** Left edge of the plot area; the start edge line and label sit here. */
  plotLeft: number;
  /** Right edge of the plot area; the end edge line and label sit here. */
  plotRight: number;
  /** Top of the plot area (grid lines and edge lines start here). */
  top: number;
  /** Bottom of the plot area (tick marks hang below this). */
  bottom: number;
  /** Full canvas width; the center label reserves its span around width / 2. */
  canvasWidth: number;
  gridColor: string;
  tickColor: string;
  labelColor: string;
  /** Formatter for the start/end edge labels. */
  formatEdgeLabel: (freq: number) => string;
  /** Formatter for the interior tick labels. */
  formatTickLabel: (freq: number) => string;
  /** Already-composed center label text, measured to reserve its span. */
  centerLabelText: string;
  /** When set, grid lines are drawn inside a save/restore at this alpha. */
  gridOpacity?: number;
  /** Round geometry to whole pixels instead of using fractional positions. */
  roundX?: boolean;
  tickLength?: number;
  /** Distance below `bottom` for tick labels. */
  labelOffsetY?: number;
  edgeReservePx?: number;
  centerReservePx?: number;
  collidePadPx?: number;
};

export function drawFrequencyGrid({
  ctx,
  minFreq,
  maxFreq,
  stepHz,
  plotLeft,
  plotRight,
  top,
  bottom,
  canvasWidth,
  gridColor,
  tickColor,
  labelColor,
  formatEdgeLabel,
  formatTickLabel,
  centerLabelText,
  gridOpacity,
  roundX = false,
  tickLength = 7,
  labelOffsetY = 25,
  edgeReservePx = 15,
  centerReservePx = 15,
  collidePadPx = 10,
}: FrequencyGridOptions): void {
  const bandwidth = maxFreq - minFreq;
  if (!(bandwidth > 0) || !(stepHz > 0)) return;

  const plotWidth = plotRight - plotLeft;
  const labelY = bottom + labelOffsetY;
  const freqToX = (freq: number) =>
    plotLeft + ((freq - minFreq) / bandwidth) * plotWidth;
  const toDrawX = (freq: number) => {
    const x = freqToX(freq);
    return roundX ? Math.round(x) : x;
  };

  const startLabel = formatEdgeLabel(minFreq);
  const endLabel = formatEdgeLabel(maxFreq);

  // Edge and center labels always reserve their span. A tick label that would
  // overlap any reserved span is dropped rather than drawn on top of it.
  const occupiedRects: { x1: number; x2: number }[] = [
    {
      x1: plotLeft - 5,
      x2: plotLeft + ctx.measureText(startLabel).width + edgeReservePx,
    },
    {
      x1: plotRight - ctx.measureText(endLabel).width - edgeReservePx,
      x2: plotRight + 5,
    },
    {
      x1: canvasWidth / 2 - ctx.measureText(centerLabelText).width / 2 - centerReservePx,
      x2: canvasWidth / 2 + ctx.measureText(centerLabelText).width / 2 + centerReservePx,
    },
  ];

  const isColliding = (x: number, text: string): boolean => {
    const halfWidth = ctx.measureText(text).width / 2;
    const x1 = x - halfWidth - collidePadPx;
    const x2 = x + halfWidth + collidePadPx;
    return occupiedRects.some((r) => x1 < r.x2 && x2 > r.x1);
  };

  ctx.strokeStyle = gridColor;
  ctx.fillStyle = labelColor;

  // Start edge line + label
  const startX = toDrawX(minFreq);
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(startX, top);
  ctx.lineTo(startX, bottom + tickLength);
  ctx.stroke();
  ctx.fillText(startLabel, plotLeft, labelY);

  // End edge line + label
  const endX = toDrawX(maxFreq);
  ctx.textAlign = "right";
  ctx.beginPath();
  ctx.moveTo(endX, top);
  ctx.lineTo(endX, bottom + tickLength);
  ctx.stroke();
  ctx.fillText(endLabel, plotRight, labelY);

  // Interior grid lines, tick marks, and collision-avoided tick labels
  ctx.textAlign = "center";
  const lowerFreq = Math.ceil(minFreq / stepHz) * stepHz;
  for (let freq = lowerFreq; freq < maxFreq - 0.0001; freq += stepHz) {
    const x = toDrawX(freq);

    if (gridOpacity === undefined) {
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, gridOpacity));
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = tickColor;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + tickLength);
    ctx.stroke();

    const label = formatTickLabel(freq);
    if (!isColliding(freqToX(freq), label)) {
      ctx.fillText(label, x, labelY);
    }
  }
}
