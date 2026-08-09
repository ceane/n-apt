export interface FFTZoomRange {
  min: number;
  max: number;
}

export interface FFTZoomResult {
  slicedWaveform: Float32Array;
  visualRange: FFTZoomRange;
  clampedPan: number;
}

export interface FFTZoomProcessor {
  process: (
    fullWaveform: Float32Array,
    fullRange: FFTZoomRange,
    zoom: number,
    panOffset: number,
  ) => FFTZoomResult;
}

export const createFFTZoomProcessor = (minimumDb: number): FFTZoomProcessor => {
  let padded = new Float32Array(0);
  const visualRange = { min: 0, max: 0 };
  const result: FFTZoomResult = {
    slicedWaveform: padded,
    visualRange,
    clampedPan: 0,
  };

  const process = (
    fullWaveform: Float32Array,
    fullRange: FFTZoomRange,
    zoom: number,
    panOffset: number,
  ): FFTZoomResult => {
    if (zoom === 1 && panOffset === 0) {
      result.slicedWaveform = fullWaveform;
      visualRange.min = fullRange.min;
      visualRange.max = fullRange.max;
      result.clampedPan = 0;
      return result;
    }

    const totalBins = fullWaveform.length;
    const visibleBins = Math.max(1, Math.floor(totalBins / zoom));
    const rangeMin = fullRange.min;
    const rangeMax = fullRange.max;
    const fullSpan = rangeMax - rangeMin;
    const visualCenter = (rangeMin + rangeMax) * 0.5 + panOffset;
    const halfSpan = fullSpan / (2 * zoom);
    const visualCenterBin = Math.round(
      ((visualCenter - rangeMin) / fullSpan) * totalBins,
    );
    const startBin = Math.round(visualCenterBin - visibleBins * 0.5);

    visualRange.min = visualCenter - halfSpan;
    visualRange.max = visualCenter + halfSpan;
    result.clampedPan = panOffset;

    if (startBin >= 0 && startBin + visibleBins <= totalBins && zoom >= 1) {
      result.slicedWaveform = fullWaveform.subarray(
        startBin,
        startBin + visibleBins,
      );
      return result;
    }

    if (padded.length !== visibleBins) {
      padded = new Float32Array(visibleBins);
    }
    padded.fill(minimumDb);

    const destinationOffset = startBin < 0 ? -startBin : 0;
    const sourceOffset = startBin > 0 ? startBin : 0;
    let copyLength = visibleBins - destinationOffset;
    const availableSource = totalBins - sourceOffset;
    if (copyLength > availableSource) copyLength = availableSource;
    if (copyLength > 0 && sourceOffset < totalBins) {
      padded.set(
        fullWaveform.subarray(sourceOffset, sourceOffset + copyLength),
        destinationOffset,
      );
    }

    result.slicedWaveform = padded;
    return result;
  };

  return { process };
};
