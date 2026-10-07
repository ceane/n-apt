import {
  TIME_DOMAIN_HIDDEN_SIZE,
  TIME_DOMAIN_MODEL_INPUT_SIZE,
  TIME_DOMAIN_MODEL_VERSION,
  type TimeDomainDemodModel,
} from "@n-apt/demodulation/survey/audioSurveyMl";
import type { AudioSurveyTrainingState } from "@n-apt/demodulation/survey/audioSurveyTraining";

const MODEL_FORMAT = "napt-audio-demod-onnx";
const MODEL_ARCHITECTURE = "tanh-mlp-192x12x1-v4";
const MODEL_INPUT_NAME = "iq_fourier_windows";
const MODEL_OUTPUT_NAME = "pcm";
const MODEL_WEIGHT_COUNT =
  TIME_DOMAIN_MODEL_INPUT_SIZE * TIME_DOMAIN_HIDDEN_SIZE +
  TIME_DOMAIN_HIDDEN_SIZE * 2 +
  1;
const MAX_ONNX_BYTES = 64_000_000;

export interface AudioSurveyPythonArtifactFiles {
  onnx: File;
  manifest: File;
  weights: File;
}

export interface LoadedAudioSurveyPythonArtifact {
  model: TimeDomainDemodModel;
  modelData: Uint8Array;
  training: AudioSurveyTrainingState;
  modelSha256: string;
  datasetSha256: string;
}

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
};

const finitePositive = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
};

