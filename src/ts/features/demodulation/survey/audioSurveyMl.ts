export const TIME_DOMAIN_MODEL_VERSION = 4 as const;
export const TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES = 64;
export const TIME_DOMAIN_IQ_FEATURE_SIZE =
  TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES * 2;
/** Raw I/Q window size retained for existing window preparation callers. */
export const TIME_DOMAIN_INPUT_SIZE = TIME_DOMAIN_IQ_FEATURE_SIZE;
export const TIME_DOMAIN_FOURIER_FEATURE_SIZE =
  TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
export const TIME_DOMAIN_MODEL_INPUT_SIZE =
  TIME_DOMAIN_IQ_FEATURE_SIZE + TIME_DOMAIN_FOURIER_FEATURE_SIZE;
export const TIME_DOMAIN_HIDDEN_SIZE = 12;

const FOURIER_TWIDDLES = Array.from(
  { length: TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES / 2 },
  (_, index) => ({
    real: Math.cos((-2 * Math.PI * index) / TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES),
    imaginary: Math.sin(
      (-2 * Math.PI * index) / TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
    ),
  }),
);
const FOURIER_HANN = Float32Array.from(
  { length: TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES },
  (_, index) =>
    0.5 -
    0.5 *
      Math.cos(
        (2 * Math.PI * index) / (TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES - 1),
      ),
);

/** Append a centered, Hann-windowed log-power spectrum to raw I/Q features. */
export const fillTimeDomainFourierFeatures = (
  iqFeatures: Float32Array,
  output: Float32Array,
  real = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES),
  imaginary = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES),
) => {
  if (
    iqFeatures.length < TIME_DOMAIN_IQ_FEATURE_SIZE ||
    output.length < TIME_DOMAIN_FOURIER_FEATURE_SIZE ||
    real.length < TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES ||
    imaginary.length < TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES
  ) {
    throw new Error("Fourier features require one complete I/Q context window");
  }
  for (let index = 0; index < TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES; index++) {
    const window = FOURIER_HANN[index];
    real[index] = iqFeatures[index * 2] * window;
    imaginary[index] = iqFeatures[index * 2 + 1] * window;
  }
  for (
    let index = 1, reversed = 0;
    index < TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
    index++
  ) {
    let bit = TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [
        imaginary[reversed],
        imaginary[index],
      ];
    }
  }
  for (
    let width = 2;
    width <= TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
    width <<= 1
  ) {
    const halfWidth = width >> 1;
    const twiddleStride = TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES / width;
    for (
      let start = 0;
      start < TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
      start += width
    ) {
      for (let offset = 0; offset < halfWidth; offset++) {
        const twiddle = FOURIER_TWIDDLES[offset * twiddleStride];
        const evenIndex = start + offset;
        const oddIndex = evenIndex + halfWidth;
        const oddReal =
          real[oddIndex] * twiddle.real -
          imaginary[oddIndex] * twiddle.imaginary;
        const oddImaginary =
          real[oddIndex] * twiddle.imaginary +
          imaginary[oddIndex] * twiddle.real;
        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;
      }
    }
  }
  let maxPower = 1e-12;
  for (let index = 0; index < TIME_DOMAIN_FOURIER_FEATURE_SIZE; index++) {
    const fftIndex =
      (index + TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES / 2) %
      TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
    const magnitude = real[fftIndex] ** 2 + imaginary[fftIndex] ** 2;
    maxPower = Math.max(maxPower, magnitude);
  }
  const maxDb = 10 * Math.log10(maxPower);
  for (let index = 0; index < TIME_DOMAIN_FOURIER_FEATURE_SIZE; index++) {
    const fftIndex =
      (index + TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES / 2) %
      TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
    const magnitude = real[fftIndex] ** 2 + imaginary[fftIndex] ** 2;
    const db = 10 * Math.log10(Math.max(magnitude, maxPower * 1e-5));
    output[index] = Math.max(-1, Math.min(0, (db - maxDb) / 50));
  }
};

