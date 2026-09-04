import { useCallback, useEffect, useRef } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";
import {
  clampFrequencyRangeToBounds,
  getFrequencyRangeCenterHz,
  normalizeFrequencyRangeToHz,
} from "@n-apt/math/frequency";
import { computeMaxFrameRate } from "@n-apt/math/signals";
import { resolveWholeChannelMode } from "@n-apt/spectrum/utils/wholeChannelControl";

export type SampleRateMode = "whole" | "manual";
export type SampleRateAnchorPosition = "start" | "center" | "end";

export const resolveHackrfBasebandSampleRateHz = ({
  isHackrfOne,
  sourceMode,
  isWholeChannelMode,
  wholeChannelSampleRate,
  sampleRateHz,
}: {
  isHackrfOne: boolean;
  sourceMode: "live" | "file";
  isWholeChannelMode: boolean;
  wholeChannelSampleRate: number | null;
  sampleRateHz: number | null;
}): number | null => {
  if (!isHackrfOne || sourceMode !== "live") return null;
  if (
    isWholeChannelMode &&
    typeof wholeChannelSampleRate === "number" &&
    Number.isFinite(wholeChannelSampleRate) &&
    wholeChannelSampleRate > 0
  ) {
    return wholeChannelSampleRate;
  }
  return typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
    ? sampleRateHz
    : null;
};

type UseLiveSampleRateControlArgs = {
  sourceMode: "live" | "file";
  supportsWholeChannelSampleRate: boolean;
  manualSampleRateOptions?: number[];
  activeChannelSampleRate: number | null;
  maxSampleRateHz?: number | null;
  activeSignalAreaBounds: FrequencyRange | null;
  frequencyRange: FrequencyRange | null;
  sampleRateHz: number | null;
  fftSize?: number;
  maxFrameRateLimit?: number;
  startingAnchorPosition?: SampleRateAnchorPosition;
  setSampleRate: (rate: number) => void;
  setSampleRateWithFrequencyRange?: (
    rate: number,
    nextRange: FrequencyRange,
  ) => void;
  onSampleRateApplied?: (rate: number) => void;
  setFftFrameRate?: (rate: number) => void;
  applyFrequencyRange: (range: FrequencyRange) => void;
};

type BuildSampleRateRangeArgs = {
  currentRange: FrequencyRange;
  sampleRateHz: number;
  channelBounds?: FrequencyRange | null;
  startingAnchorPosition?: SampleRateAnchorPosition;
  forceStartingAnchor?: boolean;
};

export interface ChannelFocusRangeOptions {
  channelBounds: FrequencyRange;
  sampleRateHz?: number | null;
  wholeChannel: boolean;
}

/**
 * Resolves the presentation window for an explicit channel selection.
 *
 * Whole Channel uses the channel bounds. Otherwise the selected sample-rate
 * window is centered on the channel; windows narrower than the channel are
 * clamped to its bounds, while wider windows retain their sample-rate span
 * as the display's intentional overscan.
 */
export const resolveChannelFocusRange = ({
  channelBounds,
  sampleRateHz,
  wholeChannel,
}: ChannelFocusRangeOptions): FrequencyRange => {
  const channelSpan = channelBounds.max - channelBounds.min;
  if (
    wholeChannel ||
    !Number.isFinite(channelSpan) ||
    channelSpan <= 0
  ) {
    return normalizeFrequencyRangeToHz(channelBounds);
  }

  const requestedSpan =
    typeof sampleRateHz === "number" &&
    Number.isFinite(sampleRateHz) &&
    sampleRateHz > 0
      ? Math.max(1, Math.round(sampleRateHz))
      : Math.max(1, Math.round(channelSpan));
  const centerHz = (channelBounds.min + channelBounds.max) / 2;
  const min = Math.max(0, Math.round(centerHz - requestedSpan / 2));
  const nextRange = normalizeFrequencyRangeToHz({
    min,
    max: min + requestedSpan,
  });

  return requestedSpan < channelSpan
    ? clampFrequencyRangeToBounds(nextRange, channelBounds)
    : nextRange;
};

