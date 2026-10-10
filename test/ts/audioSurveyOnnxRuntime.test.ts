/** @jest-environment node */
import { execFileSync } from "node:child_process";
import {
  TimeDomainOnnxDemodStream,
  TIME_DOMAIN_ONNX_MAX_BATCH_SIZE,
  type AudioSurveyOnnxRuntime,
} from "@n-apt/demodulation/survey/audioSurveyOnnxRuntime";
import {
  buildTimeDomainIqWindow,
  trainTimeDomainDemodModel,
  predictTimeDomainIqWindow,
  TimeDomainDemodStream,
  TIME_DOMAIN_INPUT_SIZE,
} from "@n-apt/demodulation/survey/audioSurveyMl";
import { serializeTimeDomainModelToOnnx } from "@n-apt/demodulation/survey/audioSurveyOnnx";

const makeExample = () => {
  const sampleRateHz = 48_000;
  const iqData = new Uint8Array(512 * 2);
  const pcmSamples = new Float32Array(512);
  for (let index = 0; index < pcmSamples.length; index++) {
    const time = index / sampleRateHz;
    const audio = 0.6 * Math.sin(2 * Math.PI * 700 * time);
    const phase = 2 * Math.PI * 6_000 * time;
    const envelope = 0.55 + audio * 0.35;
    iqData[index * 2] = 128 + Math.round(120 * envelope * Math.cos(phase));
    iqData[index * 2 + 1] = 128 + Math.round(120 * envelope * Math.sin(phase));
    pcmSamples[index] = audio;
  }
  return { iqData, sampleRateHz, pcmSamples, pcmSampleRateHz: sampleRateHz };
};

const trainModel = () =>
  trainTimeDomainDemodModel([makeExample()], {
    epochs: 1,
    maxTrainingSamples: 128,
    seed: 41,
  });

