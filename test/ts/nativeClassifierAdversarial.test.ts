import * as NativeClassifier from '@n-apt/classification';

const RATE = 3_200_000;
const N = 4096;
const CENTER = N / 2;
const metadata = (patch: Record<string, unknown> = {}) => ({
  sourceId: 'adversarial-fixture', frameId: '0', timestampMs: 1,
  acquisitionSampleRateHz: RATE, analysisSampleRateHz: RATE, fftSize: N,
  validSamples: N, window: 'hann' as const, centerFrequencyHz: 10_000_000,
  retainedStartBin: 0, retainedEndBin: N, ...patch,
});

function summarizeDb(makeSignal: (frequencyHz: number) => number, crop?: [number, number]) {
  const [start, end] = crop ?? [0, N];
  const spectrum = Float32Array.from({ length: end - start }, (_, j) => {
    const bin = start + j;
    const offsetHz = (bin - CENTER) * RATE / N;
    return makeSignal(offsetHz);
  });
  const frame = { spectrum, metadata: metadata({ retainedStartBin: start, retainedEndBin: end }) };
  const summary = NativeClassifier.summarizeFeatures(frame, NativeClassifier.extractReference(frame));
  return { summary, score: NativeClassifier.deterministicScore(summary.values) };
}

const sincSquared = (offsetHz: number, scaleHz: number) => {
  const x = Math.PI * offsetHz / scaleHz;
  const sinc = x === 0 ? 1 : Math.sin(x) / x;
  return sinc * sinc;
};

describe('native classifier synthetic shape characterization', () => {
  it('extracts diagnostics from constructed spectra without treating them as evaluation examples', () => {
    const floor = -95;
    const bpsk = summarizeDb(offset => {
      const power = sincSquared(offset, 600_000);
      return 10 * Math.log10(1e-12 + power * 1e-3) + 30 + floor;
    });
    // Approximate the app mock's sinc-squared BPSK pedestal in dB, with a bounded floor.
    const mockBpsk = summarizeDb(offset => {
      const tEff = offset / 1_500_000;
      const power = sincSquared(tEff * 1_500_000, 600_000);
      return 10 * Math.log10(1e-12 + power * 10 ** (-55 / 10)) - 95;
    });
    const edgeSinc = summarizeDb(offset =>
      10 * Math.log10(1e-12 + sincSquared(offset - 1_200_000, 180_000)) * 0.7 - 80,
      [0, 2600],
    );
    const morphology = summarizeDb(offset => {
      const x = offset / 12_000;
      const bridge = Math.exp(-((x / 4.5) ** 2));
      const u = 0.5 * (Math.exp(-(((x - 14) / 5) ** 2)) + Math.exp(-(((x + 14) / 5) ** 2)));
      return -90 + 24 * Math.max(bridge, u);
    });
    const diagnostics = (result: ReturnType<typeof summarizeDb>) => ({
      score: Number(result.score.toFixed(4)), status: result.summary.status,
      bridge: Number(result.summary.values[NativeClassifier.FEATURE_NAMES.indexOf('bridge')].toFixed(4)),
      partialBridge: Number(result.summary.values[NativeClassifier.FEATURE_NAMES.indexOf('partialBridge')].toFixed(4)),
      uDip: Number(result.summary.values[NativeClassifier.FEATURE_NAMES.indexOf('uDip')].toFixed(4)),
      spacingRegularity: Number(result.summary.values[NativeClassifier.FEATURE_NAMES.indexOf('spacingRegularity')].toFixed(4)),
      prominence: Number(result.summary.values[NativeClassifier.FEATURE_NAMES.indexOf('prominence')].toFixed(4)),
      available: result.summary.available,
    });
    // These assertions characterize extractor mechanics only. The constructed shapes are not
    // representative evidence about live N-APT or a substitute for labeled capture evaluation.
    expect(mockBpsk.summary.values).toHaveLength(NativeClassifier.FEATURE_NAMES.length);
    expect(edgeSinc.summary.resolution.resolutionHz).toBeGreaterThan(0);
    expect(morphology.summary.status).toBe('ready');
    console.info('synthetic classifier shape diagnostics (not signal evaluation)', JSON.stringify({
      bpsk: diagnostics(bpsk), mockBpsk: diagnostics(mockBpsk),
      edgeSinc: diagnostics(edgeSinc), morphology: diagnostics(morphology),
    }));
  });

  it('exposes no temporal pulse or within-frame spike-spacing feature in v1', () => {
    expect(NativeClassifier.FEATURE_NAMES).not.toContain('pulseRateHz');
    expect(NativeClassifier.FEATURE_NAMES).not.toContain('spikeSpacingRegularity');
    expect(NativeClassifier.FEATURE_NAMES).toContain('spacingRegularity');
  });
});
