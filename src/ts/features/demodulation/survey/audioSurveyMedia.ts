/** Minimal Web Audio AudioBuffer surface used by the conversion helper. */
export interface DecodedAudioBufferLike {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export const AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ = 48_000;

/** Mix decoded channels to mono and linearly resample them to the model rate. */
export const resampleDecodedAudioToMonoPcm = (
  buffer: DecodedAudioBufferLike,
  targetSampleRateHz = AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ,
): Float32Array => {
  if (
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate <= 0 ||
    !Number.isFinite(targetSampleRateHz) ||
    targetSampleRateHz <= 0 ||
    !Number.isInteger(buffer.length) ||
    buffer.length <= 0 ||
    !Number.isInteger(buffer.numberOfChannels) ||
    buffer.numberOfChannels <= 0
  ) {
    throw new Error("Decoded media audio has invalid sample metadata");
  }

  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, index) => {
      const samples = buffer.getChannelData(index);
      if (samples.length !== buffer.length) {
        throw new Error("Decoded media audio channel lengths do not match");
      }
      return samples;
    },
  );
  const outputLength = Math.max(
    1,
    Math.round((buffer.length * targetSampleRateHz) / buffer.sampleRate),
  );
  const output = new Float32Array(outputLength);
  const sourceStep = buffer.sampleRate / targetSampleRateHz;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
    const sourcePosition = Math.min(
      buffer.length - 1,
      outputIndex * sourceStep,
    );
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(buffer.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    let mono = 0;
    for (const channel of channels) {
      const left = Number.isFinite(channel[leftIndex]) ? channel[leftIndex] : 0;
      const right = Number.isFinite(channel[rightIndex])
        ? channel[rightIndex]
        : 0;
      mono += left + (right - left) * fraction;
    }
    output[outputIndex] = mono / channels.length;
  }

  return output;
};