describe("ONNX audio demodulation runtime", () => {
  it("bounds ONNX inference batches while preserving output order", async () => {
    const batchSizes: number[] = [];
    const runtime: AudioSurveyOnnxRuntime = {
      executionProvider: "wasm",
      async predictWindows(windows, batchSize) {
        expect(windows).toHaveLength(batchSize * TIME_DOMAIN_INPUT_SIZE);
        batchSizes.push(batchSize);
        return Float32Array.from({ length: batchSize }, (_, index) => index);
      },
      async release() {},
    };
    const stream = new TimeDomainOnnxDemodStream(runtime, {
      inputSampleRateHz: 48_000,
      pcmSampleRateHz: 48_000,
    });
    const sampleCount = TIME_DOMAIN_ONNX_MAX_BATCH_SIZE + 17;
    const result = await stream.processIqChunk(new Uint8Array(sampleCount * 2).fill(128));

    expect(batchSizes).toEqual([TIME_DOMAIN_ONNX_MAX_BATCH_SIZE, 17]);
    expect(result).toHaveLength(sampleCount);
    expect(Array.from(result.slice(0, TIME_DOMAIN_ONNX_MAX_BATCH_SIZE))).toEqual(
      Array.from({ length: TIME_DOMAIN_ONNX_MAX_BATCH_SIZE }, (_, index) => index),
    );
    expect(Array.from(result.slice(TIME_DOMAIN_ONNX_MAX_BATCH_SIZE))).toEqual(
      Array.from({ length: 17 }, (_, index) => index),
    );
  });

  it("runs exported model windows through the local ONNX Runtime backend", async () => {
    const model = trainModel();
    const windows = [13, 14, 15].map((sampleIndex) =>
      buildTimeDomainIqWindow(makeExample(), sampleIndex),
    );
    const flattened = Float32Array.from(
      windows.flatMap((window) => Array.from(window)),
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
              const { createAudioSurveyOnnxRuntime } = await import("./src/ts/features/demodulation/survey/audioSurveyOnnxRuntime.ts");
              const model = Uint8Array.from(Buffer.from(process.env.NAPT_ONNX_MODEL, "base64"));
              const windows = Float32Array.from(JSON.parse(process.env.NAPT_ONNX_INPUT));
              const batchSize = Number(process.env.NAPT_ONNX_BATCH_SIZE);
              const runtime = await createAudioSurveyOnnxRuntime(model, { executionProvider: "wasm" });
              try {
                process.stdout.write(JSON.stringify(Array.from(await runtime.predictWindows(windows, batchSize))));
              } finally {
                await runtime.release();
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
            NAPT_ONNX_MODEL: Buffer.from(
              serializeTimeDomainModelToOnnx(model),
            ).toString("base64"),
            NAPT_ONNX_INPUT: JSON.stringify(Array.from(flattened)),
            NAPT_ONNX_BATCH_SIZE: String(windows.length),
          },
        },
      ),
    ) as number[];
    const expected = windows.map((window) =>
      predictTimeDomainIqWindow(model, window),
    );
    expect(actual).toHaveLength(expected.length);
    actual.forEach((sample, index) =>
      expect(sample).toBeCloseTo(expected[index], 5),
    );
  });

  it("keeps streamed I/Q window context and output order across async chunks", async () => {
    const example = makeExample();
    const model = trainTimeDomainDemodModel([example], {
      epochs: 1,
      maxTrainingSamples: 128,
      seed: 43,
    });
    const reference = new TimeDomainDemodStream(model, {
      inputSampleRateHz: example.sampleRateHz,
      pcmSampleRateHz: example.pcmSampleRateHz,
    });
    const boundaries = [0, 127, 311, example.pcmSamples.length];
    const expectedChunks = boundaries
      .slice(1)
      .map((end, index) =>
        reference.processIqChunk(
          example.iqData.subarray(boundaries[index] * 2, end * 2),
        ),
      );
    const expected = Float32Array.from(
      expectedChunks.flatMap((chunk) => Array.from(chunk)),
    );
    reference.reset();
    const freshOutput = reference.processIqChunk(example.iqData);
    const execution = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `
            (async () => {
              const { createAudioSurveyOnnxRuntime, TimeDomainOnnxDemodStream } = await import("./src/ts/features/demodulation/survey/audioSurveyOnnxRuntime.ts");
              const model = Uint8Array.from(Buffer.from(process.env.NAPT_ONNX_MODEL, "base64"));
              const iq = Uint8Array.from(Buffer.from(process.env.NAPT_ONNX_IQ, "base64"));
              const boundaries = JSON.parse(process.env.NAPT_ONNX_BOUNDARIES);
              const sampleRateHz = Number(process.env.NAPT_ONNX_SAMPLE_RATE);
              const runtime = await createAudioSurveyOnnxRuntime(model, { executionProvider: "wasm" });
              const stream = new TimeDomainOnnxDemodStream(runtime, {
                inputSampleRateHz: sampleRateHz,
                pcmSampleRateHz: sampleRateHz,
              });
              try {
                const chunks = await Promise.all(boundaries.slice(1).map((end, index) =>
                  stream.processIqChunk(iq.subarray(boundaries[index] * 2, end * 2))
                ));
                const streamed = chunks.flatMap((chunk) => Array.from(chunk));
                stream.reset();
                const reset = Array.from(await stream.processIqChunk(iq));
                process.stdout.write(JSON.stringify({ streamed, reset }));
              } finally {
                stream.reset();
                await runtime.release();
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
            NAPT_ONNX_MODEL: Buffer.from(
              serializeTimeDomainModelToOnnx(model),
            ).toString("base64"),
            NAPT_ONNX_IQ: Buffer.from(example.iqData).toString("base64"),
            NAPT_ONNX_BOUNDARIES: JSON.stringify(boundaries),
            NAPT_ONNX_SAMPLE_RATE: String(example.sampleRateHz),
          },
        },
      ),
    ) as { streamed: number[]; reset: number[] };
    expect(execution.streamed.length).toBe(expected.length);
    execution.streamed.forEach((sample, index) =>
      expect(sample).toBeCloseTo(expected[index], 5),
    );
    expect(execution.reset).toHaveLength(freshOutput.length);
    execution.reset.forEach((sample, index) =>
      expect(sample).toBeCloseTo(freshOutput[index], 5),
    );
    expect(TIME_DOMAIN_INPUT_SIZE).toBe(128);
  });
});
