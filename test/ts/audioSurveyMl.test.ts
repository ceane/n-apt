import {
  trainTimeDomainDemodModel,
  predictTimeDomainAudio,
} from "@n-apt/demodulation/survey/audioSurveyMl";

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
  return { iqData, sampleRateHz, pcmSamples: pcm, pcmSampleRateHz: sampleRateHz };
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
  it("learns a waveform-only IQ-to-PCM mapping from a paired AM stimulus", () => {
    const example = makeAmExample();
    const model = trainTimeDomainDemodModel([example], {
      epochs: 35,
      maxTrainingSamples: 4096,
      learningRate: 0.02,
    });
    const recovered = predictTimeDomainAudio(model, {
      iqData: example.iqData,
      sampleRateHz: example.sampleRateHz,
      pcmSampleRateHz: example.pcmSampleRateHz,
    });

    expect(recovered.samples.length).toBe(example.pcmSamples.length);
    expect(correlation(recovered.samples.slice(100), example.pcmSamples.slice(100))).toBeGreaterThan(0.8);
    expect(recovered.samples.some((sample) => Math.abs(sample) > 0.02)).toBe(true);
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
