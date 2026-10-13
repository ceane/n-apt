import * as NativeClassifier from '@n-apt/classification';

interface ChannelRange {
  label: string;
  min_hz: number;
  max_hz: number;
}

type Matcher = (
  centerFrequencyHz: number | null | undefined,
  channels: readonly ChannelRange[] | null | undefined,
) => string | null;

const canonicalChannels: ChannelRange[] = [
  { label: 'A', min_hz: 18_000, max_hz: 4_390_000 },
  { label: 'C', min_hz: 4_750_000, max_hz: 23_000_000 },
  { label: 'B', min_hz: 24_100_000, max_hz: 30_370_000 },
];

const matchObservedChannel = (
  NativeClassifier as unknown as { suggestNativeObservedChannel?: Matcher }
).suggestNativeObservedChannel;

it('maps a uniquely known channel or out-of-range center and declines ambiguous or unavailable metadata', () => {
  expect(matchObservedChannel).toBeDefined();
  if (!matchObservedChannel) return;

  expect(matchObservedChannel(1_618_000, canonicalChannels)).toBe('A');
  expect(matchObservedChannel(24_200_000, canonicalChannels)).toBe('B');
  // Canonical C has no classifier channel label, so preserve it as the known
  // non-A/B `other` annotation without adding C to the package schema.
  expect(matchObservedChannel(10_000_000, canonicalChannels)).toBe('other');
  // A valid center outside all configured ranges is intentionally represented
  // by the existing user-facing Other / uncertain annotation.
  expect(matchObservedChannel(4_500_000, canonicalChannels)).toBe('other');
  expect(matchObservedChannel(Number.NaN, canonicalChannels)).toBeNull();
  expect(matchObservedChannel(1_618_000, undefined)).toBeNull();
  expect(matchObservedChannel(1_618_000, [
    ...canonicalChannels,
    { label: 'overlap', min_hz: 1_000_000, max_hz: 2_000_000 },
  ])).toBeNull();
  expect(matchObservedChannel(1_618_000, [
    { label: 'A', min_hz: 18_000, max_hz: Number.NaN },
  ])).toBeNull();
});
