/**
 * Presentation-only mirroring of a positive baseband acquisition across 0 Hz.
 *
 * A real-valued RF spectrum is conjugate-symmetric, so content at -f carries
 * the same magnitude as content at +f. Hardware can only ever acquire a
 * non-negative window, so when the viewport slides below 0 Hz we reflect the
 * acquired window instead of painting an empty gap.
 *
 * Everything here is pure display math. Nothing in this module may change what
 * the radio is actually tuned to; callers own that decision.
 */

export interface BasebandFrequencyRange {
  min: number;
  max: number;
}

export interface ExtendSpectrumBelowZeroOptions {
  spectrum: Float32Array;
  sourceRange: BasebandFrequencyRange;
  displayRange: BasebandFrequencyRange;
  outputLength: number;
  floorDb: number;
  target?: Float32Array;
}

const isUsableRange = (range: BasebandFrequencyRange): boolean =>
  Number.isFinite(range.min) &&
  Number.isFinite(range.max) &&
  range.max > range.min;

/** Maps a display coordinate back to the positive source coordinate. */
export const mapDisplayFrequencyToSource = (frequencyHz: number): number =>
  frequencyHz < 0 ? -frequencyHz : frequencyHz;

/**
 * Source interval a display pixel covers after one reflection across DC.
 *
 * A pixel that straddles 0 Hz maps both halves onto [0, max(|d0|, |d1|)].
 * Folding the endpoints independently and taking min/max skips DC and paints
 * a hole that pops in and out as 0 Hz crosses a pixel boundary.
 */
export const mirroredSourceIntervalForDisplayPixel = (
  display0: number,
  display1: number,
): { lo: number; hi: number } => {
  const crossesDc = display0 < 0 !== display1 < 0;
  if (crossesDc) {
    return {
      lo: 0,
      hi: Math.max(Math.abs(display0), Math.abs(display1)),
    };
  }
  const s0 = mapDisplayFrequencyToSource(display0);
  const s1 = mapDisplayFrequencyToSource(display1);
  return { lo: Math.min(s0, s1), hi: Math.max(s0, s1) };
};

/** Positive baseband source coordinates remain unchanged on the display. */
export const mapSourceFrequencyToDisplay = (frequencyHz: number): number =>
  frequencyHz;

/**
 * Maps a positive hardware frequency marker onto the signed display axis.
 * Hardware markers are expressed as magnitudes; a wholly non-positive view
 * shows the mirrored coordinate instead of treating the marker as positive.
 */
export const mapPositiveHardwareFrequencyToDisplay = (
  frequencyHz: number,
  displayRange: BasebandFrequencyRange,
): number => {
  if (!Number.isFinite(frequencyHz)) return frequencyHz;
  return displayRange.min < 0 && displayRange.max <= 0
    ? -Math.abs(frequencyHz)
    : frequencyHz;
};

/** Emits the signed display positions for a positive hardware marker. */
export const resolveMirroredHardwareMarkerFrequencies = (
  frequencyHz: number,
  displayRange: BasebandFrequencyRange,
): number[] => {
  if (!Number.isFinite(frequencyHz)) return [];
  const magnitude = Math.abs(frequencyHz);
  if (displayRange.min < 0 && displayRange.max > 0) {
    return magnitude === 0 ? [0] : [-magnitude, magnitude];
  }
  return [mapPositiveHardwareFrequencyToDisplay(magnitude, displayRange)];
};

export type HardwareLimitAliasRange = BasebandFrequencyRange;

export const isHardwareLowerLimitKind = (kind?: string | null): boolean =>
  kind === "lower_limit" || kind === "min_hardware_frequency";

export const isHardwareUpperLimitKind = (kind?: string | null): boolean =>
  kind === "upper_limit" || kind === "max_hardware_frequency";

/**
 * Resolves the visible signed-frequency bands that exceed a hardware limit.
 * Device limits apply to |frequency|, so lower limits alias around DC while
 * upper limits alias on the outer edges of the signed display.
 */
