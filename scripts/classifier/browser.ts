import * as core from '@n-apt/classification';

export async function initialize() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', event => { throw new Error(event.error.message); });
  const gpu = new core.NativeGpuExtractor(device);
  const temporal = new Map<string, core.TemporalClassifier>();
  return {
    async extract(spectrum: number[], metadata: core.FrameMetadata, model?: core.NativeModel) {
      const frame = { spectrum: new Float32Array(spectrum), metadata };
      const start = performance.now();
      const bins = await gpu.extract(frame);
      const summary = core.summarizeFeatures(frame, bins);
      let tracker = temporal.get(metadata.sourceId);
      if (!tracker) { tracker = new core.TemporalClassifier(); temporal.set(metadata.sourceId, tracker); }
      const result = tracker.update(metadata, summary);
      if (!result) return null;
      const score = model && result.status === 'ready' ? core.inferModel(core.validateModel(model), result.values) : null;
      return { ...result, metadata, modelScore: score, modelDecision: score === null ? null : score >= model!.threshold,
        sampleRateValidated: !!model?.validatedSampleRatesHz.includes(metadata.analysisSampleRateHz), latencyMs: performance.now() - start };
    },
    async inferParity(models: core.NativeModel[], probes: number[][]) {
      const comparisons = [];
      let maxInferenceError = 0;
      for (const artifact of models) {
        const model = core.validateModel(artifact);
        for (let probeIndex = 0; probeIndex < probes.length; probeIndex++) {
          const features = probes[probeIndex];
          const typescriptScore = core.inferModel(model, features);
          const webgpuScore = await gpu.infer(model, features);
          const error = Math.abs(webgpuScore - typescriptScore);
          maxInferenceError = Math.max(maxInferenceError, error);
          comparisons.push({ modelId: model.id, kind: model.kind, probeIndex,
            typescriptScore, webgpuScore, error });
        }
      }
      return { maxInferenceError, comparisons };
    },
    async parity() {
      let maxFeatureError = 0, maxInferenceError = 0;
      const latencies: number[] = [];
      let worst: unknown;
      for (const fftSize of [1024, 4096, 16384]) {
        for (const crop of [0, 127]) {
          const spectrum = Float32Array.from({ length: fftSize - 2 * crop }, (_, i) => -90 + 15 * Math.sin((i + crop) * 0.013) + 8 * Math.cos((i + crop) * 0.171));
          const frame = { spectrum, metadata: { sourceId: 'test', frameId: `${fftSize}-${crop}`, timestampMs: 0, acquisitionSampleRateHz: 3200000, analysisSampleRateHz: 3200000, fftSize, validSamples: fftSize, window: 'hann' as const, centerFrequencyHz: 0, retainedStartBin: crop, retainedEndBin: fftSize - crop } };
          const start = performance.now(); const actual = await gpu.extract(frame); latencies.push(performance.now() - start);
          const expected = core.extractReference(frame);
          actual.forEach((v, i) => { if (Math.abs(v - expected[i]) > maxFeatureError) { maxFeatureError = Math.abs(v - expected[i]); worst = { fftSize, crop, i, actual: v, expected: expected[i] }; } });
          const features = core.summarizeFeatures(frame, actual).values;
          for (const kind of ['logistic', 'mlp'] as const) {
            const hidden = kind === 'logistic' ? 1 : 16;
            const model = core.validateModel({ version: 1, preprocessing: core.PREPROCESSING, id: 'parity', kind, featureNames: [...core.FEATURE_NAMES], mean: features.map(() => 0.3), scale: features.map(() => 0.7), weights: Array.from({ length: hidden }, (_, j) => features.map((_, i) => Math.sin(i + j) * 0.2)), bias: Array.from({ length: hidden }, (_, i) => i * 0.01), outputWeights: Array.from({ length: 16 }, (_, i) => Math.cos(i) * 0.2), outputBias: -0.2, threshold: 0.5, validatedSampleRatesHz: [] });
            maxInferenceError = Math.max(maxInferenceError, Math.abs(await gpu.infer(model, features) - core.inferModel(model, features)));
          }
        }
      }
      return { maxFeatureError, maxInferenceError, worst, extractionLatencyMs: latencies, adapter: adapter.info };
    },
    close() { gpu.dispose(); device.destroy(); },
  };
}