export const buildLiveSampleRateRange = ({
  currentRange,
  sampleRateHz,
  channelBounds,
  startingAnchorPosition = "start",
  forceStartingAnchor = false,
}: BuildSampleRateRangeArgs): FrequencyRange => {
  const centerHz = getFrequencyRangeCenterHz(currentRange);
  const requestedSpan = Math.max(1, Math.round(sampleRateHz));
  const channelSpan =
    channelBounds && channelBounds.max > channelBounds.min
      ? channelBounds.max - channelBounds.min
      : 0;

  if (channelBounds && channelSpan > 0) {
    if (sampleRateHz < channelSpan) {
      const currentSpan = Math.max(0, currentRange.max - currentRange.min);
      const currentRangeUsable =
        startingAnchorPosition !== "center" &&
        !forceStartingAnchor &&
        Number.isFinite(currentRange.min) &&
        Number.isFinite(currentRange.max) &&
        currentSpan > 0 &&
        currentSpan <= requestedSpan + 1;
      const anchoredMin =
        startingAnchorPosition === "end"
          ? channelBounds.max - requestedSpan
          : startingAnchorPosition === "center"
            ? centerHz - requestedSpan / 2
            : channelBounds.min;
      const idealMin = currentRangeUsable ? currentRange.min : anchoredMin;
      const min = Math.max(0, idealMin);
      return clampFrequencyRangeToBounds(
        normalizeFrequencyRangeToHz({
          min,
          max: min + requestedSpan,
        }),
        channelBounds,
      );
    }

    const min =
      startingAnchorPosition === "center"
        ? Math.max(0, Math.round(centerHz - requestedSpan / 2))
        : Math.max(0, Math.round(channelBounds.min));
    return normalizeFrequencyRangeToHz({
      min,
      max: min + requestedSpan,
    });
  }

  const idealMin = centerHz - requestedSpan / 2;
  const min = Math.max(0, idealMin);
  const nextRange = normalizeFrequencyRangeToHz({
    min,
    max: min + requestedSpan,
  });

  return nextRange;
};

export const getWholeChannelSampleRate = (
  activeChannelSampleRate: number | null,
): number | null => {
  if (
    typeof activeChannelSampleRate !== "number" ||
    !Number.isFinite(activeChannelSampleRate) ||
    activeChannelSampleRate <= 0
  ) {
    return null;
  }

  return activeChannelSampleRate;
};

export const canUseWholeChannelSampleRate = ({
  supportsWholeChannelSampleRate,
  activeChannelSampleRate,
  maxSampleRateHz,
}: {
  supportsWholeChannelSampleRate: boolean;
  activeChannelSampleRate: number | null;
  maxSampleRateHz?: number | null;
}): boolean => {
  const wholeChannelRate = getWholeChannelSampleRate(activeChannelSampleRate);
  if (!supportsWholeChannelSampleRate || wholeChannelRate === null) {
    return false;
  }

  return (
    typeof maxSampleRateHz !== "number" ||
    !Number.isFinite(maxSampleRateHz) ||
    maxSampleRateHz <= 0 ||
    wholeChannelRate <= maxSampleRateHz + 10_000
  );
};

const rangeSpanHz = (range: FrequencyRange): number =>
  Math.max(0, Math.round(range.max - range.min));

