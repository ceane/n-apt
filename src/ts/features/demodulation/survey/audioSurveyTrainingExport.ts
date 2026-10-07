import {
  audioSurveyRepository,
  type AudioSurveyArtifact,
  type AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import { TIME_DOMAIN_MODEL_VERSION } from "@n-apt/demodulation/survey/audioSurveyMl";

export const AUDIO_SURVEY_TRAINING_ARCHIVE_MAX_BYTES = 256_000_000;
export const AUDIO_SURVEY_TRAINING_ARCHIVE_FORMAT =
  "napt-audio-demod-training-tar";
export const AUDIO_SURVEY_TRAINING_ARCHIVE_VERSION = 1;

type BaselineName = "am" | "fm" | "apt";

interface ReferencePairPayload {
  aligned?: boolean;
  captureId?: string;
  channelId?: string;
  centerFrequencyHz?: number;
  bandwidthHz?: number;
  iqData?: Uint8Array;
  iqSampleRateHz?: number;
  pcmData?: Float32Array;
  pcmSampleRateHz?: number;
  baselineAlgorithm?: BaselineName;
  baselinePcmData?: Float32Array;
  baselinePcmDataByAlgorithm?: Partial<Record<BaselineName, Float32Array>>;
  referenceStartedAtMs?: number;
  iqStartedAtMs?: number;
  iqEndedAtMs?: number;
  alignmentMethod?: string;
  alignmentErrorMs?: number;
  audioSignalLabel?: "coherent" | "static";
  labels?: string[];
}

interface TarEntry {
  path: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

const toLittleEndianFloatBytes = (values: Float32Array): Uint8Array => {
  const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index++) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, values[index], true);
  }
  return bytes;
};

const digestHex = async (bytes: Uint8Array): Promise<string> => {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
};

const writeOctal = (header: Uint8Array, offset: number, length: number, value: number) => {
  const encoded = Math.floor(value).toString(8).padStart(length - 1, "0");
  header.set(encoder.encode(`${encoded}\0`), offset);
};

const makeTarHeader = (path: string, size: number, modifiedAt: number) => {
  const header = new Uint8Array(512);
  header.set(encoder.encode(path), 0);
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(modifiedAt / 1_000));
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.set(encoder.encode("ustar\0"), 257);
  header.set(encoder.encode("00"), 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.set(encoder.encode(`${checksumText}\0 `), 148);
  return header;
};

const appendTarEntry = (parts: BlobPart[], entry: TarEntry, modifiedAt: number) => {
  const header = makeTarHeader(entry.path, entry.data.byteLength, modifiedAt);
  parts.push(header.buffer as ArrayBuffer, entry.data.buffer.slice(
    entry.data.byteOffset,
    entry.data.byteOffset + entry.data.byteLength,
  ) as ArrayBuffer);
  const remainder = entry.data.byteLength % 512;
  if (remainder > 0) parts.push(new Uint8Array(512 - remainder).buffer);
};

const isFloatArray = (value: unknown): value is Float32Array =>
  value instanceof Float32Array && value.length > 0;

const isByteArray = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.length >= 4 && value.length % 2 === 0;

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const getReferencePairs = (artifacts: readonly AudioSurveyArtifact[]) =>
  artifacts
    .filter((artifact) => artifact.kind === "reference-pair")
    .map((artifact) => ({
      artifact,
      payload: artifact.payload as ReferencePairPayload,
    }))
    .filter(
      ({ payload }) =>
        payload.aligned === true &&
        isByteArray(payload.iqData) &&
        isFloatArray(payload.pcmData) &&
        isFinitePositive(payload.iqSampleRateHz) &&
        isFinitePositive(payload.pcmSampleRateHz) &&
        isFinitePositive(payload.bandwidthHz) &&
        isFinitePositive(payload.centerFrequencyHz) &&
        typeof payload.channelId === "string" &&
        payload.channelId.length > 0,
    )
    .sort(
      (left, right) =>
        left.artifact.jobId.localeCompare(right.artifact.jobId) ||
        left.artifact.createdAt - right.artifact.createdAt ||
        left.artifact.id.localeCompare(right.artifact.id),
    );

