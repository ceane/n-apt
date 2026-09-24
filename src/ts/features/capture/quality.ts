import type { TemporalResolution } from '@n-apt/math/temporalResolution';

export interface CaptureQualityProfile {
  id: 'demodulation' | 'classifier-training' | 'iq-capture-cli';
  requiredTemporalResolution: TemporalResolution;
  minimumAnalysisFftSize?: number;
  minimumConfiguredFftSize?: number;
  maximumEffectiveResolutionHz?: number;
  minimumVisibleBins?: number;
  minimumObservedFrameRateHz?: number;
  minimumConfiguredFrameRateHz?: number;
  maximumFrameGapMs: number;
  requireRawIqContinuity: boolean;
}

export const DEMODULATION_QUALITY_PROFILE: CaptureQualityProfile = {
  id: 'demodulation', requiredTemporalResolution: 'lossless', minimumAnalysisFftSize: 32_768,
  minimumConfiguredFftSize: 32_768,
  minimumObservedFrameRateHz: 30, maximumFrameGapMs: 100, requireRawIqContinuity: false,
  minimumConfiguredFrameRateHz: 30,
};

export const CLASSIFIER_TRAINING_QUALITY_PROFILE: CaptureQualityProfile = {
  id: 'classifier-training', requiredTemporalResolution: 'lossless', maximumEffectiveResolutionHz: 24_000,
  minimumVisibleBins: 16, minimumObservedFrameRateHz: 10, maximumFrameGapMs: 250, requireRawIqContinuity: true,
};

export const IQ_CAPTURE_CLI_QUALITY_PROFILE: CaptureQualityProfile = {
  id: 'iq-capture-cli', requiredTemporalResolution: 'lossless', maximumFrameGapMs: 250,
  requireRawIqContinuity: true,
};

export type CaptureQualitySettings = {
  sampleRateHz?: number;
  fftSize?: number;
  frameRateHz?: number;
  window?: string;
  temporalResolution?: TemporalResolution;
};

export interface CaptureQualitySource {
  id: string;
  capability: 'rx' | 'tx_rx' | 'tx' | 'mock' | 'unknown';
  isMock: boolean;
  connected: boolean;
  receiving: boolean;
  paused?: boolean;
  maxSampleRateHz?: number;
  minSampleRateHz?: number;
  fftSizes?: number[];
  maxFrameRateHz?: number;
}

export interface CaptureQualityFrame {
  sourceId: string;
  streamEpoch: number;
  sequence: number;
  timestampMs: number;
  status: string;
  sampleRateHz: number;
  centerFrequencyHz: number;
  fftSize: number;
  window: string;
  acquiredSampleCount: number;
  retainedStartBin?: number;
  retainedEndBin?: number;
  rawIqByteCount?: number;
}

export interface CaptureQualityInput {
  profile: CaptureQualityProfile;
  selectedSourceId: string | null;
  sourceMode: 'live' | 'file' | string;
  source: CaptureQualitySource | null;
  requested: CaptureQualitySettings;
  configured: CaptureQualitySettings;
  frames: CaptureQualityFrame[];
  nowTimestampMs: number;
}

export type QualityFit = 'ready' | 'unmet' | 'awaiting-observation';
export type CapabilityFit = 'supported' | 'unsupported' | 'unknown';

export interface CaptureQualityAssessment {
  profileId: CaptureQualityProfile['id'];
  fit: QualityFit;
  capability: CapabilityFit;
  sourceEligible: boolean;
  requested: CaptureQualitySettings;
  configured: CaptureQualitySettings;
  observed: {
    status: 'ready' | 'not-observed' | 'invalid';
    sampleRateHz: number | null;
    centerFrequencyHz: number | null;
    fftSize: number | null;
    acquiredSampleCount: number | null;
    window: string | null;
    binSpacingHz: number | null;
    effectiveResolutionHz: number | null;
    visibleBins: number | null;
    visibleFraction: number | null;
    zeroPadded: boolean | null;
    stale: boolean;
  };
  delivery: {
    lossless: boolean | null;
    observedFrameRateHz: number | null;
    maxGapMs: number | null;
    sequenceGapCount: number;
    reordered: boolean;
    epochChanged: boolean;
  };
  mismatches: string[];
  reasons: string[];
  settingsDispatches: 0;
}

