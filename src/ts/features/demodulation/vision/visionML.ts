import {
  VISION_HEIGHT,
  VISION_PREPROCESSING,
  VISION_WIDTH,
  sameVisionFrequencyGrid,
  visionFrequencyGridSchema,
  visionDecodedFrameSchema,
  visionModelHeadOutputSchema,
  type VisionFrequencyGrid,
  type VisionSplit,
} from "./visionModel";
import {
  fitVisionNormalization,
  type VisionTrainingExample,
} from "./visionDataset";
import { opponentToRgb } from "./visionReference";
import { VISION_FEATURE_COUNT } from "./visionPreprocessing";

export const VISION_DECODER_MODEL_VERSION = 2 as const;
export const VISION_DECODER_ARCHITECTURE = "freq-conv-temporal-v2" as const;
export const VISION_FREQUENCY_BANDS = 64;
export const VISION_BINS_PER_BAND =
  VISION_PREPROCESSING.fftSize / VISION_FREQUENCY_BANDS;
export const VISION_CONV_CHANNELS = 4;
export const VISION_CONV_KERNEL = 5;
export const VISION_POOLED_FREQUENCY_BANDS = 8;
export const VISION_TEMPORAL_HIDDEN_SIZE = 24;
export const VISION_COLOR_CLASS_COUNT = 4;
export const VISION_COLOR_LOSS_WEIGHT = 0.2;

const featureChannels = 2;
const timeSlices = VISION_PREPROCESSING.temporalSlices;
const pooledFeatureCount =
  VISION_CONV_CHANNELS * timeSlices * VISION_POOLED_FREQUENCY_BANDS;
const imageSize = VISION_WIDTH * VISION_HEIGHT * 3;

export interface VisionDecoderModel {
  version: typeof VISION_DECODER_MODEL_VERSION;
  architecture: typeof VISION_DECODER_ARCHITECTURE;
  frequencyGrid: VisionFrequencyGrid;
  modelId: string;
  seed: number;
  inputSize: typeof VISION_FEATURE_COUNT;
  inputMean: Float32Array;
  inputScale: Float32Array;
  /** [output channel, input channel, kernel offset]. */
  convWeights: Float32Array;
  convBias: Float32Array;
  /** [hidden unit, pooled frequency/time feature]. */
  temporalWeights: Float32Array;
  temporalBias: Float32Array;
  /** [row-major opponent output, hidden unit]. */
  opponentWeights: Float32Array;
  opponentBias: Float32Array;
  /** [S/M/L/Red class, hidden unit]. */
  colorWeights: Float32Array;
  colorBias: Float32Array;
  trainingExamples: number;
  trainingSamples: number;
  trainingEpochs: number;
  finalLoss: number;
  updatedAt: number;
}

export interface VisionDecoderTrainingOptions {
  epochs?: number;
  learningRate?: number;
  seed?: number;
  sessionSplits: Readonly<Record<string, VisionSplit>>;
  initialModel?: VisionDecoderModel;
  now?: () => number;
}

export interface VisionDecoderTrainingMetrics {
  exampleCount: number;
  epochCount: number;
  imageMse: number;
  colorCrossEntropy: number;
  combinedLoss: number;
}

export interface VisionDecoderTrainingResult {
  model: VisionDecoderModel;
  metrics: VisionDecoderTrainingMetrics;
}

export interface VisionDecoderPrediction {
  frame: ReturnType<typeof visionDecodedFrameSchema.parse>;
  opponent: Float32Array;
  colorLogits: Float32Array;
}