export const resolveHardwareLimitAliasRanges = ({
  kind,
  frequencyHz,
  displayRange,
}: {
  kind?: string | null;
  frequencyHz: number;
  displayRange: BasebandFrequencyRange;
}): HardwareLimitAliasRange[] => {
  if (
    !isUsableRange(displayRange) ||
    !Number.isFinite(frequencyHz) ||
    frequencyHz < 0
  ) {
    return [];
  }

  const limitHz = Math.abs(frequencyHz);
  if (!(limitHz > 0)) return [];

  const isLowerLimit = isHardwareLowerLimitKind(kind);
  const isUpperLimit = isHardwareUpperLimitKind(kind);
  if (!isLowerLimit && !isUpperLimit) return [];

  const ranges: HardwareLimitAliasRange[] = [];
  const addIntersection = (min: number, max: number) => {
    const visibleMin = Math.max(displayRange.min, min);
    const visibleMax = Math.min(displayRange.max, max);
    if (visibleMax > visibleMin) {
      ranges.push({ min: visibleMin, max: visibleMax });
    }
  };

  if (isLowerLimit) {
    addIntersection(-limitHz, limitHz);
  } else {
    addIntersection(displayRange.min, -limitHz);
    addIntersection(limitHz, displayRange.max);
  }

  return ranges;
};

/**
 * Resolves the positive acquisition window for a display window. This is a
 * coordinate conversion only: it deliberately does not apply channel or
 * hardware bounds, because those are separate from the virtual negative axis.
 */
export const getPositiveSourceRangeForDisplayRange = (
  displayRange: BasebandFrequencyRange,
): BasebandFrequencyRange => {
  if (!isUsableRange(displayRange)) {
    return { min: 0, max: 0 };
  }

  if (displayRange.max < 0) {
    return {
      min: Math.abs(displayRange.max),
      max: Math.abs(displayRange.min),
    };
  }

  if (displayRange.min < 0) {
    return {
      min: 0,
      max: Math.max(Math.abs(displayRange.min), displayRange.max),
    };
  }

  return { min: displayRange.min, max: displayRange.max };
};

/** Converts a display-derived range into a safe positive hardware request. */
export const normalizePositiveHardwareRange = (
  range: BasebandFrequencyRange,
): BasebandFrequencyRange => {
  if (!isUsableRange(range)) {
    return { min: 0, max: 0 };
  }
  return range.min < 0
    ? { min: 0, max: range.max - range.min }
    : { min: range.min, max: range.max };
};

/**
 * True when a single reflection of `sourceRange` can fill every frequency in
 * `displayRange`. Used to hold the last good paint across a retune instead of
 * flashing the noise floor into the uncovered half of the viewport.
 */
export const sourceCoversMirroredDisplay = (
  sourceRange: BasebandFrequencyRange,
  displayRange: BasebandFrequencyRange,
  toleranceHz = 1,
): boolean => {
  if (!isUsableRange(sourceRange) || !isUsableRange(displayRange)) {
    return false;
  }
  const required = getPositiveSourceRangeForDisplayRange(displayRange);
  if (!isUsableRange(required)) return false;
  const edgeToleranceHz = 1;
  const fillsBoundedDcGuard =
    sourceRange.min >= 0 &&
    sourceRange.min <= toleranceHz &&
    required.min >= 0;
  return (
    (required.min >= sourceRange.min - edgeToleranceHz ||
      fillsBoundedDcGuard) &&
    required.max <= sourceRange.max + edgeToleranceHz
  );
};

/** Slack used only to bridge a configured source guard immediately above DC. */
export const mirrorPresentationCoverageSlackHz = (
  sourceRange: BasebandFrequencyRange,
): number => {
  const span = sourceRange.max - sourceRange.min;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.max(1, Math.min(span * 0.01, 50_000));
};

/**
 * The mirror setting is only active when the viewport actually reaches below
 * 0 Hz. Panning entirely in the positive half must stay on the normal
 * Redux → WebGPU path so "skipping over" DC cannot freeze the chain.
 */
