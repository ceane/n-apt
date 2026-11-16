import { computeComplexIqSpectrum } from "@n-apt/spectrum/fft/complexSpectrum";
import { newestIqWindow } from "@n-apt/spectrum/public/FIFOWaterfall";
import { subscribeFrameArrivals } from "@n-apt/app/infrastructure/visualization/frameArrivalRuntime";
import {
  WATERFALL_SOURCE_FFT_SIZE,
  WATERFALL_SOURCE_HISTORY_ROWS,
} from "@n-apt/demodulation/react-flow/nodes/waterfallLayout";

export type WaterfallSourceView = "level" | "phase" | "variance";

export interface WaterfallSourceFrame {
  levelDb: Float32Array;
  phaseDegrees: Float32Array;
  centerFrequencyHz: number | null;
  sampleRateHz: number | null;
  timestampMs: number;
  generation: number;
}

export interface WaterfallFrameRef {
  current: unknown;
}

export interface WaterfallSourceFeed {
  getCurrent: () => Float32Array | null;
  subscribe: (
    listener: (row: Float32Array, frame?: WaterfallSourceFrame) => void,
  ) => () => void;
  replayHistory: true;
}

/** Capture a viewport in the row as it arrives, for accretive stacking. */
export const cropAccretiveWaterfallRow = (
  row: Float32Array,
  zoom: number,
  panHz: number,
  sampleSpanHz: number,
): Float32Array => {
  if (zoom < 1 && zoom > 0) {
    const result = new Float32Array(row.length);
    const center =
      row.length / 2 + (panHz / Math.max(1, sampleSpanHz)) * row.length;
    const width = row.length / zoom;
    const start = center - width / 2;
    for (let index = 0; index < result.length; index++) {
      const sourceIndex = Math.floor(start + (index * width) / result.length);
      result[index] =
        sourceIndex >= 0 && sourceIndex < row.length
          ? row[sourceIndex]
          : Number.NEGATIVE_INFINITY;
    }
    return result;
  }
  const length = Math.max(
    1,
    Math.min(row.length, Math.floor(row.length / Math.max(1, zoom))),
  );
  const center =
    row.length / 2 + (panHz / Math.max(1, sampleSpanHz)) * row.length;
  const start = Math.floor(center - length / 2);
  if (start >= 0 && start + length <= row.length)
    return row.slice(start, start + length);
  const result = new Float32Array(length);
  result.fill(Number.NEGATIVE_INFINITY);
  const from = Math.max(0, start);
  const to = Math.min(row.length, start + length);
  if (to > from) result.set(row.subarray(from, to), from - start);
  return result;
};

