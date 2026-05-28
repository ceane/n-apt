import { useCallback, useEffect, useRef } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";
import {
  clampFrequencyRangeToBounds,
  getFrequencyRangeCenterHz,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";

export type SampleRateMode = "whole" | "manual";

type UseLiveSampleRateControlArgs = {
  sourceMode: "live" | "file";
  supportsWholeChannelSampleRate: boolean;
  manualSampleRateOptions?: number[];
  activeChannelSampleRate: number | null;
  activeSignalAreaBounds: FrequencyRange | null;
  frequencyRange: FrequencyRange | null;
  sampleRateHz: number | null;
  setSampleRate: (rate: number) => void;
  applyFrequencyRange: (range: FrequencyRange) => void;
};

type BuildSampleRateRangeArgs = {
  currentRange: FrequencyRange;
  sampleRateHz: number;
  channelBounds?: FrequencyRange | null;
};

export const buildLiveSampleRateRange = ({
  currentRange,
  sampleRateHz,
  channelBounds,
}: BuildSampleRateRangeArgs): FrequencyRange => {
  const centerHz = getFrequencyRangeCenterHz(currentRange);
  const requestedSpan = Math.max(1, Math.round(sampleRateHz));
  const channelSpan =
    channelBounds && channelBounds.max > channelBounds.min
      ? channelBounds.max - channelBounds.min
      : 0;

  if (channelBounds && channelSpan > 0) {
    const min = Math.max(0, Math.round(channelBounds.min));
    if (sampleRateHz <= channelSpan) {
      return clampFrequencyRangeToBounds(
        normalizeFrequencyRangeToHz({
          min,
          max: min + requestedSpan,
        }),
        channelBounds,
      );
    }

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
  setSampleRate,
  applyFrequencyRange,
}: UseLiveSampleRateControlArgs) => {
  const sampleRateModeRef = useRef<SampleRateMode | null>(null);
  const lastAppliedWholeChannelRateRef = useRef<number | null>(null);
  const previousWholeChannelRateRef = useRef<number | null>(null);

  const canUseWholeChannel =
    sourceMode === "live" && supportsWholeChannelSampleRate;
  const wholeChannelSampleRate = canUseWholeChannel
    ? getWholeChannelSampleRate(activeChannelSampleRate)
    : null;

  const handleSampleRateChange = useCallback(
    (nextSampleRate: number) => {
      if (
        wholeChannelSampleRate &&
        Math.round(wholeChannelSampleRate) !== Math.round(nextSampleRate)
      ) {
        sampleRateModeRef.current = "manual";
      } else {
        sampleRateModeRef.current = "whole";
      }

      setSampleRate(nextSampleRate);

      if (
        sourceMode !== "live" ||
        !frequencyRange ||
        !Number.isFinite(nextSampleRate) ||
        nextSampleRate <= 0
      ) {
        return;
      }

      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz: nextSampleRate,
        channelBounds: activeSignalAreaBounds,
      });
      applyFrequencyRange(nextRange);
    },
    [
      activeSignalAreaBounds,
      frequencyRange,
      setSampleRate,
      sourceMode,
      applyFrequencyRange,
      wholeChannelSampleRate,
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
        (rate) =>
          Number.isFinite(rate) &&
          Math.round(rate) === currentRate,
      );
    const currentRateIsKnownInvalidManual =
      typeof currentRate === "number" &&
      manualSampleRateOptions.length > 0 &&
      !currentRateIsAllowedManual;

    if (
      (currentRateIsPreviousWhole ||
        (currentRateIsKnownInvalidManual && sampleRateModeRef.current !== "manual")) &&
      currentRate !== null &&
      nextRate !== currentRate &&
      sampleRateModeRef.current !== "manual"
    ) {
      sampleRateModeRef.current = "whole";
      lastAppliedWholeChannelRateRef.current = nextRate;
      setSampleRate(nextRate);
      if (frequencyRange) {
        applyFrequencyRange(
          buildLiveSampleRateRange({
            currentRange: frequencyRange,
            sampleRateHz: nextRate,
            channelBounds: activeSignalAreaBounds,
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
      applyFrequencyRange(
        buildLiveSampleRateRange({
          currentRange: frequencyRange,
          sampleRateHz: nextRate,
          channelBounds: activeSignalAreaBounds,
        }),
      );
    }
  }, [
    activeChannelSampleRate,
    activeSignalAreaBounds,
    applyFrequencyRange,
    frequencyRange,
    manualSampleRateOptions,
    sampleRateHz,
    setSampleRate,
    sourceMode,
    wholeChannelSampleRate,
    canUseWholeChannel,
  ]);

  useEffect(() => {
    if (
      !canUseWholeChannel ||
      !frequencyRange ||
      !activeSignalAreaBounds ||
      typeof sampleRateHz !== "number" ||
      !Number.isFinite(sampleRateHz) ||
      sampleRateHz <= 0
    ) {
      return;
    }

    const nextRange = buildLiveSampleRateRange({
      currentRange: frequencyRange,
      sampleRateHz,
      channelBounds: activeSignalAreaBounds,
    });

    if (rangeSpanHz(frequencyRange) !== rangeSpanHz(nextRange)) {
      applyFrequencyRange(nextRange);
    }
  }, [
    activeSignalAreaBounds,
    applyFrequencyRange,
    canUseWholeChannel,
    frequencyRange,
    sampleRateHz,
  ]);

  return {
    wholeChannelSampleRate,
    handleSampleRateChange,
  };
};
