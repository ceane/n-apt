import {
  CoordinateMapper,
  Range,
} from "@n-apt/utils/rendering/CoordinateMapper";
import { findBestFrequencyRange } from "@n-apt/consts";
import { formatFrequency, roundDbValue } from "@n-apt/utils/frequency";
import { escapeAttr, sanitizePath } from "../sanitization";
import {
  drawVfoAxis,
  type VfoAxisContext,
} from "@n-apt/utils/rendering/vfoAxis";

export interface DrawingContext {
  setStroke(color: string, width: number, dash?: number[]): void;
  setFill(color: string): void;
  setFont(font: string): void;
  setScaledFont(baseFontSize: number, scale: number): void;
  setTextAlign(align: "left" | "right" | "center" | "start" | "end"): void;
  setTextBaseline(baseline: "top" | "bottom" | "middle" | "alphabetic"): void;
  setLineJoin(join: "round" | "bevel" | "miter"): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  closePath(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  fillText(text: string, x: number, y: number): void;
  measureTextWidth(text: string): number;
  save(): void;
  restore(): void;
  clipRect(x: number, y: number, w: number, h: number): void;
}

export class CanvasDrawingContext implements DrawingContext {
  constructor(private ctx: CanvasRenderingContext2D) {}

  setStroke(color: string, width: number, dash?: number[]): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    if (dash) this.ctx.setLineDash(dash);
    else this.ctx.setLineDash([]);
  }

  setFill(color: string): void {
    this.ctx.fillStyle = color;
  }

  setFont(font: string): void {
    this.ctx.font = font;
  }

  setScaledFont(baseFontSize: number, scale: number): void {
    const scaledSize = Math.round(baseFontSize * scale);
    this.ctx.font = `${scaledSize}px JetBrains Mono, monospace`;
  }

  setTextAlign(align: "left" | "right" | "center" | "start" | "end"): void {
    this.ctx.textAlign = align;
  }

  setTextBaseline(baseline: "top" | "bottom" | "middle" | "alphabetic"): void {
    this.ctx.textBaseline = baseline;
  }

  setLineJoin(join: "round" | "bevel" | "miter"): void {
    this.ctx.lineJoin = join;
  }

  beginPath(): void {
    this.ctx.beginPath();
  }

  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y);
  }

  stroke(): void {
    this.ctx.stroke();
  }

  fill(): void {
    this.ctx.fill();
  }

  closePath(): void {
    this.ctx.closePath();
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.ctx.fillRect(x, y, w, h);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    this.ctx.beginPath();
    if (typeof this.ctx.roundRect === "function") {
      this.ctx.roundRect(x, y, w, h, r);
    } else {
      this.ctx.rect(x, y, w, h);
    }
    this.ctx.fill();
  }

  fillText(text: string, x: number, y: number): void {
    this.ctx.fillText(text, x, y);
  }

  measureTextWidth(text: string): number {
    return this.ctx.measureText(text).width;
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  clipRect(x: number, y: number, w: number, h: number): void {
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
  }
}

export class SVGDrawingContext implements DrawingContext {
  private parts: string[] = [];
  private currentStroke: string = "none";
  private currentStrokeWidth: number = 1;
  private currentStrokeDash: string = "none";
  private currentFill: string = "none";
  private currentFont: string = "12px sans-serif";
  private textAlign: string = "start";
  private textBaseline: string = "alphabetic";
  private lineJoin: string = "miter";
  private path: string = "";

  constructor(
    private width: number,
    private height: number,
  ) {}

  setStroke(color: string, width: number, dash?: number[]): void {
    this.currentStroke = color;
    this.currentStrokeWidth = width;
    this.currentStrokeDash = dash ? dash.join(",") : "none";
  }

  setFill(color: string): void {
    this.currentFill = color;
  }

  setFont(font: string): void {
    this.currentFont = font;
  }

  setScaledFont(baseFontSize: number, scale: number): void {
    const scaledSize = Math.round(baseFontSize * scale);
    this.currentFont = `${scaledSize}px JetBrains Mono, monospace`;
  }

  setTextAlign(align: "left" | "right" | "center" | "start" | "end"): void {
    this.textAlign =
      align === "left" || align === "start"
        ? "start"
        : align === "right" || align === "end"
          ? "end"
          : "middle";
  }

  setTextBaseline(baseline: "top" | "bottom" | "middle" | "alphabetic"): void {
    this.textBaseline = baseline;
  }

  setLineJoin(join: "round" | "bevel" | "miter"): void {
    this.lineJoin = join;
  }

  beginPath(): void {
    this.path = "";
  }

  moveTo(x: number, y: number): void {
    this.path += `M${x},${y}`;
  }

  lineTo(x: number, y: number): void {
    this.path += ` L${x},${y}`;
  }

  stroke(): void {
    this.parts.push(
      `<path d="${escapeAttr(sanitizePath(this.path))}" fill="none" stroke="${escapeAttr(this.currentStroke)}" stroke-width="${escapeAttr(this.currentStrokeWidth)}" stroke-linejoin="${escapeAttr(this.lineJoin)}" ${
        this.currentStrokeDash !== "none"
          ? `stroke-dasharray="${escapeAttr(this.currentStrokeDash)}"`
          : ""
      }/>`,
    );
  }

  fill(): void {
    this.parts.push(
      `<path d="${escapeAttr(sanitizePath(this.path))}" fill="${escapeAttr(this.currentFill)}" stroke="none"/>`,
    );
  }

