import { useCallback, useEffect, useRef } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";
import {
  clampFrequencyRangeToBounds,
  getFrequencyRangeCenterHz,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";
import { computeMaxFrameRate } from "@n-apt/utils/signals";

export type SampleRateMode = "whole" | "manual";
export type SampleRateAnchorPosition = "start" | "center" | "end";

type UseLiveSampleRateControlArgs = {
  sourceMode: "live" | "file";
  supportsWholeChannelSampleRate: boolean;
  manualSampleRateOptions?: number[];
  activeChannelSampleRate: number | null;
  activeSignalAreaBounds: FrequencyRange | null;
  frequencyRange: FrequencyRange | null;
  sampleRateHz: number | null;
  fftSize?: number;
  maxFrameRateLimit?: number;
  startingAnchorPosition?: SampleRateAnchorPosition;
  setSampleRate: (rate: number) => void;
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

    const min = Math.max(0, Math.round(channelBounds.min));
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

const rangeSpanHz = (range: FrequencyRange): number =>
  Math.max(0, Math.round(range.max - range.min));

export const useLiveSampleRateControl = ({
  sourceMode,
  supportsWholeChannelSampleRate,
  manualSampleRateOptions = [],
  activeChannelSampleRate,
  activeSignalAreaBounds,
  frequencyRange,
  sampleRateHz,
  fftSize,
  maxFrameRateLimit,
  startingAnchorPosition = "start",
  setSampleRate,
  setFftFrameRate,
  applyFrequencyRange,
}: UseLiveSampleRateControlArgs) => {
  const sampleRateModeRef = useRef<SampleRateMode | null>(null);
  const lastAppliedWholeChannelRateRef = useRef<number | null>(null);
  const previousWholeChannelRateRef = useRef<number | null>(null);
  const lastAppliedFrequencyRangeKeyRef = useRef<string | null>(null);

  const canUseWholeChannel =
    sourceMode === "live" && supportsWholeChannelSampleRate;
  const wholeChannelSampleRate = canUseWholeChannel
    ? getWholeChannelSampleRate(activeChannelSampleRate)
    : null;

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
    (nextSampleRate: number) => {
      const nextWholeChannelRate = getWholeChannelSampleRate(
        activeChannelSampleRate,
      );
      const resolvedSampleRate =
        nextWholeChannelRate !== null &&
        Math.round(nextWholeChannelRate) === Math.round(nextSampleRate)
          ? nextWholeChannelRate
          : nextSampleRate;

      if (
        wholeChannelSampleRate &&
        Math.round(wholeChannelSampleRate) !== Math.round(resolvedSampleRate)
      ) {
        sampleRateModeRef.current = "manual";
      } else {
        sampleRateModeRef.current = "whole";
      }

      setSampleRate(resolvedSampleRate);
      setFftFrameRate?.(
        computeMaxFrameRate(
          resolvedSampleRate,
          fftSize ?? 0,
          maxFrameRateLimit,
        ),
      );

      if (
        sourceMode !== "live" ||
        !frequencyRange ||
        !Number.isFinite(resolvedSampleRate) ||
        resolvedSampleRate <= 0
      ) {
        return;
      }

      const isLeavingWholeChannelMode =
        wholeChannelSampleRate !== null &&
        typeof sampleRateHz === "number" &&
        Number.isFinite(sampleRateHz) &&
        Math.round(sampleRateHz) === Math.round(wholeChannelSampleRate) &&
        Math.round(resolvedSampleRate) !== Math.round(wholeChannelSampleRate);
      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz: resolvedSampleRate,
        channelBounds: activeSignalAreaBounds,
        startingAnchorPosition,
        forceStartingAnchor: isLeavingWholeChannelMode,
      });
      applyFrequencyRangeIfChanged(nextRange);
    },
    [
      activeSignalAreaBounds,
      frequencyRange,
      sampleRateHz,
      startingAnchorPosition,
      setSampleRate,
      setFftFrameRate,
      sourceMode,
      applyFrequencyRangeIfChanged,
      wholeChannelSampleRate,
      fftSize,
      maxFrameRateLimit,
    ],
  );

  useEffect(() => {
    if (!canUseWholeChannel || !wholeChannelSampleRate) {
      previousWholeChannelRateRef.current = wholeChannelSampleRate;
      return;
    }
    const nextRate = Math.round(wholeChannelSampleRate);
    const previousWholeRate = previousWholeChannelRateRef.current;
    previousWholeChannelRateRef.current = nextRate;
    const currentRate =
      typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
        ? Math.round(sampleRateHz)
        : null;

    const currentRateIsPreviousWhole =
      typeof currentRate === "number" &&
      typeof previousWholeRate === "number" &&
      currentRate === Math.round(previousWholeRate);
    const currentRateIsAllowedManual =
      typeof currentRate === "number" &&
      manualSampleRateOptions.length > 0 &&
      manualSampleRateOptions.some(
        (rate) => Number.isFinite(rate) && Math.round(rate) === currentRate,
      );
    const currentRateIsKnownInvalidManual =
      typeof currentRate === "number" &&
      manualSampleRateOptions.length > 0 &&
      !currentRateIsAllowedManual;

    if (
      (currentRateIsPreviousWhole ||
        (currentRateIsKnownInvalidManual &&
          sampleRateModeRef.current !== "manual")) &&
      currentRate !== null &&
      nextRate !== currentRate &&
      sampleRateModeRef.current !== "manual"
    ) {
      sampleRateModeRef.current = "whole";
      lastAppliedWholeChannelRateRef.current = nextRate;
      setSampleRate(nextRate);
      setFftFrameRate?.(
        computeMaxFrameRate(nextRate, fftSize ?? 0, maxFrameRateLimit),
      );
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
      return;
    }

    if (
      typeof sampleRateHz === "number" &&
      Number.isFinite(sampleRateHz) &&
      sampleRateHz > 0
    ) {
      return;
    }

    if (!Number.isFinite(nextRate) || nextRate <= 0) return;

    if (sampleRateModeRef.current === "manual") {
      return;
    }
    if (sampleRateHz === nextRate) {
      lastAppliedWholeChannelRateRef.current = nextRate;
      return;
    }
    if (lastAppliedWholeChannelRateRef.current === nextRate) return;

    lastAppliedWholeChannelRateRef.current = nextRate;
    setSampleRate(nextRate);

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
    manualSampleRateOptions,
    sampleRateHz,
    setSampleRate,
    sourceMode,
    startingAnchorPosition,
    wholeChannelSampleRate,
    canUseWholeChannel,
  ]);

  useEffect(() => {
    if (
      !frequencyRange ||
      !activeSignalAreaBounds ||
      typeof sampleRateHz !== "number" ||
      !Number.isFinite(sampleRateHz) ||
      sampleRateHz <= 0
    ) {
      return;
    }

    const currentSpan = rangeSpanHz(frequencyRange);

    if (canUseWholeChannel) {
      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz,
        channelBounds: activeSignalAreaBounds,
        startingAnchorPosition,
      });

      if (rangeSpanHz(frequencyRange) !== rangeSpanHz(nextRange)) {
        applyFrequencyRangeIfChanged(nextRange);
      }
    } else if (currentSpan > sampleRateHz) {
      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz,
        channelBounds: activeSignalAreaBounds,
        startingAnchorPosition,
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
    sampleRateHz,
    startingAnchorPosition,
  ]);

  return {
    wholeChannelSampleRate,
    handleSampleRateChange,
  };
};
