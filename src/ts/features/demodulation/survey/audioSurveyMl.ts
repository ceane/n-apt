const MODEL_VERSION = 1 as const;
const INPUT_SIZE = 6;
const HIDDEN_SIZE = 8;

export interface TimeDomainDemodModel {
  version: typeof MODEL_VERSION;
  inputSize: typeof INPUT_SIZE;
  hiddenSize: typeof HIDDEN_SIZE;
  pcmSampleRateHz: number;
  inputWeights: Float32Array;
  hiddenBias: Float32Array;
  outputWeights: Float32Array;
  outputBias: number;
  trainingExamples: number;
  trainingSamples: number;
  trainingEpochs: number;
  finalLoss: number;
  updatedAt: number;
}

export interface PairedAudioTrainingExample {
  iqData: Uint8Array;
  sampleRateHz: number;
  pcmSamples: Float32Array;
  pcmSampleRateHz: number;
}

export interface TimeDomainTrainingOptions {
  epochs?: number;
  maxTrainingSamples?: number;
  learningRate?: number;
  seed?: number;
  /** Epoch index for deterministic checkpointed training. */
  startEpoch?: number;
  /** Continue from a persisted checkpoint instead of random initialization. */
  initialModel?: TimeDomainDemodModel;
}

export interface TimeDomainPrediction {
  samples: Float32Array;
  sampleRateHz: number;
}

const normalizeIq = (value: number | undefined) =>
  ((value ?? 128) - 128) / 128;

const featuresAt = (
  iqData: Uint8Array,
  sampleRateHz: number,
  pcmSampleRateHz: number,
  pcmSampleIndex: number,
  pcmSampleCount: number,
): Float32Array => {
  const complexCount = Math.floor(iqData.length / 2);
  const currentIndex = Math.min(
    complexCount - 1,
    Math.max(0, Math.floor(((pcmSampleIndex + 0.5) * complexCount) / pcmSampleCount)),
  );
  const stride = Math.max(1, Math.round(sampleRateHz / pcmSampleRateHz));
  const previousIndex = Math.max(0, currentIndex - stride);
  const i = normalizeIq(iqData[currentIndex * 2]);
  const q = normalizeIq(iqData[currentIndex * 2 + 1]);
  const previousI = normalizeIq(iqData[previousIndex * 2]);
  const previousQ = normalizeIq(iqData[previousIndex * 2 + 1]);
  const magnitude = Math.hypot(i, q);
  const previousMagnitude = Math.hypot(previousI, previousQ);
  const dot = i * previousI + q * previousQ;
  const cross = q * previousI - i * previousQ;
  const phaseDelta = Math.atan2(cross, dot) / Math.PI;

  return Float32Array.of(
    i,
    q,
    magnitude,
    phaseDelta,
    previousMagnitude,
    magnitude - previousMagnitude,
  );
};

