export type EncodedAudioFormat = "wav";

export interface PcmAudioFileInput {
  samples: Float32Array;
  sampleRateHz: number;
  channels?: number;
}

export interface EncodedAudioFile {
  bytes: Uint8Array;
  blob: Blob;
  mimeType: "audio/wav";
  extension: "wav";
  sampleRateHz: number;
  channels: number;
  frames: number;
}

const WAV_HEADER_BYTES = 44;
const PCM16_MAX = 0x7fff;
const PCM16_MIN = -0x8000;

const validatePcmInput = ({
  samples,
  sampleRateHz,
  channels = 1,
}: PcmAudioFileInput): number => {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error("Audio export requires at least one PCM sample");
  }
  if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error("Audio export sample rate must be a positive integer");
  }
  if (!Number.isInteger(channels) || channels <= 0 || channels > 0xffff) {
    throw new Error("Audio export channel count is invalid");
  }
  if (samples.length % channels !== 0) {
    throw new Error("Interleaved PCM sample count must be divisible by channels");
  }
  return channels;
};

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

/**
 * Encode interleaved normalized Float32 PCM as a conventional 16-bit PCM WAV.
 *
 * Demodulators and ML models can feed their PCM output directly into this
 * helper. WAV is intentionally the baseline format because it is deterministic,
 * lossless, requires no codec dependency, and is decodable by Web Audio.
 */
export const encodePcm16Wav = (
  input: PcmAudioFileInput,
): EncodedAudioFile => {
  const channels = validatePcmInput(input);
  const { samples, sampleRateHz } = input;
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (const sample of samples) {
    const finiteSample = Number.isFinite(sample) ? sample : 0;
    const clamped = Math.max(-1, Math.min(1, finiteSample));
    const pcm16 =
      clamped < 0
        ? Math.round(clamped * -PCM16_MIN)
        : Math.round(clamped * PCM16_MAX);
    view.setInt16(offset, pcm16, true);
    offset += 2;
  }

  return {
    bytes,
    blob: new Blob([bytes], { type: "audio/wav" }),
    mimeType: "audio/wav",
    extension: "wav",
    sampleRateHz,
    channels,
    frames: samples.length / channels,
  };
};

export const encodeDemodAudioFile = (
  input: PcmAudioFileInput,
  format: EncodedAudioFormat = "wav",
): EncodedAudioFile => {
  if (format !== "wav") {
    throw new Error(`Unsupported audio export format: ${format}`);
  }
  return encodePcm16Wav(input);
};

/** Decode an encoded audio file for playback through Web Audio. */
export const decodeEncodedAudioForWebAudio = async (
  audioContext: Pick<BaseAudioContext, "decodeAudioData">,
  file: Blob | ArrayBuffer,
): Promise<AudioBuffer> => {
  const encoded =
    file instanceof Blob ? await file.arrayBuffer() : file.slice(0);
  return audioContext.decodeAudioData(encoded);
};

/**
 * Trigger a browser file save for an encoded audio artifact.
 * Call this from a user gesture (for example, an Export Audio button).
 */
export const downloadEncodedAudioFile = (
  file: EncodedAudioFile,
  filename = `demodulated.${file.extension}`,
): void => {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
};
