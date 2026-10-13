import { isFrequencyWithinRange } from '@n-apt/math/frequency';
import type { SpectrumFrame } from '@n-apt/consts/schemas/websocket';
import type { NativeTrainingChannel } from './trainingCapture';

/**
 * Suggest the classifier's supported channel annotation using the same
 * inclusive center-frequency containment rule as the spectrum Channels UI.
 * FFT crop visibility does not change this channel-selection rule. A known
 * non-A/B channel or a center outside all canonical ranges is `other`; missing
 * or ambiguous range metadata returns null so the caller can keep it unspecified.
 */
export function suggestNativeObservedChannel(
  centerFrequencyHz: number | null | undefined,
  channels: readonly SpectrumFrame[] | null | undefined,
): NativeTrainingChannel | null {
  if (typeof centerFrequencyHz !== 'number' || !Number.isFinite(centerFrequencyHz) || !Array.isArray(channels) || channels.length === 0) {
    return null;
  }
  if (channels.some((channel) =>
    !channel || typeof channel.label !== 'string' ||
    !Number.isFinite(channel.min_hz) || !Number.isFinite(channel.max_hz)
  )) {
    return null;
  }

  const matches = channels.filter((channel) =>
    isFrequencyWithinRange(centerFrequencyHz, {
      min: channel.min_hz,
      max: channel.max_hz,
    }),
  );
  if (matches.length > 1) return null;
  if (matches.length === 0) return 'other';

  const label = matches[0].label.trim().toUpperCase();
  return label === 'A' || label === 'B' ? label : 'other';
}
