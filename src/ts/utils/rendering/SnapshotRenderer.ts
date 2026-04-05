import { CoordinateMapper, Range } from "@n-apt/utils/rendering/CoordinateMapper";
import { findBestFrequencyRange } from "@n-apt/consts";
import { fmtFreq, fmtFreqTick } from "./formatters";

export interface DrawingContext {
  setStroke(color: string, width: number, dash?: number[]): void;
  setFill(color: string): void;
  setFont(font: string): void;
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
    this.ctx.roundRect(x, y, w, h, r);
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

  constructor(private width: number, private height: number) {}

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

  setTextAlign(align: "left" | "right" | "center" | "start" | "end"): void {
    this.textAlign = align === "left" || align === "start" ? "start" : align === "right" || align === "end" ? "end" : "middle";
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
      `<path d="${this.path}" fill="none" stroke="${this.currentStroke}" stroke-width="${this.currentStrokeWidth}" stroke-linejoin="${this.lineJoin}" ${
        this.currentStrokeDash !== "none" ? `stroke-dasharray="${this.currentStrokeDash}"` : ""
      }/>`
    );
  }

  fill(): void {
    this.parts.push(
      `<path d="${this.path}" fill="${this.currentFill}" stroke="none"/>`
    );
  }

  closePath(): void {
    this.path += " Z";
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this.currentFill}"/>`
    );
  }

  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    this.parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${this.currentFill}"/>`
    );
  }

  fillText(text: string, x: number, y: number): void {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fontSizeMatch = this.currentFont.match(/(\d+)px/);
    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 12;
    const style = this.currentFont.includes("JetBrains Mono") 
      ? `font-family="JetBrains Mono, monospace" font-size="${fontSize}"` 
      : `font-family="monospace" font-size="${fontSize}"`;
    // Offset Y for manual baseline alignment in SVG
    let dy = "0";
    if (this.textBaseline === "top") dy = "0.8em";
    else if (this.textBaseline === "middle") dy = "0.3em";
    
    this.parts.push(
      `<text x="${x}" y="${y}" dy="${dy}" text-anchor="${this.textAlign}" fill="${this.currentFill}" ${style}>${escaped}</text>`
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
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" width="${this.width}" height="${this.height}">
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

export class SnapshotRenderer {
  constructor(private mapper: CoordinateMapper, private theme: SnapshotTheme) {}

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
      const x = Math.round(this.mapper.freqToX(freq));
      dc.moveTo(x, area.y);
      dc.lineTo(x, area.y + area.height);
    }
    dc.stroke();
  }

  drawDbMarkers(dc: DrawingContext, dbMarkers: number[], unit: string = "dB"): void {
    const area = this.mapper.getPlotArea();
    const dbRange = this.mapper.getDbRange();

    dc.setTextAlign("right");
    dc.setTextBaseline("middle");
    dc.setFill(this.theme.text);
    dc.setFont("12px JetBrains Mono");

    for (let i = 0; i < dbMarkers.length; i++) {
      const db = dbMarkers[i];
      if (db < dbRange.min || db > dbRange.max) continue;
      const y = this.mapper.dbToY(db);
      
      let label = `${Math.round(db)}`;
      if (i === 0) {
        label += unit;
      }
      dc.fillText(label, area.x - 10, y);
    }
  }

  drawFrequencyLabels(dc: DrawingContext, zoom: number, centerFrequencyMHz: number): void {
    const area = this.mapper.getPlotArea();
    const freqRange = this.mapper.getFreqRange();
    const bandwidth = freqRange.max - freqRange.min;
    const range = findBestFrequencyRange(bandwidth, 10);
    const lowerFreq = Math.ceil(freqRange.min / range) * range;
    const FREQ_LABEL_Y = area.y + area.height + 25;

    dc.setFill(this.theme.text);
    dc.setFont("12px JetBrains Mono");

    const startLabel = fmtFreq(freqRange.min, zoom);
    const endLabel = fmtFreq(freqRange.max, zoom);
    const centerLabelText = Number.isNaN(centerFrequencyMHz) || !Number.isFinite(centerFrequencyMHz)
      ? "-- MHz"
      : fmtFreq(centerFrequencyMHz, zoom);
    
    // Collision detection
    const startW = dc.measureTextWidth(startLabel);
    const endW = dc.measureTextWidth(endLabel);
    const centerW = dc.measureTextWidth(`○  ${centerLabelText}`);
    const plotWidth = area.width;

    const occupied: { x1: number; x2: number }[] = [
      { x1: area.x - 5, x2: area.x + startW + 15 },
      { x1: area.x + area.width - endW - 15, x2: area.x + area.width + 5 },
      { x1: (area.x + plotWidth / 2) - centerW / 2 - 15, x2: (area.x + plotWidth / 2) + centerW / 2 + 15 },
    ];

    const isColliding = (x: number, text: string) => {
      const tw = dc.measureTextWidth(text);
      const x1 = x - tw / 2 - 10;
      const x2 = x + tw / 2 + 10;
      return occupied.some(r => (x1 < r.x2 && x2 > r.x1));
    };

    // Draw Ticks and Labels
    for (let freq = lowerFreq; freq < freqRange.max - 0.0001; freq += range) {
      const x = Math.round(this.mapper.freqToX(freq));
      
      // Tick mark
      dc.setStroke(this.theme.text, 1 / this.mapper.getDPR());
      dc.beginPath();
      dc.moveTo(x, area.y + area.height);
      dc.lineTo(x, area.y + area.height + 7);
      dc.stroke();

      // Label
      const labelText = fmtFreqTick(freq, range);
      if (!isColliding(x, labelText)) {
        dc.setTextAlign("center");
        dc.fillText(labelText, x, FREQ_LABEL_Y);
      }
    }

    // Edge labels
    dc.setTextAlign("start");
    dc.fillText(startLabel, area.x, FREQ_LABEL_Y);
    dc.setTextAlign("end");
    dc.fillText(endLabel, area.x + area.width, FREQ_LABEL_Y);

    // Center label - Always white
    const centerLabel = `○  ${centerLabelText}`;
    dc.setFont("bold 12px JetBrains Mono");
    dc.setFill(this.theme.cfText);
    dc.setTextAlign("center");
    dc.fillText(centerLabel, area.x + area.width / 2, FREQ_LABEL_Y);
  }

  private decimateWaveform(waveform: number[] | Float32Array, targetWidth: number): number[] | Float32Array {
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

  drawTrace(dc: DrawingContext, waveform: number[] | Float32Array, visualRange?: Range): void {
    const area = this.mapper.getPlotArea();
    dc.setLineJoin("round");
    const dataWidth = waveform.length;
    if (dataWidth < 2) return;

    const freqRange = this.mapper.getFreqRange();
    const dataRange = visualRange || freqRange;

    const isSteps = (area.width / dataWidth) >= 3;
    const decimated = this.decimateWaveform(waveform, Math.ceil(area.width));

    if (isSteps) {
      this.drawTraceSteps(dc, decimated);
    } else {
      this.drawTraceSmooth(dc, decimated, dataRange);
    }
  }

  private drawTraceSteps(dc: DrawingContext, waveform: number[] | Float32Array): void {
    const area = this.mapper.getPlotArea();
    const dataWidth = waveform.length;
    const binW = area.width / Math.max(1, dataWidth);

    dc.save();
    dc.clipRect(area.x, area.y, area.width, area.height);

    dc.setFill(this.theme.shadow);
    for (let i = 0; i < dataWidth; i++) {
      const x = Math.round(area.x + i * binW);
      const nextX = i === dataWidth - 1 ? area.x + area.width : Math.round(area.x + (i + 1) * binW);
      const w = Math.max(1, nextX - x);
      const y = Math.round(this.mapper.clampY(waveform[i]));
      const h = area.y + area.height - y;
      dc.fillRect(x, y, w, h);
    }

    dc.setStroke(this.theme.line, 1 / this.mapper.getDPR());
    dc.beginPath();
    dc.moveTo(area.x, Math.round(this.mapper.clampY(waveform[0])));
    for (let i = 0; i < dataWidth; i++) {
      const y = Math.round(this.mapper.clampY(waveform[i]));
      const x = Math.round(area.x + i * binW);
      const nextX = i === dataWidth - 1 ? area.x + area.width : Math.round(area.x + (i + 1) * binW);

      dc.lineTo(x, y);
      dc.lineTo(nextX, y);
    }
    dc.stroke();
    dc.restore();
  }

  private drawTraceSmooth(dc: DrawingContext, waveform: number[] | Float32Array, visualRange?: Range): void {
    const area = this.mapper.getPlotArea();
    const freqRange = this.mapper.getFreqRange();
    const dataRange = visualRange || freqRange;
    const dataWidth = waveform.length;

    dc.save();
    dc.clipRect(area.x, area.y, area.width, area.height);

    // Fill
    dc.setFill(this.theme.shadow);
    dc.beginPath();
    dc.moveTo(this.mapper.freqToX(dataRange.min), area.y + area.height);
    for (let i = 0; i < dataWidth; i++) {
      const freq = dataRange.min + (i / (dataWidth - 1)) * (dataRange.max - dataRange.min);
      dc.lineTo(
        this.mapper.freqToX(freq),
        this.mapper.clampY(waveform[i])
      );
    }
    dc.lineTo(this.mapper.freqToX(dataRange.max), area.y + area.height);
    dc.closePath();
    dc.fill();

    // Stroke
    dc.setStroke(this.theme.line, 1 / this.mapper.getDPR());
    dc.beginPath();
    for (let i = 0; i < dataWidth; i++) {
      const freq = dataRange.min + (i / (dataWidth - 1)) * (dataRange.max - dataRange.min);
      const x = this.mapper.freqToX(freq);
      const y = this.mapper.clampY(waveform[i]);
      if (i === 0) dc.moveTo(x, y);
      else dc.lineTo(x, y);
    }
    dc.stroke();
    dc.restore();
  }

  drawHardwareGrid(dc: DrawingContext, hardwareSampleRateHz: number, fullCaptureRange?: Range): void {
    const area = this.mapper.getPlotArea();
    const freqRange = this.mapper.getFreqRange();
    const hwSpanMHz = hardwareSampleRateHz / 1e6;
    const anchorRange = fullCaptureRange || freqRange;
    const totalSpan = anchorRange.max - anchorRange.min;

    if (totalSpan <= hwSpanMHz + 0.001 || hwSpanMHz <= 0) return;

    dc.save();
    dc.setStroke(this.theme.hwLine, 1 / this.mapper.getDPR(), [4, 4]);
    dc.setFill(this.theme.hwText);
    dc.setFont("10px JetBrains Mono");
    dc.setTextAlign("center");
    dc.setTextBaseline("top");

    const fmtOff = (mhz: number) => {
      if (Math.abs(mhz) >= 1) return `${mhz.toFixed(1)}MHz`;
      if (Math.abs(mhz) >= 0.001) return `${Math.round(mhz * 1000)}kHz`;
      return `${Math.round(mhz * 1_000_000)}Hz`;
    };

    let cur = anchorRange.min;
    while (cur < anchorRange.max - 0.001) {
      const bStart = cur;
      const bEnd = Math.min(bStart + hwSpanMHz, anchorRange.max);
      const bWidth = bEnd - bStart;
      const isFull = bWidth >= hwSpanMHz - 0.001;

      if (bEnd > freqRange.min && bStart < freqRange.max) {
        if (bStart > anchorRange.min + 0.0001 && bStart >= freqRange.min && bStart <= freqRange.max) {
          const lx = Math.round(this.mapper.freqToX(bStart));
          dc.beginPath();
          dc.moveTo(lx, area.y);
          dc.lineTo(lx, area.y + area.height);
          dc.stroke();
        }

        const visibleStart = Math.max(bStart, freqRange.min);
        const visibleEnd = Math.min(bEnd, freqRange.max);
        const visibleCenter = (visibleStart + visibleEnd) / 2;

        if (visibleCenter >= freqRange.min && visibleCenter <= freqRange.max) {
          const cx = Math.round(this.mapper.freqToX(visibleCenter));
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

  drawStatsBox(dc: DrawingContext, statsLines: string[], _waveform: number[] | Float32Array): void {
    const area = this.mapper.getPlotArea();
    // Use up to 70% of width to avoid truncation, text will scale down if needed
    const maxAllowedW = area.width * 0.7;
    const baseFontSize = 12;
    const paddingX = 12;
    const paddingY = 10;
    const lineHeight = 18;

    // Calculate required box width and individual line font sizes
    const linesWithScaling = statsLines.map(line => {
      dc.setFont(`${baseFontSize}px monospace`);
      const width = dc.measureTextWidth(line);
      let fontSize = baseFontSize;
      let finalWidth = width;
      
      const maxTextW = maxAllowedW - paddingX * 2;
      
      if (width > maxTextW) {
        // Calculate factor including a small safety margin
        fontSize = Math.floor(baseFontSize * (maxTextW / width) * 0.98);
        fontSize = Math.max(8, fontSize);
        dc.setFont(`${fontSize}px monospace`);
        finalWidth = dc.measureTextWidth(line);
      }
      return { line, fontSize, width: finalWidth };
    });

    const boxW = Math.max(...linesWithScaling.map(l => l.width)) + paddingX * 2;
    const boxH = statsLines.length * lineHeight + paddingY * 2;

    const pos = this.findOptimalStatsBoxPosition(boxW, boxH);

    dc.setFill("rgba(0, 0, 0, 0.75)");
    dc.roundRect(pos.x, pos.y, boxW, boxH, 4);

    dc.setFill("#eee");
    dc.setTextAlign("left");
    dc.setTextBaseline("alphabetic");
    
    linesWithScaling.forEach((item, i) => {
      dc.setFont(`${item.fontSize}px monospace`);
      // Use lineHeight for vertical spacing
      dc.fillText(item.line, pos.x + paddingX, pos.y + paddingY + (i + 0.8) * lineHeight);
    });
  }

  private findOptimalStatsBoxPosition(boxW: number, boxH: number): { x: number, y: number } {
    const area = this.mapper.getPlotArea();
    const paddingX = 12;
    const paddingY = 12;
    const labelBand = 28;
    const x = Math.max(area.x + paddingX, area.x + area.width - boxW - paddingX);
    const y = Math.max(area.y + paddingY, area.y + area.height - boxH - labelBand);
    return { x, y };
  }
}
