import * as NativeClassifier from '@n-apt/classification';

const metadata = (patch = {}) => ({ sourceId: 'rx', frameId: '1', timestampMs: 1000, acquisitionSampleRateHz: 3200000, analysisSampleRateHz: 3200000, fftSize: 4096, validSamples: 4096, window: 'hann' as const, centerFrequencyHz: 10000000, retainedStartBin: 0, retainedEndBin: 4096, ...patch });
const frame = (patch = {}, length = 4096) => ({ spectrum: new Float32Array(length).fill(-80), metadata: metadata(patch) });

describe('native morphology contract', () => {
  it.each([
    ['Rectangular', 'rectangular'],
    ['Hanning', 'hann'],
    ['HANN', 'hann'],
    ['none', 'rectangular'],
    ['Nuttall', 'nuttall'],
  ] as const)('normalizes applied window name %s to classifier metadata %s', (input, expected) => {
    expect(NativeClassifier.normalizeNativeWindowKind(input)).toBe(expected);
  });

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
    const cropSummary = NativeClassifier.summarizeFeatures(crop, NativeClassifier.extractReference(crop));
    expect(cropSummary.available.envelope).toBe(false);
    expect(cropSummary.status).toBe('insufficient_evidence');
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
  it('matches the live classifier sampling interval for offline temporal summaries', () => {
    const tracker = new NativeClassifier.TemporalClassifier();
    const f = frame(); const features = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    expect(tracker.update(metadata({ frameId: '10', timestampMs: 1000 }), features, 250)?.frameCount).toBe(1);
    expect(tracker.update(metadata({ frameId: '11', timestampMs: 1100 }), features, 250)).toBeNull();
    expect(tracker.update(metadata({ frameId: '12', timestampMs: 1250 }), features, 250)).toMatchObject({ frameCount: 2, evidenceMs: 250 });
  });
  it('returns a current insufficient-evidence result so callers can clear an older score', () => {
    const tracker = new NativeClassifier.TemporalClassifier();
    const f = frame();
    const ready = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    expect(tracker.update(metadata({ frameId: '10', timestampMs: 1000 }), ready)?.status).toBe('ready');
    const insufficient = { ...ready, status: 'insufficient_evidence' as const,
      available: { narrow: false, bridge: false, envelope: false } };
    expect(tracker.update(metadata({ frameId: '11', timestampMs: 1250 }), insufficient)).toMatchObject({
      status: 'insufficient_evidence', frameCount: 0, evidenceMs: 0, ruleScore: null,
    });
  });
  it('ignores delayed or same-timestamp frames without resetting temporal history', () => {
    const tracker = new NativeClassifier.TemporalClassifier();
    const f = frame(); const features = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    expect(tracker.update(metadata({ frameId: '10', sequence: 10, timestampMs: 1000 }), features)?.frameCount).toBe(1);
    expect(tracker.update(metadata({ frameId: '12', sequence: 12, timestampMs: 1100 }), features)?.frameCount).toBe(2);
    expect(tracker.update(metadata({ frameId: '11', sequence: 11, timestampMs: 1050 }), features)).toBeNull();
    expect(tracker.update(metadata({ frameId: '13', sequence: 13, timestampMs: 1200 }), features)).toMatchObject({ frameCount: 3, evidenceMs: 200 });
    expect(tracker.update(metadata({ frameId: '14', sequence: 14, timestampMs: 1200 }), features)).toBeNull();
  });
  it('resets temporal history on stream epoch and applied-options revision changes', () => {
    const tracker = new NativeClassifier.TemporalClassifier();
    const f = frame(); const features = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    expect(tracker.update(metadata({ frameId: '10', sequence: 10, timestampMs: 1000, streamEpoch: 3, optionsRevision: 4 }), features)?.frameCount).toBe(1);
    expect(tracker.update(metadata({ frameId: '0', sequence: 0, timestampMs: 1001, streamEpoch: 4, optionsRevision: 4 }), features)?.frameCount).toBe(1);
    expect(tracker.update(metadata({ frameId: '1', sequence: 1, timestampMs: 1002, streamEpoch: 4, optionsRevision: 5 }), features)?.frameCount).toBe(1);
  });
  it('does not convert insufficient feature support into negative persistence', () => {
    const tracker = new NativeClassifier.TemporalClassifier();
    const f = frame(); const features = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    expect(tracker.update(metadata({ frameId: '10', timestampMs: 1000 }), features)?.frameCount).toBe(1);
    expect(tracker.update(metadata({ frameId: '11', timestampMs: 1100 }), {
      ...features, status: 'insufficient_evidence', available: { narrow: false, bridge: false, envelope: false },
    })).toMatchObject({ status: 'insufficient_evidence', frameCount: 0, evidenceMs: 0, ruleScore: null });
    expect(tracker.update(metadata({ frameId: '12', timestampMs: 1200 }), features)).toMatchObject({ frameCount: 1, evidenceMs: 0 });
  });
  it('keeps temporal evidence unchanged when repaint cadence reprocesses the same acquisitions', () => {
    const tracker = new NativeClassifier.TemporalClassifier();
    const f = frame(); const features = NativeClassifier.summarizeFeatures(f, NativeClassifier.extractReference(f));
    let result: ReturnType<typeof tracker.update> = null;
    for (const [sequence, timestampMs] of [[10, 1000], [11, 1100], [12, 1200]]) {
      const acquired = metadata({ frameId: String(sequence), sequence, timestampMs });
      result = tracker.update(acquired, features);
      expect(result).not.toBeNull();
      for (let repaint = 0; repaint < 4; repaint++) expect(tracker.update(acquired, features)).toBeNull();
    }
    expect(result).toMatchObject({ frameCount: 3, evidenceMs: 200 });
  });
  it('validates model structure and refuses mismatched feature contracts', () => {
    const model = { version: 1, preprocessing: 'native-morphology-v1', featureNames: [...NativeClassifier.FEATURE_NAMES], kind: 'logistic', mean: NativeClassifier.FEATURE_NAMES.map(() => 0), scale: NativeClassifier.FEATURE_NAMES.map(() => 1), weights: [NativeClassifier.FEATURE_NAMES.map(() => 0)], bias: [0], threshold: 0.5, validatedSampleRatesHz: [], id: 'test' };
    expect(NativeClassifier.inferModel(NativeClassifier.validateModel(model), NativeClassifier.FEATURE_NAMES.map(() => 0))).toBe(0.5);
    expect(() => NativeClassifier.validateModel({ ...model, scale: [0] })).toThrow();
    expect(() => NativeClassifier.validateModel({ ...model, featureNames: ['incorrect'] })).toThrow();
  });
});

import * as Spectrum from '@n-apt/spectrum/fft/complexSpectrum';

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
