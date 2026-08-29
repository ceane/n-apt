export interface TuningFrequencyRange {
  min: number;
  max: number;
}

export type TuneInertia =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | {
      type: "cubic-bezier";
      points: [number, number, number, number];
    }
  | { type: "sine"; mode: "in" | "out" | "in-out" }
  | ((progress: number) => number);

export interface TuneWiggleOptions {
  amplitudeHz: number;
  cycles?: number;
  damping?: number;
}

export interface TuneOptions {
  /** Total trajectory duration. Supplying options opts a tune into animation. */
  durationMs?: number;
  inertia?: TuneInertia;
  wiggle?: TuneWiggleOptions;
  /** Minimum interval between hardware retune commands. */
  retuneIntervalMs?: number;
}

export interface ProgressiveTuneFrame {
  range: TuningFrequencyRange;
  progress: number;
  isFinal: boolean;
}

export interface ProgressiveTuningControllerOptions {
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (frameId: number) => void;
  now?: () => number;
  onPreview: (range: TuningFrequencyRange, frame: ProgressiveTuneFrame) => void;
  onRetune: (range: TuningFrequencyRange, frame: ProgressiveTuneFrame) => void;
  onComplete: (range: TuningFrequencyRange) => void;
}

export interface ProgressiveTuningController {
  start: (
    fromRange: TuningFrequencyRange,
    toRange: TuningFrequencyRange,
    options?: TuneOptions,
    bounds?: TuningFrequencyRange,
  ) => void;
  cancel: () => void;
  isActive: () => boolean;
}

export const DEFAULT_TUNE_DURATION_MS = 500;
export const DEFAULT_RETUNE_INTERVAL_MS = 50;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const cubicBezierCoordinate = (t: number, p1: number, p2: number): number => {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
};

const cubicBezierDerivative = (t: number, p1: number, p2: number): number =>
  3 * (1 - t) * (1 - t) * p1 + 6 * (1 - t) * t * (p2 - p1) + 3 * t * t * (1 - p2);

const solveCubicBezier = (
  progress: number,
  points: [number, number, number, number],
): number => {
  const [rawX1, y1, rawX2, y2] = points;
  const x1 = clamp01(rawX1);
  const x2 = clamp01(rawX2);
  let parameter = progress;

  // Newton converges quickly for normal CSS timing curves.
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = cubicBezierCoordinate(parameter, x1, x2) - progress;
    const slope = cubicBezierDerivative(parameter, x1, x2);
    if (Math.abs(error) < 1e-7 || Math.abs(slope) < 1e-7) break;
    parameter = clamp01(parameter - error / slope);
  }

  // The bisection fallback handles flat slopes and unusual but valid curves.
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const x = cubicBezierCoordinate(parameter, x1, x2);
    if (Math.abs(x - progress) < 1e-7) break;
    if (x < progress) low = parameter;
    else high = parameter;
    parameter = (low + high) / 2;
  }

  return clamp01(cubicBezierCoordinate(parameter, y1, y2));
};

/** Resolve a normalized animation progress value from the public inertia API. */
export const resolveTuneProgress = (
  rawProgress: number,
  inertia: TuneInertia = "ease-out",
): number => {
  const progress = clamp01(rawProgress);
  if (progress === 0 || progress === 1) return progress;

  let resolved: number;
  if (typeof inertia === "function") {
    try {
      resolved = inertia(progress);
    } catch {
      resolved = progress;
    }
  } else if (typeof inertia === "object" && inertia.type === "cubic-bezier") {
    resolved = solveCubicBezier(progress, inertia.points);
  } else if (typeof inertia === "object" && inertia.type === "sine") {
    switch (inertia.mode) {
      case "in":
        resolved = 1 - Math.cos((progress * Math.PI) / 2);
        break;
      case "out":
        resolved = Math.sin((progress * Math.PI) / 2);
        break;
      case "in-out":
        resolved = -(Math.cos(Math.PI * progress) - 1) / 2;
        break;
    }
  } else {
    switch (inertia) {
      case "linear":
        resolved = progress;
        break;
      case "ease-in":
        resolved = progress * progress;
        break;
      case "ease-in-out":
        resolved = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        break;
      case "ease-out":
      default:
        resolved = 1 - Math.pow(1 - progress, 2);
        break;
    }
  }

  return clamp01(resolved);
};

