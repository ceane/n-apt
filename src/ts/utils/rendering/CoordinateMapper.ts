export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Range {
  min: number;
  max: number;
}

/**
 * CoordinateMapper handles the mapping between data units (Frequency in MHz, Amplitude in dB)
 * and visual coordinates (pixels).
 */
export class CoordinateMapper {
  private plotArea: Rect;
  private freqRange: Range;
  private dbRange: Range;
  private dpr: number;

  constructor(
    plotArea: Rect,
    freqRange: Range,
    dbRange: Range,
    dpr: number = 1
  ) {
    this.plotArea = plotArea;
    this.freqRange = freqRange;
    this.dbRange = dbRange;
    this.dpr = dpr;
  }

  /**
   * Maps a frequency in MHz to an X coordinate in logical pixels.
   */
  freqToX(freq: number): number {
    const bandwidth = this.freqRange.max - this.freqRange.min;
    if (bandwidth === 0) return this.plotArea.x;
    const ratio = (freq - this.freqRange.min) / bandwidth;
    return this.plotArea.x + ratio * this.plotArea.width;
  }

  /**
   * Maps a dB value to a Y coordinate in logical pixels.
   */
  dbToY(db: number): number {
    const range = this.dbRange.max - this.dbRange.min;
    if (range === 0) return this.plotArea.y + this.plotArea.height;
    // Higher dB means smaller Y (higher on screen)
    const ratio = (db - this.dbRange.min) / range;
    return this.plotArea.y + this.plotArea.height - ratio * this.plotArea.height;
  }

  /**
   * Clamps a dB value to the visual Y range.
   */
  clampY(db: number): number {
    const y = this.dbToY(db);
    return Math.max(this.plotArea.y, Math.min(this.plotArea.y + this.plotArea.height, y));
  }

  /**
   * Helper to round a value to pixel grid based on DPR.
   */
  snap(val: number): number {
    return Math.round(val * this.dpr) / this.dpr;
  }

  /**
   * Get the logical pixels per unit (MHz)
   */
  getPixelsPerMHz(): number {
    const bandwidth = this.freqRange.max - this.freqRange.min;
    return bandwidth > 0 ? this.plotArea.width / bandwidth : 0;
  }

  /**
   * Get the logical pixels per unit (dB)
   */
  getPixelsPerDB(): number {
    const range = this.dbRange.max - this.dbRange.min;
    return range > 0 ? this.plotArea.height / range : 0;
  }

  getPlotArea(): Rect {
    return this.plotArea;
  }

  getFreqRange(): Range {
    return this.freqRange;
  }

  getDbRange(): Range {
    return this.dbRange;
  }

  getDPR(): number {
    return this.dpr;
  }
}
