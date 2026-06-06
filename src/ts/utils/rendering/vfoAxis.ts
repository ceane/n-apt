import { findBestFrequencyRange } from "@n-apt/consts";
import {
  formatFrequency,
  formatFrequencyHighRes,
} from "@n-apt/utils/frequency";
import { fmtFreqTick, tickPrecisionForStep } from "./formatters";

export type VfoAxisOrientation = "top" | "bottom";
export type VfoAxisTickDirection = "up" | "down";
export type VfoAxisIcon = "hand" | "circle" | "wave" | string;

export type VfoAxisRange = { min: number; max: number };
export type VfoAxisContentBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type VfoAxisTheme = {
  grid?: string;
  tick: string;
  edgeTick?: string;
  label: string;
  edgeLabel?: string;
  center: string;
  centerLine?: string;
};

export type VfoAxisPrecision = {
  edgeMHz?: number;
  edgeKHz?: number;
  centerMinMHz?: number;
  centerMinKHz?: number;
  centerMinGHz?: number;
};

export type VfoAxisContext = {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureTextWidth(text: string): number;
  setStroke(color: string, width?: number): void;
  setFill(color: string): void;
  setFont(font: string): void;
  setTextAlign(align: CanvasTextAlign): void;
  setTextBaseline(baseline: CanvasTextBaseline): void;
};

export type DrawVfoAxisOptions = {
  ctx: VfoAxisContext;
  frequencyRange: VfoAxisRange;
  centerFrequencyHz?: number | null;
  bounds: VfoAxisContentBounds;
  y: number;
  labelY: number;
  orientation?: VfoAxisOrientation;
  tickDirection?: VfoAxisTickDirection;
  tickStepHz?: number;
  targetTicks?: number;
  showAxisLine?: boolean;
  showEdgeLabels?: boolean;
  showTickMarks?: boolean;
  showTickLabels?: boolean;
  showCenterLabel?: boolean;
  showCenterTick?: boolean;
  showCenterLine?: boolean;
  centerLineTop?: number;
  centerLineBottom?: number;
  icon?: VfoAxisIcon;
  theme: VfoAxisTheme;
  fontPx?: number;
  centerFontPx?: number;
  textBaseline?: CanvasTextBaseline;
  tickLength?: number;
  centerTickLength?: number;
  minorTickLength?: number;
  precision?: VfoAxisPrecision;
  useHighResLabels?: boolean;
  edgeReservePx?: number;
  centerReservePx?: number;
  lineWidth?: number;
};

export function createCanvasVfoAxisContext(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): VfoAxisContext {
  return {
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    beginPath: () => ctx.beginPath(),
    moveTo: (x, y) => ctx.moveTo(x, y),
    lineTo: (x, y) => ctx.lineTo(x, y),
    stroke: () => ctx.stroke(),
    fillText: (text, x, y) => ctx.fillText(text, x, y),
    measureTextWidth: (text) => ctx.measureText(text).width,
    setStroke: (color, width) => {
      ctx.strokeStyle = color;
      if (width !== undefined) ctx.lineWidth = width;
    },
    setFill: (color) => {
      ctx.fillStyle = color;
    },
    setFont: (font) => {
      ctx.font = font;
    },
    setTextAlign: (align) => {
      ctx.textAlign = align;
    },
    setTextBaseline: (baseline) => {
      ctx.textBaseline = baseline;
    },
  };
}

export function formatVfoAxisEdgeLabel(
  freq: number,
  useHighRes: boolean,
  _stepHz: number,
): string {
  if (useHighRes && Math.abs(freq) >= 1_000_000) {
    return formatFrequencyHighRes(freq);
  }
  return formatFrequency(freq, {
    trimTrailingZeros: true,
    precisionMHz: 4,
    precisionKHz: 2,
    precisionGHz: 3,
  });
}

export function formatVfoAxisCenterLabel(
  freq: number,
  _useHighRes: boolean,
  stepHz: number,
  precision?: VfoAxisPrecision,
): string {
  const { precisionMHz, precisionKHz } = tickPrecisionForStep(stepHz);
  return formatFrequency(freq, {
    trimTrailingZeros: true,
    precisionMHz: Math.min(
      Math.max(precision?.centerMinMHz ?? 4, precisionMHz),
      4,
    ),
    precisionKHz: Math.min(
      Math.max(precision?.centerMinKHz ?? 0, precisionKHz),
      2,
    ),
    precisionGHz: Math.min(Math.max(precision?.centerMinGHz ?? 3, 3), 3),
  });
}