const normalizeRange = (range: TuningFrequencyRange): TuningFrequencyRange => {
  const min = finiteOr(range.min, 0);
  const max = finiteOr(range.max, min + 1);
  if (max > min) {
    return { min: Math.round(min), max: Math.round(max) };
  }
  return { min: Math.round(min), max: Math.round(min) + 1 };
};

const getRangeSpan = (range: TuningFrequencyRange): number =>
  Math.max(1, normalizeRange(range).max - normalizeRange(range).min);

/**
 * Builds one integer-Hz viewport around a center while preserving its span.
 * If bounds are supplied, the entire viewport is translated inside them.
 */
export const resolveTuningRange = (
  centerFrequencyHz: number,
  range: TuningFrequencyRange,
  bounds?: TuningFrequencyRange,
): TuningFrequencyRange => {
  const normalizedRange = normalizeRange(range);
  const span = getRangeSpan(normalizedRange);
  const center = finiteOr(centerFrequencyHz, normalizedRange.min + span / 2);
  if (!bounds) {
    const min = Math.round(center - span / 2);
    return { min, max: min + span };
  }

  const normalizedBounds = normalizeRange(bounds);
  const boundsSpan = normalizedBounds.max - normalizedBounds.min;
  if (span >= boundsSpan) return normalizedBounds;

  let min = Math.round(center - span / 2);
  min = Math.max(normalizedBounds.min, Math.min(min, normalizedBounds.max - span));
  return { min, max: min + span };
};

const getRangeCenter = (range: TuningFrequencyRange): number => {
  const normalized = normalizeRange(range);
  return (normalized.min + normalized.max) / 2;
};

const resolveWiggleOffset = (
  progress: number,
  wiggle: TuneWiggleOptions | undefined,
): number => {
  if (!wiggle) return 0;
  const amplitudeHz = finiteOr(wiggle.amplitudeHz, 0);
  if (amplitudeHz === 0) return 0;
  const cycles = Math.max(0, finiteOr(wiggle.cycles, 2));
  const damping = Math.max(0, finiteOr(wiggle.damping, 4));
  // sin(pi*t) makes the decorative motion exactly zero at both endpoints.
  return (
    amplitudeHz *
    Math.sin(progress * Math.PI * 2 * cycles) *
    Math.sin(progress * Math.PI) *
    Math.exp(-damping * progress)
  );
};

/** Resolve the animated center in Hz, including an optional damped wiggle. */
export const resolveTuningCenterFrequency = ({
  fromCenterFrequencyHz,
  toCenterFrequencyHz,
  progress,
  inertia = "ease-out",
  wiggle,
}: {
  fromCenterFrequencyHz: number;
  toCenterFrequencyHz: number;
  progress: number;
  inertia?: TuneInertia;
  wiggle?: TuneWiggleOptions;
}): number => {
  const safeProgress = clamp01(progress);
  if (safeProgress === 0) return fromCenterFrequencyHz;
  if (safeProgress === 1) return toCenterFrequencyHz;
  return (
    fromCenterFrequencyHz +
    (toCenterFrequencyHz - fromCenterFrequencyHz) *
      resolveTuneProgress(safeProgress, inertia) +
    resolveWiggleOffset(safeProgress, wiggle)
  );
};

