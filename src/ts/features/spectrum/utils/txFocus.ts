import { buildCenteredFrequencyRange } from "@n-apt/math/frequency";
import type { FrequencyRange } from "@n-apt/consts/types";

type ResolveTxFocusSampleRateArgs = {
  txBandwidthHz: number | null | undefined;
  maxSampleRateHz?: number | null;
};

type ResolveTxFocusGeometryArgs = ResolveTxFocusSampleRateArgs & {
  centerFrequencyHz: number | null | undefined;
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

  const sampleRateHz = resolveTxFocusSampleRateHz({
    txBandwidthHz,
    maxSampleRateHz,
  });
  if (sampleRateHz === null) return null;

  return {
    sampleRateHz,
    frequencyRange: buildCenteredFrequencyRange(
      centerFrequencyHz,
      sampleRateHz,
      Number.NEGATIVE_INFINITY,
    ),
  };
};