export const displayRangeNeedsBasebandMirror = (
  displayRange: BasebandFrequencyRange,
): boolean => isUsableRange(displayRange) && displayRange.min < 0;

/** Display window implied by a hardware range, zoom, and pan offset. */
export const resolveDisplayRangeForPanOffset = ({
  hardwareRange,
  zoom,
  panOffsetHz,
}: {
  hardwareRange: BasebandFrequencyRange;
  zoom: number;
  panOffsetHz: number;
}): BasebandFrequencyRange => {
  if (!isUsableRange(hardwareRange)) {
    return { min: 0, max: 0 };
  }
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const halfSpan = (hardwareRange.max - hardwareRange.min) / (2 * safeZoom);
  const center = (hardwareRange.min + hardwareRange.max) / 2;
  const pan = Number.isFinite(panOffsetHz) ? panOffsetHz : 0;
  return {
    min: center + pan - halfSpan,
    max: center + pan + halfSpan,
  };
};

/**
 * Re-anchors a subscriber-local mirrored view after the device changes its
 * positive acquisition window. The device center is shared in absolute Hz;
 * only the signed presentation side is local. Returning null means that the
 * caller should leave its local pan untouched (for example when mirroring is
 * disabled or there is no previous hardware window to compare).
 */
export const resolveMirroredDevicePanOffset = ({
  previousHardwareRange,
  nextHardwareRange,
  previousPanOffsetHz,
  previousZoom = 1,
  mirrorEnabled,
  toleranceHz = 1,
}: {
  previousHardwareRange: BasebandFrequencyRange | null | undefined;
  nextHardwareRange: BasebandFrequencyRange;
  previousPanOffsetHz: number;
  previousZoom?: number;
  mirrorEnabled: boolean;
  toleranceHz?: number;
}): number | null => {
  if (
    !mirrorEnabled ||
    !isUsableRange(previousHardwareRange ?? { min: 0, max: 0 }) ||
    !isUsableRange(nextHardwareRange) ||
    !Number.isFinite(previousPanOffsetHz)
  ) {
    return null;
  }

  const rangeChanged =
    Math.abs(nextHardwareRange.min - previousHardwareRange!.min) > toleranceHz ||
    Math.abs(nextHardwareRange.max - previousHardwareRange!.max) > toleranceHz;
  if (!rangeChanged) return null;

  const previousDisplayRange = resolveDisplayRangeForPanOffset({
    hardwareRange: previousHardwareRange!,
    zoom: previousZoom,
    panOffsetHz: previousPanOffsetHz,
  });
  const previousDisplayCenter =
    (previousDisplayRange.min + previousDisplayRange.max) / 2;
  const nextHardwareCenter =
    (nextHardwareRange.min + nextHardwareRange.max) / 2;

  return previousDisplayCenter - nextHardwareCenter;
};

/**
 * Pan/zoom against `hardwareRange` that realises an absolute display window.
 *
 * Used when Redux still measures pan against a start-anchored request while the
 * live waveform is labeled by the frame's CF ± fs/2. Re-basing keeps the
 * absolute Hz the user is looking at and stops the GPU |f| fold from painting
 * a channel-sized island in the wrong place.
 */
export const resolvePanZoomForDisplayRange = ({
  hardwareRange,
  displayRange,
}: {
  hardwareRange: BasebandFrequencyRange;
  displayRange: BasebandFrequencyRange;
}): { zoom: number; panOffsetHz: number } => {
  if (!isUsableRange(hardwareRange) || !isUsableRange(displayRange)) {
    return { zoom: 1, panOffsetHz: 0 };
  }
  const axisSpan = hardwareRange.max - hardwareRange.min;
  const displaySpan = displayRange.max - displayRange.min;
  if (!(displaySpan > 0) || !(axisSpan > 0)) {
    return { zoom: 1, panOffsetHz: 0 };
  }
  const axisCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const displayCenter = (displayRange.min + displayRange.max) / 2;
  return {
    zoom: axisSpan / displaySpan,
    panOffsetHz: displayCenter - axisCenter,
  };
};