export const useLiveSampleRateControl = ({
  sourceMode,
  supportsWholeChannelSampleRate,
  manualSampleRateOptions: _manualSampleRateOptions = [],
  activeChannelSampleRate,
  maxSampleRateHz,
  activeSignalAreaBounds,
  frequencyRange,
  sampleRateHz,
  fftSize,
  maxFrameRateLimit,
  startingAnchorPosition = "start",
  setSampleRate,
  setSampleRateWithFrequencyRange,
  onSampleRateApplied,
  setFftFrameRate,
  applyFrequencyRange,
}: UseLiveSampleRateControlArgs) => {
  const sampleRateModeRef = useRef<SampleRateMode | null>(null);
  const lastAppliedWholeChannelRateRef = useRef<number | null>(null);
  const lastAppliedFrequencyRangeKeyRef = useRef<string | null>(null);
  const lastObservedFrequencyRangeKeyRef = useRef<string | null>(null);
  const lastExplicitChannelFocusRangeKeyRef = useRef<string | null>(null);
  const pendingSampleRateRef = useRef<number | null>(null);
  const requestedSampleRateHz = pendingSampleRateRef.current ?? sampleRateHz;

  useEffect(() => {
    if (
      pendingSampleRateRef.current !== null &&
      typeof sampleRateHz === "number" &&
      Math.round(sampleRateHz) === Math.round(pendingSampleRateRef.current)
    ) {
      pendingSampleRateRef.current = null;
    }
  }, [sampleRateHz]);

  const canUseWholeChannel =
    sourceMode === "live" &&
    canUseWholeChannelSampleRate({
      supportsWholeChannelSampleRate,
      activeChannelSampleRate,
      maxSampleRateHz,
    });
  const wholeChannelSampleRate = canUseWholeChannel
    ? getWholeChannelSampleRate(activeChannelSampleRate)
    : null;

  const isWholeChannelMode =
    canUseWholeChannel &&
    (sampleRateModeRef.current === "whole" ||
      (sampleRateModeRef.current !== "manual" &&
        resolveWholeChannelMode({
          supportsWholeChannel: true,
          sampleRateHz: requestedSampleRateHz,
          activeChannelBounds: {
            min: 0,
            max: wholeChannelSampleRate ?? 0,
          },
        })));

  const applyFrequencyRangeIfChanged = useCallback(
    (range: FrequencyRange) => {
      const normalizedRange = normalizeFrequencyRangeToHz(range);
      const key = `${normalizedRange.min}:${normalizedRange.max}`;
      if (lastAppliedFrequencyRangeKeyRef.current === key) {
        return;
      }
      lastAppliedFrequencyRangeKeyRef.current = key;
      applyFrequencyRange(normalizedRange);
    },
    [applyFrequencyRange],
  );

  const handleSampleRateChange = useCallback(
    (
      nextSampleRate: number,
      requestedMode?: SampleRateMode,
      frequencyRangeOverride?: FrequencyRange,
    ) => {
      const nextWholeChannelRate = getWholeChannelSampleRate(
        activeChannelSampleRate,
      );
      const overrideSpanHz =
        frequencyRangeOverride &&
        Number.isFinite(frequencyRangeOverride.min) &&
        Number.isFinite(frequencyRangeOverride.max) &&
        frequencyRangeOverride.max > frequencyRangeOverride.min
          ? Math.max(
              1,
              Math.round(
                frequencyRangeOverride.max - frequencyRangeOverride.min,
              ),
            )
          : null;
      const resolvedSampleRate =
        requestedMode === "whole" && overrideSpanHz !== null
          ? overrideSpanHz
          : nextWholeChannelRate !== null &&
          Math.round(nextWholeChannelRate) === Math.round(nextSampleRate)
            ? nextWholeChannelRate
            : nextSampleRate;
      pendingSampleRateRef.current = resolvedSampleRate;
      if (requestedMode === "whole" && frequencyRangeOverride) {
        const normalizedOverride = normalizeFrequencyRangeToHz(
          frequencyRangeOverride,
        );
        lastExplicitChannelFocusRangeKeyRef.current =
          `${normalizedOverride.min}:${normalizedOverride.max}`;
      }

      if (requestedMode) {
        sampleRateModeRef.current = requestedMode;
      } else if (
        wholeChannelSampleRate &&
        Math.round(wholeChannelSampleRate) !== Math.round(resolvedSampleRate)
      ) {
        sampleRateModeRef.current = "manual";
      } else {
        sampleRateModeRef.current = "whole";
      }

      let nextRange: FrequencyRange | null = null;
      const rangeForSampleRate = frequencyRangeOverride ?? frequencyRange;
      if (
        sourceMode === "live" &&
        rangeForSampleRate &&
        Number.isFinite(resolvedSampleRate) &&
        resolvedSampleRate > 0
      ) {
        const isImplicitWholeChannelRestore =
          requestedMode === undefined &&
          wholeChannelSampleRate !== null &&
          Math.round(resolvedSampleRate) === Math.round(wholeChannelSampleRate);
        nextRange =
          requestedMode === "whole" && frequencyRangeOverride
            ? normalizeFrequencyRangeToHz(frequencyRangeOverride)
            : buildLiveSampleRateRange({
                currentRange: rangeForSampleRate,
                sampleRateHz: resolvedSampleRate,
                // Signal Display changes are viewport changes, even when the
                // current center is outside the selected channel (for example
                // after a double-click VFO entry). Channel bounds belong to
                // channel-selection/automatic hydration paths; applying them here
                // silently retunes a manual center back to that channel.
                channelBounds: requestedMode ? null : activeSignalAreaBounds,
                startingAnchorPosition: isImplicitWholeChannelRestore
                  ? startingAnchorPosition
                  : "center",
              });
      }

      if (nextRange && setSampleRateWithFrequencyRange) {
        setSampleRateWithFrequencyRange(resolvedSampleRate, nextRange);
      } else {
        setSampleRate(resolvedSampleRate);
      }
      onSampleRateApplied?.(resolvedSampleRate);
      setFftFrameRate?.(
        computeMaxFrameRate(
          resolvedSampleRate,
          fftSize ?? 0,
          maxFrameRateLimit,
        ),
      );
      if (nextRange) {
        applyFrequencyRangeIfChanged(nextRange);
      }
    },
    [
      activeSignalAreaBounds,
      frequencyRange,
      requestedSampleRateHz,
      startingAnchorPosition,
      setSampleRate,
      setSampleRateWithFrequencyRange,
      onSampleRateApplied,
      setFftFrameRate,
      sourceMode,
      applyFrequencyRangeIfChanged,
      wholeChannelSampleRate,
      fftSize,
      maxFrameRateLimit,
    ],
  );

  useEffect(() => {
    if (!canUseWholeChannel || !wholeChannelSampleRate) return;
    const nextRate = Math.round(wholeChannelSampleRate);
    const currentRate =
      typeof requestedSampleRateHz === "number" &&
      Number.isFinite(requestedSampleRateHz)
        ? Math.round(requestedSampleRateHz)
        : null;

    // A valid receive rate is explicit acquisition state. Merely panning into
    // another channel must not reinterpret it as a request for that channel's
    // Whole Channel width. Explicit selector/channel actions call
    // handleSampleRateChange themselves.
    if (currentRate !== null && currentRate > 0) {
      if (currentRate !== nextRate) return;
      if (lastAppliedWholeChannelRateRef.current !== nextRate) {
        onSampleRateApplied?.(nextRate);
      }
      lastAppliedWholeChannelRateRef.current = nextRate;
      return;
    }

    if (!Number.isFinite(nextRate) || nextRate <= 0) return;

    if (sampleRateModeRef.current === "manual") {
      return;
    }
    if (lastAppliedWholeChannelRateRef.current === nextRate) return;

    lastAppliedWholeChannelRateRef.current = nextRate;
    setSampleRate(nextRate);
    onSampleRateApplied?.(nextRate);

    if (frequencyRange) {
      applyFrequencyRangeIfChanged(
        buildLiveSampleRateRange({
          currentRange: frequencyRange,
          sampleRateHz: nextRate,
          channelBounds: activeSignalAreaBounds,
          startingAnchorPosition,
        }),
      );
    }
  }, [
    activeChannelSampleRate,
    activeSignalAreaBounds,
    applyFrequencyRangeIfChanged,
    frequencyRange,
    requestedSampleRateHz,
    setSampleRate,
    onSampleRateApplied,
    sourceMode,
    startingAnchorPosition,
    wholeChannelSampleRate,
    canUseWholeChannel,
  ]);

  useEffect(() => {
    if (
      !frequencyRange ||
      !activeSignalAreaBounds ||
      typeof requestedSampleRateHz !== "number" ||
      !Number.isFinite(requestedSampleRateHz) ||
      requestedSampleRateHz <= 0
    ) {
      return;
    }

    const currentSpan = rangeSpanHz(frequencyRange);
    const normalizedCurrentRange =
      normalizeFrequencyRangeToHz(frequencyRange);
    const currentRangeKey = `${normalizedCurrentRange.min}:${normalizedCurrentRange.max}`;
    const rangeChangedSinceObservation =
      lastObservedFrequencyRangeKeyRef.current !== null &&
      lastObservedFrequencyRangeKeyRef.current !== currentRangeKey;
    lastObservedFrequencyRangeKeyRef.current = currentRangeKey;

    if (canUseWholeChannel) {
      const targetRate =
        isWholeChannelMode && typeof wholeChannelSampleRate === "number"
          ? wholeChannelSampleRate
          : requestedSampleRateHz;
      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz: targetRate,
        channelBounds: activeSignalAreaBounds,
        startingAnchorPosition: isWholeChannelMode
          ? startingAnchorPosition
          : "center",
      });
      const wholeChannelEdgesDiffer =
        normalizedCurrentRange.min !== nextRange.min ||
        normalizedCurrentRange.max !== nextRange.max;
      const nextRangeKey = `${nextRange.min}:${nextRange.max}`;
      const isExplicitChannelFocus =
        lastExplicitChannelFocusRangeKeyRef.current === nextRangeKey;
      if (
        isExplicitChannelFocus &&
        rangeChangedSinceObservation &&
        lastAppliedFrequencyRangeKeyRef.current !== currentRangeKey
      ) {
        // A changed live range is a new observation. If it does not equal the
        // range we last requested, allow Whole Channel edge reconciliation to
        // publish again rather than treating the old request as an ACK.
        lastAppliedFrequencyRangeKeyRef.current = null;
      }

      if (
        (isWholeChannelMode && isExplicitChannelFocus)
          ? wholeChannelEdgesDiffer
          : rangeSpanHz(frequencyRange) !== rangeSpanHz(nextRange)
      ) {
        applyFrequencyRangeIfChanged(nextRange);
      }
    } else if (currentSpan > requestedSampleRateHz) {
      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz: requestedSampleRateHz,
        channelBounds: activeSignalAreaBounds,
        startingAnchorPosition: "center",
      });

      if (rangeSpanHz(frequencyRange) !== rangeSpanHz(nextRange)) {
        applyFrequencyRangeIfChanged(nextRange);
      }
    }
  }, [
    activeSignalAreaBounds,
    applyFrequencyRangeIfChanged,
    canUseWholeChannel,
    frequencyRange,
    requestedSampleRateHz,
    startingAnchorPosition,
  ]);

  return {
    wholeChannelSampleRate,
    isWholeChannelMode,
    handleSampleRateChange,
  };
};
