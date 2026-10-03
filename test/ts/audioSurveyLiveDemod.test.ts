import { execFileSync } from "node:child_process";
import {
  createAudioSurveyOnnxNeuralDemodulator,
  createAudioSurveyNeuralDemodulator,
  isAudioSurveyNeuralModelReady,
  shouldResetAudioSurveyNeuralStream,
} from "@n-apt/demodulation/survey/audioSurveyLiveDemod";
import type { TimeDomainDemodModel } from "@n-apt/demodulation/survey/audioSurveyMl";
import * as audioSurveyOnnxRuntime from "@n-apt/demodulation/survey/audioSurveyOnnxRuntime";
import type { AudioSurveyOnnxRuntime } from "@n-apt/demodulation/survey/audioSurveyOnnxRuntime";
import { serializeTimeDomainModelToOnnx } from "@n-apt/demodulation/survey/audioSurveyOnnx";

const makeModel = (): TimeDomainDemodModel => ({
  version: 3,
  inputSize: 128,
  hiddenSize: 12,
  inputSampleRateHz: 256_000 / 3,
  channelBandwidthHz: 32_000,
  pcmSampleRateHz: 48_000,
  inputWeights: Float32Array.from(
    { length: 128 * 12 },
    (_, i) => Math.sin(i * 0.013) * 0.02,
  ),
  hiddenBias: Float32Array.from({ length: 12 }, (_, i) => i * 0.005),
  outputWeights: Float32Array.from({ length: 12 }, (_, i) => (i + 1) * 0.01),
  outputBias: 0.01,
  trainingExamples: 4,
  trainingSamples: 10_000,
  trainingEpochs: 30,
  finalLoss: 0.01,
  updatedAt: 1,
});

const makeIq = (sampleCount: number) => {
  const iq = new Uint8Array(sampleCount * 2);
  for (let sample = 0; sample < sampleCount; sample++) {
    iq[sample * 2] = Math.round(128 + 40 * Math.sin(sample * 0.041));
    iq[sample * 2 + 1] = Math.round(128 + 34 * Math.cos(sample * 0.027));
  }
  return iq;
};

