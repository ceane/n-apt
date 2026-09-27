/** @jest-environment node */
import { execFileSync } from "node:child_process";
import {
  buildTimeDomainIqWindow,
  trainTimeDomainDemodModel,
  predictTimeDomainAudio,
  predictTimeDomainIqWindow,
  predictTimeDomainAudioRange,
  TimeDomainDemodStream,
  TIME_DOMAIN_INPUT_SIZE,
  TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES,
} from "@n-apt/demodulation/survey/audioSurveyMl";
import { serializeTimeDomainModelToOnnx } from "@n-apt/demodulation/survey/audioSurveyOnnx";

const makeAmExample = () => {
  const sampleRateHz = 48_000;
  const durationS = 0.25;
  const sampleCount = sampleRateHz * durationS;
  const iqData = new Uint8Array(sampleCount * 2);
  const pcm = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index++) {
    const time = index / sampleRateHz;
    const audio = 0.7 * Math.sin(2 * Math.PI * 700 * time);
    const envelope = 0.5 + 0.3 * audio;
    const phase = 2 * Math.PI * 6_000 * time;
    iqData[index * 2] = 128 + Math.round(120 * envelope * Math.cos(phase));
    iqData[index * 2 + 1] = 128 + Math.round(120 * envelope * Math.sin(phase));
    pcm[index] = audio;
  }
  return {
    iqData,
    sampleRateHz,
    pcmSamples: pcm,
    pcmSampleRateHz: sampleRateHz,
  };
};

const correlation = (left: Float32Array, right: Float32Array) => {
  let leftMean = 0;
  let rightMean = 0;
  for (let index = 0; index < left.length; index++) {
    leftMean += left[index];
    rightMean += right[index];
  }
  leftMean /= left.length;
  rightMean /= right.length;
  let covariance = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index++) {
    const x = left[index] - leftMean;
    const y = right[index] - rightMean;
    covariance += x * y;
    leftEnergy += x * x;
    rightEnergy += y * y;
  }
  return covariance / Math.sqrt(leftEnergy * rightEnergy);
};