const fillModelInput = (
  example: PairedAudioTrainingExample,
  pcmSampleIndex: number,
  output: Float32Array,
  real = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES),
  imaginary = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES),
) => {
  const iq = output.subarray(0, TIME_DOMAIN_IQ_FEATURE_SIZE);
  fillTimeDomainIqWindow(example, pcmSampleIndex, iq);
  fillTimeDomainFourierFeatures(
    iq,
    output.subarray(TIME_DOMAIN_IQ_FEATURE_SIZE),
    real,
    imaginary,
  );
};

export interface TimeDomainDemodModel {
  version: typeof TIME_DOMAIN_MODEL_VERSION;
  inputSize: typeof TIME_DOMAIN_MODEL_INPUT_SIZE;
  hiddenSize: typeof TIME_DOMAIN_HIDDEN_SIZE;
  /** Channelized narrowband I/Q rate used by the aligned training pairs. */
  inputSampleRateHz: number;
  /** RF channel width used before the training I/Q was decimated. */
  channelBandwidthHz?: number;
  pcmSampleRateHz: number;
  /** Row-major hidden-by-input weights for the dense temporal layer. */
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
  channelBandwidthHz?: number;
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

export interface PcmSampleRange {
  startSample: number;
  endSample: number;
}

const normalizeIq = (value: number | undefined) =>
  value === undefined ? 0 : (value - 128) / 128;

const currentIqIndexAtPcmSample = (
  example: PairedAudioTrainingExample,
  pcmSampleIndex: number,
) => {
  const complexCount = Math.floor(example.iqData.length / 2);
  return Math.min(
    complexCount - 1,
    Math.max(
      0,
      Math.floor(
        ((pcmSampleIndex + 0.5) * complexCount) / example.pcmSamples.length,
      ),
    ),
  );
};

const fillTimeDomainIqWindow = (
  example: PairedAudioTrainingExample,
  pcmSampleIndex: number,
  output: Float32Array,
) => {
  const complexCount = Math.floor(example.iqData.length / 2);
  const currentIndex = currentIqIndexAtPcmSample(example, pcmSampleIndex);
  const firstIndex = currentIndex - TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES + 1;
  for (let tap = 0; tap < TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES; tap++) {
    const iqIndex = firstIndex + tap;
    const sourceIndex = iqIndex * 2;
    output[tap * 2] =
      iqIndex < 0 || iqIndex >= complexCount
        ? 0
        : normalizeIq(example.iqData[sourceIndex]);
    output[tap * 2 + 1] =
      iqIndex < 0 || iqIndex >= complexCount
        ? 0
        : normalizeIq(example.iqData[sourceIndex + 1]);
  }
};

/** Return the preceding 64 normalized complex I/Q samples, oldest first. */
export const buildTimeDomainIqWindow = (
  example: PairedAudioTrainingExample,
  pcmSampleIndex: number,
): Float32Array => {
  if (
    example.iqData.length < 2 ||
    example.pcmSamples.length < 1 ||
    !Number.isInteger(pcmSampleIndex) ||
    pcmSampleIndex < 0 ||
    pcmSampleIndex >= example.pcmSamples.length
  ) {
    throw new Error("Cannot build an I/Q context window for this audio sample");
  }
  const output = new Float32Array(TIME_DOMAIN_INPUT_SIZE);
  fillTimeDomainIqWindow(example, pcmSampleIndex, output);
  return output;
};

/** Prepare the complete raw I/Q and Fourier feature vector used by the model. */
export const buildTimeDomainModelInputWindow = (
  example: PairedAudioTrainingExample,
  pcmSampleIndex: number,
): Float32Array => {
  const iq = buildTimeDomainIqWindow(example, pcmSampleIndex);
  const output = new Float32Array(TIME_DOMAIN_MODEL_INPUT_SIZE);
  output.set(iq);
  fillTimeDomainFourierFeatures(
    iq,
    output.subarray(TIME_DOMAIN_IQ_FEATURE_SIZE),
  );
  return output;
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

const createInitialModel = (
  pcmSampleRateHz: number,
  inputSampleRateHz: number,
  channelBandwidthHz: number | undefined,
  seed: number,
) => {
  const random = createRandom(seed);
  const scale = Math.sqrt(2 / TIME_DOMAIN_MODEL_INPUT_SIZE);
  const inputWeights = new Float32Array(
    TIME_DOMAIN_MODEL_INPUT_SIZE * TIME_DOMAIN_HIDDEN_SIZE,
  );
  const outputWeights = new Float32Array(TIME_DOMAIN_HIDDEN_SIZE);
  for (let index = 0; index < inputWeights.length; index++) {
    inputWeights[index] = (random() * 2 - 1) * scale;
  }
  for (let index = 0; index < outputWeights.length; index++) {
    outputWeights[index] =
      (random() * 2 - 1) * Math.sqrt(2 / TIME_DOMAIN_HIDDEN_SIZE);
  }
  return {
    version: TIME_DOMAIN_MODEL_VERSION,
    inputSize: TIME_DOMAIN_MODEL_INPUT_SIZE,
    hiddenSize: TIME_DOMAIN_HIDDEN_SIZE,
    inputSampleRateHz,
    channelBandwidthHz,
    pcmSampleRateHz,
    inputWeights,
    hiddenBias: new Float32Array(TIME_DOMAIN_HIDDEN_SIZE),
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
  for (let unit = 0; unit < TIME_DOMAIN_HIDDEN_SIZE; unit++) {
    let activation = model.hiddenBias[unit];
    const weightOffset = unit * TIME_DOMAIN_MODEL_INPUT_SIZE;
    for (let feature = 0; feature < TIME_DOMAIN_MODEL_INPUT_SIZE; feature++) {
      activation +=
        model.inputWeights[weightOffset + feature] * features[feature];
    }
    hidden[unit] = Math.tanh(activation);
  }
  let output = model.outputBias;
  for (let unit = 0; unit < TIME_DOMAIN_HIDDEN_SIZE; unit++) {
    output += model.outputWeights[unit] * hidden[unit];
  }
  return Math.tanh(output);
};

/** Run the learned temporal network on one prepared raw I/Q context window. */
export const predictTimeDomainIqWindow = (
  model: TimeDomainDemodModel,
  window: Float32Array,
): number => {
  if (
    model.version !== TIME_DOMAIN_MODEL_VERSION ||
    model.inputSize !== TIME_DOMAIN_MODEL_INPUT_SIZE ||
    window.length !== TIME_DOMAIN_INPUT_SIZE
  ) {
    throw new Error(
      "Unsupported time-domain demodulation model or input window",
    );
  }
  const modelWindow = new Float32Array(TIME_DOMAIN_MODEL_INPUT_SIZE);
  modelWindow.set(window);
  fillTimeDomainFourierFeatures(
    window,
    modelWindow.subarray(TIME_DOMAIN_IQ_FEATURE_SIZE),
  );
  return predictFeatures(
    model,
    modelWindow,
    new Float32Array(TIME_DOMAIN_HIDDEN_SIZE),
  );
};

export interface TimeDomainDemodStreamOptions {
  inputSampleRateHz: number;
  pcmSampleRateHz?: number;
}

/** Incremental inference that preserves the temporal context across I/Q chunks. */
export class TimeDomainDemodStream {
  private readonly inputSampleRateHz: number;
  private readonly pcmSampleRateHz: number;
  private readonly inputHistory = new Float32Array(
    TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
  );
  private readonly quadratureHistory = new Float32Array(
    TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
  );
  private readonly window = new Float32Array(TIME_DOMAIN_MODEL_INPUT_SIZE);
  private readonly fourierReal = new Float32Array(
    TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
  );
  private readonly fourierImaginary = new Float32Array(
    TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
  );
  private readonly hidden = new Float32Array(TIME_DOMAIN_HIDDEN_SIZE);
  private inputSamplesReceived = 0;
  private nextOutputSample = 0;

  constructor(
    private readonly model: TimeDomainDemodModel,
    options: TimeDomainDemodStreamOptions,
  ) {
    if (
      model.version !== TIME_DOMAIN_MODEL_VERSION ||
      model.inputSize !== TIME_DOMAIN_MODEL_INPUT_SIZE ||
      model.hiddenSize !== TIME_DOMAIN_HIDDEN_SIZE ||
      !Number.isFinite(model.inputSampleRateHz) ||
      model.inputSampleRateHz <= 0 ||
      (model.channelBandwidthHz !== undefined &&
        (!Number.isFinite(model.channelBandwidthHz) ||
          model.channelBandwidthHz <= 0)) ||
      model.inputWeights.length !==
        TIME_DOMAIN_MODEL_INPUT_SIZE * TIME_DOMAIN_HIDDEN_SIZE ||
      model.hiddenBias.length !== TIME_DOMAIN_HIDDEN_SIZE ||
      model.outputWeights.length !== TIME_DOMAIN_HIDDEN_SIZE
    ) {
      throw new Error("Unsupported time-domain demodulation model version");
    }
    this.inputSampleRateHz = options.inputSampleRateHz;
    this.pcmSampleRateHz = options.pcmSampleRateHz ?? model.pcmSampleRateHz;
    if (
      !Number.isFinite(options.inputSampleRateHz) ||
      options.inputSampleRateHz <= 0 ||
      !Number.isFinite(this.pcmSampleRateHz) ||
      this.pcmSampleRateHz <= 0
    ) {
      throw new Error(
        "I/Q and PCM sample rates must be positive finite values",
      );
    }
  }

  /** Process complete complex I/Q samples and return the newly available PCM. */
  processIqChunk(iqData: Uint8Array): Float32Array {
    if (iqData.length % 2 !== 0) {
      throw new Error("An I/Q chunk must contain complete complex samples");
    }

    const chunkSampleCount = iqData.length / 2;
    const endSample = this.inputSamplesReceived + chunkSampleCount;
    const endOutputSample = Math.floor(
      (endSample * this.pcmSampleRateHz) / this.inputSampleRateHz,
    );
    const output = new Float32Array(endOutputSample - this.nextOutputSample);
    let outputOffset = 0;

    for (
      let sampleOffset = 0;
      sampleOffset < chunkSampleCount;
      sampleOffset++
    ) {
      const inputSampleIndex = this.inputSamplesReceived + sampleOffset;
      const historyIndex =
        inputSampleIndex % TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
      this.inputHistory[historyIndex] = normalizeIq(iqData[sampleOffset * 2]);
      this.quadratureHistory[historyIndex] = normalizeIq(
        iqData[sampleOffset * 2 + 1],
      );

      while (this.nextOutputSample < endOutputSample) {
        const currentIqIndex = Math.floor(
          ((this.nextOutputSample + 0.5) * this.inputSampleRateHz) /
            this.pcmSampleRateHz,
        );
        if (currentIqIndex > inputSampleIndex) break;

        const firstIqIndex =
          currentIqIndex - TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES + 1;
        for (let tap = 0; tap < TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES; tap++) {
          const iqIndex = firstIqIndex + tap;
          const targetIndex = tap * 2;
          if (iqIndex < 0) {
            this.window[targetIndex] = 0;
            this.window[targetIndex + 1] = 0;
          } else {
            const sourceIndex = iqIndex % TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
            this.window[targetIndex] = this.inputHistory[sourceIndex];
            this.window[targetIndex + 1] = this.quadratureHistory[sourceIndex];
          }
        }
        fillTimeDomainFourierFeatures(
          this.window.subarray(0, TIME_DOMAIN_IQ_FEATURE_SIZE),
          this.window.subarray(TIME_DOMAIN_IQ_FEATURE_SIZE),
          this.fourierReal,
          this.fourierImaginary,
        );
        output[outputOffset++] = predictFeatures(
          this.model,
          this.window,
          this.hidden,
        );
        this.nextOutputSample++;
      }
    }

    this.inputSamplesReceived = endSample;
    return outputOffset === output.length
      ? output
      : output.slice(0, outputOffset);
  }

  /** Start a fresh stream after a retune or acquisition discontinuity. */
  reset() {
    this.inputHistory.fill(0);
    this.quadratureHistory.fill(0);
    this.window.fill(0);
    this.fourierReal.fill(0);
    this.fourierImaginary.fill(0);
    this.hidden.fill(0);
    this.inputSamplesReceived = 0;
    this.nextOutputSample = 0;
  }
}

/** Train a local temporal model directly from aligned raw I/Q windows to PCM. */
export const trainTimeDomainDemodModel = (
  examples: readonly PairedAudioTrainingExample[],
  options: TimeDomainTrainingOptions = {},
): TimeDomainDemodModel => {
  const usableExamples = examples.filter(
    (example) =>
      example.iqData.length >= 2 &&
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
  if (
    usableExamples.some(
      (example) => example.pcmSampleRateHz !== pcmSampleRateHz,
    )
  ) {
    throw new Error("Training examples must use the same PCM sample rate");
  }
  const inputSampleRateHz = usableExamples[0].sampleRateHz;
  if (
    usableExamples.some((example) => example.sampleRateHz !== inputSampleRateHz)
  ) {
    throw new Error("Training examples must use the same I/Q sample rate");
  }
  const channelBandwidthHz = usableExamples[0].channelBandwidthHz;
  if (
    usableExamples.some(
      (example) => example.channelBandwidthHz !== channelBandwidthHz,
    )
  ) {
    throw new Error("Training examples must use the same RF channel bandwidth");
  }

  const epochs = Math.max(1, Math.floor(options.epochs ?? 20));
  const maxTrainingSamples = Math.max(
    16,
    Math.floor(options.maxTrainingSamples ?? 4096),
  );
  const learningRate = Math.max(
    0.0001,
    Math.min(0.1, options.learningRate ?? 0.005),
  );
  const model = options.initialModel
    ? {
        ...options.initialModel,
        inputWeights: options.initialModel.inputWeights.slice(),
        hiddenBias: options.initialModel.hiddenBias.slice(),
        outputWeights: options.initialModel.outputWeights.slice(),
      }
    : createInitialModel(
        pcmSampleRateHz,
        inputSampleRateHz,
        channelBandwidthHz,
        options.seed ?? 1337,
      );
  if (
    model.version !== TIME_DOMAIN_MODEL_VERSION ||
    model.inputSize !== TIME_DOMAIN_MODEL_INPUT_SIZE ||
    model.hiddenSize !== TIME_DOMAIN_HIDDEN_SIZE
  ) {
    throw new Error(
      "Checkpoint architecture does not match the temporal model",
    );
  }
  if (model.pcmSampleRateHz !== pcmSampleRateHz) {
    throw new Error(
      "Checkpoint PCM sample rate does not match training examples",
    );
  }
  if (
    model.inputSampleRateHz !== inputSampleRateHz ||
    model.channelBandwidthHz !== channelBandwidthHz
  ) {
    throw new Error(
      "Checkpoint I/Q profile does not match the training examples",
    );
  }
  const startEpoch = Math.max(
    0,
    Math.floor(options.startEpoch ?? model.trainingEpochs),
  );
  const window = new Float32Array(TIME_DOMAIN_MODEL_INPUT_SIZE);
  const fourierReal = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES);
  const fourierImaginary = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES);
  const hidden = new Float32Array(TIME_DOMAIN_HIDDEN_SIZE);
  const hiddenGradients = new Float32Array(TIME_DOMAIN_HIDDEN_SIZE);
  let totalSamples = 0;
  let finalLoss = 0;

  const sampleRanges = usableExamples.map((example) => {
    const firstUsefulSample = Math.min(
      example.pcmSamples.length - 1,
      Math.max(1, TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES - 1),
    );
    const availableSamples = example.pcmSamples.length - firstUsefulSample;
    return {
      firstUsefulSample,
      availableSamples,
      sampleCount: Math.min(maxTrainingSamples, availableSamples),
    };
  });

  for (let epoch = 0; epoch < epochs; epoch++) {
    const random = createRandom(
      (options.seed ?? 1337) + Math.imul(startEpoch + epoch, 0x9e3779b9),
    );
    let epochLoss = 0;
    let epochSamples = 0;
    for (
      let exampleIndex = 0;
      exampleIndex < usableExamples.length;
      exampleIndex++
    ) {
      const example = usableExamples[exampleIndex];
      const range = sampleRanges[exampleIndex];
      const indices = Array.from(
        { length: range.sampleCount },
        () =>
          range.firstUsefulSample +
          Math.floor(random() * range.availableSamples),
      );
      for (let index = indices.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1));
        [indices[index], indices[swap]] = [indices[swap], indices[index]];
      }

      for (const sampleIndex of indices) {
        fillModelInput(
          example,
          sampleIndex,
          window,
          fourierReal,
          fourierImaginary,
        );
        const prediction = predictFeatures(model, window, hidden);
        const error = prediction - example.pcmSamples[sampleIndex];
        epochLoss += error * error;
        epochSamples++;

        const outputGradient =
          2 * error * (1 - prediction * prediction) * learningRate;
        for (let unit = 0; unit < TIME_DOMAIN_HIDDEN_SIZE; unit++) {
          const hiddenValue = hidden[unit];
          hiddenGradients[unit] =
            outputGradient *
            model.outputWeights[unit] *
            (1 - hiddenValue * hiddenValue);
        }
        model.outputBias -= outputGradient;
        for (let unit = 0; unit < TIME_DOMAIN_HIDDEN_SIZE; unit++) {
          model.outputWeights[unit] -= outputGradient * hidden[unit];
          const gradient = hiddenGradients[unit];
          model.hiddenBias[unit] -= gradient;
          const weightOffset = unit * TIME_DOMAIN_MODEL_INPUT_SIZE;
          for (
            let feature = 0;
            feature < TIME_DOMAIN_MODEL_INPUT_SIZE;
            feature++
          ) {
            model.inputWeights[weightOffset + feature] -=
              gradient * window[feature];
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

/** Predict a bounded excerpt without losing its position in the aligned pair. */
export const predictTimeDomainAudioRange = (
  model: TimeDomainDemodModel,
  example: PairedAudioTrainingExample,
  range: PcmSampleRange,
): TimeDomainPrediction => {
  if (
    model.version !== TIME_DOMAIN_MODEL_VERSION ||
    model.inputSize !== TIME_DOMAIN_MODEL_INPUT_SIZE ||
    model.hiddenSize !== TIME_DOMAIN_HIDDEN_SIZE
  ) {
    throw new Error("Unsupported time-domain demodulation model version");
  }
  if (
    !Number.isFinite(example.sampleRateHz) ||
    example.sampleRateHz <= 0 ||
    !Number.isFinite(example.pcmSampleRateHz) ||
    example.pcmSampleRateHz <= 0
  ) {
    throw new Error("I/Q sample rate must be a positive finite value");
  }
  if (
    example.iqData.length < 2 ||
    example.pcmSamples.length < 1 ||
    !Number.isInteger(range.startSample) ||
    !Number.isInteger(range.endSample) ||
    range.startSample < 0 ||
    range.endSample < range.startSample ||
    range.endSample > example.pcmSamples.length
  ) {
    throw new Error("Cannot predict an invalid aligned PCM sample range");
  }

  const window = new Float32Array(TIME_DOMAIN_MODEL_INPUT_SIZE);
  const fourierReal = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES);
  const fourierImaginary = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES);
  const hidden = new Float32Array(TIME_DOMAIN_HIDDEN_SIZE);
  const samples = new Float32Array(range.endSample - range.startSample);
  for (let outputIndex = 0; outputIndex < samples.length; outputIndex++) {
    fillModelInput(
      example,
      range.startSample + outputIndex,
      window,
      fourierReal,
      fourierImaginary,
    );
    samples[outputIndex] = predictFeatures(model, window, hidden);
  }
  return { samples, sampleRateHz: example.pcmSampleRateHz };
};

/** Apply the reference temporal model sample by sample in TypeScript. */
export const predictTimeDomainAudio = (
  model: TimeDomainDemodModel,
  input: {
    iqData: Uint8Array;
    sampleRateHz: number;
    pcmSampleRateHz?: number;
    outputSampleCount?: number;
  },
): TimeDomainPrediction => {
  if (!Number.isFinite(input.sampleRateHz) || input.sampleRateHz <= 0) {
    throw new Error("I/Q sample rate must be a positive finite value");
  }
  const pcmSampleRateHz = input.pcmSampleRateHz ?? model.pcmSampleRateHz;
  const complexCount = Math.floor(input.iqData.length / 2);
  const outputSampleCount = Math.max(
    0,
    Math.floor(
      input.outputSampleCount ??
        (complexCount * pcmSampleRateHz) / input.sampleRateHz,
    ),
  );
  const example: PairedAudioTrainingExample = {
    iqData: input.iqData,
    sampleRateHz: input.sampleRateHz,
    pcmSamples: new Float32Array(outputSampleCount),
    pcmSampleRateHz,
  };
  return predictTimeDomainAudioRange(model, example, {
    startSample: 0,
    endSample: outputSampleCount,
  });
};