  closePath(): void {
    this.path += " Z";
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.parts.push(
      `<rect x="${escapeAttr(x)}" y="${escapeAttr(y)}" width="${escapeAttr(w)}" height="${escapeAttr(h)}" fill="${escapeAttr(this.currentFill)}"/>`,
    );
  }

  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    this.parts.push(
      `<rect x="${escapeAttr(x)}" y="${escapeAttr(y)}" width="${escapeAttr(w)}" height="${escapeAttr(h)}" rx="${escapeAttr(r)}" fill="${escapeAttr(this.currentFill)}"/>`,
    );
  }

  fillText(text: string, x: number, y: number): void {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/•/g, "&#x2022;")
      .replace(/●/g, "&#x25CF;")
      .replace(/○/g, "&#x25CB;")
      .replace(/–/g, "&#x2013;")
      .replace(/—/g, "&#x2014;");
    const fontSizeMatch = this.currentFont.match(/(\d+)px/);
    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 12;
    const fontFamily = this.currentFont.includes("JetBrains Mono")
      ? "JetBrains Mono, monospace"
      : "monospace";

    // Offset Y for manual baseline alignment in SVG
    let dy = "0";
    if (this.textBaseline === "top") dy = "0.8em";
    else if (this.textBaseline === "middle") dy = "0.3em";

    this.parts.push(
      `<text x="${escapeAttr(x)}" y="${escapeAttr(y)}" dy="${escapeAttr(dy)}" text-anchor="${escapeAttr(this.textAlign)}" fill="${escapeAttr(this.currentFill)}" font-family="${escapeAttr(fontFamily)}" font-size="${escapeAttr(fontSize)}">${escaped}</text>`,
    );
  }

  measureTextWidth(text: string): number {
    const fontSizeMatch = this.currentFont.match(/(\d+)px/);
    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 12;
    return text.length * fontSize * 0.6;
  }

  save(): void {}
  restore(): void {}
  clipRect(_x: number, _y: number, _w: number, _h: number): void {}

  getSVG(): string {
    const sw = escapeAttr(this.width);
    const sh = escapeAttr(this.height);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw} ${sh}" width="${sw}" height="${sh}">
  ${this.parts.join("\n  ")}