const resolveTrajectoryFrame = ({
  fromRange,
  toRange,
  progress,
  inertia,
  wiggle,
  bounds,
}: {
  fromRange: TuningFrequencyRange;
  toRange: TuningFrequencyRange;
  progress: number;
  inertia: TuneInertia;
  wiggle?: TuneWiggleOptions;
  bounds?: TuningFrequencyRange;
}): ProgressiveTuneFrame => {
  const safeProgress = clamp01(progress);
  const from = normalizeRange(fromRange);
  const target = normalizeRange(toRange);
  const targetSpan = getRangeSpan(target);
  if (safeProgress === 0) {
    return { range: resolveTuningRange(getRangeCenter(from), from, bounds), progress: 0, isFinal: false };
  }
  if (safeProgress === 1) {
    const finalRange = resolveTuningRange(getRangeCenter(target), target, bounds);
    return { range: finalRange, progress: 1, isFinal: true };
  }

  const center = resolveTuningCenterFrequency({
    fromCenterFrequencyHz: getRangeCenter(from),
    toCenterFrequencyHz: getRangeCenter(target),
    progress: safeProgress,
    inertia,
    wiggle,
  });
  return {
    range: resolveTuningRange(
      center,
      { min: center - targetSpan / 2, max: center + targetSpan / 2 },
      bounds,
    ),
    progress: safeProgress,
    isFinal: false,
  };
};

const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const defaultRequestFrame = (callback: (timestamp: number) => void): number => {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(defaultNow()), 16) as unknown as number;
};

const defaultCancelFrame = (frameId: number): void => {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameId);
    return;
  }
  globalThis.clearTimeout(frameId);
};

export const createProgressiveTuningController = (
  controllerOptions: Partial<ProgressiveTuningControllerOptions> = {},
): ProgressiveTuningController => {
  const requestFrame = controllerOptions.requestFrame ?? defaultRequestFrame;
  const cancelFrame = controllerOptions.cancelFrame ?? defaultCancelFrame;
  const now = controllerOptions.now ?? defaultNow;
  const onPreview = controllerOptions.onPreview ?? (() => undefined);
  const onRetune = controllerOptions.onRetune ?? (() => undefined);
  const onComplete = controllerOptions.onComplete ?? (() => undefined);

  let frameId: number | null = null;
  let generation = 0;
  let active = false;
  let startTime = 0;
  let lastRetuneAt: number | null = null;

  const cancel = () => {
    generation += 1;
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    active = false;
  };

  const start = (
    fromRange: TuningFrequencyRange,
    toRange: TuningFrequencyRange,
    options: TuneOptions = {},
    bounds?: TuningFrequencyRange,
  ) => {
    cancel();
    const token = generation + 1;
    generation = token;
    active = true;
    startTime = now();
    lastRetuneAt = null;
    const durationMs = Math.max(0, finiteOr(options.durationMs, DEFAULT_TUNE_DURATION_MS));
    const retuneIntervalMs = Math.max(
      0,
      finiteOr(options.retuneIntervalMs, DEFAULT_RETUNE_INTERVAL_MS),
    );
    const inertia = options.inertia ?? "ease-out";

    const emit = (timestamp: number) => {
      if (!active || generation !== token) return;
      const elapsed = Math.max(0, timestamp - startTime);
      const progress = durationMs === 0 ? 1 : clamp01(elapsed / durationMs);
      const frame = resolveTrajectoryFrame({
        fromRange,
        toRange,
        progress,
        inertia,
        wiggle: options.wiggle,
        bounds,
      });
      onPreview(frame.range, frame);
      if (
        frame.isFinal ||
        lastRetuneAt === null ||
        timestamp - lastRetuneAt >= retuneIntervalMs
      ) {
        onRetune(frame.range, frame);
        lastRetuneAt = timestamp;
      }

      if (frame.isFinal) {
        active = false;
        frameId = null;
        onComplete(frame.range);
        return;
      }
      frameId = requestFrame(emit);
    };

    frameId = requestFrame(emit);
  };

  return {
    start,
    cancel,
    isActive: () => active,
  };
};
