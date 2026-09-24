import * as NativeClassifier from '@n-apt/classification';

const metadata = (patch = {}) => ({ sourceId: 'rx', frameId: '1', timestampMs: 1000, acquisitionSampleRateHz: 3200000, analysisSampleRateHz: 3200000, fftSize: 4096, validSamples: 4096, window: 'hann' as const, centerFrequencyHz: 10000000, retainedStartBin: 0, retainedEndBin: 4096, ...patch });
const frame = (patch = {}, length = 4096) => ({ spectrum: new Float32Array(length).fill(-80), metadata: metadata(patch) });

describe('native morphology contract', () => {
  it('preserves bin spacing and origin after frequency cropping', () => {
    const d = NativeClassifier.describeFrame(frame({ retainedStartBin: 100, retainedEndBin: 300 }, 200));
    expect(d.binHz).toBe(781.25);
    expect(d.firstBinHz).toBe(8400000 + 100 * 781.25);
    expect(d.cropped).toBe(true);
  });
  it('distinguishes zero padding from acquired resolution', () => {
    const d = NativeClassifier.describeFrame(frame({ validSamples: 1024 }));
    expect(d.binHz).toBe(781.25);
    expect(d.resolutionHz).toBe(4687.5);
    expect(d.incomplete).toBe(true);
  });
  it('rejects invalid metadata and nonfinite bins', () => {
    expect(() => NativeClassifier.describeFrame(frame({ analysisSampleRateHz: 0 }))).toThrow();
    expect(() => NativeClassifier.describeFrame(frame({ retainedEndBin: 5000 }))).toThrow();
    const f = frame(); f.spectrum[5] = NaN;
    expect(() => NativeClassifier.describeFrame(f)).toThrow();
  });
  it('marks unresolved narrow detail and clipped envelopes unavailable', () => {
    const f = frame({ fftSize: 64, validSamples: 64, retainedEndBin: 64 }, 64);
    const result = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    expect(result.available.narrow).toBe(false);
    expect(result.status).toBe('insufficient_evidence');
    const crop = frame({ retainedStartBin: 100, retainedEndBin: 104 }, 4);
    expect(NativeClassifier.summarizeFeatures(crop, NativeClassifier.extractReference(crop)).available.envelope).toBe(false);
  });
  it('is independent of a constant gain offset and detects supported shape', () => {
    const f = frame();
    for (let i = 0; i < 4096; i++) f.spectrum[i] += 25 * Math.exp(-(((i - 2000) / 65) ** 2));
    const a = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    const g = { ...f, spectrum: Float32Array.from(f.spectrum, x => x + 30) };
    const b = NativeClassifier.summarizeFeatures(g, NativeClassifier.extractReference(g));
    expect(a.values.length).toBe(NativeClassifier.FEATURE_NAMES.length);
    a.values.forEach((x, i) => expect(x).toBeCloseTo(b.values[i], 4));
    expect(a.values[NativeClassifier.FEATURE_NAMES.indexOf('bridge')]).toBeGreaterThan(0.1);
  });
  it('deduplicates frames and resets on source, crop, window and stale gaps', () => {
    const tracker = new NativeClassifier.TemporalClassifier();
    const f = frame(); const features = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    expect(tracker.update(f.metadata, features)?.frameCount).toBe(1);
    expect(tracker.update(f.metadata, features)).toBeNull();
    expect(tracker.update(metadata({ frameId: '2', timestampMs: 1100 }), features)?.frameCount).toBe(2);
    expect(tracker.update(metadata({ sourceId: 'other', frameId: '3', timestampMs: 1200 }), features)?.frameCount).toBe(1);
    expect(tracker.update(metadata({ frameId: '4', timestampMs: 5000 }), features)?.frameCount).toBe(1);
  });
  it('validates model structure and refuses mismatched feature contracts', () => {
    const model = { version: 1, preprocessing: 'native-morphology-v1', featureNames: [...NativeClassifier.FEATURE_NAMES], kind: 'logistic', mean: NativeClassifier.FEATURE_NAMES.map(() => 0), scale: NativeClassifier.FEATURE_NAMES.map(() => 1), weights: [NativeClassifier.FEATURE_NAMES.map(() => 0)], bias: [0], threshold: 0.5, validatedSampleRatesHz: [], id: 'test' };
    expect(NativeClassifier.inferModel(NativeClassifier.validateModel(model), NativeClassifier.FEATURE_NAMES.map(() => 0))).toBe(0.5);
    expect(() => NativeClassifier.validateModel({ ...model, scale: [0] })).toThrow();
    expect(() => NativeClassifier.validateModel({ ...model, featureNames: ['incorrect'] })).toThrow();
  });
});

import * as Spectrum from '@n-apt/spectrum';

it.each(['rectangular', 'hann', 'hamming', 'blackman', 'nuttall'] as const)(
  'offline I/Q FFT matches the existing browser scalar FFT for %s, including incomplete frames',
  window => {
    for (const samples of [750, 1024]) {
      const bytes = Uint8Array.from({ length: samples * 2 }, (_, i) => 128 + Math.round(90 * Math.sin(i * 0.13)));
      const normalized = Float32Array.from(bytes, x => (x - 128) / 128);
      const actual = NativeClassifier.spectrumFromIq(normalized, 1024, window);
      const expected = Spectrum.computeComplexIqSpectrum(bytes, 1024, window);
      expect(actual.fftSize).toBe(expected.fftLen);
      expect(actual.validSamples).toBe(expected.numSamples);
      for (let i = 0; i < actual.fftSize; i++) {
        const j = (i + actual.fftSize / 2) % actual.fftSize;
        const db = 10 * Math.log10((expected.real[j] ** 2 + expected.imag[j] ** 2) / expected.normSq + 1e-15);
        expect(actual.spectrum[i]).toBeCloseTo(db, 4);
      }
    }
  },
);