describe("local time-domain audio model", () => {
  it("uses a causal window of raw normalized complex I/Q samples", () => {
    const iqData = new Uint8Array(80 * 2);
    for (let index = 0; index < 80; index++) {
      iqData[index * 2] = 128 + index;
      iqData[index * 2 + 1] = 128 - index;
    }
    const example = {
      iqData,
      sampleRateHz: 48_000,
      pcmSamples: new Float32Array(80),
      pcmSampleRateHz: 48_000,
    };
    const window = buildTimeDomainIqWindow(example, 79);

    expect(TIME_DOMAIN_WINDOW_COMPLEX_SAMPLES).toBe(64);
    expect(TIME_DOMAIN_INPUT_SIZE).toBe(128);
    expect(window).toHaveLength(TIME_DOMAIN_INPUT_SIZE);
    expect(window[0]).toBeCloseTo(16 / 128);
    expect(window[1]).toBeCloseTo(-16 / 128);
    expect(window[window.length - 2]).toBeCloseTo(79 / 128);
    expect(window[window.length - 1]).toBeCloseTo(-79 / 128);
  });

  it("learns an IQ-window-to-PCM mapping from a paired AM stimulus", () => {
    const example = makeAmExample();
    const model = trainTimeDomainDemodModel([example], {
      epochs: 100,
      maxTrainingSamples: 4096,
      learningRate: 0.005,
    });
    const recovered = predictTimeDomainAudio(model, {
      iqData: example.iqData,
      sampleRateHz: example.sampleRateHz,
      pcmSampleRateHz: example.pcmSampleRateHz,
    });

    expect(recovered.samples.length).toBe(example.pcmSamples.length);
    expect(
      correlation(recovered.samples.slice(100), example.pcmSamples.slice(100)),
    ).toBeGreaterThan(0.8);
    expect(recovered.samples.some((sample) => Math.abs(sample) > 0.02)).toBe(
      true,
    );
  });

  it("predicts a bounded PCM excerpt using the original aligned I/Q context", () => {
    const example = makeAmExample();
    const model = trainTimeDomainDemodModel([example], {
      epochs: 1,
      maxTrainingSamples: 128,
      seed: 19,
    });
    const full = predictTimeDomainAudio(model, {
      iqData: example.iqData,
      sampleRateHz: example.sampleRateHz,
      pcmSampleRateHz: example.pcmSampleRateHz,
    });
    const excerpt = predictTimeDomainAudioRange(model, example, {
      startSample: 200,
      endSample: 264,
    });

    expect(excerpt.samples).toEqual(full.samples.slice(200, 264));
    expect(excerpt.sampleRateHz).toBe(full.sampleRateHz);
  });

  it("keeps temporal context across streaming I/Q chunks", () => {
    const sampleRateHz = 68_000;
    const pcmSampleRateHz = 48_000;
    const iqSampleCount = 3_400;
    const pcmSampleCount = 2_400;
    const iqData = new Uint8Array(iqSampleCount * 2);
    const pcmSamples = new Float32Array(pcmSampleCount);
    for (let index = 0; index < iqSampleCount; index++) {
      const time = index / sampleRateHz;
      const audio = 0.6 * Math.sin(2 * Math.PI * 700 * time);
      const phase = 2 * Math.PI * 6_000 * time;
      const envelope = 0.55 + audio * 0.35;
      iqData[index * 2] = 128 + Math.round(120 * envelope * Math.cos(phase));
      iqData[index * 2 + 1] =
        128 + Math.round(120 * envelope * Math.sin(phase));
    }
    for (let index = 0; index < pcmSampleCount; index++) {
      pcmSamples[index] =
        0.6 * Math.sin((2 * Math.PI * 700 * index) / pcmSampleRateHz);
    }
    const example = {
      iqData,
      sampleRateHz,
      pcmSamples,
      pcmSampleRateHz,
    };
    const model = trainTimeDomainDemodModel([example], {
      epochs: 1,
      maxTrainingSamples: 128,
      seed: 23,
    });
    const batch = predictTimeDomainAudio(model, {
      iqData,
      sampleRateHz,
      pcmSampleRateHz,
      outputSampleCount: pcmSampleCount,
    });
    const stream = new TimeDomainDemodStream(model, {
      inputSampleRateHz: sampleRateHz,
      pcmSampleRateHz,
    });
    const boundaries = [0, 777, 2_001, iqSampleCount];
    const outputChunks = boundaries
      .slice(1)
      .map((end, index) =>
        stream.processIqChunk(iqData.subarray(boundaries[index] * 2, end * 2)),
      );
    const streamed = Float32Array.from(
      outputChunks.flatMap((chunk) => Array.from(chunk)),
    );

    expect(streamed).toEqual(batch.samples);
    stream.reset();
    expect(stream.processIqChunk(iqData)).toEqual(batch.samples);

    const mutableOptions = { inputSampleRateHz: sampleRateHz, pcmSampleRateHz };
    const stableStream = new TimeDomainDemodStream(model, mutableOptions);
    mutableOptions.inputSampleRateHz = 24_000;
    expect(stableStream.processIqChunk(iqData)).toEqual(batch.samples);

    const lowerRateExample = {
      ...example,
      sampleRateHz: 24_000,
      pcmSamples: new Float32Array(6_800),
    };
    const upsampledBatch = predictTimeDomainAudio(model, {
      iqData,
      sampleRateHz: lowerRateExample.sampleRateHz,
      pcmSampleRateHz,
      outputSampleCount: lowerRateExample.pcmSamples.length,
    });
    const upsampledStream = new TimeDomainDemodStream(model, {
      inputSampleRateHz: lowerRateExample.sampleRateHz,
      pcmSampleRateHz,
    });
    const upsampledOutput = Float32Array.from(
      upsampledStream.processIqChunk(iqData),
    );

    expect(upsampledOutput).toEqual(upsampledBatch.samples);
  });

  it("exports an executable ONNX model matching the local reference predictor", () => {
    const example = makeAmExample();
    const model = trainTimeDomainDemodModel([example], {
      epochs: 2,
      maxTrainingSamples: 128,
      seed: 19,
    });
    const windows = [200, 201, 202].map((sampleIndex) =>
      buildTimeDomainIqWindow(example, sampleIndex),
    );
    const input = Float32Array.from(
      windows.flatMap((window) => Array.from(window)),
    );
    const expected = windows.map((window) =>
      predictTimeDomainIqWindow(model, window),
    );
    const onnxModel = serializeTimeDomainModelToOnnx(model);
    const execution = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          `
            const ort = require("onnxruntime-node");
            (async () => {
              const model = Uint8Array.from(Buffer.from(process.env.NAPT_ONNX_MODEL, "base64"));
              const input = Float32Array.from(JSON.parse(process.env.NAPT_ONNX_INPUT));
              const session = await ort.InferenceSession.create(model);
              try {
                const result = await session.run({
                  iq_windows: new ort.Tensor("float32", input, [input.length / 128, 128]),
                });
                process.stdout.write(JSON.stringify({
                  inputNames: session.inputNames,
                  outputNames: session.outputNames,
                  values: Array.from(result.pcm.data),
                }));
              } finally {
                await session.release();
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
            NAPT_ONNX_MODEL: Buffer.from(onnxModel).toString("base64"),
            NAPT_ONNX_INPUT: JSON.stringify(Array.from(input)),
          },
        },
      ),
    );

    expect(execution.inputNames).toEqual(["iq_windows"]);
    expect(execution.outputNames).toEqual(["pcm"]);
    expect(execution.values).toHaveLength(expected.length);
    execution.values.forEach((value: number, index: number) => {
      expect(value).toBeCloseTo(expected[index], 5);
    });
  });

  it("can checkpoint after an epoch and resume with the same waveform weights", () => {
    const example = makeAmExample();
    const options = { maxTrainingSamples: 512, learningRate: 0.01, seed: 19 };
    const uninterrupted = trainTimeDomainDemodModel([example], {
      ...options,
      epochs: 3,
    });
    const firstChunk = trainTimeDomainDemodModel([example], {
      ...options,
      epochs: 1,
      startEpoch: 0,
    });
    const secondChunk = trainTimeDomainDemodModel([example], {
      ...options,
      epochs: 1,
      startEpoch: 1,
      initialModel: firstChunk,
    });
    const resumed = trainTimeDomainDemodModel([example], {
      ...options,
      epochs: 1,
      startEpoch: 2,
      initialModel: secondChunk,
    });

    expect(resumed.trainingEpochs).toBe(3);
    expect(Array.from(resumed.inputWeights)).toEqual(
      Array.from(uninterrupted.inputWeights),
    );
    expect(Array.from(resumed.outputWeights)).toEqual(
      Array.from(uninterrupted.outputWeights),
    );
  });
});
