export interface HeterodyningDetectionResult {
  detected: boolean;
  confidence: number | null;
  statusText: string;
  highlightedBins: Array<{ start: number; end: number }>;
}

const MIN_HISTORY_ROWS = 24;
const MIN_BIN_COUNT = 32;
const MAX_HIGHLIGHT_BINS = 8;

export function detectHeterodyningFromHistory(
  history: Float32Array[],
): HeterodyningDetectionResult {
  if (history.length < MIN_HISTORY_ROWS) {
    return {
      detected: false,
      confidence: null,
      statusText: "Not enough history",
      highlightedBins: [],
    };
  }

  const width = history[0]?.length ?? 0;
  if (width < MIN_BIN_COUNT || history.some((row) => row.length !== width)) {
    return {
      detected: false,
      confidence: null,
      statusText: "Incompatible waterfall",
      highlightedBins: [],
    };
  }

  const columnScores = new Float32Array(width);
  const rowMeans = new Float32Array(history.length);

  for (let rowIndex = 0; rowIndex < history.length; rowIndex++) {
    const row = history[rowIndex];
    let sum = 0;
    for (let i = 0; i < width; i++) {
      sum += row[i];
    }
    rowMeans[rowIndex] = sum / width;
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    let sqSum = 0;
    for (let rowIndex = 0; rowIndex < history.length; rowIndex++) {
      const normalized = history[rowIndex][x] - rowMeans[rowIndex];
      sum += normalized;
      sqSum += normalized * normalized;
    }
    const mean = sum / history.length;
    const variance = Math.max(0, sqSum / history.length - mean * mean);
    columnScores[x] = variance;
  }

  let total = 0;
  let maxScore = 0;
  for (let i = 0; i < width; i++) {
    total += columnScores[i];
    if (columnScores[i] > maxScore) {
      maxScore = columnScores[i];
    }
  }

  const meanScore = total / width;
  if (!Number.isFinite(meanScore) || meanScore <= 0 || maxScore <= 0) {
    return {
      detected: false,
      confidence: 0,
      statusText: "No periodic pattern",
      highlightedBins: [],
    };
  }

  const threshold = meanScore * 1.9;
  const segments: Array<{ start: number; end: number; peak: number }> = [];
  let start = -1;
  let peak = 0;

  for (let i = 0; i < width; i++) {
    const score = columnScores[i];
    if (score >= threshold) {
      if (start === -1) {
        start = i;
        peak = score;
      } else {
        peak = Math.max(peak, score);
      }
    } else if (start !== -1) {
      segments.push({ start, end: i, peak });
      start = -1;
      peak = 0;
    }
  }

  if (start !== -1) {
    segments.push({ start, end: width, peak });
  }

  const highlightedBins = segments
    .sort((a, b) => b.peak - a.peak)
    .slice(0, MAX_HIGHLIGHT_BINS)
    .sort((a, b) => a.start - b.start)
    .map((segment) => ({
      start: segment.start / width,
      end: segment.end / width,
    }));

  const normalizedPeak = Math.min(
    1,
    Math.max(0, (maxScore - meanScore) / (meanScore * 4)),
  );
  const coverage = highlightedBins.reduce(
    (acc, item) => acc + (item.end - item.start),
    0,
  );
  const confidence = Math.max(
    0,
    Math.min(0.99, normalizedPeak * 0.8 + Math.min(0.2, coverage)),
  );
  const detected = highlightedBins.length >= 2 && confidence >= 0.28;

  return {
    detected,
    confidence: Number(confidence.toFixed(2)),
    statusText: detected
      ? `Detected (${confidence.toFixed(2)})`
      : `Not detected (${confidence.toFixed(2)})`,
    highlightedBins: detected ? highlightedBins : [],
  };
}
