import {
  fillTimeDomainFourierFeatures,
  TIME_DOMAIN_IQ_FEATURE_SIZE,
  TIME_DOMAIN_INPUT_SIZE,
  TIME_DOMAIN_MODEL_INPUT_SIZE,
  TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
} from "@n-apt/demodulation/survey/audioSurveyMl";

export const TIME_DOMAIN_ONNX_MAX_BATCH_SIZE = 256;

export type AudioSurveyOnnxExecutionProvider = "auto" | "wasm" | "webgpu";

export interface AudioSurveyOnnxRuntimeOptions {
  executionProvider?: AudioSurveyOnnxExecutionProvider;
}

export interface AudioSurveyOnnxRuntime {
  readonly executionProvider: Exclude<AudioSurveyOnnxExecutionProvider, "auto">;
  predictWindows(
    windows: Float32Array,
    batchSize: number,
  ): Promise<Float32Array>;
  release(): Promise<void>;
}

interface OrtTensor {
  data: Float32Array;
}

interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}

interface OrtModule {
  Tensor: new (
    type: "float32",
    data: Float32Array,
    dimensions: number[],
  ) => unknown;
  InferenceSession: {
    create(
      model: Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<OrtSession>;
  };
}

const hasWebGpu = () => typeof navigator !== "undefined" && "gpu" in navigator;

const loadOrtModule = async (
  executionProvider: "wasm" | "webgpu",
): Promise<OrtModule> =>
  executionProvider === "webgpu"
    ? ((await import("onnxruntime-web/webgpu")) as unknown as OrtModule)
    : ((await import("onnxruntime-web")) as unknown as OrtModule);

const createRuntimeForProvider = async (
  modelData: Uint8Array,
  executionProvider: "wasm" | "webgpu",
): Promise<AudioSurveyOnnxRuntime> => {
  const ort = await loadOrtModule(executionProvider);
  const session = await ort.InferenceSession.create(modelData, {
    executionProviders: [executionProvider],
  });

  if (
    session.inputNames.length !== 1 ||
    session.inputNames[0] !== "iq_fourier_windows" ||
    session.outputNames.length !== 1 ||
    session.outputNames[0] !== "pcm"
  ) {
    await session.release();
    throw new Error(
      "ONNX model must expose iq_fourier_windows input and pcm output",
    );
  }

  const fourierReal = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES);
  const fourierImaginary = new Float32Array(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES);
  return {
    executionProvider,
    async predictWindows(windows, batchSize) {
      if (
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        windows.length !== batchSize * TIME_DOMAIN_INPUT_SIZE
      ) {
        throw new Error(
          `ONNX inference expects ${TIME_DOMAIN_INPUT_SIZE} floats for each input window`,
        );
      }

      const modelWindows = new Float32Array(
        batchSize * TIME_DOMAIN_MODEL_INPUT_SIZE,
      );
      for (let batch = 0; batch < batchSize; batch++) {
        const rawStart = batch * TIME_DOMAIN_INPUT_SIZE;
        const modelStart = batch * TIME_DOMAIN_MODEL_INPUT_SIZE;
        const iq = windows.subarray(
          rawStart,
          rawStart + TIME_DOMAIN_INPUT_SIZE,
        );
        modelWindows.set(iq, modelStart);
        fillTimeDomainFourierFeatures(
          iq,
          modelWindows.subarray(
            modelStart + TIME_DOMAIN_IQ_FEATURE_SIZE,
            modelStart + TIME_DOMAIN_MODEL_INPUT_SIZE,
          ),
          fourierReal,
          fourierImaginary,
        );
      }
      const result = await session.run({
        iq_fourier_windows: new ort.Tensor("float32", modelWindows, [
          batchSize,
          TIME_DOMAIN_MODEL_INPUT_SIZE,
        ]),
      });
      const output = result.pcm?.data;
      if (!(output instanceof Float32Array) || output.length !== batchSize) {
        throw new Error("ONNX model returned an invalid PCM output tensor");
      }
      return output.slice();
    },
    release: () => session.release(),
  };
};