const ENBW: Record<string, number> = {
  rectangular: 1, none: 1, hann: 1.5, hanning: 1.5, hamming: 1.363,
  blackman: 1.727, 'blackman-harris': 2.004, nuttall: 2.021,
};

const finitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function evaluateCaptureQuality(input: CaptureQualityInput): CaptureQualityAssessment {
  const { profile, requested, configured, source, frames, nowTimestampMs } = input;
  const reasons: string[] = [];
  const mismatches: string[] = [];
  const latest = frames.length ? frames[frames.length - 1] : null;
  const sourceEligible = !!source && !!input.selectedSourceId && source.id === input.selectedSourceId &&
    input.sourceMode === 'live' && !source.isMock && (source.capability === 'rx' || source.capability === 'tx_rx') &&
    source.connected && source.receiving && !source.paused;

  if (!input.selectedSourceId || !source || source.id !== input.selectedSourceId) reasons.push('Selected source identity is unavailable or mismatched.');
  if (input.sourceMode !== 'live') reasons.push('Live acquisition is required.');
  if (!source || source.isMock || (source.capability !== 'rx' && source.capability !== 'tx_rx')) reasons.push('A real receive-capable source is required.');
  else if (!source.connected || !source.receiving || source.paused) reasons.push('Source must be connected, receiving, and unpaused.');

  let capability: CapabilityFit = 'unknown';
  if (source) {
    const unsupported = (finitePositive(configured.sampleRateHz) &&
      ((finitePositive(source.maxSampleRateHz) && configured.sampleRateHz > source.maxSampleRateHz) ||
       (finitePositive(source.minSampleRateHz) && configured.sampleRateHz < source.minSampleRateHz))) ||
      (finitePositive(configured.fftSize) && Array.isArray(source.fftSizes) && source.fftSizes.length > 0 && !source.fftSizes.includes(configured.fftSize)) ||
      (finitePositive(configured.frameRateHz) && finitePositive(source.maxFrameRateHz) && configured.frameRateHz > source.maxFrameRateHz);
    if (unsupported) capability = 'unsupported';
    else if (finitePositive(source.maxSampleRateHz) && Array.isArray(source.fftSizes) && source.fftSizes.length > 0) capability = 'supported';
  }
  if (capability === 'unsupported') reasons.push('Configured settings exceed the reported source capabilities.');
  if (capability === 'unknown') reasons.push('Source capability limits are not fully reported.');

  if (requested.sampleRateHz !== undefined && configured.sampleRateHz !== undefined && requested.sampleRateHz !== configured.sampleRateHz) mismatches.push(`requested sample rate ${requested.sampleRateHz} differs from configured sample rate ${configured.sampleRateHz}`);
  if (requested.fftSize !== undefined && configured.fftSize !== undefined && requested.fftSize !== configured.fftSize) mismatches.push(`requested FFT size ${requested.fftSize} differs from configured FFT size ${configured.fftSize}`);
  if (requested.frameRateHz !== undefined && configured.frameRateHz !== undefined && requested.frameRateHz !== configured.frameRateHz) mismatches.push(`requested frame rate ${requested.frameRateHz} differs from configured frame rate ${configured.frameRateHz}`);
  if (latest && configured.fftSize !== undefined && latest.fftSize !== configured.fftSize) mismatches.push(`configured FFT size ${configured.fftSize} differs from observed FFT size ${latest.fftSize}`);
  if (latest && configured.sampleRateHz !== undefined && latest.sampleRateHz !== configured.sampleRateHz) mismatches.push(`configured sample rate ${configured.sampleRateHz} differs from observed sample rate ${latest.sampleRateHz}`);

  if (configured.temporalResolution !== profile.requiredTemporalResolution) reasons.push(`Profile requires ${profile.requiredTemporalResolution} temporal resolution.`);
  if (profile.minimumConfiguredFftSize && (!finitePositive(configured.fftSize) || configured.fftSize < profile.minimumConfiguredFftSize)) reasons.push(`Configured FFT size must be at least ${profile.minimumConfiguredFftSize}.`);
  if (profile.minimumConfiguredFftSize && finitePositive(requested.fftSize) && requested.fftSize < profile.minimumConfiguredFftSize) reasons.push(`Requested FFT size must be at least ${profile.minimumConfiguredFftSize}.`);
  if (profile.minimumConfiguredFrameRateHz && (!finitePositive(configured.frameRateHz) || configured.frameRateHz < profile.minimumConfiguredFrameRateHz)) {
    reasons.push(`Configured frame rate must be at least ${profile.minimumConfiguredFrameRateHz} FPS.`);
  }
  if (!latest) reasons.push('Waiting for an observed acquisition frame.');
  if (profile.minimumObservedFrameRateHz && frames.length < 2) reasons.push('Waiting for enough fresh frames to measure delivery cadence.');

  const enbw = latest ? ENBW[latest.window.toLowerCase()] : undefined;
  const frameValid = !!latest && !!latest.sourceId && Number.isFinite(latest.streamEpoch) && Number.isFinite(latest.sequence) &&
    Number.isFinite(latest.timestampMs) && latest.status === 'receiving' && finitePositive(latest.sampleRateHz) &&
    finitePositive(latest.centerFrequencyHz) && Number.isInteger(latest.fftSize) && latest.fftSize >= 2 &&
    Number.isInteger(latest.acquiredSampleCount) && latest.acquiredSampleCount >= 2 && enbw !== undefined;
  if (latest && !frameValid) reasons.push('Observed frame metadata is incomplete or invalid.');
  if (latest && frameValid && (latest.sourceId !== input.selectedSourceId || latest.status !== 'receiving')) reasons.push('Observed frame is not from the selected receiving source.');

  const binSpacingHz = frameValid && latest ? latest.sampleRateHz / latest.fftSize : null;
  const effectiveResolutionHz = frameValid && latest && enbw !== undefined ? enbw * latest.sampleRateHz / latest.acquiredSampleCount : null;
  const retainedStart = latest?.retainedStartBin ?? 0;
  const retainedEnd = latest?.retainedEndBin ?? latest?.fftSize ?? 0;
  const visibleBins = frameValid ? Math.max(0, retainedEnd - retainedStart) : null;
  const visibleFraction = frameValid && latest ? (visibleBins ?? 0) / latest.fftSize : null;
  const stale = !!latest && (nowTimestampMs - latest.timestampMs > profile.maximumFrameGapMs || latest.timestampMs > nowTimestampMs + profile.maximumFrameGapMs);
  if (stale) reasons.push('Latest observed frame is stale.');
  if (latest && profile.minimumAnalysisFftSize && latest.fftSize < profile.minimumAnalysisFftSize) reasons.push(`Observed FFT size must be at least ${profile.minimumAnalysisFftSize}.`);
  if (effectiveResolutionHz !== null && profile.maximumEffectiveResolutionHz && effectiveResolutionHz > profile.maximumEffectiveResolutionHz) reasons.push(`Observed effective resolution exceeds ${profile.maximumEffectiveResolutionHz} Hz.`);
  if (visibleBins !== null && profile.minimumVisibleBins && visibleBins < profile.minimumVisibleBins) reasons.push(`Too few visible bins: ${visibleBins}; profile requires ${profile.minimumVisibleBins}.`);

  let sequenceGapCount = 0;
  let reordered = false;
  let epochChanged = false;
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1]; const current = frames[i];
    if (current.sourceId !== previous.sourceId || current.streamEpoch !== previous.streamEpoch) { epochChanged = true; continue; }
    if (current.sequence <= previous.sequence || current.timestampMs <= previous.timestampMs) { reordered = true; continue; }
    if (current.sequence > previous.sequence + 1) sequenceGapCount += current.sequence - previous.sequence - 1;
    gaps.push(current.timestampMs - previous.timestampMs);
  }
  const maxGapMs = gaps.length ? Math.max(...gaps) : null;
  const observedFrameRateHz = gaps.length ? 1000 / (gaps.reduce((sum, value) => sum + value, 0) / gaps.length) : null;
  const deliveryLossless = configured.temporalResolution === 'lossless' && !stale && !reordered && !epochChanged && sequenceGapCount === 0 &&
    (profile.maximumFrameGapMs <= 0 || maxGapMs === null || maxGapMs <= profile.maximumFrameGapMs);
  if (reordered) reasons.push('Observed frame ordering is invalid.');
  if (epochChanged) reasons.push('Observed stream epoch changed.');
  if (sequenceGapCount > 0) reasons.push(`Observed ${sequenceGapCount} missing frame sequence(s).`);
  if (maxGapMs !== null && maxGapMs > profile.maximumFrameGapMs) reasons.push(`Observed frame gap ${maxGapMs} ms exceeds ${profile.maximumFrameGapMs} ms.`);
  if (profile.minimumObservedFrameRateHz && observedFrameRateHz !== null && observedFrameRateHz < profile.minimumObservedFrameRateHz) reasons.push(`Observed cadence is below ${profile.minimumObservedFrameRateHz} FPS.`);
  if (profile.requireRawIqContinuity && latest && latest.rawIqByteCount !== undefined && latest.rawIqByteCount !== latest.acquiredSampleCount * 2) reasons.push('Raw I/Q payload does not match its full acquired sample count.');
  if (profile.requireRawIqContinuity && frames.length > 1 && !deliveryLossless) reasons.push('Continuous raw I/Q delivery is required.');

  const observedStatus = !latest ? 'not-observed' : frameValid ? 'ready' : 'invalid';
  if (frameValid && !stale && configured.temporalResolution === profile.requiredTemporalResolution &&
    profile.minimumObservedFrameRateHz && frames.length > 1 && observedFrameRateHz !== null && observedFrameRateHz < profile.minimumObservedFrameRateHz) {
    // The cadence reason above is a hard profile failure.
  }
  const hardFailure = !sourceEligible || capability === 'unsupported' || (latest !== null && (!frameValid || stale)) ||
    configured.temporalResolution !== profile.requiredTemporalResolution ||
    (profile.minimumConfiguredFftSize !== undefined && (!finitePositive(configured.fftSize) || configured.fftSize < profile.minimumConfiguredFftSize)) ||
    (profile.minimumConfiguredFftSize !== undefined && finitePositive(requested.fftSize) && requested.fftSize < profile.minimumConfiguredFftSize) ||
    (profile.minimumConfiguredFrameRateHz !== undefined && (!finitePositive(configured.frameRateHz) || configured.frameRateHz < profile.minimumConfiguredFrameRateHz)) ||
    (latest !== null && profile.minimumAnalysisFftSize !== undefined && latest.fftSize < profile.minimumAnalysisFftSize) ||
    (effectiveResolutionHz !== null && profile.maximumEffectiveResolutionHz !== undefined && effectiveResolutionHz > profile.maximumEffectiveResolutionHz) ||
    (visibleBins !== null && profile.minimumVisibleBins !== undefined && visibleBins < profile.minimumVisibleBins) ||
    reordered || epochChanged || sequenceGapCount > 0 || (maxGapMs !== null && maxGapMs > profile.maximumFrameGapMs) ||
    (profile.minimumObservedFrameRateHz !== undefined && observedFrameRateHz !== null && observedFrameRateHz < profile.minimumObservedFrameRateHz) ||
    (profile.requireRawIqContinuity && latest?.rawIqByteCount !== undefined && latest.rawIqByteCount !== latest.acquiredSampleCount * 2);
  const fit: QualityFit = hardFailure ? 'unmet' : !latest || capability === 'unknown' || (profile.minimumObservedFrameRateHz !== undefined && frames.length < 2) ? 'awaiting-observation' : 'ready';

  return {
    profileId: profile.id, fit, capability, sourceEligible, requested: { ...requested }, configured: { ...configured },
    observed: { status: observedStatus, sampleRateHz: latest?.sampleRateHz ?? null, centerFrequencyHz: latest?.centerFrequencyHz ?? null,
      fftSize: latest?.fftSize ?? null, acquiredSampleCount: latest?.acquiredSampleCount ?? null, window: latest?.window ?? null,
      binSpacingHz, effectiveResolutionHz, visibleBins, visibleFraction,
      zeroPadded: frameValid && latest ? latest.fftSize > latest.acquiredSampleCount : null, stale },
    delivery: { lossless: latest ? deliveryLossless : null, observedFrameRateHz, maxGapMs, sequenceGapCount, reordered, epochChanged },
    mismatches, reasons: [...new Set(reasons)], settingsDispatches: 0,
  };
}

