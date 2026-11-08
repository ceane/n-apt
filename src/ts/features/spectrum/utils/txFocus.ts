import { buildCenteredFrequencyRange } from "@n-apt/math/frequency";
import type { FrequencyRange } from "@n-apt/consts/types";

type ResolveTxFocusSampleRateArgs = {
  txBandwidthHz: number | null | undefined;
  maxSampleRateHz?: number | null;
};

type ResolveTxFocusGeometryArgs = ResolveTxFocusSampleRateArgs & {
  centerFrequencyHz: number | null | undefined;
  allowNegativeFrequencies?: boolean;
};

/** Returns a monitor rate with roughly ten percent of headroom above Tx. */
export const resolveTxFocusSampleRateHz = ({
  txBandwidthHz,
  maxSampleRateHz,
}: ResolveTxFocusSampleRateArgs): number | null => {
  if (
    typeof txBandwidthHz !== "number" ||
    !Number.isFinite(txBandwidthHz) ||
    txBandwidthHz <= 0
  ) {
    return null;
  }

  const targetRateHz = Math.ceil(txBandwidthHz * 1.1);
  if (
    typeof maxSampleRateHz === "number" &&
    Number.isFinite(maxSampleRateHz) &&
    maxSampleRateHz > 0
  ) {
    return Math.min(targetRateHz, Math.round(maxSampleRateHz));
  }

  return targetRateHz;
};

export const resolveTxFocusGeometry = ({
  centerFrequencyHz,
  txBandwidthHz,
  maxSampleRateHz,
  allowNegativeFrequencies = false,
}: ResolveTxFocusGeometryArgs): {
  sampleRateHz: number;
  frequencyRange: FrequencyRange;
} | null => {
  if (
    typeof centerFrequencyHz !== "number" ||
    !Number.isFinite(centerFrequencyHz)
  ) {
    return null;
  }

  const requestedSampleRateHz = resolveTxFocusSampleRateHz({
    txBandwidthHz,
    maxSampleRateHz,
  });
  if (requestedSampleRateHz === null) return null;

  // A centered window cannot be wider than twice its center frequency
  // without crossing 0 Hz when mirrored frequencies are disabled.
  const sampleRateHz = allowNegativeFrequencies
    ? requestedSampleRateHz
    : Math.min(requestedSampleRateHz, centerFrequencyHz * 2);
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) return null;

  return {
    sampleRateHz,
    frequencyRange: buildCenteredFrequencyRange(
      centerFrequencyHz,
      sampleRateHz,
      allowNegativeFrequencies ? Number.NEGATIVE_INFINITY : 0,
    ),
  };
};
