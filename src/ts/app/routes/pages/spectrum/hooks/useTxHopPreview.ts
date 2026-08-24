import { useEffect, useMemo, useState } from "react";
import {
  setTxHopPreviewState,
} from "@n-apt/redux";
import type { Dispatch } from "@reduxjs/toolkit";

type HopTarget = {
  centerFrequencyHz: number;
  bandwidthHz: number;
  min: number;
  max: number;
  label: string;
};

export interface UseTxHopPreviewOptions {
  txHopType: string;
  txHopEnabled: boolean;
  txHopChannels: string[];
  websocketChannels: Array<{ label: string; min_hz: number; max_hz: number }> | null;
  txSampleRateHz: number;
  txCenterFrequencyHz: number;
  effectiveRxSampleRate: number | null | undefined;
  isSelectedSourceTxMode: boolean;
  isSelectedMockTxTransmitting: boolean;
  reduxDispatch: Dispatch;
  /** Hop steps retarget the monitor VFO atomically with the tune. */
  setMockMonitorCenterHz: (centerHz: number) => void;
}

/**
 * Tx hop-preview cycling: derives hop targets (channel list or segmented
 * range), cycles a preview index on a 1 s interval while hop preview is
 * active, and publishes each step as one atomic Redux update. Extracted
 * verbatim from SpectrumRoute so the per-second cadence lives here instead of
 * re-rendering the whole route's concerns.
 */
export const useTxHopPreview = (
  options: UseTxHopPreviewOptions,
): { activeHopTarget: HopTarget | null; hopPreviewIndex: number } => {
  const {
    txHopType,
    txHopEnabled,
    txHopChannels,
    websocketChannels,
    txSampleRateHz,
    txCenterFrequencyHz,
    effectiveRxSampleRate,
    isSelectedSourceTxMode,
    isSelectedMockTxTransmitting,
    reduxDispatch,
    setMockMonitorCenterHz,
  } = options;

  const channelsList = useMemo(() => {
    const defaultChannels = [
      { label: "A", min: 18_000, max: 4_390_000 },
      { label: "B", min: 24_100_000, max: 30_370_000 },
      { label: "C", min: 4_750_000, max: 23_000_000 },
    ];
    if (websocketChannels && websocketChannels.length > 0) {
      return websocketChannels.map((ch) => ({
        label: ch.label,
        min: ch.min_hz,
        max: ch.max_hz,
      }));
    }
    return defaultChannels;
  }, [websocketChannels]);

  const autoHopRequired = useMemo(() => {
    return txHopType === "channels" && txHopChannels.length > 1;
  }, [txHopType, txHopChannels.length]);

  const isHopActive =
    (txHopEnabled || autoHopRequired) &&
    (isSelectedSourceTxMode || isSelectedMockTxTransmitting);

  const hopTargets = useMemo(() => {
    if (!isHopActive) return [];
    if (txHopType === "channels") {
      const selected = (txHopChannels || []).map((l) => l.toUpperCase());
      const targets: HopTarget[] = [];
      for (const label of selected) {
        const ch = channelsList.find((c) => c.label.toUpperCase() === label);
        if (ch) {
          const bw = Math.max(1, ch.max - ch.min);
          const center = Math.round((ch.min + ch.max) / 2);
          targets.push({
            centerFrequencyHz: center,
            bandwidthHz: bw,
            min: ch.min,
            max: ch.max,
            label: ch.label,
          });
        }
      }
      return targets;
    } else {
      const hwRate = Math.max(1_000_000, effectiveRxSampleRate || 3_200_000);
      if (txSampleRateHz <= hwRate) {
        return [
          {
            centerFrequencyHz: txCenterFrequencyHz,
            bandwidthHz: txSampleRateHz,
            min: txCenterFrequencyHz - txSampleRateHz / 2,
            max: txCenterFrequencyHz + txSampleRateHz / 2,
            label: "range",
          },
        ];
      }
      const numSegments = Math.ceil(txSampleRateHz / hwRate);
      const startHz = txCenterFrequencyHz - txSampleRateHz / 2;
      const targets: HopTarget[] = [];
      for (let i = 0; i < numSegments; i++) {
        const segMin = Math.round(startHz + hwRate * i);
        const segMax = Math.round(startHz + hwRate * (i + 1));
        const segCenter = Math.round((segMin + segMax) / 2);
        targets.push({
          centerFrequencyHz: segCenter,
          bandwidthHz: hwRate,
          min: segMin,
          max: segMax,
          label: `segment_${i + 1}`,
        });
      }
      return targets;
    }
  }, [
    isHopActive,
    txHopType,
    txHopChannels,
    channelsList,
    effectiveRxSampleRate,
    txSampleRateHz,
    txCenterFrequencyHz,
  ]);

  const [hopPreviewIndex, setHopPreviewIndex] = useState(0);

  useEffect(() => {
    if (!isHopActive || hopTargets.length <= 1 || isSelectedMockTxTransmitting) {
      setHopPreviewIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setHopPreviewIndex((prev) => (prev + 1) % hopTargets.length);
    }, 1000);
    return () => clearInterval(timer);
  }, [isHopActive, hopTargets.length, isSelectedMockTxTransmitting]);

  const activeHopTarget = useMemo(() => {
    if (isHopActive && hopTargets.length > 1) {
      return hopTargets[hopPreviewIndex % hopTargets.length];
    }
    return null;
  }, [isHopActive, hopTargets, hopPreviewIndex]);

  useEffect(() => {
    if (!isHopActive || !activeHopTarget) return;
    // Single atomic dispatch: view range, planned Tx, and sample rate move
    // together as one hop-preview step.
    reduxDispatch(
      setTxHopPreviewState({
        frequencyRange: { min: activeHopTarget.min, max: activeHopTarget.max },
        txCenterFrequencyHz: activeHopTarget.centerFrequencyHz,
        txSampleRateHz: activeHopTarget.bandwidthHz,
        sampleRateHz: activeHopTarget.bandwidthHz,
        activeSignalArea:
          activeHopTarget.label && activeHopTarget.label !== "range"
            ? activeHopTarget.label
            : undefined,
      }),
    );
    setMockMonitorCenterHz(activeHopTarget.centerFrequencyHz);
  }, [isHopActive, activeHopTarget, reduxDispatch]);

  return { activeHopTarget, hopPreviewIndex };
};