/**
 * The display window the acquisition covers exactly once, either directly or
 * as its reflection across DC.
 */
export const getMirroredDisplayBounds = (
  sourceRange: BasebandFrequencyRange,
): BasebandFrequencyRange => {
  if (!isUsableRange(sourceRange)) {
    return { min: 0, max: 0 };
  }
  const reach = Math.max(Math.abs(sourceRange.min), Math.abs(sourceRange.max));
  return { min: -reach, max: reach };
};

export interface MirroredTuning {
  /** The positive window to ask the radio for. */
  hardwareRange: BasebandFrequencyRange;
  /** The pan that presents `requestedDisplayRange` from that window. */
  panOffsetHz: number;
}

export interface ResolveMirroredTuningOptions {
  /**
   * Hard cap on the positive acquisition width (almost always the device
   * sample rate). FrequencyRangeSlider reports whole-channel thumbs that are
   * wider than this; without the cap Redux adopts the channel span, the radio
   * still delivers one SR window, and the spectrum paints an island.
   */
  maxAcquisitionSpanHz?: number | null;
}

/**
 * Splits a requested display window into the positive window the radio can
 * actually tune and the pan that presents the request from it.
 *
 * Both halves must be applied together. Applying only the first is what made
 * explicit tuning land on an arbitrary offset: the window was shifted up to
 * clear 0 Hz but the viewport was left pointing at the old centre, so a channel
 * click arrived somewhere else entirely, sometimes below 0 Hz.
 *
 * A wholly positive request yields a zero pan, which leaves the mirror inert.
 * When `maxAcquisitionSpanHz` clamps a wider positive request, the window is
 * start-anchored inside that request with pan 0 — same contract as the
 * non-mirror hardware-window helper.
 */
export const resolveMirroredTuning = (
  requestedDisplayRange: BasebandFrequencyRange,
  tuningBounds?: BasebandFrequencyRange | null,
  options?: ResolveMirroredTuningOptions | null,
): MirroredTuning => {
  if (!isUsableRange(requestedDisplayRange)) {
    return { hardwareRange: requestedDisplayRange, panOffsetHz: 0 };
  }

  const positiveRequiredRange = getPositiveSourceRangeForDisplayRange(
    requestedDisplayRange,
  );
  const requestedSpan = requestedDisplayRange.max - requestedDisplayRange.min;
  const requiredSpan = positiveRequiredRange.max - positiveRequiredRange.min;
  const maxSpan =
    typeof options?.maxAcquisitionSpanHz === "number" &&
    Number.isFinite(options.maxAcquisitionSpanHz) &&
    options.maxAcquisitionSpanHz > 0
      ? options.maxAcquisitionSpanHz
      : null;
  let acquisitionSpan = Math.max(requestedSpan, requiredSpan);
  if (maxSpan !== null) {
    acquisitionSpan = Math.min(acquisitionSpan, maxSpan);
  }

  // Wholly positive + span-clamped: start-anchor inside the request, pan 0.
  // Re-centering on the wide thumb would leave the SR window floating in the
  // middle of the channel with floor on both sides (the island).
  if (
    requestedDisplayRange.min >= 0 &&
    maxSpan !== null &&
    requestedSpan > acquisitionSpan + 1
  ) {
    let min = positiveRequiredRange.min;
    let max = min + acquisitionSpan;
    if (max > positiveRequiredRange.max) {
      max = positiveRequiredRange.max;
      min = max - acquisitionSpan;
    }
    if (tuningBounds && isUsableRange(tuningBounds)) {
      if (min < tuningBounds.min) {
        min = tuningBounds.min;
        max = min + acquisitionSpan;
      }
      if (max > tuningBounds.max) {
        max = tuningBounds.max;
        min = max - acquisitionSpan;
      }
    }
    return {
      hardwareRange: { min, max },
      panOffsetHz: 0,
    };
  }

  // A wholly negative display maps to the same positive RF interval in
  // reverse order. A viewport crossing DC needs a positive window beginning
  // at zero that is wide enough for the (possibly clamped) display span.
  let min =
    requestedDisplayRange.min < 0
      ? requestedDisplayRange.max < 0
        ? positiveRequiredRange.min
        : 0
      : positiveRequiredRange.min;
  let max = min + acquisitionSpan;
  if (tuningBounds && isUsableRange(tuningBounds)) {
    const span = max - min;
    if (span >= tuningBounds.max - tuningBounds.min) {
      min = tuningBounds.min;
      max = tuningBounds.max;
    } else {
      if (min < tuningBounds.min) {
        min = tuningBounds.min;
        max = min + span;
      }
      if (max > tuningBounds.max) {
        max = tuningBounds.max;
        min = max - span;
      }
    }
  }

  const requestedCenter =
    (requestedDisplayRange.min + requestedDisplayRange.max) / 2;
  const hardwareCenter = (min + max) / 2;
  return {
    hardwareRange: { min, max },
    // Pan realises the requested centre from the (possibly span-clamped)
    // acquisition. For DC-crossing thumbs this centres the SR window on 0 so
    // the mirror fills it instead of leaving floor around an island.
    panOffsetHz: requestedCenter - hardwareCenter,
  };
};