const createRandom = (seed: number) => {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const createInitialModel = (pcmSampleRateHz: number, seed: number) => {
  const random = createRandom(seed);
  const scale = Math.sqrt(2 / INPUT_SIZE);
  const inputWeights = new Float32Array(INPUT_SIZE * HIDDEN_SIZE);
  const outputWeights = new Float32Array(HIDDEN_SIZE);
  for (let index = 0; index < inputWeights.length; index++) {
    inputWeights[index] = (random() * 2 - 1) * scale;
  }
  for (let index = 0; index < outputWeights.length; index++) {
    outputWeights[index] = (random() * 2 - 1) * Math.sqrt(2 / HIDDEN_SIZE);
  }
  return {
    version: MODEL_VERSION,
    inputSize: INPUT_SIZE,
    hiddenSize: HIDDEN_SIZE,
    pcmSampleRateHz,
    inputWeights,
    hiddenBias: new Float32Array(HIDDEN_SIZE),
    outputWeights,
    outputBias: 0,
    trainingExamples: 0,
    trainingSamples: 0,
    trainingEpochs: 0,
    finalLoss: Number.POSITIVE_INFINITY,
    updatedAt: Date.now(),
  } satisfies TimeDomainDemodModel;
};

const predictFeatures = (
  model: TimeDomainDemodModel,
  features: Float32Array,
  hidden: Float32Array,
) => {
  for (let unit = 0; unit < HIDDEN_SIZE; unit++) {
    let activation = model.hiddenBias[unit];
    const weightOffset = unit * INPUT_SIZE;
    for (let feature = 0; feature < INPUT_SIZE; feature++) {
      activation += model.inputWeights[weightOffset + feature] * features[feature];
    }
    hidden[unit] = Math.tanh(activation);
  }
  let output = model.outputBias;
  for (let unit = 0; unit < HIDDEN_SIZE; unit++) {
    output += model.outputWeights[unit] * hidden[unit];
  }
  return Math.tanh(output);
};

/** Train a compact local time-domain model from aligned I/Q and PCM pairs. */
export const trainTimeDomainDemodModel = (
  examples: readonly PairedAudioTrainingExample[],
  options: TimeDomainTrainingOptions = {},
): TimeDomainDemodModel => {
  const usableExamples = examples.filter(
    (example) =>
      example.iqData.length >= 4 &&
      example.pcmSamples.length >= 8 &&
      Number.isFinite(example.sampleRateHz) &&
      example.sampleRateHz > 0 &&
      Number.isFinite(example.pcmSampleRateHz) &&
      example.pcmSampleRateHz > 0,
  );
  if (usableExamples.length === 0) {
    throw new Error("At least one aligned I/Q and PCM example is required");
  }
  const pcmSampleRateHz = usableExamples[0].pcmSampleRateHz;
  if (usableExamples.some((example) => example.pcmSampleRateHz !== pcmSampleRateHz)) {
    throw new Error("Training examples must use the same PCM sample rate");
  }

  const epochs = Math.max(1, Math.floor(options.epochs ?? 20));
  const maxTrainingSamples = Math.max(
    16,
    Math.floor(options.maxTrainingSamples ?? 4096),
  );
  const learningRate = Math.max(0.0001, Math.min(0.1, options.learningRate ?? 0.01));
  const model = options.initialModel
    ? {
        ...options.initialModel,
        inputWeights: options.initialModel.inputWeights.slice(),
        hiddenBias: options.initialModel.hiddenBias.slice(),
        outputWeights: options.initialModel.outputWeights.slice(),
      }
    : createInitialModel(pcmSampleRateHz, options.seed ?? 1337);
  if (model.pcmSampleRateHz !== pcmSampleRateHz) {
    throw new Error("Checkpoint PCM sample rate does not match training examples");
  }
  const startEpoch = Math.max(0, Math.floor(options.startEpoch ?? model.trainingEpochs));
  const hidden = new Float32Array(HIDDEN_SIZE);
  let totalSamples = 0;
  let finalLoss = 0;

  const sampledIndices = usableExamples.map((example) => {
    const stride = Math.max(
      1,
      Math.ceil(example.pcmSamples.length / maxTrainingSamples),
    );
    const indices: number[] = [];
    for (let index = 1; index < example.pcmSamples.length; index += stride) {
      indices.push(index);
    }
    return indices;
  });

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Each epoch has its own deterministic shuffle stream. That lets a saved
    // model resume between epochs and produce the same weights as one long run.
    const random = createRandom(
      (options.seed ?? 1337) + Math.imul(startEpoch + epoch, 0x9e3779b9),
    );
    let epochLoss = 0;
    let epochSamples = 0;
    for (let exampleIndex = 0; exampleIndex < usableExamples.length; exampleIndex++) {
      const example = usableExamples[exampleIndex];
      const indices = sampledIndices[exampleIndex].slice();
      for (let index = indices.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1));
        [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
      }

      for (const sampleIndex of indices) {
        const features = featuresAt(
          example.iqData,
          example.sampleRateHz,
          example.pcmSampleRateHz,
          sampleIndex,
          example.pcmSamples.length,
        );
        const prediction = predictFeatures(model, features, hidden);
        const error = prediction - example.pcmSamples[sampleIndex];
        epochLoss += error * error;
        epochSamples++;

        const outputGradient =
          2 * error * (1 - prediction * prediction) * learningRate;
        model.outputBias -= outputGradient;
        const hiddenGradients = new Float32Array(HIDDEN_SIZE);
        for (let unit = 0; unit < HIDDEN_SIZE; unit++) {
          const hiddenValue = hidden[unit];
          const gradient =
            outputGradient * model.outputWeights[unit] * (1 - hiddenValue * hiddenValue);
          hiddenGradients[unit] = gradient;
          model.outputWeights[unit] -= outputGradient * hiddenValue;
        }
        for (let unit = 0; unit < HIDDEN_SIZE; unit++) {
          const gradient = hiddenGradients[unit];
          model.hiddenBias[unit] -= gradient;
          const weightOffset = unit * INPUT_SIZE;
          for (let feature = 0; feature < INPUT_SIZE; feature++) {
            model.inputWeights[weightOffset + feature] -= gradient * features[feature];
          }
        }
      }
    }
    finalLoss = epochSamples > 0 ? epochLoss / epochSamples : 0;
    totalSamples = epochSamples;
  }

  model.trainingExamples = usableExamples.length;
  model.trainingSamples = totalSamples;
  model.trainingEpochs = startEpoch + epochs;
  model.finalLoss = finalLoss;
  model.updatedAt = Date.now();
  return model;
};

/** Run local waveform inference directly over time-domain I/Q samples. */
export const predictTimeDomainAudio = (
  model: TimeDomainDemodModel,
  input: {
    iqData: Uint8Array;
    sampleRateHz: number;
    pcmSampleRateHz?: number;
    outputSampleCount?: number;
  },
): TimeDomainPrediction => {
  if (model.version !== MODEL_VERSION || model.inputSize !== INPUT_SIZE) {
    throw new Error("Unsupported time-domain demodulation model version");
  }
  const pcmSampleRateHz = input.pcmSampleRateHz ?? model.pcmSampleRateHz;
  if (!Number.isFinite(input.sampleRateHz) || input.sampleRateHz <= 0) {
    throw new Error("I/Q sample rate must be a positive finite value");
  }
  const complexCount = Math.floor(input.iqData.length / 2);
  const outputSampleCount = Math.max(
    0,
    Math.floor(
      input.outputSampleCount ??
        (complexCount * pcmSampleRateHz) / input.sampleRateHz,
    ),
  );
  const samples = new Float32Array(outputSampleCount);
  const hidden = new Float32Array(HIDDEN_SIZE);
  for (let index = 0; index < outputSampleCount; index++) {
    const features = featuresAt(
      input.iqData,
      input.sampleRateHz,
      pcmSampleRateHz,
      index,
      outputSampleCount,
    );
    samples[index] = predictFeatures(model, features, hidden);
  }
  return { samples, sampleRateHz: pcmSampleRateHz };
};
