import {
  MAX_SAMPLE_RATE_HZ,
  normalizeFftSize,
  normalizeGainDb,
  normalizePpm,
  normalizeSampleRateHz,
  type RtlSdrSessionOptions,
} from "./rtlSdrWebUsb";
import {
  parseFrequencyInputValue,
  type FrequencyUnit,
} from "./frequency";

export type RtlSdrOptionInput = {
  centerFrequencyText: string;
  centerFrequencyUnit: FrequencyUnit;
  sampleRateText: string;
  sampleRateUnit: FrequencyUnit;
  fftSizeText: string;
  gainText: string;
  ppmText: string;
};

export type RtlSdrOptionState = Required<RtlSdrSessionOptions>;

const parseFiniteInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getRtlSdrOptionState = (
  input: RtlSdrOptionInput,
): RtlSdrOptionState | null => {
  const centerFrequencyHz = parseFrequencyInputValue(
    input.centerFrequencyText,
    input.centerFrequencyUnit,
    0,
    30_000_000_000,
  );
  const sampleRateHz = parseFrequencyInputValue(
    input.sampleRateText,
    input.sampleRateUnit,
    1,
    MAX_SAMPLE_RATE_HZ,
  );
  const fftSize = parseFiniteInput(input.fftSizeText);
  const gainDb = parseFiniteInput(input.gainText);
  const ppm = parseFiniteInput(input.ppmText);

  if (
    centerFrequencyHz === null ||
    sampleRateHz === null ||
    fftSize === null ||
    gainDb === null ||
    ppm === null
  ) {
    return null;
  }

  return {
    centerFrequencyHz: Math.max(1, Math.floor(centerFrequencyHz)),
    sampleRateHz: normalizeSampleRateHz(sampleRateHz),
    fftSize: normalizeFftSize(fftSize),
    gainDb: normalizeGainDb(gainDb),
    ppm: normalizePpm(ppm),
  };
};

export const haveRtlSdrOptionsChanged = (
  current: RtlSdrOptionState | null,
  next: RtlSdrOptionState | null,
): boolean => {
  if (!current || !next) return true;
  return (
    current.centerFrequencyHz !== next.centerFrequencyHz ||
    current.sampleRateHz !== next.sampleRateHz ||
    current.fftSize !== next.fftSize ||
    current.gainDb !== next.gainDb ||
    current.ppm !== next.ppm
  );
};