export interface MirroredPanOptions {
  panOffsetHz: number;
  /** The acquisition window the pan offset is measured against. */
  hardwareRange: BasebandFrequencyRange;
  /**
   * How far the radio can be tuned, in display coordinates. Panning is only
   * bounded by the hardware itself; the current acquisition must never bound
   * it, because running off the acquisition is what triggers a retune.
   */
  tuningBounds?: BasebandFrequencyRange | null;
  zoom: number;
}

/**
 * Bounds a pan offset by what the radio can be tuned to, mirrored across DC.
 *
 * Deliberately not bounded by the current acquisition: an earlier version did
 * that and trapped the viewport inside the active window, so the user could
 * not pan out of the channel at all.
 */
export const clampMirroredPanOffset = ({
  panOffsetHz,
  hardwareRange,
  tuningBounds,
  zoom,
}: MirroredPanOptions): number => {
  if (!Number.isFinite(panOffsetHz)) return 0;
  if (
    !isUsableRange(hardwareRange) ||
    !tuningBounds ||
    !isUsableRange(tuningBounds)
  ) {
    return panOffsetHz;
  }

  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const halfSpan = (hardwareRange.max - hardwareRange.min) / (2 * safeZoom);
  const bounds = getMirroredDisplayBounds(tuningBounds);

  const minPan = bounds.min + halfSpan - hardwareCenter;
  const maxPan = bounds.max - halfSpan - hardwareCenter;
  // A viewport wider than the tuning range can only be centred on DC.
  if (minPan > maxPan) return -hardwareCenter;
  return Math.min(maxPan, Math.max(minPan, panOffsetHz));
};

/** Reject corrupt persisted or synced pans before they reach Redux. */
export const sanitizeMirroredPanOffset = ({
  panOffsetHz,
  hardwareRange,
  zoom = 1,
  tuningBounds,
}: {
  panOffsetHz: number;
  hardwareRange?: BasebandFrequencyRange | null;
  zoom?: number;
  tuningBounds?: BasebandFrequencyRange | null;
}): number => {
  if (!Number.isFinite(panOffsetHz)) return 0;
  if (!hardwareRange || !isUsableRange(hardwareRange)) {
    return Math.abs(panOffsetHz) > 50_000_000 ? 0 : panOffsetHz;
  }
  const span = hardwareRange.max - hardwareRange.min;
  if (!(span > 0)) {
    return 0;
  }
  // A mirrored viewport's pan is displayCenter − hardwareCenter. After the
  // first retune past Channel A that is about 2×hardwareCenter, which is
  // routinely larger than 4×span. Zeroing it snapped -5 MHz back to +|f|.
  if (tuningBounds && isUsableRange(tuningBounds)) {
    return clampMirroredPanOffset({
      panOffsetHz,
      hardwareRange,
      tuningBounds,
      zoom,
    });
  }
  return panOffsetHz;
};