/** Load a self-contained temporal demodulation ONNX model on the local device. */
export const createAudioSurveyOnnxRuntime = async (
  modelData: Uint8Array,
  options: AudioSurveyOnnxRuntimeOptions = {},
): Promise<AudioSurveyOnnxRuntime> => {
  if (!(modelData instanceof Uint8Array) || modelData.byteLength === 0) {
    throw new Error("An ONNX model must contain non-empty binary data");
  }

  const requestedProvider = options.executionProvider ?? "auto";
  const providers: Array<"wasm" | "webgpu"> =
    requestedProvider === "auto"
      ? hasWebGpu()
        ? ["webgpu", "wasm"]
        : ["wasm"]
      : [requestedProvider];
  let lastError: unknown;
  for (const executionProvider of providers) {
    try {
      return await createRuntimeForProvider(modelData, executionProvider);
    } catch (error) {
      lastError = error;
      if (requestedProvider !== "auto" || executionProvider === "wasm") {
        break;
      }
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Could not load the local ONNX runtime${detail}`);
};

export interface TimeDomainOnnxDemodStreamOptions {
  inputSampleRateHz: number;
  pcmSampleRateHz: number;
}

/** Stateful async inference that preserves I/Q context and sample order. */
export class TimeDomainOnnxDemodStream {
  private readonly inputSampleRateHz: number;
  private readonly pcmSampleRateHz: number;
  private readonly inputHistory = new Float32Array(
    TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
  );
  private readonly quadratureHistory = new Float32Array(
    TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
  );
  private inputSamplesReceived = 0;
  private nextOutputSample = 0;
  private generation = 0;
  private requiresReset = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly runtime: AudioSurveyOnnxRuntime,
    options: TimeDomainOnnxDemodStreamOptions,
  ) {
    this.inputSampleRateHz = options.inputSampleRateHz;
    this.pcmSampleRateHz = options.pcmSampleRateHz;
    if (
      !Number.isFinite(this.inputSampleRateHz) ||
      this.inputSampleRateHz <= 0 ||
      !Number.isFinite(this.pcmSampleRateHz) ||
      this.pcmSampleRateHz <= 0
    ) {
      throw new Error(
        "I/Q and PCM sample rates must be positive finite values",
      );
    }
  }

  /** Queue a chunk for ordered inference; the caller may submit without waiting. */
  processIqChunk(iqData: Uint8Array): Promise<Float32Array> {
    if (iqData.length % 2 !== 0) {
      throw new Error("An I/Q chunk must contain complete complex samples");
    }
    if (this.requiresReset) {
      return Promise.reject(
        new Error("Reset the ONNX demodulator after a failed inference"),
      );
    }

    const chunk = iqData.slice();
    const generation = this.generation;
    const operation = this.pending.then(async () => {
      if (generation !== this.generation) return new Float32Array();
      try {
        return await this.appendChunkAndPredictWindows(chunk, generation);
      } catch (error) {
        if (generation === this.generation) {
          this.requiresReset = true;
          this.clearState();
        }
        throw error;
      }
    });
    this.pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /** Discard queued output and start a new stream after a tune or data gap. */
  reset() {
    const generation = ++this.generation;
    this.pending = this.pending
      .catch(() => undefined)
      .then(() => {
        if (generation === this.generation) {
          this.clearState();
          this.requiresReset = false;
        }
      });
  }

  private async appendChunkAndPredictWindows(
    iqData: Uint8Array,
    generation: number,
  ) {
    const startSample = this.inputSamplesReceived;
    const endSample = startSample + iqData.length / 2;
    const endOutputSample = Math.floor(
      (endSample * this.pcmSampleRateHz) / this.inputSampleRateHz,
    );
    const output = new Float32Array(endOutputSample - this.nextOutputSample);
    const windows = new Float32Array(
      TIME_DOMAIN_ONNX_MAX_BATCH_SIZE * TIME_DOMAIN_INPUT_SIZE,
    );
    let batchSize = 0;
    let outputOffset = 0;

    for (
      let sampleOffset = 0;
      sampleOffset < iqData.length / 2;
      sampleOffset++
    ) {
      const inputSampleIndex = startSample + sampleOffset;
      const historyIndex =
        inputSampleIndex % TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
      this.inputHistory[historyIndex] = (iqData[sampleOffset * 2] - 128) / 128;
      this.quadratureHistory[historyIndex] =
        (iqData[sampleOffset * 2 + 1] - 128) / 128;

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
          const targetIndex = batchSize * TIME_DOMAIN_INPUT_SIZE + tap * 2;
          if (iqIndex < 0) {
            windows[targetIndex] = 0;
            windows[targetIndex + 1] = 0;
          } else {
            const sourceIndex = iqIndex % TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES;
            windows[targetIndex] = this.inputHistory[sourceIndex];
            windows[targetIndex + 1] = this.quadratureHistory[sourceIndex];
          }
        }
        batchSize++;
        this.nextOutputSample++;

        if (batchSize === TIME_DOMAIN_ONNX_MAX_BATCH_SIZE) {
          const decoded = await this.runtime.predictWindows(windows, batchSize);
          if (generation !== this.generation) return new Float32Array();
          if (decoded.length !== batchSize) {
            throw new Error("ONNX model returned an incomplete PCM batch");
          }
          output.set(decoded, outputOffset);
          outputOffset += decoded.length;
          batchSize = 0;
        }
      }
    }

    this.inputSamplesReceived = endSample;
    if (batchSize > 0) {
      const decoded = await this.runtime.predictWindows(
        windows.subarray(0, batchSize * TIME_DOMAIN_INPUT_SIZE),
        batchSize,
      );
      if (generation !== this.generation) return new Float32Array();
      if (decoded.length !== batchSize) {
        throw new Error("ONNX model returned an incomplete PCM batch");
      }
      output.set(decoded, outputOffset);
      outputOffset += decoded.length;
    }

    if (outputOffset !== output.length) {
      throw new Error("ONNX model returned an incomplete PCM chunk");
    }
    return generation === this.generation ? output : new Float32Array();
  }

  private clearState() {
    this.inputHistory.fill(0);
    this.quadratureHistory.fill(0);
    this.inputSamplesReceived = 0;
    this.nextOutputSample = 0;
  }
}