const nonnegativeNumber = (value: unknown, name: string): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative finite number`);
  }
  return value;
};

const integer = (value: unknown, name: string): number => {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return value;
};

const sha256Hex = async (data: Uint8Array): Promise<string> => {
  const input = new ArrayBuffer(data.byteLength);
  new Uint8Array(input).set(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
};

const readFile = async (file: File, maximumBytes: number): Promise<Uint8Array> => {
  if (file.size <= 0 || file.size > maximumBytes) {
    throw new Error(`${file.name} is empty or exceeds the supported file size`);
  }
  return new Uint8Array(await file.arrayBuffer());
};

const parseManifest = async (file: File): Promise<Record<string, unknown>> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("The Python ONNX manifest is not valid JSON");
  }
  return record(parsed, "Python ONNX manifest");
};

const validateTrainingState = (
  value: unknown,
  jobId: string,
): AudioSurveyTrainingState => {
  const training = record(value, "Training report summary");
  if (training.status !== "completed" || typeof training.modelPreferred !== "boolean") {
    throw new Error("The Python model has no completed held-out evaluation result");
  }
  const epoch = integer(training.epoch, "Training epoch");
  const totalEpochs = integer(training.totalEpochs, "Total training epochs");
  const trainingPairCount = integer(training.trainingPairCount, "Training pair count");
  const validationPairCount = integer(training.validationPairCount, "Validation pair count");
  const testPairCount = integer(training.testPairCount, "Test pair count");
  if (trainingPairCount < 1 || validationPairCount < 1 || testPairCount < 1) {
    throw new Error("The Python model must have independent train, validation, and test pairs");
  }
  const holdoutPairCount = integer(training.holdoutPairCount, "Holdout pair count");
  if (totalEpochs < epoch || holdoutPairCount !== validationPairCount + testPairCount) {
    throw new Error("Python model training counts are inconsistent");
  }
  return {
    jobId,
    status: "completed",
    epoch,
    totalEpochs,
    trainingPairCount,
    holdoutPairCount,
    validationPairCount,
    testPairCount,
    validationRmse: nonnegativeNumber(training.validationRmse, "Validation RMSE"),
    modelRmse: nonnegativeNumber(training.modelRmse, "Test model RMSE"),
    dspRmse: nonnegativeNumber(training.dspRmse, "Test DSP RMSE"),
    modelPreferred: training.modelPreferred,
  };
};

/** Validate a Python export and rebuild weights for the existing local runtime. */
export const loadAudioSurveyPythonArtifact = async (
  files: AudioSurveyPythonArtifactFiles,
  jobId: string,
): Promise<LoadedAudioSurveyPythonArtifact> => {
  const manifest = await parseManifest(files.manifest);
  if (
    manifest.format !== MODEL_FORMAT ||
    manifest.version !== 1 ||
    manifest.modelVersion !== TIME_DOMAIN_MODEL_VERSION ||
    manifest.architecture !== MODEL_ARCHITECTURE
  ) {
    throw new Error("Unsupported Python audio-demod model format or architecture");
  }
  if (manifest.modelFile !== files.onnx.name || manifest.weightsFile !== files.weights.name) {
    throw new Error("Selected ONNX and weight files do not match the manifest filenames");
  }
  const input = record(manifest.input, "Model input contract");
  const output = record(manifest.output, "Model output contract");
  if (
    input.name !== MODEL_INPUT_NAME ||
    JSON.stringify(input.shape) !== JSON.stringify(["batch", TIME_DOMAIN_MODEL_INPUT_SIZE]) ||
    input.preprocessing !== "audio-survey-v4-iq-plus-hann-fourier" ||
    output.name !== MODEL_OUTPUT_NAME ||
    JSON.stringify(output.shape) !== JSON.stringify(["batch", 1])
  ) {
    throw new Error("Python model input/output contract is incompatible with the live demodulator");
  }

  const profile = record(manifest.profile, "Model RF profile");
  const inputSampleRateHz = finitePositive(profile.iqSampleRateHz, "I/Q sample rate");
  const channelBandwidthHz = finitePositive(profile.bandwidthHz, "Channel width");
  const pcmSampleRateHz = finitePositive(profile.pcmSampleRateHz, "PCM sample rate");
  if (output.sampleRateHz !== pcmSampleRateHz) {
    throw new Error("Python model PCM rate does not match its RF profile");
  }
  const modelSha256 = manifest.modelSha256;
  const weightsSha256 = manifest.weightsSha256;
  if (
    typeof modelSha256 !== "string" ||
    !/^[\da-f]{64}$/i.test(modelSha256) ||
    typeof weightsSha256 !== "string" ||
    !/^[\da-f]{64}$/i.test(weightsSha256)
  ) {
    throw new Error("Python model manifest has invalid file checksums");
  }
  const modelData = await readFile(files.onnx, MAX_ONNX_BYTES);
  const weightData = await readFile(files.weights, MODEL_WEIGHT_COUNT * 4);
  if (
    (await sha256Hex(modelData)) !== modelSha256 ||
    (await sha256Hex(weightData)) !== weightsSha256
  ) {
    throw new Error("Python ONNX or weight checksum does not match the manifest");
  }
  if (
    manifest.weightsFloatCount !== MODEL_WEIGHT_COUNT ||
    weightData.byteLength !== MODEL_WEIGHT_COUNT * Float32Array.BYTES_PER_ELEMENT
  ) {
    throw new Error("Python model weights do not match the v4 architecture");
  }
  if (
    JSON.stringify(manifest.weightsLayout) !==
    JSON.stringify(["inputWeights[12,192]", "hiddenBias[12]", "outputWeights[12]", "outputBias[1]"]) ||
    manifest.experimental !== true
  ) {
    throw new Error("Python model weights or promotion metadata are not supported");
  }
  const weights = new Float32Array(MODEL_WEIGHT_COUNT);
  const weightView = new DataView(weightData.buffer, weightData.byteOffset, weightData.byteLength);
  for (let index = 0; index < weights.length; index++) {
    weights[index] = weightView.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
  }
  if (!weights.every(Number.isFinite)) {
    throw new Error("Python model contains non-finite weights");
  }

  const inputWeightCount = TIME_DOMAIN_MODEL_INPUT_SIZE * TIME_DOMAIN_HIDDEN_SIZE;
  const hiddenBiasStart = inputWeightCount;
  const outputWeightStart = hiddenBiasStart + TIME_DOMAIN_HIDDEN_SIZE;
  const outputBiasIndex = outputWeightStart + TIME_DOMAIN_HIDDEN_SIZE;
  const training = validateTrainingState(manifest.training, jobId);
  if (manifest.modelPreferredOnTest !== training.modelPreferred) {
    throw new Error("Python model promotion flag does not match its held-out evaluation");
  }
  const sourcePairIds = manifest.sourcePairIds;
  if (
    !Array.isArray(sourcePairIds) ||
    sourcePairIds.length <
      training.trainingPairCount +
        (training.validationPairCount ?? 0) +
        (training.testPairCount ?? 0) ||
    new Set(sourcePairIds).size !== sourcePairIds.length ||
    sourcePairIds.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new Error("Python model manifest has an incomplete source-pair inventory");
  }

  const createdAt = Date.parse(String(manifest.createdAt ?? ""));
  const model: TimeDomainDemodModel = {
    version: TIME_DOMAIN_MODEL_VERSION,
    inputSize: TIME_DOMAIN_MODEL_INPUT_SIZE,
    hiddenSize: TIME_DOMAIN_HIDDEN_SIZE,
    inputSampleRateHz,
    channelBandwidthHz,
    pcmSampleRateHz,
    inputWeights: weights.slice(0, inputWeightCount),
    hiddenBias: weights.slice(hiddenBiasStart, outputWeightStart),
    outputWeights: weights.slice(outputWeightStart, outputBiasIndex),
    outputBias: weights[outputBiasIndex],
    trainingExamples: sourcePairIds.length,
    trainingSamples: integer(manifest.trainingSamples, "Training sample count"),
    trainingEpochs: training.epoch,
    finalLoss: (training.validationRmse ?? 0) ** 2,
    updatedAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
  const datasetSha256 = manifest.datasetSha256;
  if (typeof datasetSha256 !== "string" || !/^[\da-f]{64}$/i.test(datasetSha256)) {
    throw new Error("Python model manifest has an invalid dataset digest");
  }
  return { model, modelData, training, modelSha256, datasetSha256 };
};