export interface MirroredAcquisitionRequest {
  /** The positive hardware window that would cover the requested display. */
  range: BasebandFrequencyRange;
  /** True when the current source cannot fill the requested display window. */
  needsRetune: boolean;
}

export interface ResolveMirroredAcquisitionOptions {
  displayRange: BasebandFrequencyRange;
  sourceRange: BasebandFrequencyRange;
  /** Hardware tuning limits, applied after the window is made non-negative. */
  hardwareBounds?: BasebandFrequencyRange | null;
  /** Ignore sub-Hz rounding between the requested and acquired window. */
  toleranceHz?: number;
}

/**
 * Decides whether the viewport has crossed the threshold for grabbing more
 * spectrum, and what positive window to ask for. The returned window keeps the
 * current sample rate whenever it is wide enough, so panning near DC retunes
 * rather than widening.
 */
export const resolveMirroredAcquisition = ({
  displayRange,
  sourceRange,
  hardwareBounds,
  toleranceHz = 1,
}: ResolveMirroredAcquisitionOptions): MirroredAcquisitionRequest => {
  if (!isUsableRange(sourceRange)) {
    return { range: sourceRange, needsRetune: false };
  }
  // Single |f| reflection when the acquisition already covers the viewport.
  // Uncovered |f| (including wholly negative pans past ±SR) must retune so
  // the radio fetches that RF instead of flooring or tiling Channel A.
  if (
    isUsableRange(displayRange) &&
    displayRange.min < 0 &&
    sourceCoversMirroredDisplay(sourceRange, displayRange, toleranceHz)
  ) {
    return { range: sourceRange, needsRetune: false };
  }
  const required = getPositiveSourceRangeForDisplayRange(displayRange);
  if (!isUsableRange(required)) {
    return { range: sourceRange, needsRetune: false };
  }

  const covered = sourceCoversMirroredDisplay(
    sourceRange,
    displayRange,
    toleranceHz,
  );
  if (covered) {
    return { range: sourceRange, needsRetune: false };
  }

  const sourceSpan = sourceRange.max - sourceRange.min;
  const span = Math.max(sourceSpan, required.max - required.min);
  const requiredCenter = (required.min + required.max) / 2;
  let min = requiredCenter - span / 2;
  if (min < 0) min = 0;
  let max = min + span;

  if (hardwareBounds && isUsableRange(hardwareBounds)) {
    if (span >= hardwareBounds.max - hardwareBounds.min) {
      min = hardwareBounds.min;
      max = hardwareBounds.max;
    } else {
      if (min < hardwareBounds.min) {
        min = hardwareBounds.min;
        max = min + span;
      }
      if (max > hardwareBounds.max) {
        max = hardwareBounds.max;
        min = max - span;
      }
    }
  }

  const range = normalizePositiveHardwareRange({ min, max });
  return {
    range,
    needsRetune:
      Math.abs(range.min - sourceRange.min) > toleranceHz ||
      Math.abs(range.max - sourceRange.max) > toleranceHz,
  };
};

const sampleSpectrumAtFrequency = (
  spectrum: Float32Array,
  sourceRange: BasebandFrequencyRange,
  displayFrequencyHz: number,
  floorDb: number,
): number => {
  const sourceSpan = sourceRange.max - sourceRange.min;
  if (
    spectrum.length === 0 ||
    !Number.isFinite(sourceSpan) ||
    sourceSpan <= 0
  ) {
    return floorDb;
  }

  // Single reflection across DC. Periodic folding below 0 Hz repeats Channel A.
  let frequencyHz = mapDisplayFrequencyToSource(displayFrequencyHz);
  // The mirrored display must remain continuous at DC. If the configured
  // positive acquisition begins above zero, leaving this interval as floor
  // exposes an artificial slit between the reflected and positive halves.
  // Use the nearest acquired edge for the boundary fill; this is presentation
  // continuity, not another acquisition range.
  if (
    sourceRange.min >= 0 &&
    frequencyHz >= 0 &&
    frequencyHz < sourceRange.min
  ) {
    frequencyHz = sourceRange.min;
  }
  if (frequencyHz < sourceRange.min || frequencyHz > sourceRange.max) {
    return floorDb;
  }

  const position =
    ((frequencyHz - sourceRange.min) / sourceSpan) * (spectrum.length - 1);
  const lowerIndex = Math.max(0, Math.floor(position));
  const upperIndex = Math.min(spectrum.length - 1, lowerIndex + 1);
  const fraction = position - lowerIndex;
  return (
    spectrum[lowerIndex] * (1 - fraction) + spectrum[upperIndex] * fraction
  );
};

