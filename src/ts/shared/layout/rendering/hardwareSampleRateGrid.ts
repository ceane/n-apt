import type { Range } from "@n-apt/layout/rendering/CoordinateMapper";

interface HardwareGridContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
}

export function drawHardwareSampleRateBlocks(
  ctx: HardwareGridContext,
  {
    anchorRange, visibleRange, sampleSpan, blockEpsilon, boundaryEpsilon,
    drawRightBoundary, toX, top, bottom, labelY, subLabelY, formatWidth,
  }: {
    anchorRange: Range;
    visibleRange: Range;
    sampleSpan: number;
    blockEpsilon: number;
    boundaryEpsilon: number;
    drawRightBoundary: boolean;
    toX: (frequency: number) => number;
    top: number;
    bottom: number;
    labelY: number;
    subLabelY: number;
    formatWidth: (span: number) => string;
  },
): void {
  let current = anchorRange.min;
  while (current < anchorRange.max - blockEpsilon) {
    const start = current;
    const end = Math.min(start + sampleSpan, anchorRange.max);
    const span = end - start;
    const isFull = span >= sampleSpan - blockEpsilon;
    if (end > visibleRange.min && start < visibleRange.max) {
      if (
        start > anchorRange.min + boundaryEpsilon &&
        start >= visibleRange.min && start <= visibleRange.max
      ) {
        const x = toX(start);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      if (
        drawRightBoundary && end < anchorRange.max - boundaryEpsilon &&
        end >= visibleRange.min && end <= visibleRange.max
      ) {
        const x = toX(end);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      const visibleStart = Math.max(start, visibleRange.min);
      const visibleEnd = Math.min(end, visibleRange.max);
      const center = (visibleStart + visibleEnd) / 2;
      if (center >= visibleRange.min && center <= visibleRange.max) {
        const x = toX(center);
        const label = isFull ? "Hardware Sample Rate" : "Next Sample";
        const subLabel = formatWidth(span);
        ctx.fillText(label, x, labelY);
        ctx.fillText(subLabel, x, subLabelY);
      }
    }
    current = end;
  }
}