</svg>`;
  }
}

export interface SnapshotTheme {
  bg: string;
  grid: string;
  line: string;
  shadow: string;
  text: string;
  hwLine: string;
  hwText: string;
  cfText: string;
}

export type StatsBoxPlacement = {
  pos: { x: number; y: number };
  boxW: number;
  boxH: number;
  lines: { line: string; fontSize: number; width: number }[];
  padX: number;
  padY: number;
  lh: number;
  columns?: {
    splitIndex: number;
    columnGap: number;
    leftWidth: number;
    rightWidth: number;
  };
};

export class SnapshotRenderer {
  constructor(
    private mapper: CoordinateMapper,
    private theme: SnapshotTheme,
  ) {}

  measureChannelLabelBox(
    channelBounds: Range | null | undefined,
    viewRange: Range,
    channelLabel?: string,
  ): { x: number; y: number; w: number; h: number } | null {
    if (!channelBounds) return null;
    const channelSpan = channelBounds.max - channelBounds.min;
    const viewSpan = viewRange.max - viewRange.min;
    if (!Number.isFinite(channelSpan) || channelSpan <= 0) return null;
    if (!Number.isFinite(viewSpan) || viewSpan <= 0) return null;

    const area = this.mapper.getPlotArea();
    const visibleMin = Math.max(channelBounds.min, viewRange.min);
    const visibleMax = Math.min(channelBounds.max, viewRange.max);
    if (!(visibleMax > visibleMin)) return null;

    const rawStartX = this.mapper.freqToX(visibleMin);
    const rawEndX = this.mapper.freqToX(visibleMax);
    const plotRight = area.x + area.width;
    const startX = Math.max(area.x, Math.min(plotRight, rawStartX));
    const endX = Math.max(area.x, Math.min(plotRight, rawEndX));
    const bandWidth = Math.max(1, endX - startX);
    const centerX = startX + bandWidth / 2;
    const labelText = channelLabel ? `Channel ${channelLabel}` : "Channel";
    const labelWidth = labelText.length * 6;
    const boxW = labelWidth + 20;
    const boxH = 20;
    const preferredBoxX = Math.min(
      Math.max(area.x + 4, centerX - boxW / 2),
      area.x + area.width - boxW - 4,
    );
    const candidateYs = [
      area.y + 6,
      area.y + area.height - boxH - 6,
      area.y + area.height * 0.25 - boxH / 2,
      area.y + area.height * 0.75 - boxH / 2,
    ].map((y) =>
      Math.max(area.y + 4, Math.min(area.y + area.height - boxH - 4, y)),
    );

    return {
      x: preferredBoxX,
      y: candidateYs[0] ?? area.y + 6,
      w: boxW,
      h: boxH,
    };
  }

  drawBackground(dc: DrawingContext): void {
    dc.setFill(this.theme.bg);
    const area = this.mapper.getPlotArea();
    dc.fillRect(0, 0, area.x + area.width + 40, area.y + area.height + 40);
  }

  drawAxes(dc: DrawingContext): void {
    const area = this.mapper.getPlotArea();
    dc.setStroke(this.theme.text, 1 / this.mapper.getDPR());
    dc.beginPath();
    dc.moveTo(area.x, area.y + area.height);
    dc.lineTo(area.x + area.width, area.y + area.height);
    dc.stroke();

    dc.beginPath();
    dc.moveTo(area.x, area.y);
    dc.lineTo(area.x, area.y + area.height);
    dc.stroke();
  }

  drawGridLines(dc: DrawingContext, dbMarkers: number[]): void {
    const area = this.mapper.getPlotArea();
    const dbRange = this.mapper.getDbRange();

    dc.setStroke(this.theme.grid, 1 / this.mapper.getDPR());
    for (const db of dbMarkers) {
      if (db < dbRange.min || db > dbRange.max) continue;
      const y = this.mapper.dbToY(db);
      dc.beginPath();
      dc.moveTo(area.x, y);
      dc.lineTo(area.x + area.width, y);
      dc.stroke();
    }

    this.drawVerticalGridLines(dc);
  }

  private drawVerticalGridLines(dc: DrawingContext): void {
    const area = this.mapper.getPlotArea();
    const freqRange = this.mapper.getFreqRange();
    const bandwidth = freqRange.max - freqRange.min;
    const range = findBestFrequencyRange(bandwidth, 10);
    const lowerFreq = Math.ceil(freqRange.min / range) * range;

    dc.setStroke(this.theme.grid, 1 / this.mapper.getDPR());
    dc.beginPath();
    for (let freq = lowerFreq; freq < freqRange.max - 0.0001; freq += range) {
      const x = this.mapper.freqToX(freq);
      dc.moveTo(x, area.y);
      dc.lineTo(x, area.y + area.height);
    }
    const maxEdgeX = this.mapper.freqToX(freqRange.max);
    dc.moveTo(maxEdgeX, area.y);
    dc.lineTo(maxEdgeX, area.y + area.height);
    dc.stroke();
  }

  drawDbMarkers(
    dc: DrawingContext,
    dbMarkers: number[],
    unit: string = "dB",
    fontScale: number = 1,
  ): void {
    const area = this.mapper.getPlotArea();
    const dbRange = this.mapper.getDbRange();

    dc.setTextAlign("right");
    dc.setTextBaseline("middle");
    dc.setFill(this.theme.text);
    dc.setScaledFont(12, fontScale);

    for (let i = 0; i < dbMarkers.length; i++) {
      const db = dbMarkers[i];
      if (db < dbRange.min || db > dbRange.max) continue;
      const y = this.mapper.dbToY(db);

      let label = `${roundDbValue(db)}`;
      if (i === 0) {
        label += unit;
      }
      dc.fillText(label, area.x - 10, y);
    }
  }

  drawFrequencyLabels(
    dc: DrawingContext,
    zoom: number,
    centerFrequencyHz: number,
    fontScale: number = 1,
  ): void {
    const area = this.mapper.getPlotArea();
    const freqRange = this.mapper.getFreqRange();
    const FREQ_LABEL_Y = area.y + area.height + 25;
    const useHighRes = zoom >= 100;

    drawVfoAxis({
      ctx: this.createVfoAxisContext(dc),
      frequencyRange: freqRange,
      centerFrequencyHz,
      bounds: {
        left: area.x,
        right: area.x + area.width,
        top: area.y,
        bottom: area.y + area.height,
      },
      y: area.y + area.height,
      labelY: FREQ_LABEL_Y,
      orientation: "bottom",
      tickDirection: "down",
      targetTicks: 10,
      showAxisLine: false,
      icon: "circle",
      theme: {
        tick: this.theme.text,
        label: this.theme.text,
        center: this.theme.cfText,
        centerLine: this.theme.cfText,
      },
      fontPx: 12 * fontScale,
      centerFontPx: 12 * fontScale,
      tickLength: 7,
      centerTickLength: 9,
      useHighResLabels: useHighRes,
      precision: {
        edgeMHz: 4,
        edgeKHz: 0,
        centerMinMHz: 4,
        centerMinKHz: 0,
      },
      lineWidth: 1 / this.mapper.getDPR(),
    });
  }

  private createVfoAxisContext(dc: DrawingContext): VfoAxisContext {
    return {
      save: () => dc.save(),
      restore: () => dc.restore(),
      beginPath: () => dc.beginPath(),
      moveTo: (x, y) => dc.moveTo(x, y),
      lineTo: (x, y) => dc.lineTo(x, y),
      stroke: () => dc.stroke(),
      fillText: (text, x, y) => dc.fillText(text, x, y),
      measureTextWidth: (text) => dc.measureTextWidth(text),
      setStroke: (color, width) => dc.setStroke(color, width ?? 1),
      setFill: (color) => dc.setFill(color),
      setFont: (font) => dc.setFont(font),
      setTextAlign: (align) => dc.setTextAlign(align),
      setTextBaseline: (baseline) =>
        dc.setTextBaseline(
          baseline === "top" ||
            baseline === "bottom" ||
            baseline === "middle" ||
            baseline === "alphabetic"
            ? baseline
            : "alphabetic",
        ),
    };
  }

  private decimateWaveform(
    waveform: number[] | Float32Array,
    targetWidth: number,
  ): number[] | Float32Array {
    const len = waveform.length;
    if (len <= targetWidth * 2 || targetWidth <= 0) return waveform;
    const out = new Float32Array(targetWidth);
    const factor = len / targetWidth;
    for (let i = 0; i < targetWidth; i++) {
      const start = Math.floor(i * factor);
      const end = Math.min(len, Math.floor((i + 1) * factor));
      let max = -Infinity;
      for (let j = start; j < end; j++) {
        if (waveform[j] > max) max = waveform[j];
      }
      out[i] = max === -Infinity ? -120 : max;
    }
    return out;
  }

  drawTrace(
    dc: DrawingContext,
    waveform: number[] | Float32Array,
    visualRange?: Range,
    options?: { crispTrace?: boolean; forceSteps?: boolean },
  ): void {
    const area = this.mapper.getPlotArea();
    const crispTrace = options?.crispTrace ?? false;
    dc.setLineJoin(crispTrace ? "miter" : "round");
    const dataWidth = waveform.length;
    if (dataWidth < 2) return;

    const freqRange = this.mapper.getFreqRange();
    const dataRange = visualRange || freqRange;

    const physicalWidth = Math.ceil(area.width * this.mapper.getDPR());
    const isSteps = options?.forceSteps || physicalWidth / dataWidth >= 3;
    const decimated = this.decimateWaveform(waveform, physicalWidth);

    if (isSteps) {
      this.drawTraceSteps(dc, decimated, crispTrace);
    } else {
      this.drawTraceSmooth(dc, decimated, dataRange, crispTrace);
    }
  }

  private drawTraceSteps(
    dc: DrawingContext,
    waveform: number[] | Float32Array,
    crispTrace: boolean = false,
  ): void {
    const area = this.mapper.getPlotArea();
    const dataWidth = waveform.length;
    const binW = area.width / Math.max(1, dataWidth);

    dc.save();
    dc.clipRect(area.x, area.y, area.width, area.height);

    dc.setFill(this.theme.shadow);
    dc.beginPath();
    dc.moveTo(area.x, area.y + area.height);
    for (let i = 0; i < dataWidth; i++) {
      const x = area.x + i * binW;
      const nextX =
        i === dataWidth - 1 ? area.x + area.width : area.x + (i + 1) * binW;
      const y = this.mapper.clampY(waveform[i]);
      dc.lineTo(
        crispTrace ? this.mapper.snap(x) : x,
        crispTrace ? this.mapper.snap(y) : y,
      );
      dc.lineTo(
        crispTrace ? this.mapper.snap(nextX) : nextX,
        crispTrace ? this.mapper.snap(y) : y,
      );
    }
    dc.lineTo(area.x + area.width, area.y + area.height);
    dc.closePath();
    dc.fill();

    dc.setStroke(this.theme.line, 1 / this.mapper.getDPR());
    dc.beginPath();
    dc.moveTo(
      crispTrace ? this.mapper.snapStrokeCenter(area.x) : area.x,
      crispTrace
        ? this.mapper.snapStrokeCenter(this.mapper.clampY(waveform[0]))
        : this.mapper.clampY(waveform[0]),
    );
    for (let i = 0; i < dataWidth; i++) {
      const y = this.mapper.clampY(waveform[i]);
      const x = area.x + i * binW;
      const nextX =
        i === dataWidth - 1 ? area.x + area.width : area.x + (i + 1) * binW;

      dc.lineTo(
        crispTrace ? this.mapper.snapStrokeCenter(x) : x,
        crispTrace ? this.mapper.snapStrokeCenter(y) : y,
      );
      dc.lineTo(
        crispTrace ? this.mapper.snapStrokeCenter(nextX) : nextX,
        crispTrace ? this.mapper.snapStrokeCenter(y) : y,
      );
    }
    dc.stroke();
    dc.restore();
  }

  private drawTraceSmooth(
    dc: DrawingContext,
    waveform: number[] | Float32Array,
    visualRange?: Range,
    crispTrace: boolean = false,
  ): void {
    const area = this.mapper.getPlotArea();
    const freqRange = this.mapper.getFreqRange();
    const dataRange = visualRange || freqRange;
    const dataWidth = waveform.length;

    dc.save();
    dc.clipRect(area.x, area.y, area.width, area.height);

    // Fill
    dc.setFill(this.theme.shadow);
    dc.beginPath();
    dc.moveTo(
      crispTrace
        ? this.mapper.snap(this.mapper.freqToX(dataRange.min))
        : this.mapper.freqToX(dataRange.min),
      area.y + area.height,
    );
    for (let i = 0; i < dataWidth; i++) {
      const freq =
        dataRange.min + (i / (dataWidth - 1)) * (dataRange.max - dataRange.min);
      const x = this.mapper.freqToX(freq);
      const y = this.mapper.clampY(waveform[i]);
      dc.lineTo(
        crispTrace ? this.mapper.snap(x) : x,
        crispTrace ? this.mapper.snap(y) : y,
      );
    }
    dc.lineTo(
      crispTrace
        ? this.mapper.snap(this.mapper.freqToX(dataRange.max))
        : this.mapper.freqToX(dataRange.max),
      area.y + area.height,
    );
    dc.closePath();
    dc.fill();

    // Stroke
    dc.setStroke(this.theme.line, 1 / this.mapper.getDPR());
    dc.beginPath();
    for (let i = 0; i < dataWidth; i++) {
      const freq =
        dataRange.min + (i / (dataWidth - 1)) * (dataRange.max - dataRange.min);
      const x = this.mapper.freqToX(freq);
      const y = this.mapper.clampY(waveform[i]);
      const rx = crispTrace ? this.mapper.snapStrokeCenter(x) : x;
      const ry = crispTrace ? this.mapper.snapStrokeCenter(y) : y;
      if (i === 0) dc.moveTo(rx, ry);
      else dc.lineTo(rx, ry);
    }
    dc.stroke();
    dc.restore();
  }

  drawHardwareGrid(
    dc: DrawingContext,
    hardwareSampleRateHz: number,
    fullCaptureRange?: Range,
  ): void {
    const area = this.mapper.getPlotArea();
    const freqRange = this.mapper.getFreqRange();
    const hwSpanHz = hardwareSampleRateHz;
    const anchorRange = fullCaptureRange || freqRange;
    const totalSpan = anchorRange.max - anchorRange.min;

    if (totalSpan <= hwSpanHz + 1 || hwSpanHz <= 0) return;

    dc.save();
    dc.setStroke(this.theme.hwLine, 1 / this.mapper.getDPR(), [4, 4]);
    dc.setFill(this.theme.hwText);
    dc.setFont("10px JetBrains Mono");
    dc.setTextAlign("center");
    dc.setTextBaseline("top");

    const fmtOff = (hz: number) =>
      formatFrequency(hz, { trimTrailingZeros: true });

    let cur = anchorRange.min;
    while (cur < anchorRange.max - 1) {
      const bStart = cur;
      const bEnd = Math.min(bStart + hwSpanHz, anchorRange.max);
      const bWidth = bEnd - bStart;
      const isFull = bWidth >= hwSpanHz - 1;

      if (bEnd > freqRange.min && bStart < freqRange.max) {
        if (
          bStart > anchorRange.min + 0.001 &&
          bStart >= freqRange.min &&
          bStart <= freqRange.max
        ) {
          const lx = this.mapper.freqToX(bStart);
          dc.beginPath();
          dc.moveTo(lx, area.y);
          dc.lineTo(lx, area.y + area.height);
          dc.stroke();
        }

        const visibleStart = Math.max(bStart, freqRange.min);
        const visibleEnd = Math.min(bEnd, freqRange.max);
        const visibleCenter = (visibleStart + visibleEnd) / 2;

        if (visibleCenter >= freqRange.min && visibleCenter <= freqRange.max) {
          const cx = this.mapper.freqToX(visibleCenter);
          const label = isFull ? "Hardware Sample Rate" : "Next Sample";
          const subLabel = fmtOff(bWidth);
          dc.fillText(label, cx, area.y + 7);
          dc.fillText(subLabel, cx, area.y + 19);
        }
      }
      cur = bEnd;
    }
    dc.restore();
  }

  drawChannelBounds(
    dc: DrawingContext,
    channelBounds: Range | null | undefined,
    viewRange: Range,
    channelLabel?: string,
    avoidPlacement?: Pick<StatsBoxPlacement, "pos" | "boxW" | "boxH"> | null,
  ): void {
    if (!channelBounds) return;
    const channelSpan = channelBounds.max - channelBounds.min;
    const viewSpan = viewRange.max - viewRange.min;
    if (!Number.isFinite(channelSpan) || channelSpan <= 0) return;
    if (!Number.isFinite(viewSpan) || viewSpan <= 0) return;

    const area = this.mapper.getPlotArea();
    const visibleMin = Math.max(channelBounds.min, viewRange.min);
    const visibleMax = Math.min(channelBounds.max, viewRange.max);
    if (!(visibleMax > visibleMin)) return;

    const rawStartX = this.mapper.freqToX(visibleMin);
    const rawEndX = this.mapper.freqToX(visibleMax);
    const plotRight = area.x + area.width;
    const startX = Math.max(area.x, Math.min(plotRight, rawStartX));
    const endX = Math.max(area.x, Math.min(plotRight, rawEndX));
    const bandWidth = Math.max(1, endX - startX);
    const centerX = startX + bandWidth / 2;
    const label = channelLabel ? `Channel ${channelLabel}` : "Channel";
    const markerColor = "#ffb000";
    const pillFill = "rgba(7, 10, 18, 0.94)";
    const pillText = "#f8fafc";

    dc.save();
    dc.clipRect(area.x, area.y, area.width, area.height);
    dc.setStroke(markerColor, 2 / this.mapper.getDPR(), [4, 4]);
    dc.setFill(pillText);
    dc.setFont("10px JetBrains Mono");
    dc.setTextAlign("center");
    dc.setTextBaseline("bottom");

    const labelText = `${label}`;
    const labelWidth = dc.measureTextWidth(labelText);
    const boxW = labelWidth + 20;
    const boxH = 20;
    const preferredBoxX = Math.min(
      Math.max(area.x + 4, centerX - boxW / 2),
      area.x + area.width - boxW - 4,
    );
    const candidateYs = [
      area.y + 6,
      area.y + area.height - boxH - 6,
      area.y + area.height * 0.25 - boxH / 2,
      area.y + area.height * 0.75 - boxH / 2,
    ].map((y) =>
      Math.max(area.y + 4, Math.min(area.y + area.height - boxH - 4, y)),
    );
    const avoidBox = avoidPlacement
      ? {
          x: avoidPlacement.pos.x - 8,
          y: avoidPlacement.pos.y - 8,
          w: avoidPlacement.boxW + 16,
          h: avoidPlacement.boxH + 16,
        }
      : null;
    const overlapsAvoidBox = (x: number, y: number) =>
      avoidBox != null &&
      x < avoidBox.x + avoidBox.w &&
      x + boxW > avoidBox.x &&
      y < avoidBox.y + avoidBox.h &&
      y + boxH > avoidBox.y;
    const distanceFromAvoidBox = (x: number, y: number) => {
      if (!avoidBox) return Number.POSITIVE_INFINITY;
      const cx = x + boxW / 2;
      const cy = y + boxH / 2;
      const acx = avoidBox.x + avoidBox.w / 2;
      const acy = avoidBox.y + avoidBox.h / 2;
      return Math.hypot(cx - acx, cy - acy);
    };
    const boxY =
      candidateYs.find((y) => !overlapsAvoidBox(preferredBoxX, y)) ??
      candidateYs
        .map((y) => ({ y, distance: distanceFromAvoidBox(preferredBoxX, y) }))
        .sort((a, b) => b.distance - a.distance)[0]?.y ??
      area.y + 6;
    const boxX = preferredBoxX;
    const labelY = boxY + boxH / 2;
    const lineTop = area.y;
    const lineBottom = area.y + area.height;
    const lineGap = 2;
    const obstacles = [
      avoidBox
        ? {
            x: avoidBox.x,
            y: avoidBox.y,
            w: avoidBox.w,
            h: avoidBox.h,
          }
        : null,
      {
        x: boxX,
        y: boxY,
        w: boxW,
        h: boxH,
      },
    ].filter(Boolean) as { x: number; y: number; w: number; h: number }[];
    function drawBoundary(x: number): void {
      const blockedRanges = obstacles
        .filter((obstacle) => x >= obstacle.x && x <= obstacle.x + obstacle.w)
        .map((obstacle) => ({
          top: obstacle.y - lineGap,
          bottom: obstacle.y + obstacle.h + lineGap,
        }))
        .sort((a, b) => a.top - b.top);

      if (blockedRanges.length === 0) {
        dc.moveTo(x, lineTop);
        dc.lineTo(x, lineBottom);
        return;
      }

      let cursor = lineTop;
      for (const range of blockedRanges) {
        const start = Math.max(lineTop, Math.min(lineBottom, range.top));
        const end = Math.max(lineTop, Math.min(lineBottom, range.bottom));
        if (start > cursor) {
          dc.moveTo(x, cursor);
          dc.lineTo(x, start);
        }
        cursor = Math.max(cursor, end);
      }
      if (cursor < lineBottom) {
        dc.moveTo(x, cursor);
        dc.lineTo(x, lineBottom);
      }
    }

    const eraseSolidGridLine = (x: number) => {
      // The solid grid line is 1px wide, centered on x, but drawing a 3px background line
      // will cleanly replace it without affecting the dotted line we're about to draw.
      dc.save();
      dc.setStroke(this.theme.bg, 3 / this.mapper.getDPR());
      dc.beginPath();
      drawBoundary(x);
      dc.stroke();
      dc.restore();
    };

    if (Math.abs(startX - area.x) < 2) {
      eraseSolidGridLine(startX);
    }
    if (Math.abs(endX - (area.x + area.width)) < 2) {
      eraseSolidGridLine(endX);
    }

    dc.beginPath();
    drawBoundary(startX);
    drawBoundary(endX);
    dc.stroke();

    dc.setFill(pillFill);
    dc.roundRect(boxX, boxY, boxW, boxH, 4);
    dc.setFill(pillText);
    dc.setTextBaseline("middle");
    dc.fillText(labelText, boxX + boxW / 2, labelY);
    dc.restore();
  }

  drawStatsBox(
    dc: DrawingContext,
    statsLines: string[],
    waveform: number[] | Float32Array,
    fontScale: number = 1,
    fixedPlacement?: StatsBoxPlacement,
    avoidBoxes?: { x: number; y: number; w: number; h: number }[] | null,
  ): StatsBoxPlacement | null {
    if (fixedPlacement) {
      const { pos, boxW, boxH, lines, padX, padY, lh, columns } =
        fixedPlacement;

      dc.setFill("rgba(0, 0, 0, 0.75)");
      dc.roundRect(pos.x, pos.y, boxW, boxH, 4);

      dc.setFill("#eee");
      dc.setTextAlign("left");
      dc.setTextBaseline("alphabetic");

      this.renderStatsBoxLines(dc, pos, padX, padY, lh, lines, columns);

      return fixedPlacement;
    }

    const area = this.mapper.getPlotArea();

    // Try the primary font scale and a compact fallback to find the best fit
    const scales = [fontScale, fontScale * 0.82];
    type StatsBoxCandidate = {
      pos: { x: number; y: number };
      boxW: number;
      boxH: number;
      lines: { line: string; fontSize: number; width: number }[];
      padX: number;
      padY: number;
      lh: number;
      columns?: {
        splitIndex: number;
        columnGap: number;
        leftWidth: number;
        rightWidth: number;
      };
      score: number;
    };
    let bestSafeSingle: StatsBoxCandidate | null = null;
    let bestSafeDouble: StatsBoxCandidate | null = null;
    let bestFallbackSingle:
      | (StatsBoxCandidate & { overlapRatio: number })
      | null = null;
    let bestFallbackDouble:
      | (StatsBoxCandidate & { overlapRatio: number })
      | null = null;
    const obstacles = avoidBoxes ?? [];

    for (const scale of scales) {
      const maxAllowedW = area.width * 0.7;
      const baseFontSize = Math.round(12 * scale);
      const padX = Math.round(12 * scale);
      const padY = Math.round(10 * scale);
      const lh = Math.round(18 * scale);

      const lines = statsLines.map((line) => {
        dc.setFont(`${baseFontSize}px monospace`);
        let pointWidth = dc.measureTextWidth("-");
        const width = dc.measureTextWidth(line);
        let fontSize = baseFontSize;
        let finalWidth = width;
        const maxTextW = maxAllowedW - padX * 2;
        if (width > maxTextW) {
          fontSize = Math.max(
            8,
            Math.floor(baseFontSize * (maxTextW / width) * 0.98),
          );
          dc.setFont(`${fontSize}px monospace`);
          pointWidth = dc.measureTextWidth("-");
          finalWidth = dc.measureTextWidth(line);
        }
        return { line, fontSize, width: finalWidth + pointWidth + 4 };
      });

      const layouts = this.buildStatsLayouts(lines, padX, padY, lh, area.width);
      for (const layout of layouts) {
        const candidates = this.generateCandidatePositions(
          layout.boxW,
          layout.boxH,
          waveform,
        );

        for (const pos of candidates) {
          const metrics = this.measureBoxPlacement(
            pos.x,
            pos.y,
            layout.boxW,
            layout.boxH,
            waveform,
            obstacles,
          );
          const candidate = {
            pos,
            boxW: layout.boxW,
            boxH: layout.boxH,
            lines,
            padX,
            padY,
            lh,
            columns: layout.columns,
            score: metrics.score,
          };

          if (metrics.safe) {
            if (layout.columns) {
              if (!bestSafeDouble || candidate.score > bestSafeDouble.score) {
                bestSafeDouble = candidate;
              }
            } else if (
              !bestSafeSingle ||
              candidate.score > bestSafeSingle.score
            ) {
              bestSafeSingle = candidate;
            }
            continue;
          }

          const fallbackCandidate = {
            ...candidate,
            overlapRatio: metrics.overlapRatio,
          };

          if (layout.columns) {
            if (
              !bestFallbackDouble ||
              metrics.overlapRatio < bestFallbackDouble.overlapRatio - 1e-6 ||
              (Math.abs(
                metrics.overlapRatio - bestFallbackDouble.overlapRatio,
              ) <= 1e-6 &&
                candidate.score > bestFallbackDouble.score)
            ) {
              bestFallbackDouble = fallbackCandidate;
            }
          } else if (
            !bestFallbackSingle ||
            metrics.overlapRatio < bestFallbackSingle.overlapRatio - 1e-6 ||
            (Math.abs(metrics.overlapRatio - bestFallbackSingle.overlapRatio) <=
              1e-6 &&
              candidate.score > bestFallbackSingle.score)
          ) {
            bestFallbackSingle = fallbackCandidate;
          }
        }
      }
    }

    const best =
      bestSafeSingle ??
      bestSafeDouble ??
      bestFallbackSingle ??
      bestFallbackDouble;
    if (!best) return null;

    const { pos, boxW, boxH, lines, padX, padY, lh, columns } = best;

    dc.setFill("rgba(0, 0, 0, 0.75)");
    dc.roundRect(pos.x, pos.y, boxW, boxH, 4);

    dc.setFill("#eee");
    dc.setTextAlign("left");
    dc.setTextBaseline("alphabetic");

    this.renderStatsBoxLines(dc, pos, padX, padY, lh, lines, columns);

    return best;
  }

  private renderStatsBoxLines(
    dc: DrawingContext,
    pos: { x: number; y: number },
    padX: number,
    padY: number,
    lh: number,
    lines: { line: string; fontSize: number; width: number }[],
    columns?: {
      splitIndex: number;
      columnGap: number;
      leftWidth: number;
      rightWidth: number;
    },
  ): void {
    const pointColor = "rgba(238, 238, 238, 0.45)";
    const pointGap = 4;

    if (!columns) {
      lines.forEach((item, i) => {
        dc.setFont(`${item.fontSize}px monospace`);
        const y = pos.y + padY + (i + 0.8) * lh;
        const pointWidth = dc.measureTextWidth("-");
        dc.setFill(pointColor);
        dc.fillText("-", pos.x + padX, y);
        dc.setFill("#eee");
        dc.fillText(item.line, pos.x + padX + pointWidth + pointGap, y);
      });
      return;
    }

    const leftLines = lines.slice(0, columns.splitIndex);
    const rightLines = lines.slice(columns.splitIndex);
    const leftX = pos.x + padX;
    const rightX = pos.x + padX + columns.leftWidth + columns.columnGap;
    const rowCount = Math.max(leftLines.length, rightLines.length);

    for (let i = 0; i < rowCount; i++) {
      const left = leftLines[i];
      if (left) {
        dc.setFont(`${left.fontSize}px monospace`);
        const y = pos.y + padY + (i + 0.8) * lh;
        const pointWidth = dc.measureTextWidth("-");
        dc.setFill(pointColor);
        dc.fillText("-", leftX, y);
        dc.setFill("#eee");
        dc.fillText(left.line, leftX + pointWidth + pointGap, y);
      }

      const right = rightLines[i];
      if (right) {
        dc.setFont(`${right.fontSize}px monospace`);
        const y = pos.y + padY + (i + 0.8) * lh;
        const pointWidth = dc.measureTextWidth("-");
        dc.setFill(pointColor);
        dc.fillText("-", rightX, y);
        dc.setFill("#eee");
        dc.fillText(right.line, rightX + pointWidth + pointGap, y);
      }
    }
  }

  private buildStatsLayouts(
    lines: { line: string; fontSize: number; width: number }[],
    padX: number,
    padY: number,
    lh: number,
    _areaWidth: number,
  ): {
    kind: "single" | "double";
    boxW: number;
    boxH: number;
    columns?: {
      splitIndex: number;
      columnGap: number;
      leftWidth: number;
      rightWidth: number;
    };
  }[] {
    const singleColumn = {
      kind: "single" as const,
      boxW: Math.max(...lines.map((l) => l.width)) + padX * 2,
      boxH: lines.length * lh + padY * 2,
    };

    const layouts: {
      kind: "single" | "double";
      boxW: number;
      boxH: number;
      columns?: {
        splitIndex: number;
        columnGap: number;
        leftWidth: number;
        rightWidth: number;
      };
    }[] = [singleColumn];
    if (lines.length >= 5) {
      const splitIndex = Math.ceil(lines.length / 2);
      const leftLines = lines.slice(0, splitIndex);
      const rightLines = lines.slice(splitIndex);
      const columnGap = Math.round(18 * Math.max(1, padX / 12));
      const leftWidth = Math.max(...leftLines.map((l) => l.width));
      const rightWidth = Math.max(...rightLines.map((l) => l.width));
      const boxW = leftWidth + rightWidth + columnGap + padX * 2;
      const boxH =
        Math.max(leftLines.length, rightLines.length) * lh + padY * 2;

      if (boxH < singleColumn.boxH) {
        layouts.unshift({
          kind: "double",
          boxW,
          boxH,
          columns: {
            splitIndex,
            columnGap,
            leftWidth,
            rightWidth,
          },
        });
      }
    }

    return layouts;
  }

  /**
   * Generate candidate positions across a 3×5 grid within the plot area.
   */
  private generateCandidatePositions(
    boxW: number,
    boxH: number,
    waveform: number[] | Float32Array,
  ): { x: number; y: number }[] {
    const area = this.mapper.getPlotArea();
    const pad = 8;
    const candidates: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    const clampX = (x: number) =>
      Math.max(area.x + pad, Math.min(area.x + area.width - boxW - pad, x));
    const clampY = (y: number) =>
      Math.max(area.y + pad, Math.min(area.y + area.height - boxH - pad, y));
    const add = (x: number, y: number) => {
      const pos = { x: clampX(x), y: clampY(y) };
      const key = `${Math.round(pos.x)}:${Math.round(pos.y)}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(pos);
    };

    const xSlots = [
      area.x + pad,
      area.x + (area.width - boxW) * 0.18,
      area.x + (area.width - boxW) * 0.5,
      area.x + (area.width - boxW) * 0.82,
      area.x + area.width - boxW - pad,
    ];

    for (const x of xSlots) {
      const envelope = this.getWaveformEnvelope(x, boxW, waveform);
      add(x, area.y + pad);
      add(x, area.y + area.height - boxH - pad);
      add(x, envelope.top - boxH - pad);
      add(x, envelope.bottom + pad);
    }

    // Grid fallback for odd shapes or very sparse traces.
    const gridYSlots = [
      area.y + pad,
      area.y + (area.height - boxH) * 0.25,
      area.y + (area.height - boxH) * 0.5,
      area.y + (area.height - boxH) * 0.75,
      area.y + area.height - boxH - pad,
    ];
    for (const x of xSlots) {
      for (const y of gridYSlots) add(x, y);
    }

    return candidates;
  }

  private getWaveformEnvelope(
    boxX: number,
    boxW: number,
    waveform: number[] | Float32Array,
  ): { top: number; bottom: number } {
    const area = this.mapper.getPlotArea();
    const dataLen = waveform?.length ?? 0;
    if (dataLen < 2 || area.width <= 0) {
      return { top: area.y, bottom: area.y + area.height };
    }

    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    const boxRight = boxX + boxW;
    for (let idx = 0; idx < dataLen; idx++) {
      const frac = dataLen > 1 ? idx / (dataLen - 1) : 0;
      const px = area.x + frac * area.width;
      if (px < boxX || px > boxRight) continue;

      const waveY = this.mapper.clampY(waveform[idx]);
      if (waveY < top) top = waveY;
      if (waveY > bottom) bottom = waveY;
    }

    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      const sampleCount = Math.min(96, Math.max(24, Math.ceil(boxW / 2)));
      for (let i = 0; i < sampleCount; i++) {
        const px =
          boxX + (i / Math.max(1, sampleCount - 1)) * Math.max(1, boxW);
        const frac = Math.max(0, Math.min(1, (px - area.x) / area.width));
        const idx = Math.min(
          dataLen - 1,
          Math.max(0, Math.round(frac * (dataLen - 1))),
        );
        const waveY = this.mapper.clampY(waveform[idx]);
        if (waveY < top) top = waveY;
        if (waveY > bottom) bottom = waveY;
      }
    }

    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      return { top: area.y, bottom: area.y + area.height };
    }

    return { top, bottom };
  }

  /**
   * Score a candidate box position by measuring distance from the waveform
   * trace and preferring corner placements.
   *
   * Higher score = better placement.
   */
  private measureBoxPlacement(
    bx: number,
    by: number,
    bw: number,
    bh: number,
    waveform: number[] | Float32Array,
    avoidBoxes: { x: number; y: number; w: number; h: number }[] = [],
  ): { score: number; overlapRatio: number; safe: boolean } {
    const area = this.mapper.getPlotArea();
    const dataLen = waveform?.length ?? 0;
    const pad = 8;

    // Fallback: no waveform → prefer top-right corner
    if (dataLen < 2) {
      const distToTopRight =
        Math.abs(bx + bw - (area.x + area.width)) + Math.abs(by - area.y);
      return { score: -distToTopRight, overlapRatio: 0, safe: true };
    }

    const boxLeft = Math.max(bx, area.x);
    const boxRight = Math.min(bx + bw, area.x + area.width);
    if (boxRight <= boxLeft) {
      return { score: -100_000, overlapRatio: 1, safe: false };
    }

    const boxTop = by;
    const boxBottom = by + bh;
    const boxCenterY = (boxTop + boxBottom) / 2;
    const envelope = this.getWaveformEnvelope(bx, bw, waveform);
    const boxAbove = boxBottom <= envelope.top - pad;
    const boxBelow = boxTop >= envelope.bottom + pad;
    const numSamples = Math.min(60, Math.max(8, Math.ceil(boxRight - boxLeft)));
    const obstacleOverlap = avoidBoxes.some(
      (obstacle) =>
        bx < obstacle.x + obstacle.w &&
        bx + bw > obstacle.x &&
        by < obstacle.y + obstacle.h &&
        by + bh > obstacle.y,
    );

    let traceOverlapCount = 0;
    let totalDistance = 0;
    let validSamples = 0;

    for (let i = 0; i < numSamples; i++) {
      const px =
        boxLeft + (i / Math.max(1, numSamples - 1)) * (boxRight - boxLeft);
      const frac = Math.max(0, Math.min(1, (px - area.x) / area.width));
      const idx = Math.min(
        dataLen - 1,
        Math.max(0, Math.round(frac * (dataLen - 1))),
      );
      const waveY = this.mapper.clampY(waveform[idx]);
      validSamples++;

      // Trace passes through the box
      if (waveY >= boxTop && waveY <= boxBottom) {
        traceOverlapCount++;
      }

      // Distance from waveform trace to box center — further = better
      totalDistance += Math.abs(waveY - boxCenterY);
    }

    if (validSamples === 0) {
      return { score: 0, overlapRatio: 1, safe: false };
    }

    const overlapRatio =
      traceOverlapCount / validSamples + (obstacleOverlap ? 0.5 : 0);
    const avgDistance = totalDistance / validSamples;
    const clearance = boxAbove
      ? envelope.top - boxBottom
      : boxBelow
        ? boxTop - envelope.bottom
        : -Math.min(
            Math.max(0, boxBottom - envelope.top),
            Math.max(0, envelope.bottom - boxTop),
          );

    // Corner preference: bonus for being near any corner of the plot area
    const cornerDistX = Math.min(
      Math.abs(bx - (area.x + pad)),
      Math.abs(bx + bw - (area.x + area.width - pad)),
    );
    const cornerDistY = Math.min(
      Math.abs(by - (area.y + pad)),
      Math.abs(by + bh - (area.y + area.height - pad)),
    );
    const cornerBonus = -(cornerDistX + cornerDistY) * 0.3;
    const noOverlapBonus = boxAbove || boxBelow ? 2500 : 0;
    const clearanceScore = Math.max(0, clearance) * 10;
    const score =
      avgDistance +
      cornerBonus +
      noOverlapBonus +
      clearanceScore -
      overlapRatio * 1000;

    return {
      score,
      overlapRatio,
      safe: boxAbove || boxBelow,
    };
  }

  private scoreBoxPlacement(
    bx: number,
    by: number,
    bw: number,
    bh: number,
    waveform: number[] | Float32Array,
  ): number {
    return this.measureBoxPlacement(bx, by, bw, bh, waveform).score;
  }
}
