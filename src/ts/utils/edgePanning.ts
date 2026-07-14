import { clampFrequencyHz } from "@n-apt/utils/frequency";

export type EdgePanningHandle = "left" | "right";
export type BandDragMode = "move" | "resize-left" | "resize-right";

export interface BandDragModeInput {
  pointerHz: number;
  startHz: number;
  endHz: number;
  hzPerPixel: number;
  handleHitPixels?: number;
}

export const getBandDragMode = ({
  pointerHz,
  startHz,
  endHz,
  hzPerPixel,
  handleHitPixels = 10,
}: BandDragModeInput): BandDragMode | null => {
  if (
    !Number.isFinite(pointerHz) ||
    !Number.isFinite(startHz) ||
    !Number.isFinite(endHz) ||
    endHz <= startHz
  ) {
    return null;
  }

  const handleHitHz = Math.max(
    Math.abs(hzPerPixel) * Math.max(0, handleHitPixels),
    Number.EPSILON,
  );
  const distanceToLeft = Math.abs(pointerHz - startHz);
  const distanceToRight = Math.abs(pointerHz - endHz);
  const hitLeft = distanceToLeft <= handleHitHz;
  const hitRight = distanceToRight <= handleHitHz;

  if (hitLeft || hitRight) {
    return hitLeft && (!hitRight || distanceToLeft <= distanceToRight)
      ? "resize-left"
      : "resize-right";
  }

  return pointerHz > startHz && pointerHz < endHz ? "move" : null;
};

export interface EdgePanningResult {
  startHz: number;
  endHz: number;
  centerHz: number;
  sampleRateHz: number;
}

const buildResult = (startHz: number, endHz: number): EdgePanningResult => {
  const sampleRateHz = Math.max(0, endHz - startHz);
  return {
    startHz: Math.round(startHz),
    endHz: Math.round(endHz),
    centerHz: Math.round(startHz + sampleRateHz / 2),
    sampleRateHz: Math.round(sampleRateHz),
  };
};

export interface EdgeResizeInput {
  visibleMinHz: number;
  visibleMaxHz: number;
  startHz: number;
  endHz: number;
  pointerHz: number;
  activeHandle: EdgePanningHandle;
  minSpanHz?: number;
}

export const computeEdgeResizedBand = ({
  visibleMinHz,
  visibleMaxHz,
  startHz,
  endHz,
  pointerHz,
  activeHandle,
  minSpanHz = 1,
}: EdgeResizeInput): EdgePanningResult => {
  const lo = Math.min(visibleMinHz, visibleMaxHz);
  const hi = Math.max(visibleMinHz, visibleMaxHz);
  const safeStart = Number.isFinite(startHz) ? startHz : lo;
  const safeEnd = Number.isFinite(endHz) ? endHz : hi;
  const safeMinSpan =
    Number.isFinite(minSpanHz) && minSpanHz > 0 ? minSpanHz : 1;
  const boundedPointer = clampFrequencyHz(pointerHz, lo, hi);

  if (activeHandle === "left") {
    const nextStart = clampFrequencyHz(
      boundedPointer,
      lo,
      Math.min(hi, safeEnd - safeMinSpan),
    );
    return buildResult(nextStart, safeEnd);
  }

  const nextEnd = clampFrequencyHz(
    boundedPointer,
    Math.max(lo, safeStart + safeMinSpan),
    hi,
  );
  return buildResult(safeStart, nextEnd);
};

export interface BandPanInput {
  visibleMinHz: number;
  visibleMaxHz: number;
  startHz: number;
  endHz: number;
  pointerHz: number;
  pointerOffsetHz: number;
}

export const computeBandPannedWithinTrack = ({
  visibleMinHz,
  visibleMaxHz,
  startHz,
  endHz,
  pointerHz,
  pointerOffsetHz,
}: BandPanInput): EdgePanningResult => {
  const lo = Math.min(visibleMinHz, visibleMaxHz);
  const hi = Math.max(visibleMinHz, visibleMaxHz);
  const span = Math.max(0, endHz - startHz);
  const trackSpan = Math.max(0, hi - lo);

  if (!Number.isFinite(pointerHz) || !Number.isFinite(span) || span <= 0) {
    return buildResult(startHz, endHz);
  }

  if (span >= trackSpan) {
    return buildResult(lo, hi);
  }

  const requestedStart = pointerHz - pointerOffsetHz;
  const nextStart = clampFrequencyHz(requestedStart, lo, hi - span);
  return buildResult(nextStart, nextStart + span);
};

/**
 * Extends {@link computeBandPannedWithinTrack} with overflow detection.
 *
 * Returns the clamped band position *plus* `overflowHz` — the signed Hz
 * distance that the requested (unclamped) band start exceeded the visible
 * track bounds.
 *
 * - `overflowHz < 0` → band tried to go past the **left** edge
 * - `overflowHz > 0` → band tried to go past the **right** edge
 * - `overflowHz === 0` → band fits entirely within the visible range
 *
 * The caller (e.g. useFrequencyDrag) uses this to decide whether to
 * edge-pan the spectrum underneath.
 */