/** Retain rows after their arrival-time transform, independently per view. */
export const createAccretiveWaterfallFeed = (
  source: WaterfallSourceFeed,
  transform: (row: Float32Array, frame?: WaterfallSourceFrame) => Float32Array,
): WaterfallSourceFeed => {
  const rows: Array<{ row: Float32Array; frame?: WaterfallSourceFrame }> = [];
  const listeners = new Set<
    (row: Float32Array, frame?: WaterfallSourceFrame) => void
  >();
  let unsubscribeSource: (() => void) | null = null;
  let lastGeneration = 0;

  return {
    replayHistory: true,
    getCurrent: () => {
      const current = rows[rows.length - 1]?.row;
      if (current) return current;
      const row = source.getCurrent();
      return row ? transform(row) : null;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      for (const entry of rows) listener(entry.row, entry.frame);
      if (!unsubscribeSource) {
        unsubscribeSource = source.subscribe((row, frame) => {
          if (frame && frame.generation <= lastGeneration) return;
          if (frame) lastGeneration = frame.generation;
          const transformed = transform(row, frame);
          rows.push({ row: transformed, frame });
          if (rows.length > WATERFALL_SOURCE_HISTORY_ROWS) rows.shift();
          for (const current of listeners) current(transformed, frame);
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeSource?.();
          unsubscribeSource = null;
        }
      };
    },
  };
};

interface SourceBuffer {
  sourceRef: WaterfallFrameRef;
  rows: Array<WaterfallSourceFrame | null>;
  start: number;
  count: number;
  generation: number;
  lastMarker: string;
  listeners: Set<(frame: WaterfallSourceFrame) => void>;
  animationFrame: number | null;
  unsubscribeFrameArrival: (() => void) | null;
  lastUsedAt: number;
}

const sourceBuffers = new Map<string, SourceBuffer>();
const MAX_SOURCE_BUFFERS = 4;
const VARIANCE_TIME_CONSTANT_SECONDS = 0.65;
const VARIANCE_TRAIL_HALF_LIFE_SECONDS = 1.2;

const readFrame = (
  sourceRef: WaterfallFrameRef,
): Record<string, unknown> | null => {
  const current = sourceRef.current;
  if (Array.isArray(current)) {
    return (current[current.length - 1] as Record<string, unknown>) ?? null;
  }
  return (current as Record<string, unknown> | null) ?? null;
};

const getFrameMarker = (
  frame: Record<string, unknown>,
  iq: Uint8Array,
): string => {
  const sampleIndices = [
    0,
    Math.floor(iq.length * 0.125),
    Math.floor(iq.length * 0.25),
    Math.floor(iq.length * 0.375),
    Math.floor(iq.length * 0.5),
    Math.floor(iq.length * 0.625),
    Math.floor(iq.length * 0.75),
    Math.floor(iq.length * 0.875),
    iq.length - 1,
  ];
  return [
    frame.source_id ?? "",
    frame.stream_epoch ?? "",
    frame.sequence ?? "",
    frame.timestamp ?? "",
    frame.center_frequency_hz ?? "",
    frame.sample_rate ?? "",
    iq.length,
    ...sampleIndices.map((index) => iq[index] ?? 0),
  ].join(":");
};

const createSourceBuffer = (sourceRef: WaterfallFrameRef): SourceBuffer => ({
  sourceRef,
  rows: Array.from({ length: WATERFALL_SOURCE_HISTORY_ROWS }, () => null),
  start: 0,
  count: 0,
  generation: 0,
  lastMarker: "",
  listeners: new Set(),
  animationFrame: null,
  unsubscribeFrameArrival: null,
  lastUsedAt: performance.now(),
});

const getSourceBuffer = (
  sourceKey: string,
  sourceRef: WaterfallFrameRef,
): SourceBuffer => {
  let buffer = sourceBuffers.get(sourceKey);
  if (!buffer) {
    if (sourceBuffers.size >= MAX_SOURCE_BUFFERS) {
      const idleBuffers = [...sourceBuffers.entries()]
        .filter(([, candidate]) => candidate.listeners.size === 0)
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
      const oldestIdle = idleBuffers[0];
      if (oldestIdle) sourceBuffers.delete(oldestIdle[0]);
    }
    buffer = createSourceBuffer(sourceRef);
    sourceBuffers.set(sourceKey, buffer);
  } else {
    buffer.sourceRef = sourceRef;
    buffer.lastUsedAt = performance.now();
  }
  return buffer;
};

const appendLatestFrame = (
  buffer: SourceBuffer,
): WaterfallSourceFrame | null => {
  const frame = readFrame(buffer.sourceRef);
  const iq = frame?.iq_data;
  if (!frame || !(iq instanceof Uint8Array) || iq.length < 2) return null;

  const marker = getFrameMarker(frame, iq);
  if (marker === buffer.lastMarker) return null;
  buffer.lastMarker = marker;

  const input = newestIqWindow(iq, WATERFALL_SOURCE_FFT_SIZE);
  const { real, imag, fftLen, normSq } = computeComplexIqSpectrum(
    input,
    WATERFALL_SOURCE_FFT_SIZE,
  );
  const levelDb = new Float32Array(fftLen);
  const phaseDegrees = new Float32Array(fftLen);
  const half = fftLen / 2;
  const radiansToDegrees = 180 / Math.PI;

  for (let index = 0; index < fftLen; index++) {
    const sourceIndex = index < half ? index + half : index - half;
    const realValue = real[sourceIndex];
    const imagValue = imag[sourceIndex];
    levelDb[index] =
      10 *
      Math.log10(
        (realValue * realValue + imagValue * imagValue) / normSq + 1e-15,
      );
    phaseDegrees[index] = Math.atan2(imagValue, realValue) * radiansToDegrees;
  }

  const parsedTimestamp = Number(frame.timestamp);
  const row: WaterfallSourceFrame = {
    levelDb,
    phaseDegrees,
    centerFrequencyHz:
      typeof frame.center_frequency_hz === "number" &&
      Number.isFinite(frame.center_frequency_hz)
        ? frame.center_frequency_hz
        : null,
    sampleRateHz:
      typeof frame.sample_rate === "number" &&
      Number.isFinite(frame.sample_rate) &&
      frame.sample_rate > 0
        ? frame.sample_rate
        : null,
    timestampMs: Number.isFinite(parsedTimestamp)
      ? parsedTimestamp
      : performance.now(),
    generation: ++buffer.generation,
  };
  const writeIndex = (buffer.start + buffer.count) % buffer.rows.length;
  if (buffer.count === buffer.rows.length) {
    buffer.rows[buffer.start] = row;
    buffer.start = (buffer.start + 1) % buffer.rows.length;
  } else {
    buffer.rows[writeIndex] = row;
    buffer.count += 1;
  }
  return row;
};

const getOrderedRows = (buffer: SourceBuffer): WaterfallSourceFrame[] => {
  const ordered: WaterfallSourceFrame[] = [];
  for (let index = 0; index < buffer.count; index++) {
    const row = buffer.rows[(buffer.start + index) % buffer.rows.length];
    if (row) ordered.push(row);
  }
  return ordered;
};

const startSourcePolling = (buffer: SourceBuffer) => {
  if (buffer.animationFrame !== null || buffer.listeners.size === 0) return;

  const publishLatest = () => {
    const row = appendLatestFrame(buffer);
    if (row) {
      for (const listener of buffer.listeners) listener(row);
    }
  };
  buffer.unsubscribeFrameArrival = subscribeFrameArrivals(publishLatest);

  const tick = () => {
    if (buffer.listeners.size === 0) {
      buffer.animationFrame = null;
      return;
    }
    publishLatest();
    buffer.animationFrame = window.requestAnimationFrame(tick);
  };

  buffer.animationFrame = window.requestAnimationFrame(tick);
};

export const createWaterfallSourceFeed = (
  sourceKey: string,
  sourceRef: WaterfallFrameRef,
  view: WaterfallSourceView,
  levelOffsetDb = 0,
): WaterfallSourceFeed => {
  const buffer = getSourceBuffer(sourceKey, sourceRef);
  const transformedRows = new Map<number, Float32Array>();
  let varianceMean = new Float32Array(0);
  let variancePower = new Float32Array(0);
  let varianceTrail = new Float32Array(0);
  let hasVarianceBaseline = false;
  let lastTimestampMs: number | null = null;

  const transformRow = (frame: WaterfallSourceFrame): Float32Array => {
    const cached = transformedRows.get(frame.generation);
    if (cached) return cached;

    let row: Float32Array;
    if (view === "phase") {
      row = frame.phaseDegrees;
    } else if (view === "variance") {
      if (varianceMean.length !== frame.levelDb.length) {
        varianceMean = new Float32Array(frame.levelDb.length);
        variancePower = new Float32Array(frame.levelDb.length);
        varianceTrail = new Float32Array(frame.levelDb.length);
        hasVarianceBaseline = false;
        lastTimestampMs = null;
      }
      const timestampDeltaSeconds =
        lastTimestampMs === null
          ? 0
          : (frame.timestampMs - lastTimestampMs) / 1000;
      const elapsedSeconds =
        lastTimestampMs === null
          ? 0
          : timestampDeltaSeconds > 0
            ? Math.min(2, timestampDeltaSeconds)
            : 1 / 30;
      lastTimestampMs = frame.timestampMs;
      row = new Float32Array(frame.levelDb.length);
      if (!hasVarianceBaseline) {
        varianceMean.set(frame.levelDb);
        hasVarianceBaseline = true;
      } else {
        const smoothing =
          1 - Math.exp(-elapsedSeconds / VARIANCE_TIME_CONSTANT_SECONDS);
        const trailDecay = Math.exp(
          (-Math.LN2 * elapsedSeconds) / VARIANCE_TRAIL_HALF_LIFE_SECONDS,
        );
        for (let index = 0; index < frame.levelDb.length; index++) {
          const delta = frame.levelDb[index] - varianceMean[index];
          varianceMean[index] += smoothing * delta;
          variancePower[index] =
            (1 - smoothing) *
            (variancePower[index] + smoothing * delta * delta);
          const standardDeviationDb = Math.sqrt(variancePower[index]);
          varianceTrail[index] = Math.min(
            30,
            Math.max(standardDeviationDb, varianceTrail[index] * trailDecay),
          );
          row[index] = varianceTrail[index];
        }
      }
    } else if (levelOffsetDb === 0) {
      row = frame.levelDb;
    } else {
      row = new Float32Array(frame.levelDb.length);
      for (let index = 0; index < frame.levelDb.length; index++) {
        row[index] = frame.levelDb[index] + levelOffsetDb;
      }
    }

    transformedRows.set(frame.generation, row);
    if (transformedRows.size > WATERFALL_SOURCE_HISTORY_ROWS) {
      const oldestGeneration = transformedRows.keys().next().value;
      if (oldestGeneration !== undefined)
        transformedRows.delete(oldestGeneration);
    }
    return row;
  };

  return {
    replayHistory: true,
    getCurrent: () => {
      if (view === "variance") return null;
      const latest = buffer.count
        ? buffer.rows[(buffer.start + buffer.count - 1) % buffer.rows.length]
        : null;
      return latest ? transformRow(latest) : null;
    },
    subscribe: (listener) => {
      if (buffer.listeners.size === 0) appendLatestFrame(buffer);
      for (const row of getOrderedRows(buffer))
        listener(transformRow(row), row);
      const onFrame = (frame: WaterfallSourceFrame) => {
        listener(transformRow(frame), frame);
      };
      buffer.listeners.add(onFrame);
      startSourcePolling(buffer);
      return () => {
        buffer.listeners.delete(onFrame);
        buffer.lastUsedAt = performance.now();
        if (buffer.listeners.size === 0 && buffer.animationFrame !== null) {
          window.cancelAnimationFrame(buffer.animationFrame);
          buffer.animationFrame = null;
        }
        if (buffer.listeners.size === 0) {
          buffer.unsubscribeFrameArrival?.();
          buffer.unsubscribeFrameArrival = null;
        }
      };
    },
  };
};