export interface CaptureIntentResolution {
  requested: CaptureQualitySettings;
  effective: CaptureQualitySettings;
  fit: 'ready' | 'unmet';
  reasons: string[];
  settingsDispatches: 0;
}

/** Resolves pre-acquisition intent without rewriting explicit caller values or dispatching hardware settings. */
export function resolveCaptureIntent({
  profile, requested, sourceCapabilities,
}: {
  profile: CaptureQualityProfile;
  requested: CaptureQualitySettings;
  sourceCapabilities: Pick<CaptureQualitySource, 'minSampleRateHz' | 'maxSampleRateHz' | 'fftSizes' | 'maxFrameRateHz'>;
}): CaptureIntentResolution {
  const reasons: string[] = [];
  if (profile.minimumAnalysisFftSize && requested.fftSize !== undefined && requested.fftSize < profile.minimumAnalysisFftSize) reasons.push(`Requested FFT size must be at least ${profile.minimumAnalysisFftSize}.`);
  if (profile.minimumConfiguredFrameRateHz && !finitePositive(requested.frameRateHz)) reasons.push('Requested frame rate is unknown.');
  if (profile.minimumConfiguredFrameRateHz && finitePositive(requested.frameRateHz) && requested.frameRateHz < profile.minimumConfiguredFrameRateHz) reasons.push(`Requested frame rate must be at least ${profile.minimumConfiguredFrameRateHz} FPS.`);
  if (profile.minimumConfiguredFrameRateHz && finitePositive(sourceCapabilities.maxFrameRateHz) && sourceCapabilities.maxFrameRateHz < profile.minimumConfiguredFrameRateHz) reasons.push(`Source maximum frame rate is below ${profile.minimumConfiguredFrameRateHz} FPS.`);
  if (requested.temporalResolution !== profile.requiredTemporalResolution) reasons.push(`Profile requires ${profile.requiredTemporalResolution} temporal resolution.`);
  if (requested.sampleRateHz !== undefined && sourceCapabilities.maxSampleRateHz !== undefined && requested.sampleRateHz > sourceCapabilities.maxSampleRateHz) reasons.push(`Requested sample rate ${requested.sampleRateHz} exceeds source maximum ${sourceCapabilities.maxSampleRateHz}.`);
  if (requested.sampleRateHz !== undefined && sourceCapabilities.minSampleRateHz !== undefined && requested.sampleRateHz < sourceCapabilities.minSampleRateHz) reasons.push(`Requested sample rate ${requested.sampleRateHz} is below source minimum ${sourceCapabilities.minSampleRateHz}.`);
  if (requested.fftSize !== undefined && sourceCapabilities.fftSizes?.length && !sourceCapabilities.fftSizes.includes(requested.fftSize)) reasons.push(`Requested FFT size ${requested.fftSize} is not supported by the source.`);
  if (requested.frameRateHz !== undefined && sourceCapabilities.maxFrameRateHz !== undefined && requested.frameRateHz > sourceCapabilities.maxFrameRateHz) reasons.push(`Requested frame rate ${requested.frameRateHz} exceeds source maximum ${sourceCapabilities.maxFrameRateHz}.`);
  return { requested: { ...requested }, effective: { ...requested }, fit: reasons.length ? 'unmet' : 'ready', reasons, settingsDispatches: 0 };
}