export function getVfoAxisIcon(icon: VfoAxisIcon | undefined): string {
  if (!icon || icon === "hand") return "✋";
  if (icon === "circle") return "○";
  if (icon === "wave") return "👋";
  return icon;
}

function labelRect(
  x: number,
  width: number,
  align: CanvasTextAlign,
  pad: number,
) {
  if (align === "left" || align === "start") {
    return { x1: x - pad, x2: x + width + pad };
  }
  if (align === "right" || align === "end") {
    return { x1: x - width - pad, x2: x + pad };
  }
  return { x1: x - width / 2 - pad, x2: x + width / 2 + pad };
}

export function drawVfoAxis({
  ctx,
  frequencyRange,
  centerFrequencyHz,
  bounds,
  y,
  labelY,
  tickDirection = "down",
  tickStepHz,
  targetTicks = 10,
  showAxisLine = true,
  showEdgeLabels = true,
  showTickMarks = true,
  showTickLabels = true,
  showCenterLabel = true,
  showCenterTick,
  showCenterLine = false,
  centerLineTop = bounds.top,
  centerLineBottom = bounds.bottom,
  icon = "hand",
  theme,
  fontPx = 12,
  centerFontPx = fontPx,
  textBaseline = "middle",
  tickLength = 7,
  centerTickLength = tickLength,
  minorTickLength = 4,
  precision,
  useHighResLabels,
  edgeReservePx = 14,
  centerReservePx = 10,
  lineWidth = 1,
}: DrawVfoAxisOptions): void {
  const bandwidth = frequencyRange.max - frequencyRange.min;
  if (!(bandwidth > 0)) return;

  const plotWidth = Math.max(1, bounds.right - bounds.left);
  const stepHz = tickStepHz ?? findBestFrequencyRange(bandwidth, targetTicks);
  const lowerFreq = Math.ceil(frequencyRange.min / stepHz) * stepHz;
  const useHighRes = useHighResLabels ?? bandwidth / Math.max(stepHz, 1) >= 100;
  const freqToX = (freq: number) =>
    bounds.left + ((freq - frequencyRange.min) / bandwidth) * plotWidth;

  const occupiedRects: { x1: number; x2: number }[] = [];
  const occupy = (
    x: number,
    text: string,
    align: CanvasTextAlign = "center",
    pad = 10,
  ) => {
    occupiedRects.push(labelRect(x, ctx.measureTextWidth(text), align, pad));
  };
  const isColliding = (
    x: number,
    text: string,
    align: CanvasTextAlign = "center",
    pad = 8,
  ) => {
    const rect = labelRect(x, ctx.measureTextWidth(text), align, pad);
    return occupiedRects.some(
      (occupied) => rect.x1 < occupied.x2 && rect.x2 > occupied.x1,
    );
  };

  const startLabel = formatVfoAxisEdgeLabel(
    frequencyRange.min,
    useHighRes,
    stepHz,
  );
  const endLabel = formatVfoAxisEdgeLabel(
    frequencyRange.max,
    useHighRes,
    stepHz,
  );
  const centerText =
    typeof centerFrequencyHz === "number" && Number.isFinite(centerFrequencyHz)
      ? formatVfoAxisCenterLabel(
          centerFrequencyHz,
          useHighRes,
          stepHz,
          precision,
        )
      : null;
  const centerLabel = centerText
    ? `${getVfoAxisIcon(icon)}  ${centerText}`
    : null;
  const centerX =
    typeof centerFrequencyHz === "number" && Number.isFinite(centerFrequencyHz)
      ? Math.min(
          bounds.right,
          Math.max(bounds.left, freqToX(centerFrequencyHz)),
        )
      : bounds.left + plotWidth / 2;
  const edgeTickColor = theme.edgeTick ?? theme.tick;
  const edgeLabelColor = theme.edgeLabel ?? theme.label;

  ctx.save();
  ctx.setStroke(theme.tick, lineWidth);
  ctx.setFill(theme.label);
  ctx.setFont(`${fontPx}px JetBrains Mono, monospace`);
  ctx.setTextBaseline(textBaseline);

  if (showAxisLine) {
    ctx.setStroke(theme.grid ?? theme.tick, lineWidth);
    ctx.beginPath();
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.right, y);
    ctx.stroke();
  }

  if (showEdgeLabels) {
    ctx.setFill(edgeLabelColor);
    ctx.setTextAlign("left");
    ctx.fillText(startLabel, bounds.left, labelY);
    ctx.setTextAlign("right");
    ctx.fillText(endLabel, bounds.right, labelY);
    occupy(bounds.left, startLabel, "left", edgeReservePx);
    occupy(bounds.right, endLabel, "right", edgeReservePx);
  }

  if (centerLabel && showCenterLabel) {
    ctx.setFill(theme.center);
    ctx.setFont(`bold ${centerFontPx}px JetBrains Mono, monospace`);
    ctx.setTextAlign("center");
    ctx.fillText(centerLabel, centerX, labelY);
    occupy(centerX, centerLabel, "center", centerReservePx);
    ctx.setFill(theme.label);
    ctx.setFont(`${fontPx}px JetBrains Mono, monospace`);
  }

  if (showCenterLine) {
    // Draw the main center line
    ctx.setStroke(theme.centerLine ?? theme.center, lineWidth);
    ctx.beginPath();
    ctx.moveTo(centerX, centerLineTop);
    ctx.lineTo(centerX, centerLineBottom);
    ctx.stroke();
  }

  const shouldDrawCenterTick =
    showCenterTick ?? (!!centerLabel && !showCenterLine && showTickMarks);
  const drawMinorTicks = showTickMarks && stepHz >= 1_000;
  const minorOffsets =
    stepHz >= 50_000 ? [0.25, 0.5, 0.75] : stepHz >= 10_000 ? [0.5] : [0.5];

  for (
    let freq = lowerFreq;
    freq < frequencyRange.max - 0.0001;
    freq += stepHz
  ) {
    const x = freqToX(freq);
    const roundedX = Math.round(x);
    ctx.setStroke(theme.tick, lineWidth);
    if (showTickMarks) {
      ctx.beginPath();
      if (tickDirection === "down") {
        ctx.moveTo(roundedX, y);
        ctx.lineTo(roundedX, y + tickLength);
      } else {
        ctx.moveTo(roundedX, y - tickLength);
        ctx.lineTo(roundedX, y);
      }
      ctx.stroke();
    }

    if (drawMinorTicks) {
      for (const offset of minorOffsets) {
        const minorFreq = freq + stepHz * offset;
        if (minorFreq >= frequencyRange.max) continue;
        const mx = freqToX(minorFreq);
        ctx.beginPath();
        if (tickDirection === "down") {
          ctx.moveTo(Math.round(mx), y + 2);
          ctx.lineTo(Math.round(mx), y + 2 + minorTickLength);
        } else {
          ctx.moveTo(Math.round(mx), y - 2 - minorTickLength);
          ctx.lineTo(Math.round(mx), y - 2);
        }
        ctx.stroke();
      }
    }

    const label = fmtFreqTick(freq, stepHz);
    if (showTickLabels && label.length > 0 && !isColliding(x, label)) {
      ctx.setFill(theme.label);
      ctx.setTextAlign("center");
      ctx.fillText(label, x, labelY);
    }
  }

  if (drawMinorTicks && lowerFreq > frequencyRange.min) {
    for (const offset of minorOffsets) {
      const minorFreq = frequencyRange.min + stepHz * offset;
      if (minorFreq >= lowerFreq || minorFreq >= frequencyRange.max) continue;
      const mx = freqToX(minorFreq);
      ctx.beginPath();
      if (tickDirection === "down") {
        ctx.moveTo(Math.round(mx), y + 2);
        ctx.lineTo(Math.round(mx), y + 2 + minorTickLength);
      } else {
        ctx.moveTo(Math.round(mx), y - 2 - minorTickLength);
        ctx.lineTo(Math.round(mx), y - 2);
      }
      ctx.stroke();
    }
  }

  if (showTickMarks) {
    for (const edgeFreq of [frequencyRange.min, frequencyRange.max]) {
      const edgeX = Math.round(freqToX(edgeFreq));
      ctx.setStroke(edgeTickColor, lineWidth);
      ctx.beginPath();
      if (tickDirection === "down") {
        ctx.moveTo(edgeX, y);
        ctx.lineTo(edgeX, y + tickLength);
      } else {
        ctx.moveTo(edgeX, y - tickLength);
        ctx.lineTo(edgeX, y);
      }
      ctx.stroke();
    }
  }

  if (shouldDrawCenterTick) {
    const roundedCenterX = Math.round(centerX);
    ctx.setStroke(theme.centerLine ?? theme.center, lineWidth);
    ctx.beginPath();
    if (tickDirection === "down") {
      ctx.moveTo(roundedCenterX, y);
      ctx.lineTo(roundedCenterX, y + centerTickLength);
    } else {
      ctx.moveTo(roundedCenterX, y - centerTickLength);
      ctx.lineTo(roundedCenterX, y);
    }
    ctx.stroke();
  }

  ctx.restore();
}
