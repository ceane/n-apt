/** Versioned, display-independent morphology contract shared by browser and CLI. */
export const PREPROCESSING = 'native-morphology-v1';
export const FEATURE_NAMES = [
  'bridge', 'partialBridge', 'uDip', 'occupancy', 'peakDensity',
  'spacingRegularity', 'width', 'prominence', 'envelopeVariation', 'quality',
  'narrowAvailable', 'bridgeAvailable', 'envelopeAvailable', 'visibleFraction',
  'validFraction', 'persistence', 'meanBridge', 'meanUDip',
] as const;
export type WindowKind = 'rectangular' | 'hann' | 'hamming' | 'blackman' | 'blackman-harris' | 'nuttall';
export interface FrameMetadata {
  sourceId: string;
  frameId: string;
  timestampMs: number;
  acquisitionSampleRateHz: number;
  analysisSampleRateHz: number;
  fftSize: number;
  validSamples: number;
  window: WindowKind;
  centerFrequencyHz: number;
  /** Half-open interval in the original FFT-shifted spectrum, never rebased. */
  retainedStartBin: number;
  retainedEndBin: number;
}
export interface NativeFrame { spectrum: Float32Array; metadata: FrameMetadata }
const ENBW: Record<WindowKind, number> = { rectangular: 1, hann: 1.5, hamming: 1.363, blackman: 1.727, 'blackman-harris': 2.004, nuttall: 2.021 };
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
export function describeFrame({ spectrum, metadata: m }: NativeFrame) {
  if (!m.sourceId || !m.frameId || !Number.isFinite(m.timestampMs) || !Number.isFinite(m.centerFrequencyHz) ||
      !Number.isFinite(m.acquisitionSampleRateHz) || m.acquisitionSampleRateHz <= 0 ||
      !Number.isFinite(m.analysisSampleRateHz) || m.analysisSampleRateHz <= 0 ||
      !Number.isInteger(m.fftSize) || m.fftSize < 2 || m.fftSize > 1048576 ||
      !Number.isInteger(m.validSamples) || m.validSamples < 2 || m.validSamples > m.fftSize ||
      !Object.prototype.hasOwnProperty.call(ENBW, m.window) || !Number.isInteger(m.retainedStartBin) || !Number.isInteger(m.retainedEndBin) ||
      m.retainedStartBin < 0 || m.retainedEndBin > m.fftSize || m.retainedEndBin <= m.retainedStartBin ||
      spectrum.length !== m.retainedEndBin - m.retainedStartBin || spectrum.some(v => !Number.isFinite(v))) {
    throw new Error('Invalid native spectrum or acquisition metadata');
  }
  const binHz = m.analysisSampleRateHz / m.fftSize;
  return {
    binHz, resolutionHz: ENBW[m.window] * m.analysisSampleRateHz / m.validSamples,
    firstBinHz: m.centerFrequencyHz - m.analysisSampleRateHz / 2 + m.retainedStartBin * binHz,
    cropped: m.retainedStartBin !== 0 || m.retainedEndBin !== m.fftSize,
    incomplete: m.validSamples !== m.fftSize,
    visibleFraction: spectrum.length / m.fftSize,
    validFraction: m.validSamples / m.fftSize,
  };
}
export function extractionParams(frame: NativeFrame) {
  const d = describeFrame(frame);
  // Bounded stratified quantile; no dependence on display width or absolute gain.
  const samples: number[] = [];
  const count = Math.min(2048, frame.spectrum.length);
  for (let i = 0; i < count; i++) samples.push(frame.spectrum[Math.floor(i * frame.spectrum.length / count)]);
  samples.sort((a, b) => a - b);
  return { ...d, floor: samples[Math.floor((samples.length - 1) * 0.2)],
    step: Math.min(frame.metadata.fftSize, Math.max(1, Math.round(12000 / d.binHz))), broad: Math.min(frame.metadata.fftSize, Math.max(1, Math.round(96000 / d.binHz))) };
}
/** CPU reference for native_features.wgsl. Eight output floats per retained bin. */
export function extractReference(frame: NativeFrame): Float32Array {
  const p = extractionParams(frame), s = frame.spectrum, n = s.length;
  const out = new Float32Array(n * 8);
  const at = (i: number) => s[Math.max(0, Math.min(n - 1, i))];
  const smooth = (i: number) => (at(i - p.step) + at(i) + at(i + p.step)) / 3;
  for (let i = 0; i < n; i++) {
    const center = smooth(i), left = smooth(i - 4 * p.step), right = smooth(i + 4 * p.step);
    const bridgeValid = i >= 5 * p.step && i + 5 * p.step < n;
    const uValid = i >= p.broad + p.step && i + p.broad + p.step < n;
    const leftRise = center - left, rightRise = center - right;
    out.set([
      i > 0 && i + 1 < n && at(i) > at(i - 1) && at(i) >= at(i + 1) ? clamp((at(i) - p.floor - 6) / 24) : 0,
      bridgeValid ? clamp(Math.min(leftRise, rightRise) / 12) : 0,
      uValid ? clamp(Math.min(smooth(i - p.broad) - center, smooth(i + p.broad) - center) / 12) : 0,
      !bridgeValid ? clamp(Math.max(i >= 5 * p.step ? leftRise : 0, i + 5 * p.step < n ? rightRise : 0) / 12) : 0,
      center - p.floor, clamp((at(i) - p.floor) / 24), bridgeValid ? 1 : 0, uValid ? 1 : 0,
    ], i * 8);
  }
  return out;
}
export interface FeatureSummary {
  values: number[];
  status: 'ready' | 'insufficient_evidence';
  available: { narrow: boolean; bridge: boolean; envelope: boolean };
  resolution: ReturnType<typeof describeFrame>;
  diagnostics: { floorDb: number; widthHz: number; widthBins: number; spacingHz: number | null; peakCount: number };
}
export function summarizeFeatures(frame: NativeFrame, bins: Float32Array): FeatureSummary {
  const p = extractionParams(frame), n = frame.spectrum.length;
  if (bins.length !== n * 8 || bins.some(v => !Number.isFinite(v))) throw new Error('Invalid feature readback');
  let bridge = 0, partial = 0, u = 0, occupancy = 0, run = 0, widthBins = 0;
  let bridgeSupport = 0, uSupport = 0, prominence = 0, minEnv = Infinity, maxEnv = -Infinity;
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = i * 8;
    bridge = Math.max(bridge, bins[k + 1]); partial = Math.max(partial, bins[k + 3]); u = Math.max(u, bins[k + 2]);
    bridgeSupport += bins[k + 6]; uSupport += bins[k + 7];
    prominence = Math.max(prominence, bins[k]);
    if (bins[k] > 0) peaks.push(i);
    if (frame.spectrum[i] > p.floor + 6) { occupancy++; run++; widthBins = Math.max(widthBins, run); } else run = 0;
    minEnv = Math.min(minEnv, bins[k + 4]); maxEnv = Math.max(maxEnv, bins[k + 4]);
  }
  const available = { narrow: p.resolutionHz <= 6000 && n >= 16,
    bridge: p.resolutionHz <= 12000 && bridgeSupport >= 8,
    envelope: p.resolutionHz <= 24000 && uSupport >= 8 };
  const gaps = peaks.slice(1).map((v, i) => (v - peaks[i]) * p.binHz);
  const spacingHz = gaps.length >= 4 && available.narrow ? mean(gaps) : null;
  const regularity = spacingHz ? clamp(1 - mean(gaps.map(v => Math.abs(v - spacingHz))) / spacingHz) : 0;
  const quality = clamp(frame.metadata.validSamples / 32) * clamp(n / 32);
  const values = [available.bridge ? bridge : 0, p.resolutionHz <= 12000 ? partial : 0, available.envelope ? u : 0,
    occupancy / n, available.narrow ? clamp(peaks.length * 12000 / (n * p.binHz)) : 0,
    regularity, clamp(widthBins * p.binHz / 192000), available.narrow ? prominence : 0,
    clamp((maxEnv - minEnv) / 24), quality, +available.narrow, +available.bridge, +available.envelope,
    p.visibleFraction, p.validFraction, 0, 0, 0];
  return { values, available, resolution: describeFrame(frame),
    status: n >= 32 && (available.bridge || available.envelope) ? 'ready' : 'insufficient_evidence',
    diagnostics: { floorDb: p.floor, widthHz: widthBins * p.binHz, widthBins, spacingHz, peakCount: peaks.length } };
}
export function deterministicScore(values: number[]): number {
  // Provisional baseline: calibrated by the offline validation command, not a probability.
  return clamp(0.45 * Math.max(values[0], 0.65 * values[1]) + 0.25 * values[2] +
    0.15 * values[5] + 0.15 * values[15]);
}
export class TemporalClassifier {
  private key = '';
  private history: { timestamp: number; id: string; bridge: number; u: number }[] = [];
  reset() { this.key = ''; this.history = []; }
  update(m: FrameMetadata, summary: FeatureSummary) {
    const key = JSON.stringify([m.sourceId, m.acquisitionSampleRateHz, m.analysisSampleRateHz, m.fftSize,
      m.validSamples, m.window, m.centerFrequencyHz, m.retainedStartBin, m.retainedEndBin]);
    const last = this.history[this.history.length - 1];
    if (key !== this.key || (last && (m.timestampMs < last.timestamp || m.timestampMs - last.timestamp > 1000))) this.history = [];
    this.key = key;
    if (this.history.some(f => f.id === m.frameId)) return null;
    this.history = this.history.filter(f => m.timestampMs - f.timestamp <= 1000);
    this.history.push({ timestamp: m.timestampMs, id: m.frameId, bridge: Math.max(summary.values[0], summary.values[1] * 0.65), u: summary.values[2] });
    if (this.history.length > 256) this.history.shift();
    const values = [...summary.values];
    // Duration-weighted evidence; a high frame rate does not get extra votes.
    let duration = 0, present = 0, bridge = 0, u = 0;
    for (let i = 1; i < this.history.length; i++) {
      const previous = this.history[i - 1];
      const dt = Math.min(250, this.history[i].timestamp - previous.timestamp);
      duration += dt; present += dt * +(previous.bridge >= 0.4 || previous.u >= 0.4);
      bridge += dt * previous.bridge; u += dt * previous.u;
    }
    values[15] = duration ? present / duration : 0;
    values[16] = duration ? bridge / duration : values[0];
    values[17] = duration ? u / duration : values[2];
    return { ...summary, values, frameCount: this.history.length, evidenceMs: duration, ruleScore: deterministicScore(values) };
  }
}
export interface NativeModel {
  version: 1; preprocessing: string; id: string; kind: 'logistic' | 'mlp'; featureNames: string[];
  mean: number[]; scale: number[]; weights: number[][]; bias: number[];
  outputWeights?: number[]; outputBias?: number; threshold: number; validatedSampleRatesHz: number[];
}
export function validateModel(input: unknown): NativeModel {
  const m = input as NativeModel, n = FEATURE_NAMES.length;
  const vector = (v: unknown, length: number) => Array.isArray(v) && v.length === length && v.every(x => typeof x === 'number' && Number.isFinite(x));
  if (!m || m.version !== 1 || m.preprocessing !== PREPROCESSING || typeof m.id !== 'string' || !m.id ||
    JSON.stringify(m.featureNames) !== JSON.stringify(FEATURE_NAMES) || !['logistic', 'mlp'].includes(m.kind) ||
    !vector(m.mean, n) || !vector(m.scale, n) || m.scale.some(x => x <= 0) ||
    !Array.isArray(m.weights) || m.weights.length !== (m.kind === 'mlp' ? 16 : 1) || !m.weights.every(v => vector(v, n)) ||
    !vector(m.bias, m.weights.length) || !Number.isFinite(m.threshold) || m.threshold < 0 || m.threshold > 1 ||
    !Array.isArray(m.validatedSampleRatesHz) || m.validatedSampleRatesHz.some(x => !Number.isFinite(x) || x <= 0) ||
    (m.kind === 'mlp' && (!vector(m.outputWeights, 16) || !Number.isFinite(m.outputBias)))) throw new Error('Incompatible classifier model');
  return m;
}
export function inferModel(m: NativeModel, values: number[]) {
  if (values.length !== FEATURE_NAMES.length || values.some(x => !Number.isFinite(x))) throw new Error('Invalid model features');
  const x = values.map((v, i) => (v - m.mean[i]) / m.scale[i]);
  const hidden = m.weights.map((row, j) => row.reduce((sum, w, i) => sum + w * x[i], m.bias[j]));
  const logit = m.kind === 'logistic' ? hidden[0] : hidden.reduce((sum, v, i) => sum + Math.max(0, v) * m.outputWeights![i], m.outputBias!);
  return 1 / (1 + Math.exp(-Math.max(-80, Math.min(80, logit))));
}