/**
 * Resamples a whole display row from the positive acquisition, reflecting
 * across DC wherever the viewport is negative.
 *
 * Both halves are resampled here on purpose. An earlier version stitched a
 * bin-indexed positive slice onto a frequency-interpolated negative slice; the
 * two conventions only line up at zoom 1, so every other zoom produced a
 * lopsided seam at DC and a compressed positive half.
 */
export const extendSpectrumBelowZero = ({
  spectrum,
  sourceRange,
  displayRange,
  outputLength,
  floorDb,
  target,
}: ExtendSpectrumBelowZeroOptions): Float32Array => {
  const output =
    target && target.length === outputLength
      ? target
      : new Float32Array(Math.max(0, outputLength));
  if (output.length === 0) return output;

  const displaySpan = displayRange.max - displayRange.min;
  if (!Number.isFinite(displaySpan) || displaySpan <= 0) {
    output.fill(floorDb);
    return output;
  }

  if (output.length === 1) {
    output[0] = sampleSpectrumAtFrequency(
      spectrum,
      sourceRange,
      mapDisplayFrequencyToSource(displayRange.min),
      floorDb,
    );
    return output;
  }

  const step = displaySpan / (output.length - 1);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = sampleSpectrumAtFrequency(
      spectrum,
      sourceRange,
      displayRange.min + index * step,
      floorDb,
    );
  }
  return output;
};

export interface MirroredRetune extends MirroredAcquisitionRequest {
  /**
   * The pan offset that keeps the viewport exactly where it is once the new
   * window arrives. Re-anchoring here is what stops a retune from bouncing:
   * the display does not move, so the threshold is not re-crossed.
   */
  panOffsetHz: number;
}

export interface ResolveMirroredRetuneOptions
  extends ResolveMirroredAcquisitionOptions {
  displayRange: BasebandFrequencyRange;
}

/**
 * Combines the acquisition threshold with the pan re-anchoring it implies, so
 * callers cannot apply one without the other.
 */
export const resolveMirroredRetune = ({
  displayRange,
  sourceRange,
  hardwareBounds,
  toleranceHz,
}: ResolveMirroredRetuneOptions): MirroredRetune => {
  const request = resolveMirroredAcquisition({
    displayRange,
    sourceRange,
    hardwareBounds,
    toleranceHz,
  });
  const displayCenter = (displayRange.min + displayRange.max) / 2;
  const nextCenter = (request.range.min + request.range.max) / 2;
  return { ...request, panOffsetHz: displayCenter - nextCenter };
};

/**
 * Resolves a center-frequency change against the currently acquired frame.
 * The center sign is not a hold/retune signal by itself: only the mirrored
 * interval's coverage determines whether the positive acquisition must move.
 */
export const resolveMirroredDisplayCenter = ({
  displayCenterHz,
  displaySpanHz,
  sourceRange,
}: {
  displayCenterHz: number;
  displaySpanHz: number;
  sourceRange: BasebandFrequencyRange;
}): MirroredRetune => {
  const halfSpan = displaySpanHz / 2;
  return resolveMirroredRetune({
    displayRange: {
      min: displayCenterHz - halfSpan,
      max: displayCenterHz + halfSpan,
    },
    sourceRange,
  });
};