export interface BandPanWithOverflowResult extends EdgePanningResult {
  overflowHz: number;
}

export const computeBandPannedWithOverflow = ({
  visibleMinHz,
  visibleMaxHz,
  startHz,
  endHz,
  pointerHz,
  pointerOffsetHz,
}: BandPanInput): BandPanWithOverflowResult => {
  const lo = Math.min(visibleMinHz, visibleMaxHz);
  const hi = Math.max(visibleMinHz, visibleMaxHz);
  const span = Math.max(0, endHz - startHz);
  const trackSpan = Math.max(0, hi - lo);

  if (!Number.isFinite(pointerHz) || !Number.isFinite(span) || span <= 0) {
    return { ...buildResult(startHz, endHz), overflowHz: 0 };
  }

  if (span >= trackSpan) {
    return { ...buildResult(lo, hi), overflowHz: 0 };
  }

  const requestedStart = pointerHz - pointerOffsetHz;
  const maxStart = hi - span;
  const nextStart = clampFrequencyHz(requestedStart, lo, maxStart);

  let overflowHz = 0;
  if (requestedStart < lo) {
    overflowHz = requestedStart - lo;
  } else if (requestedStart > maxStart) {
    overflowHz = requestedStart - maxStart;
  }

  return { ...buildResult(nextStart, nextStart + span), overflowHz };
};

export const getPointerOffsetWithinBandHz = (
  pointerHz: number,
  startHz: number,
): number => {
  if (!Number.isFinite(pointerHz) || !Number.isFinite(startHz)) return 0;
  return pointerHz - startHz;
};

export interface BandPanWithEdgePanningInput {
  visibleMinHz: number;
  visibleMaxHz: number;
  startHz: number;
  endHz: number;
  pointerHz: number;
  pointerOffsetHz: number;
  hardwareMinHz?: number;
  hardwareMaxHz?: number;
  stepHz?: number;
}

export interface BandPanWithEdgePanningResult extends EdgePanningResult {
  visibleMinHz: number;
  visibleMaxHz: number;
  overflowHz: number;
}

export const computeBandPanWithEdgePanning = ({
  visibleMinHz,
  visibleMaxHz,
  startHz,
  endHz,
  pointerHz,
  pointerOffsetHz,
  hardwareMinHz,
  hardwareMaxHz,
  stepHz,
}: BandPanWithEdgePanningInput): BandPanWithEdgePanningResult => {
  const lo = Math.min(visibleMinHz, visibleMaxHz);
  const hi = Math.max(visibleMinHz, visibleMaxHz);
  const span = Math.max(0, endHz - startHz);
  const trackSpan = Math.max(0, hi - lo);

  if (!Number.isFinite(pointerHz) || !Number.isFinite(span) || span <= 0) {
    return {
      ...buildResult(startHz, endHz),
      visibleMinHz: lo,
      visibleMaxHz: hi,
      overflowHz: 0,
    };
  }

  if (span >= trackSpan) {
    return {
      ...buildResult(lo, hi),
      visibleMinHz: lo,
      visibleMaxHz: hi,
      overflowHz: 0,
    };
  }

  const requestedStart = pointerHz - pointerOffsetHz;
  const maxStart = hi - span;

  let overflowHz = 0;
  let nextVisibleMinHz = lo;
  let nextVisibleMaxHz = hi;

  if (requestedStart < lo) {
    const shift = typeof stepHz === "number" ? stepHz : lo - requestedStart;
    nextVisibleMinHz = lo - shift;
    nextVisibleMaxHz = hi - shift;
    overflowHz = -shift;
  } else if (requestedStart > maxStart) {
    const shift =
      typeof stepHz === "number" ? stepHz : requestedStart - maxStart;
    nextVisibleMinHz = lo + shift;
    nextVisibleMaxHz = hi + shift;
    overflowHz = shift;
  }

  if (overflowHz !== 0) {
    // Clamp new visible range to hardware bounds if provided
    const hMin = typeof hardwareMinHz === "number" ? hardwareMinHz : -Infinity;
    const hMax = typeof hardwareMaxHz === "number" ? hardwareMaxHz : Infinity;
    const visibleSpan = hi - lo;

    if (nextVisibleMinHz < hMin) {
      nextVisibleMinHz = hMin;
      nextVisibleMaxHz = hMin + visibleSpan;
    } else if (nextVisibleMaxHz > hMax) {
      nextVisibleMaxHz = hMax;
      nextVisibleMinHz = hMax - visibleSpan;
    }
  }

  // Calculate final band position relative to the (possibly shifted) visible range
  const finalMaxStart = nextVisibleMaxHz - span;
  const nextStart = clampFrequencyHz(
    requestedStart,
    nextVisibleMinHz,
    finalMaxStart,
  );

  return {
    ...buildResult(nextStart, nextStart + span),
    visibleMinHz: nextVisibleMinHz,
    visibleMaxHz: nextVisibleMaxHz,
    overflowHz,
  };
};