const concat = (...chunks: Float32Array[]) => {
  const samples = new Float32Array(
    chunks.reduce((sum, item) => sum + item.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
};

describe("audio survey live neural demodulator", () => {
  it("requires a held-out-winning model before live neural decoding is ready", () => {
    const model = makeModel();
    expect(
      isAudioSurveyNeuralModelReady(model, {
        status: "completed",
        modelPreferred: true,
      }),
    ).toBe(true);
    expect(
      isAudioSurveyNeuralModelReady(model, {
        status: "completed",
        modelPreferred: false,
      }),
    ).toBe(false);
    expect(
      isAudioSurveyNeuralModelReady(model, {
        status: "running",
        modelPreferred: true,
      }),
    ).toBe(false);
    expect(
      isAudioSurveyNeuralModelReady(null, {
        status: "completed",
        modelPreferred: true,
      }),
    ).toBe(false);
  });

  it("resets stream state at receive gaps, retunes, and source changes", () => {
    const previous = {
      sourceId: "rtl-0",
      streamEpoch: 4,
      sequence: 40,
      optionsRevision: 9,
      centerFrequencyHz: 25_000_000,
      sampleRateHz: 3_200_000,
    };

    expect(
      shouldResetAudioSurveyNeuralStream(previous, {
        ...previous,
        sequence: 41,
      }),
    ).toBe(false);
    expect(
      shouldResetAudioSurveyNeuralStream(previous, {
        ...previous,
        sequence: 42,
      }),
    ).toBe(true);
    expect(
      shouldResetAudioSurveyNeuralStream(previous, {
        ...previous,
        centerFrequencyHz: 25_100_000,
        sequence: 41,
      }),
    ).toBe(true);
    expect(
      shouldResetAudioSurveyNeuralStream(previous, {
        ...previous,
        sourceId: "rtl-1",
        sequence: 41,
      }),
    ).toBe(true);
  });

  it("preserves channelizer and model context across consecutive I/Q chunks", () => {
    const input = makeIq(2_049);
    const wholeFrame = createAudioSurveyNeuralDemodulator({
      model: makeModel(),
      centerFrequencyHz: 100_000,
      bandwidthHz: 32_000,
    }).process(input, 256_000, 100_000);

    const chunked = createAudioSurveyNeuralDemodulator({
      model: makeModel(),
      centerFrequencyHz: 100_000,
      bandwidthHz: 32_000,
    });
    const splitAt = 1_026;
    const chunkedOutput = concat(
      chunked.process(input.slice(0, splitAt * 2), 256_000, 100_000),
      chunked.process(input.slice(splitAt * 2), 256_000, 100_000),
    );

    expect(chunkedOutput).toEqual(wholeFrame);
    expect(wholeFrame.length).toBeGreaterThan(0);
  });

  it("runs the exported model through ONNX after the live channelizer", async () => {
    const model = makeModel();
    const input = makeIq(2_049);
    const options = {
      model,
      onnxModelData: serializeTimeDomainModelToOnnx(model),
      centerFrequencyHz: 100_000,
      bandwidthHz: 32_000,
      executionProvider: "wasm" as const,
    };
    const reference = createAudioSurveyNeuralDemodulator(options).process(
      input,
      256_000,
      100_000,
    );
    const actual = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `
            (async () => {
              const { createAudioSurveyOnnxNeuralDemodulator } = await import("./src/ts/features/demodulation/survey/audioSurveyLiveDemod.ts");
              const model = JSON.parse(process.env.NAPT_ONNX_MODEL_METADATA);
              model.inputWeights = Float32Array.from(model.inputWeights);
              model.hiddenBias = Float32Array.from(model.hiddenBias);
              model.outputWeights = Float32Array.from(model.outputWeights);
              const demodulator = await createAudioSurveyOnnxNeuralDemodulator({
                model,
                onnxModelData: Uint8Array.from(Buffer.from(process.env.NAPT_ONNX_MODEL, "base64")),
                centerFrequencyHz: 100000,
                bandwidthHz: 32000,
                executionProvider: "wasm",
              });
              try {
                const iq = Uint8Array.from(Buffer.from(process.env.NAPT_ONNX_IQ, "base64"));
                process.stdout.write(JSON.stringify(Array.from(await demodulator.process(iq, 256000, 100000))));
              } finally {
                await demodulator.dispose();
              }
            })().catch((error) => {
              console.error(error);
              process.exitCode = 1;
            });
          `,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            NAPT_ONNX_MODEL_METADATA: JSON.stringify({
              ...model,
              inputWeights: Array.from(model.inputWeights),
              hiddenBias: Array.from(model.hiddenBias),
              outputWeights: Array.from(model.outputWeights),
            }),
            NAPT_ONNX_MODEL: Buffer.from(
              serializeTimeDomainModelToOnnx(model),
            ).toString("base64"),
            NAPT_ONNX_IQ: Buffer.from(input).toString("base64"),
          },
        },
      ),
    ) as number[];
    expect(actual.length).toBe(reference.length);
    actual.forEach((sample, index) =>
      expect(sample).toBeCloseTo(reference[index], 5),
    );
  });

  it("drops frames during pending ONNX inference and invalidates stale audio", async () => {
    let resolveFirstInference: ((samples: Float32Array) => void) | undefined;
    let inferenceCount = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const runtime: AudioSurveyOnnxRuntime = {
      executionProvider: "wasm",
      async predictWindows(_windows, batchSize) {
        inferenceCount++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (inferenceCount === 1) {
          return new Promise<Float32Array>((resolve) => {
            resolveFirstInference = (samples) => {
              inFlight--;
              resolve(samples);
            };
          });
        }
        inFlight--;
        return Float32Array.from({ length: batchSize }, () => 0.25);
      },
      async release() {},
    };
    const runtimeFactory = jest
      .spyOn(audioSurveyOnnxRuntime, "createAudioSurveyOnnxRuntime")
      .mockResolvedValue(runtime);

    const demodulator = await createAudioSurveyOnnxNeuralDemodulator({
      model: makeModel(),
      onnxModelData: new Uint8Array([1]),
      centerFrequencyHz: 100_000,
      bandwidthHz: 32_000,
    });
    try {
      const firstFrame = demodulator.process(makeIq(2_049), 256_000, 100_000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(inferenceCount).toBe(1);

      await expect(
        demodulator.process(makeIq(2_049), 256_000, 100_000),
      ).resolves.toHaveLength(0);
      expect(inferenceCount).toBe(1);

      resolveFirstInference?.(new Float32Array(600).fill(0.25));
      await expect(firstFrame).resolves.toHaveLength(0);

      const recoveredFrame = await demodulator.process(
        makeIq(2_049),
        256_000,
        100_000,
      );
      expect(recoveredFrame.length).toBeGreaterThan(0);
      expect(maxInFlight).toBe(1);
    } finally {
      await demodulator.dispose();
      runtimeFactory.mockRestore();
    }
  });

  it("does not run a trained model at a different channelized I/Q rate", () => {
    const profiledModel = Object.assign(makeModel(), {
      inputSampleRateHz: 180_000,
      channelBandwidthHz: 68_000,
    });
    const processor = createAudioSurveyNeuralDemodulator({
      model: profiledModel,
      centerFrequencyHz: 100_000,
      bandwidthHz: 68_000,
    });

    expect(processor.process(makeIq(2_049), 3_200_000, 100_000)).toHaveLength(
      0,
    );
  });

  it("unlocks Neural only when the live channel width and sample rate match training", () => {
    const model = Object.assign(makeModel(), {
      inputSampleRateHz: 3_200_000 / 18,
      channelBandwidthHz: 68_000,
    });
    const training = { status: "completed", modelPreferred: true } as const;
    const checkProfile = (profile: {
      inputSampleRateHz: number;
      channelBandwidthHz: number;
    }) =>
      Reflect.apply(isAudioSurveyNeuralModelReady, undefined, [
        model,
        training,
        profile,
      ]) as boolean;

    expect(
      checkProfile({ inputSampleRateHz: 3_200_000, channelBandwidthHz: 68_000 }),
    ).toBe(true);
    expect(
      checkProfile({ inputSampleRateHz: 3_200_000, channelBandwidthHz: 32_000 }),
    ).toBe(false);
    expect(
      checkProfile({ inputSampleRateHz: 2_400_000, channelBandwidthHz: 68_000 }),
    ).toBe(false);
  });

  it("starts a fresh channelizer and model state after reset", () => {
    const input = makeIq(1_024);
    const processor = createAudioSurveyNeuralDemodulator({
      model: makeModel(),
      centerFrequencyHz: 100_000,
      bandwidthHz: 32_000,
    });
    processor.process(makeIq(512), 256_000, 100_000);
    processor.reset();

    const afterReset = processor.process(input, 256_000, 100_000);
    const fresh = createAudioSurveyNeuralDemodulator({
      model: makeModel(),
      centerFrequencyHz: 100_000,
      bandwidthHz: 32_000,
    }).process(input, 256_000, 100_000);

    expect(afterReset).toEqual(fresh);
  });
});
