import { useCallback, useEffect, useRef, useState } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";
import {
  clampFrequencyRangeToBounds,
  getFrequencyRangeCenterHz,
  normalizeFrequencyRangeToHz,
} from "@n-apt/math/frequency";
import { computeMaxFrameRate } from "@n-apt/math/signals";
import { resolveWholeChannelMode } from "@n-apt/spectrum/utils/wholeChannelControl";
import { assertValidSampleRateHz } from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";

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
  preferWholeChannelOnLiveStart?: boolean;
  manualSampleRateOptions?: number[];
  activeChannelSampleRate: number | null;
  maxSampleRateHz?: number | null;
  activeSignalAreaBounds: FrequencyRange | null;
  frequencyRange: FrequencyRange | null;
  sampleRateHz: number | null;
  /** Backend-accepted acquisition rate, distinct from persisted/requested UI state. */
  deviceSampleRateHz?: number | null;
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
  // A non-finite or non-positive rate is a stale/broken reference, not a
  // request to collapse the window. Deriving NaN straight through produced a
  // zero-width window, which blanks the view instead of failing visibly.
  const requestedSpan =
    Number.isFinite(sampleRateHz) && sampleRateHz > 0
      ? Math.max(1, Math.round(sampleRateHz))
      : Math.max(
          1,
          Math.round(Math.max(0, currentRange.max - currentRange.min)),
        );
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
  preferWholeChannelOnLiveStart = false,
  manualSampleRateOptions: _manualSampleRateOptions = [],
  activeChannelSampleRate,
  maxSampleRateHz,
  activeSignalAreaBounds,
  frequencyRange,
  sampleRateHz,
  deviceSampleRateHz,
  fftSize,
  maxFrameRateLimit,
  startingAnchorPosition = "start",
  setSampleRate,
  setSampleRateWithFrequencyRange,
  onSampleRateApplied,
  setFftFrameRate,
  applyFrequencyRange,
}: UseLiveSampleRateControlArgs) => {
  // The selected mode and the pending local rate are rendered by this hook, so
  // they are state rather than refs. A ref mutation does not re-render, which let
  // effects run against a stale mode/rate until an unrelated render refreshed
  // them ("stale until you keep interacting"). Both change only on explicit
  // user actions, never per frame, so the extra renders are gesture-frequency.
  const [sampleRateMode, setSampleRateMode] = useState<SampleRateMode | null>(
    null,
  );
  const lastAppliedWholeChannelRateRef = useRef<number | null>(null);
  const lastAppliedFrequencyRangeKeyRef = useRef<string | null>(null);
  const wholeChannelStartupRestoreAttemptedRef = useRef(false);
  const pendingAcquisitionRateRef = useRef<number | null>(null);
  const wholeChannelBoundsKeyRef = useRef<string | null>(null);
  const pendingWholeChannelBoundsKeyRef = useRef<string | null>(null);
  const wholeChannelDeviceSyncRateRef = useRef<number | null>(null);
  const [pendingSampleRateHz, setPendingSampleRateHz] = useState<number | null>(
    null,
  );
  const requestedSampleRateHz = pendingSampleRateHz ?? sampleRateHz;

  useEffect(() => {
    if (
      pendingSampleRateHz !== null &&
      typeof sampleRateHz === "number" &&
      Math.round(sampleRateHz) === Math.round(pendingSampleRateHz) &&
      (!frequencyRange ||
        rangeSpanHz(frequencyRange) === Math.round(pendingSampleRateHz))
    ) {
      pendingAcquisitionRateRef.current = null;
      setPendingSampleRateHz(null);
    }
  }, [pendingSampleRateHz, sampleRateHz, frequencyRange]);

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

  // An explicit Whole Channel selection follows channel changes: Channels
  // uses this value to request the newly selected channel's full bounds and
  // rate. When no mode has been selected in this session, infer the mode from
  // the live rate. Manual remains sticky because panning must not reinterpret
  // an explicit acquisition choice as a channel request.
  const isWholeChannelMode =
    canUseWholeChannel &&
    (sampleRateMode === "whole" ||
      (sampleRateMode !== "manual" &&
        resolveWholeChannelMode({
          supportsWholeChannel: true,
          // A persisted local request is only intent. Until the device accepts
          // it, an older channel-width request must not make the selector claim
          // Whole Channel while the source is still acquiring at its old rate.
          sampleRateHz:
            typeof deviceSampleRateHz === "number" &&
            Number.isFinite(deviceSampleRateHz) &&
            deviceSampleRateHz > 0
              ? deviceSampleRateHz
              : requestedSampleRateHz,
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
      // Every selector, channel-click and preset rate enters through here.
      assertValidSampleRateHz(nextSampleRate, "the sample-rate control");
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
      pendingAcquisitionRateRef.current = resolvedSampleRate;
      setPendingSampleRateHz(resolvedSampleRate);

      const nextMode = requestedMode ?? (
        wholeChannelSampleRate &&
        Math.round(wholeChannelSampleRate) !== Math.round(resolvedSampleRate)
          ? "manual"
          : "whole"
      );
      setSampleRateMode(nextMode);
      wholeChannelStartupRestoreAttemptedRef.current = true;
      if (nextMode === "whole") {
        const bounds = frequencyRangeOverride ?? activeSignalAreaBounds;
        const key = bounds ? `${bounds.min}:${bounds.max}` : null;
        wholeChannelBoundsKeyRef.current = key;
        pendingWholeChannelBoundsKeyRef.current = frequencyRangeOverride
          ? key
          : null;
      } else {
        pendingWholeChannelBoundsKeyRef.current = null;
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
      activeChannelSampleRate,
      activeSignalAreaBounds,
      frequencyRange,
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
    // The device-accepted rate is the only proof that a request reached the
    // hardware. Redux can hold the whole-channel intent (e.g. rehydrated from
    // storage) while the source still acquires at its generic floor after a
    // hot-plug or source switch.
    const deviceRate =
      typeof deviceSampleRateHz === "number" &&
      Number.isFinite(deviceSampleRateHz) &&
      deviceSampleRateHz > 0
        ? Math.round(deviceSampleRateHz)
        : null;
    const acceptedRate = deviceRate ?? currentRate;
    if (deviceRate !== null && deviceRate === nextRate) {
      wholeChannelDeviceSyncRateRef.current = null;
    }

    const boundsKey = activeSignalAreaBounds
      ? `${activeSignalAreaBounds.min}:${activeSignalAreaBounds.max}`
      : null;
    if (sampleRateMode === "whole" && activeSignalAreaBounds) {
      // A click supplies the target before source/channel metadata catches up.
      // Do not reinterpret that previous metadata as a second channel switch.
      const pendingBoundsKey = pendingWholeChannelBoundsKeyRef.current;
      if (pendingBoundsKey !== null && pendingBoundsKey !== boundsKey) return;
      pendingWholeChannelBoundsKeyRef.current = null;
      const deviceBehindWholeChannel =
        deviceRate !== null &&
        deviceRate !== nextRate &&
        wholeChannelDeviceSyncRateRef.current !== nextRate;
      if (
        wholeChannelBoundsKeyRef.current !== boundsKey ||
        currentRate !== nextRate ||
        deviceBehindWholeChannel
      ) {
        wholeChannelBoundsKeyRef.current = boundsKey;
        wholeChannelDeviceSyncRateRef.current = nextRate;
        pendingAcquisitionRateRef.current = nextRate;
        setPendingSampleRateHz(nextRate);
        if (setSampleRateWithFrequencyRange) {
          setSampleRateWithFrequencyRange(nextRate, activeSignalAreaBounds);
        } else {
          setSampleRate(nextRate);
        }
        onSampleRateApplied?.(nextRate);
        applyFrequencyRangeIfChanged(activeSignalAreaBounds);
        return;
      }
    }

    // A valid receive rate is explicit acquisition state. Merely panning into
    // another channel must not reinterpret it as a request for that channel's
    // Whole Channel width. Explicit selector/channel actions call
    // handleSampleRateChange themselves.
    if (acceptedRate !== null && acceptedRate > 0) {
      if (
        preferWholeChannelOnLiveStart &&
        sampleRateMode === null &&
        !wholeChannelStartupRestoreAttemptedRef.current &&
        acceptedRate === 3_200_000 &&
        acceptedRate !== nextRate
      ) {
        // The device still reports its generic floor even though the local
        // state carries the Whole Channel intent (persisted across reloads and
        // source switches). Apply the intent once; the selector already treats
        // the accepted device rate, not this request, as authoritative.
        wholeChannelStartupRestoreAttemptedRef.current = true;
        wholeChannelBoundsKeyRef.current = boundsKey;
        wholeChannelDeviceSyncRateRef.current = nextRate;
        pendingAcquisitionRateRef.current = nextRate;
        setPendingSampleRateHz(nextRate);
        setSampleRateMode("whole");
        const wholeRange = activeSignalAreaBounds;
        if (wholeRange && setSampleRateWithFrequencyRange) {
          setSampleRateWithFrequencyRange(nextRate, wholeRange);
        } else {
          setSampleRate(nextRate);
        }
        onSampleRateApplied?.(nextRate);
        if (wholeRange) applyFrequencyRangeIfChanged(wholeRange);
        return;
      }
      if (acceptedRate !== nextRate) return;
      if (lastAppliedWholeChannelRateRef.current !== nextRate) {
        onSampleRateApplied?.(nextRate);
      }
      lastAppliedWholeChannelRateRef.current = nextRate;
      return;
    }

    if (!Number.isFinite(nextRate) || nextRate <= 0) return;

    if (sampleRateMode === "manual") {
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
    deviceSampleRateHz,
    frequencyRange,
    preferWholeChannelOnLiveStart,
    requestedSampleRateHz,
    setSampleRate,
    onSampleRateApplied,
    sampleRateMode,
    sourceMode,
    startingAnchorPosition,
    wholeChannelSampleRate,
    canUseWholeChannel,
    setSampleRateWithFrequencyRange,
  ]);

  useEffect(() => {
    if (
      pendingAcquisitionRateRef.current !== null ||
      !frequencyRange ||
      !activeSignalAreaBounds ||
      typeof requestedSampleRateHz !== "number" ||
      !Number.isFinite(requestedSampleRateHz) ||
      requestedSampleRateHz <= 0
    ) {
      return;
    }

    const currentSpan = rangeSpanHz(frequencyRange);

    if (canUseWholeChannel) {
      // The selected mode controls the next channel-click command, while the
      // requested rate owns the current acquisition. Channel metadata can lag
      // that command; using its span here overwrites the just-clicked window.
      const targetRate = requestedSampleRateHz;
      // Span-only reconciliation, anchored on the current centre. The channel
      // bounds deliberately do NOT participate: passing them made the builder
      // clamp the window back inside the active channel (and re-publish whenever
      // that clamp moved the window), which fought every scroll past the channel
      // and could oscillate. Position belongs to explicit channel/sample-rate
      // actions; this effect only keeps the acquisition width equal to the rate.
      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz: targetRate,
        startingAnchorPosition: "center",
      });

      if (currentSpan !== rangeSpanHz(nextRange)) {
        applyFrequencyRangeIfChanged(nextRange);
      }
    } else if (currentSpan > requestedSampleRateHz) {
      const nextRange = buildLiveSampleRateRange({
        currentRange: frequencyRange,
        sampleRateHz: requestedSampleRateHz,
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
  ]);

  return {
    wholeChannelSampleRate,
    isWholeChannelMode,
    handleSampleRateChange,
  };
};