export interface AudioSurveyTrainingArchive {
  blob: Blob;
  fileName: string;
  pairCount: number;
  sessionCount: number;
  sizeBytes: number;
}

/** Package the current survey's aligned I/Q, reference PCM, and DSP baselines. */
export const createAudioSurveyTrainingArchive = async (
  jobId: string,
  repository: AudioSurveyRepository = audioSurveyRepository,
  now = Date.now(),
): Promise<AudioSurveyTrainingArchive> => {
  const artifacts = await repository.listArtifacts(jobId);
  const pairs = getReferencePairs(artifacts);
  if (pairs.length === 0) {
    throw new Error("This survey has no timestamp-aligned reference pairs to export");
  }

  const estimatedBytes = pairs.reduce((total, { payload }) => {
    const baselines = payload.baselinePcmDataByAlgorithm;
    const baselineBytes = baselines
      ? Object.values(baselines).reduce(
          (sum, value) => sum + (isFloatArray(value) ? value.byteLength : 0),
          0,
        )
      : isFloatArray(payload.baselinePcmData)
        ? payload.baselinePcmData.byteLength
        : 0;
    return (
      total +
      (payload.iqData?.byteLength ?? 0) +
      (payload.pcmData?.byteLength ?? 0) +
      baselineBytes
    );
  }, 0);
  if (estimatedBytes > AUDIO_SURVEY_TRAINING_ARCHIVE_MAX_BYTES) {
    throw new Error(
      `This survey's paired data is ${Math.ceil(estimatedBytes / 1_000_000)} MB; export one smaller survey at a time (limit ${Math.floor(AUDIO_SURVEY_TRAINING_ARCHIVE_MAX_BYTES / 1_000_000)} MB)`,
    );
  }

  const entries: TarEntry[] = [];
  const examples = [];
  for (let index = 0; index < pairs.length; index++) {
    const { artifact, payload } = pairs[index];
    const prefix = `pairs/${index.toString().padStart(6, "0")}`;
    const iqData = payload.iqData!;
    const pcmBytes = toLittleEndianFloatBytes(payload.pcmData!);
    const iqPath = `${prefix}/iq.u8`;
    const pcmPath = `${prefix}/reference.f32le`;
    entries.push({ path: iqPath, data: iqData }, { path: pcmPath, data: pcmBytes });

    const baselines: Partial<Record<BaselineName, Record<string, unknown>>> = {};
    const namedBaselines = payload.baselinePcmDataByAlgorithm;
    const hasNamedBaseline =
      namedBaselines && Object.values(namedBaselines).some(isFloatArray);
    const sourceBaselines = hasNamedBaseline
      ? namedBaselines
      : payload.baselineAlgorithm && isFloatArray(payload.baselinePcmData)
        ? { [payload.baselineAlgorithm]: payload.baselinePcmData }
        : {};
    for (const name of ["am", "fm", "apt"] as const) {
      const values = sourceBaselines[name];
      if (!isFloatArray(values)) continue;
      const path = `${prefix}/baseline-${name}.f32le`;
      const data = toLittleEndianFloatBytes(values);
      entries.push({ path, data });
      baselines[name] = {
        path,
        encoding: "float32-le",
        sampleCount: values.length,
        byteLength: data.byteLength,
        sha256: await digestHex(data),
      };
    }
    examples.push({
      artifactId: artifact.id,
      captureId: payload.captureId ?? artifact.id,
      sessionId: artifact.jobId,
      channelId: payload.channelId,
      centerFrequencyHz: payload.centerFrequencyHz,
      bandwidthHz: payload.bandwidthHz,
      iq: {
        path: iqPath,
        encoding: "u8-interleaved",
        complexSampleCount: iqData.length / 2,
        byteLength: iqData.byteLength,
        sampleRateHz: payload.iqSampleRateHz,
        sha256: await digestHex(iqData),
      },
      reference: {
        path: pcmPath,
        encoding: "float32-le",
        sampleCount: payload.pcmData!.length,
        byteLength: pcmBytes.byteLength,
        sampleRateHz: payload.pcmSampleRateHz,
        sha256: await digestHex(pcmBytes),
      },
      baselines,
      alignment: {
        method: payload.alignmentMethod ?? "shared-wall-clock-frame-timestamps",
        errorMs: payload.alignmentErrorMs ?? null,
        referenceStartedAtMs: payload.referenceStartedAtMs ?? null,
        iqStartedAtMs: payload.iqStartedAtMs ?? null,
        iqEndedAtMs: payload.iqEndedAtMs ?? null,
      },
      ...(payload.audioSignalLabel
        ? { audioSignalLabel: payload.audioSignalLabel }
        : {}),
      ...(payload.labels?.length ? { labels: [...payload.labels] } : {}),
    });
  }

  const sessionIds = [...new Set(examples.map((example) => example.sessionId))].sort();
  const manifest = {
    format: AUDIO_SURVEY_TRAINING_ARCHIVE_FORMAT,
    version: AUDIO_SURVEY_TRAINING_ARCHIVE_VERSION,
    createdAt: new Date(now).toISOString(),
    modelContract: {
      version: TIME_DOMAIN_MODEL_VERSION,
      inputName: "iq_fourier_windows",
      outputName: "pcm",
      inputShape: ["batch", 192],
      outputShape: ["batch", 1],
      architecture: "64-complex-iq-plus-64-fourier-features-to-pcm",
    },
    preprocessing: {
      iqEncoding: "u8-interleaved",
      iqNormalization: "(value-128)/128",
      iqContext: "64-complex-samples-oldest-first-zero-padded-on-left",
      fourier: "64-point-hann-symmetric-fftshift-log-power",
      fourierNormalization: "(binDb-maxDb)/50-clamped-to[-1,0]-with-50dB-floor",
      pcmEncoding: "float32-le",
      samplePairing: "current-iq-index=floor(((pcmIndex+0.5)*iqCount)/pcmCount)",
    },
    sessionIds,
    exampleCount: examples.length,
    examples,
  };
  const splitTemplate = {
    format: "napt-audio-demod-session-splits",
    version: 1,
    sessionSplits: Object.fromEntries(sessionIds.map((sessionId) => [sessionId, "assign-train-validation-or-test"])),
  };
  const metadataEntries: TarEntry[] = [
    { path: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)) },
    { path: "session-splits.template.json", data: encoder.encode(JSON.stringify(splitTemplate, null, 2)) },
  ];
  const parts: BlobPart[] = [];
  for (const entry of [...metadataEntries, ...entries]) {
    appendTarEntry(parts, entry, now);
  }
  parts.push(new Uint8Array(1_024).buffer);
  const blob = new Blob(parts, { type: "application/x-tar" });
  if (blob.size > AUDIO_SURVEY_TRAINING_ARCHIVE_MAX_BYTES) {
    throw new Error("The generated training archive exceeds the 256 MB export limit");
  }
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return {
    blob,
    fileName: `napt-audio-demod-${stamp}.tar`,
    pairCount: examples.length,
    sessionCount: sessionIds.length,
    sizeBytes: blob.size,
  };
};

/** Download one survey archive for local, offline Python training. */
export const downloadAudioSurveyTrainingArchive = async (
  jobId: string,
  repository: AudioSurveyRepository = audioSurveyRepository,
): Promise<Omit<AudioSurveyTrainingArchive, "blob">> => {
  const archive = await createAudioSurveyTrainingArchive(jobId, repository);
  const url = URL.createObjectURL(archive.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = archive.fileName;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return {
    fileName: archive.fileName,
    pairCount: archive.pairCount,
    sessionCount: archive.sessionCount,
    sizeBytes: archive.sizeBytes,
  };
};