const createRandom = (seed: number) => {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const createInitialModel = (
  seed: number,
  now: () => number,
  frequencyGrid: VisionFrequencyGrid,
) => {
  const random = createRandom(seed);
  const convWeights = new Float32Array(
    VISION_CONV_CHANNELS * featureChannels * VISION_CONV_KERNEL,
  );
  const temporalWeights = new Float32Array(
    VISION_TEMPORAL_HIDDEN_SIZE * pooledFeatureCount,
  );
  const opponentWeights = new Float32Array(
    imageSize * VISION_TEMPORAL_HIDDEN_SIZE,
  );
  const colorWeights = new Float32Array(
    VISION_COLOR_CLASS_COUNT * VISION_TEMPORAL_HIDDEN_SIZE,
  );
  const fillUniform = (values: Float32Array, scale: number) => {
    for (let index = 0; index < values.length; index++)
      values[index] = (random() * 2 - 1) * scale;
  };
  fillUniform(
    convWeights,
    Math.sqrt(2 / (featureChannels * VISION_CONV_KERNEL)),
  );
  fillUniform(temporalWeights, Math.sqrt(2 / pooledFeatureCount));
  fillUniform(opponentWeights, Math.sqrt(1 / VISION_TEMPORAL_HIDDEN_SIZE));
  fillUniform(colorWeights, Math.sqrt(1 / VISION_TEMPORAL_HIDDEN_SIZE));
  return {
    version: VISION_DECODER_MODEL_VERSION,
    architecture: VISION_DECODER_ARCHITECTURE,
    frequencyGrid: { ...frequencyGrid },
    modelId: `vision-decoder-v2-${seed >>> 0}`,
    seed: seed >>> 0,
    inputSize: VISION_FEATURE_COUNT,
    inputMean: new Float32Array(VISION_FEATURE_COUNT),
    inputScale: new Float32Array(VISION_FEATURE_COUNT).fill(1),
    convWeights,
    convBias: new Float32Array(VISION_CONV_CHANNELS),
    temporalWeights,
    temporalBias: new Float32Array(VISION_TEMPORAL_HIDDEN_SIZE),
    opponentWeights,
    opponentBias: new Float32Array(imageSize),
    colorWeights,
    colorBias: new Float32Array(VISION_COLOR_CLASS_COUNT),
    trainingExamples: 0,
    trainingSamples: 0,
    trainingEpochs: 0,
    finalLoss: Number.POSITIVE_INFINITY,
    updatedAt: now(),
  } satisfies VisionDecoderModel;
};

export const validateVisionDecoderModel = (model: VisionDecoderModel) => {
  if (
    model.version !== VISION_DECODER_MODEL_VERSION ||
    model.architecture !== VISION_DECODER_ARCHITECTURE ||
    model.inputSize !== VISION_FEATURE_COUNT ||
    model.inputMean.length !== VISION_FEATURE_COUNT ||
    model.inputScale.length !== VISION_FEATURE_COUNT ||
    model.convWeights.length !==
      VISION_CONV_CHANNELS * featureChannels * VISION_CONV_KERNEL ||
    model.convBias.length !== VISION_CONV_CHANNELS ||
    model.temporalWeights.length !==
      VISION_TEMPORAL_HIDDEN_SIZE * pooledFeatureCount ||
    model.temporalBias.length !== VISION_TEMPORAL_HIDDEN_SIZE ||
    model.opponentWeights.length !== imageSize * VISION_TEMPORAL_HIDDEN_SIZE ||
    model.opponentBias.length !== imageSize ||
    model.colorWeights.length !==
      VISION_COLOR_CLASS_COUNT * VISION_TEMPORAL_HIDDEN_SIZE ||
    model.colorBias.length !== VISION_COLOR_CLASS_COUNT
  )
    throw new Error("Vision checkpoint architecture is incompatible");
  visionFrequencyGridSchema.parse(model.frequencyGrid);
  for (const tensor of [
    model.inputMean,
    model.inputScale,
    model.convWeights,
    model.convBias,
    model.temporalWeights,
    model.temporalBias,
    model.opponentWeights,
    model.opponentBias,
    model.colorWeights,
    model.colorBias,
  ])
    if (!tensor.every(Number.isFinite))
      throw new Error("Vision checkpoint contains non-finite values");
  if (model.inputScale.some((value) => value <= 0))
    throw new Error("Vision checkpoint normalization scale is invalid");
};

interface ForwardCache {
  downsampled: Float32Array;
  convolved: Float32Array;
  pooled: Float32Array;
  hidden: Float32Array;
  opponent: Float32Array;
  colorLogits: Float32Array;
}

const featureIndex = (slice: number, bin: number, channel: number) =>
  (slice * VISION_PREPROCESSING.fftSize + bin) * featureChannels + channel;
const convIndex = (channel: number, slice: number, bin: number) =>
  (channel * timeSlices + slice) * VISION_FREQUENCY_BANDS + bin;
const pooledIndex = (channel: number, slice: number, band: number) =>
  (channel * timeSlices + slice) * VISION_POOLED_FREQUENCY_BANDS + band;

const forward = (
  model: VisionDecoderModel,
  features: Float32Array,
): ForwardCache => {
  if (
    !(features instanceof Float32Array) ||
    features.length !== VISION_FEATURE_COUNT ||
    !features.every(Number.isFinite)
  )
    throw new Error("Vision decoder requires a finite feature tensor");
  const downsampled = new Float32Array(
    timeSlices * VISION_FREQUENCY_BANDS * featureChannels,
  );
  for (let slice = 0; slice < timeSlices; slice++)
    for (let band = 0; band < VISION_FREQUENCY_BANDS; band++)
      for (let channel = 0; channel < featureChannels; channel++) {
        let sum = 0;
        for (let offset = 0; offset < VISION_BINS_PER_BAND; offset++) {
          const bin = band * VISION_BINS_PER_BAND + offset;
          const feature = featureIndex(slice, bin, channel);
          sum +=
            (features[feature] - model.inputMean[feature]) /
            model.inputScale[feature];
        }
        downsampled[
          (slice * VISION_FREQUENCY_BANDS + band) * featureChannels + channel
        ] = sum / VISION_BINS_PER_BAND;
      }

  const convolved = new Float32Array(
    VISION_CONV_CHANNELS * timeSlices * VISION_FREQUENCY_BANDS,
  );
  for (
    let outputChannel = 0;
    outputChannel < VISION_CONV_CHANNELS;
    outputChannel++
  )
    for (let slice = 0; slice < timeSlices; slice++)
      for (let band = 0; band < VISION_FREQUENCY_BANDS; band++) {
        let value = model.convBias[outputChannel];
        for (
          let inputChannel = 0;
          inputChannel < featureChannels;
          inputChannel++
        )
          for (let offset = 0; offset < VISION_CONV_KERNEL; offset++) {
            const inputBand =
              band + offset - Math.floor(VISION_CONV_KERNEL / 2);
            if (inputBand < 0 || inputBand >= VISION_FREQUENCY_BANDS) continue;
            const weightIndex =
              (outputChannel * featureChannels + inputChannel) *
                VISION_CONV_KERNEL +
              offset;
            value +=
              model.convWeights[weightIndex] *
              downsampled[
                (slice * VISION_FREQUENCY_BANDS + inputBand) * featureChannels +
                  inputChannel
              ];
          }
        convolved[convIndex(outputChannel, slice, band)] = Math.max(0, value);
      }

  const pooled = new Float32Array(pooledFeatureCount);
  const binsPerPool = VISION_FREQUENCY_BANDS / VISION_POOLED_FREQUENCY_BANDS;
  for (let channel = 0; channel < VISION_CONV_CHANNELS; channel++)
    for (let slice = 0; slice < timeSlices; slice++)
      for (let band = 0; band < VISION_POOLED_FREQUENCY_BANDS; band++) {
        let sum = 0;
        for (let offset = 0; offset < binsPerPool; offset++)
          sum +=
            convolved[convIndex(channel, slice, band * binsPerPool + offset)];
        pooled[pooledIndex(channel, slice, band)] = sum / binsPerPool;
      }

  const hidden = new Float32Array(VISION_TEMPORAL_HIDDEN_SIZE);
  for (let unit = 0; unit < VISION_TEMPORAL_HIDDEN_SIZE; unit++) {
    let value = model.temporalBias[unit];
    const offset = unit * pooledFeatureCount;
    for (let feature = 0; feature < pooledFeatureCount; feature++)
      value += model.temporalWeights[offset + feature] * pooled[feature];
    hidden[unit] = Math.tanh(value);
  }

  const opponent = new Float32Array(imageSize);
  for (let output = 0; output < imageSize; output++) {
    let value = model.opponentBias[output];
    const offset = output * VISION_TEMPORAL_HIDDEN_SIZE;
    for (let unit = 0; unit < VISION_TEMPORAL_HIDDEN_SIZE; unit++)
      value += model.opponentWeights[offset + unit] * hidden[unit];
    opponent[output] = value;
  }

  const colorLogits = new Float32Array(VISION_COLOR_CLASS_COUNT);
  for (let color = 0; color < VISION_COLOR_CLASS_COUNT; color++) {
    let value = model.colorBias[color];
    const offset = color * VISION_TEMPORAL_HIDDEN_SIZE;
    for (let unit = 0; unit < VISION_TEMPORAL_HIDDEN_SIZE; unit++)
      value += model.colorWeights[offset + unit] * hidden[unit];
    colorLogits[color] = value;
  }
  return { downsampled, convolved, pooled, hidden, opponent, colorLogits };
};

const softmax = (logits: Float32Array) => {
  const maximum = Math.max(...logits);
  const probabilities = Float32Array.from(logits, (value) =>
    Math.exp(value - maximum),
  );
  const sum = probabilities.reduce((total, value) => total + value, 0);
  for (let index = 0; index < probabilities.length; index++)
    probabilities[index] /= sum;
  return probabilities;
};

export function predictVisionDecoder(
  model: VisionDecoderModel,
  features: Float32Array,
  metadata: {
    sourceId: string;
    timestampBackendMs: number;
    frequencyGrid: VisionFrequencyGrid;
  },
): VisionDecoderPrediction {
  validateVisionDecoderModel(model);
  if (!sameVisionFrequencyGrid(model.frequencyGrid, metadata.frequencyGrid))
    throw new Error(
      "Vision model frequency grid does not match inference input",
    );
  const cache = forward(model, features);
  const head = visionModelHeadOutputSchema.parse({
    version: 2,
    modelId: model.modelId,
    sourceId: metadata.sourceId,
    timestampBackendMs: metadata.timestampBackendMs,
    frequencyGrid: metadata.frequencyGrid,
    opponent: cache.opponent,
  });
  const rgb = new Float32Array(imageSize);
  for (let pixel = 0; pixel < VISION_WIDTH * VISION_HEIGHT; pixel++) {
    const offset = pixel * 3;
    const decoded = opponentToRgb([
      head.opponent[offset],
      head.opponent[offset + 1],
      head.opponent[offset + 2],
    ]);
    rgb[offset] = decoded[0] / 255;
    rgb[offset + 1] = decoded[1] / 255;
    rgb[offset + 2] = decoded[2] / 255;
  }
  return {
    frame: visionDecodedFrameSchema.parse({
      version: 2,
      modelId: model.modelId,
      sourceId: metadata.sourceId,
      timestampBackendMs: metadata.timestampBackendMs,
      frequencyGrid: metadata.frequencyGrid,
      rgb,
      confidence: null,
    }),
    opponent: head.opponent.slice(),
    colorLogits: cache.colorLogits,
  };
}

const validateTrainingExamples = (
  examples: readonly VisionTrainingExample[],
  sessionSplits: Readonly<Record<string, VisionSplit>>,
) => {
  if (!examples.length)
    throw new Error("Vision training examples are required");
  const frequencyGrid = visionFrequencyGridSchema.parse(
    examples[0].frequencyGrid,
  );
  for (const example of examples) {
    if (
      example.split !== "train" ||
      sessionSplits[example.sessionId] !== "train" ||
      !Object.prototype.hasOwnProperty.call(sessionSplits, example.sessionId)
    )
      throw new Error(
        "Vision training examples must come from assigned training sessions",
      );
    if (
      !(example.features instanceof Float32Array) ||
      example.features.length !== VISION_FEATURE_COUNT ||
      !example.features.every(Number.isFinite)
    )
      throw new Error("Invalid vision training feature tensor");
    const exampleFrequencyGrid = visionFrequencyGridSchema.parse(
      example.frequencyGrid,
    );
    if (!sameVisionFrequencyGrid(frequencyGrid, exampleFrequencyGrid))
      throw new Error(
        "Vision training examples must share one RF frequency grid",
      );
    if (
      !(example.opponent instanceof Float32Array) ||
      example.opponent.length !== imageSize ||
      !example.opponent.every(Number.isFinite)
    )
      throw new Error("Invalid vision opponent target image");
    if (
      example.colorClassIndex !== null &&
      (!Number.isInteger(example.colorClassIndex) ||
        example.colorClassIndex < 0 ||
        example.colorClassIndex >= VISION_COLOR_CLASS_COUNT)
    )
      throw new Error("Invalid vision solid-color class target");
  }
  return frequencyGrid;
};

const assertTrainableModel = (model: VisionDecoderModel) => {
  try {
    validateVisionDecoderModel(model);
  } catch {
    throw new Error(
      "Vision checkpoint architecture or tensors are incompatible",
    );
  }
};

/**
 * Train the compact frequency-convolution/temporal encoder with SGD. Each
 * epoch is seeded from the checkpoint epoch, making pause/resume reproducible.
 */
export function trainVisionDecoder(
  examples: readonly VisionTrainingExample[],
  options: VisionDecoderTrainingOptions,
): VisionDecoderTrainingResult {
  const frequencyGrid = validateTrainingExamples(
    examples,
    options.sessionSplits,
  );
  const epochs = Math.floor(options.epochs ?? 1);
  const learningRate = options.learningRate ?? 0.005;
  const seed = (options.seed ?? options.initialModel?.seed ?? 1337) >>> 0;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 1000)
    throw new Error("Vision training epochs must be from 1 through 1000");
  if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 0.1)
    throw new Error(
      "Vision learning rate must be greater than 0 and at most 0.1",
    );

  let model = options.initialModel
    ? {
        ...options.initialModel,
        inputMean: options.initialModel.inputMean.slice(),
        inputScale: options.initialModel.inputScale.slice(),
        convWeights: options.initialModel.convWeights.slice(),
        convBias: options.initialModel.convBias.slice(),
        temporalWeights: options.initialModel.temporalWeights.slice(),
        temporalBias: options.initialModel.temporalBias.slice(),
        opponentWeights: options.initialModel.opponentWeights.slice(),
        opponentBias: options.initialModel.opponentBias.slice(),
        colorWeights: options.initialModel.colorWeights.slice(),
        colorBias: options.initialModel.colorBias.slice(),
      }
    : createInitialModel(seed, now, frequencyGrid);
  if (options.initialModel) {
    assertTrainableModel(model);
    if (!sameVisionFrequencyGrid(model.frequencyGrid, frequencyGrid))
      throw new Error(
        "Vision checkpoint frequency grid does not match training data",
      );
    if (model.seed !== seed)
      throw new Error(
        "Vision checkpoint seed does not match this training run",
      );
  } else {
    const normalization = fitVisionNormalization(
      examples.map(({ sessionId, features }) => ({ sessionId, features })),
      options.sessionSplits,
    );
    model.inputMean = Float32Array.from(normalization.mean);
    model.inputScale = Float32Array.from(normalization.scale);
  }
  const pooledGradient = new Float32Array(pooledFeatureCount);
  const hiddenGradient = new Float32Array(VISION_TEMPORAL_HIDDEN_SIZE);
  const convWeightGradient = new Float32Array(model.convWeights.length);
  const convBiasGradient = new Float32Array(model.convBias.length);
  const exampleOrder = Array.from(
    { length: examples.length },
    (_, index) => index,
  );
  const trainingStartEpoch = model.trainingEpochs;
  let imageMse = 0;
  let colorCrossEntropy = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const random = createRandom(
      (seed + Math.imul(trainingStartEpoch + epoch, 0x9e3779b9)) >>> 0,
    );
    for (let index = 0; index < exampleOrder.length; index++)
      exampleOrder[index] = index;
    for (let index = exampleOrder.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [exampleOrder[index], exampleOrder[swap]] = [
        exampleOrder[swap],
        exampleOrder[index],
      ];
    }
    let epochImageLoss = 0;
    let epochColorLoss = 0;
    let epochColorCount = 0;

    for (const exampleIndex of exampleOrder) {
      const example = examples[exampleIndex];
      const cache = forward(model, example.features);
      pooledGradient.fill(0);
      hiddenGradient.fill(0);

      for (let output = 0; output < imageSize; output++) {
        const error = cache.opponent[output] - example.opponent[output];
        epochImageLoss += (error * error) / imageSize;
        const gradient = (2 * error * learningRate) / imageSize;
        const offset = output * VISION_TEMPORAL_HIDDEN_SIZE;
        for (let unit = 0; unit < VISION_TEMPORAL_HIDDEN_SIZE; unit++) {
          hiddenGradient[unit] +=
            model.opponentWeights[offset + unit] * gradient;
          model.opponentWeights[offset + unit] -= gradient * cache.hidden[unit];
        }
        model.opponentBias[output] -= gradient;
      }

      if (example.colorClassIndex !== null) {
        const probabilities = softmax(cache.colorLogits);
        epochColorLoss -= Math.log(
          Math.max(probabilities[example.colorClassIndex], 1e-8),
        );
        epochColorCount++;
        for (let color = 0; color < VISION_COLOR_CLASS_COUNT; color++) {
          const gradient =
            (probabilities[color] -
              (color === example.colorClassIndex ? 1 : 0)) *
            VISION_COLOR_LOSS_WEIGHT *
            learningRate;
          const offset = color * VISION_TEMPORAL_HIDDEN_SIZE;
          for (let unit = 0; unit < VISION_TEMPORAL_HIDDEN_SIZE; unit++) {
            hiddenGradient[unit] +=
              model.colorWeights[offset + unit] * gradient;
            model.colorWeights[offset + unit] -= gradient * cache.hidden[unit];
          }
          model.colorBias[color] -= gradient;
        }
      }

      for (let unit = 0; unit < VISION_TEMPORAL_HIDDEN_SIZE; unit++) {
        const gradient =
          hiddenGradient[unit] * (1 - cache.hidden[unit] * cache.hidden[unit]);
        const offset = unit * pooledFeatureCount;
        for (let feature = 0; feature < pooledFeatureCount; feature++) {
          pooledGradient[feature] +=
            model.temporalWeights[offset + feature] * gradient;
          model.temporalWeights[offset + feature] -=
            gradient * cache.pooled[feature];
        }
        model.temporalBias[unit] -= gradient;
      }

      convWeightGradient.fill(0);
      convBiasGradient.fill(0);
      const binsPerPool =
        VISION_FREQUENCY_BANDS / VISION_POOLED_FREQUENCY_BANDS;
      for (
        let outputChannel = 0;
        outputChannel < VISION_CONV_CHANNELS;
        outputChannel++
      )
        for (let slice = 0; slice < timeSlices; slice++)
          for (let band = 0; band < VISION_FREQUENCY_BANDS; band++) {
            const activation =
              cache.convolved[convIndex(outputChannel, slice, band)];
            if (activation <= 0) continue;
            const gradient =
              pooledGradient[
                pooledIndex(
                  outputChannel,
                  slice,
                  Math.floor(band / binsPerPool),
                )
              ] / binsPerPool;
            convBiasGradient[outputChannel] += gradient;
            for (
              let inputChannel = 0;
              inputChannel < featureChannels;
              inputChannel++
            )
              for (let offset = 0; offset < VISION_CONV_KERNEL; offset++) {
                const inputBand =
                  band + offset - Math.floor(VISION_CONV_KERNEL / 2);
                if (inputBand < 0 || inputBand >= VISION_FREQUENCY_BANDS)
                  continue;
                const weightIndex =
                  (outputChannel * featureChannels + inputChannel) *
                    VISION_CONV_KERNEL +
                  offset;
                const input =
                  cache.downsampled[
                    (slice * VISION_FREQUENCY_BANDS + inputBand) *
                      featureChannels +
                      inputChannel
                  ];
                convWeightGradient[weightIndex] += gradient * input;
              }
          }
      for (let index = 0; index < model.convWeights.length; index++)
        model.convWeights[index] -= convWeightGradient[index];
      for (let index = 0; index < model.convBias.length; index++)
        model.convBias[index] -= convBiasGradient[index];
    }

    imageMse = epochImageLoss / examples.length;
    colorCrossEntropy =
      epochColorCount === 0 ? 0 : epochColorLoss / epochColorCount;
    model.trainingEpochs++;
    model.trainingSamples += examples.length;
    model.trainingExamples = examples.length;
    model.finalLoss = imageMse + VISION_COLOR_LOSS_WEIGHT * colorCrossEntropy;
    model.updatedAt = now();
  }

  return {
    model,
    metrics: {
      exampleCount: examples.length,
      epochCount: model.trainingEpochs,
      imageMse,
      colorCrossEntropy,
      combinedLoss: imageMse + VISION_COLOR_LOSS_WEIGHT * colorCrossEntropy,
    },
  };
}
