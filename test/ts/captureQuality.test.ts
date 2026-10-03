import * as Capture from '@n-apt/capture';
import * as CapturePolicy from '@n-apt/capture/policy';

const base: Capture.CaptureQualityInput = {
  profile: Capture.DEMODULATION_QUALITY_PROFILE,
  selectedSourceId: 'rtl-1', sourceMode: 'live', nowTimestampMs: 20_000,
  source: { id: 'rtl-1', capability: 'rx', isMock: false, connected: true, receiving: true,
    maxSampleRateHz: 3_200_000, fftSizes: [16_384, 32_768, 65_536], maxFrameRateHz: 60 },
  requested: { sampleRateHz: 3_200_000, fftSize: 32_768, frameRateHz: 60, window: 'hann', temporalResolution: 'lossless' },
  configured: { sampleRateHz: 3_200_000, fftSize: 32_768, frameRateHz: 60, window: 'hann', temporalResolution: 'lossless' },
  frames: [{ sourceId: 'rtl-1', streamEpoch: 2, sequence: 9, timestampMs: 19_980, status: 'receiving',
    sampleRateHz: 3_200_000, centerFrequencyHz: 1_600_000, fftSize: 32_768, window: 'hann', acquiredSampleCount: 32_768,
    retainedStartBin: 0, retainedEndBin: 32_768, rawIqByteCount: 65_536 }, { sourceId: 'rtl-1', streamEpoch: 2, sequence: 10, timestampMs: 19_990, status: 'receiving',
    sampleRateHz: 3_200_000, centerFrequencyHz: 1_600_000, fftSize: 32_768, window: 'hann', acquiredSampleCount: 32_768,
    retainedStartBin: 0, retainedEndBin: 32_768, rawIqByteCount: 65_536 }],
};

it('uses acquired samples and window ENBW for effective resolution rather than zero-padded bin spacing', () => {
  const result = Capture.evaluateCaptureQuality({ ...base, frames: [{ ...base.frames[0], fftSize: 65_536, acquiredSampleCount: 32_768 }] });
  expect(result.observed.binSpacingHz).toBeCloseTo(48.828);
  expect(result.observed.effectiveResolutionHz).toBeCloseTo(146.484);
  expect(result.observed.zeroPadded).toBe(true);
  expect(result.observed.acquiredSampleCount).toBe(32_768);
});

it('accepts demod only at the actual FFT floor with lossless temporal setting', () => {
  expect(Capture.evaluateCaptureQuality(base).fit).toBe('ready');
  const tooSmall = Capture.evaluateCaptureQuality({ ...base, frames: [{ ...base.frames[0], fftSize: 16_384, acquiredSampleCount: 16_384 }] });
  expect(tooSmall.fit).toBe('unmet');
  expect(tooSmall.reasons.join(' ')).toMatch(/32768/);
  const smoothed = Capture.evaluateCaptureQuality({ ...base, configured: { ...base.configured, temporalResolution: 'reduced' } });
  expect(smoothed.fit).toBe('unmet');
  expect(smoothed.reasons.join(' ')).toMatch(/lossless/);
});

it('allows the classifier training profile to use smaller FFTs when actual resolution and visible bins suffice', () => {
  const input = { ...base, profile: Capture.CLASSIFIER_TRAINING_QUALITY_PROFILE,
    source: { ...base.source!, fftSizes: [...base.source!.fftSizes!, 4096] },
    requested: { ...base.requested, fftSize: 4096 }, configured: { ...base.configured, fftSize: 4096 },
    frames: base.frames.map((frame) => ({ ...frame, fftSize: 4096, acquiredSampleCount: 4096, rawIqByteCount: 8192 })) };
  expect(Capture.evaluateCaptureQuality(input).fit).toBe('ready');
  const crop = Capture.evaluateCaptureQuality({ ...input, frames: input.frames.map((frame) => ({ ...frame, retainedStartBin: 0, retainedEndBin: 8 })) });
  expect(crop.fit).toBe('unmet');
  expect(crop.reasons.join(' ')).toMatch(/visible/);
});

it('reports configured versus observed mismatches, delivery gaps, stale frames and source capability distinctly', () => {
  const mismatch = Capture.evaluateCaptureQuality({ ...base, configured: { ...base.configured, fftSize: 65_536 }, frames: [{ ...base.frames[0], fftSize: 16_384 }] });
  expect(mismatch.mismatches).toContain('configured FFT size 65536 differs from observed FFT size 16384');
  const gap = Capture.evaluateCaptureQuality({ ...base, frames: [base.frames[0], { ...base.frames[0], sequence: 12, timestampMs: 20_000 }] });
  expect(gap.delivery.sequenceGapCount).toBe(2);
  expect(gap.delivery.lossless).toBe(false);
  const stale = Capture.evaluateCaptureQuality({ ...base, nowTimestampMs: 30_000 });
  expect(stale.observed.stale).toBe(true);
  const unsupported = Capture.evaluateCaptureQuality({ ...base, source: { ...base.source!, maxSampleRateHz: 1_000_000 } });
  expect(unsupported.capability).toBe('unsupported');
  const unknown = Capture.evaluateCaptureQuality({ ...base, frames: [] });
  expect(unknown.capability).toBe('supported');
  expect(unknown.observed.status).toBe('not-observed');
});

it('rejects explicit CLI output options that exceed source capabilities', () => {
  const preflight = Capture.resolveCapturePreflightOptions({ profile: Capture.IQ_CAPTURE_CLI_QUALITY_PROFILE,
    requested: { sampleRateHz: 4_000_000, fftSize: 16_384, frameRateHz: 25, fftWindow: 'rectangular', temporalResolution: 'lossless' },
    sourceCapabilities: { minSampleRateHz: 500_000, maxSampleRateHz: 3_200_000, fftSizes: [16_384, 32_768], maxFrameRateHz: 60 } });
  expect(preflight.options).toBeNull();
  expect(preflight.fit).toBe('unmet');
  expect(preflight.reasons.join(' ')).toMatch(/exceeds source maximum/);
});

it('rejects a demod preflight when reported frame-rate capability cannot meet the profile', () => {
  const preflight = Capture.resolveCapturePreflightOptions({ profile: Capture.DEMODULATION_QUALITY_PROFILE,
    requested: { ...base.requested, fftWindow: 'hanning' },
    sourceCapabilities: { maxSampleRateHz: 3_200_000, fftSizes: [32_768], maxFrameRateHz: 20 } });
  expect(preflight.options).toBeNull();
  expect(preflight.fit).toBe('unmet');
  expect(preflight.reasons.join(' ')).toMatch(/20 FPS|at least 30 FPS/);
});

describe('capture preflight options', () => {
  const resolveOptions = (
    Capture as typeof Capture & {
      resolveCapturePreflightOptions?: (input: {
        profile: Capture.CaptureQualityProfile;
        requested: Capture.CaptureQualitySettings;
        sourceCapabilities: {
          minSampleRateHz?: number;
          maxSampleRateHz?: number;
          fftSizes?: number[];
          maxFrameRateHz?: number;
        };
      }) => {
        profileId: string;
        fit: 'ready' | 'unmet';
        options: {
          sampleRateHz: number;
          fftSize: number;
          fftWindow: string;
          frameRateHz: number;
        } | null;
        reasons: string[];
      };
    }
  ).resolveCapturePreflightOptions;

  it('resolves concrete attainable options instead of reporting intent metadata', () => {
    expect(resolveOptions?.({
      profile: Capture.IQ_CAPTURE_CLI_QUALITY_PROFILE,
      requested: {
        sampleRateHz: 3_200_000,
        fftSize: 65_536,
        fftWindow: 'hanning',
        temporalResolution: 'lossless',
      },
      sourceCapabilities: {
        minSampleRateHz: 500_000,
        maxSampleRateHz: 3_200_000,
        fftSizes: [32_768, 65_536],
        maxFrameRateHz: 60,
      },
    })).toEqual({
      profileId: 'iq-capture-cli',
      fit: 'ready',
      options: {
        sampleRateHz: 3_200_000,
        fftSize: 65_536,
        fftWindow: 'hanning',
        frameRateHz: 48,
      },
      reasons: [],
    });
  });

  it('rejects unattainable frame rates and unknown windows before capture', () => {
    const excessive = resolveOptions?.({
      profile: Capture.IQ_CAPTURE_CLI_QUALITY_PROFILE,
      requested: {
        sampleRateHz: 3_200_000,
        fftSize: 65_536,
        fftWindow: 'hanning',
        frameRateHz: 60,
        temporalResolution: 'lossless',
      },
      sourceCapabilities: { maxSampleRateHz: 3_200_000, fftSizes: [65_536], maxFrameRateHz: 60 },
    });
    expect(excessive?.fit).toBe('unmet');
    expect(excessive?.options).toBeNull();
    expect(excessive?.reasons.join(' ')).toMatch(/48/);

    const unknownWindow = resolveOptions?.({
      profile: Capture.IQ_CAPTURE_CLI_QUALITY_PROFILE,
      requested: {
        sampleRateHz: 3_200_000,
        fftSize: 65_536,
        fftWindow: 'triangle',
        temporalResolution: 'lossless',
      },
      sourceCapabilities: { maxSampleRateHz: 3_200_000, fftSizes: [65_536], maxFrameRateHz: 60 },
    });
    expect(unknownWindow?.fit).toBe('unmet');
    expect(unknownWindow?.reasons.join(' ')).toMatch(/window/i);
  });

  it('accepts only an acknowledgement matching the concrete preflight options', () => {
    const validate = (
      Capture as typeof Capture & {
        validateCapturePreflightAcknowledgement?: (
          options: { sampleRateHz: number; fftSize: number; fftWindow: string; frameRateHz: number },
          status: unknown,
        ) => { valid: boolean; reason?: string };
      }
    ).validateCapturePreflightAcknowledgement;
    const options = { sampleRateHz: 3_200_000, fftSize: 65_536, fftWindow: 'hanning', frameRateHz: 48 };

    expect(validate?.(options, {
      settingsApplied: true,
      effectiveSettings: { ...options, fftWindow: 'Hanning' },
    })).toEqual({ valid: true });
    expect(validate?.(options, {
      settingsApplied: true,
      effectiveSettings: { ...options, frameRateHz: 60 },
    })).toMatchObject({ valid: false });
    expect(validate?.(options, { settingsApplied: false })).toMatchObject({ valid: false });
  });
});

it('marks mock, paused, non-receiving and file-mode inputs ineligible without changing settings', () => {
  const result = Capture.evaluateCaptureQuality({ ...base, sourceMode: 'file', source: { ...base.source!, isMock: true, receiving: false, paused: true } });
  expect(result.sourceEligible).toBe(false);
  expect(result.settingsDispatches).toBe(0);
});

describe('CLI capture frequency span', () => {
  const resolveFrequencySpan = (
    CapturePolicy as typeof CapturePolicy & {
      resolveCliCaptureFrequencySpan?: (
        args: readonly string[],
        source: {
          sdr: {
            max_sample_rate: number;
            sample_rate_options: number[];
            settings: { center_frequency?: number; sample_rate?: number };
          };
        },
      ) => { centerFrequencyHz: number; sampleRateHz: number };
    }
  ).resolveCliCaptureFrequencySpan;

  const source = {
    sdr: {
      max_sample_rate: 3_200_000,
      sample_rate_options: [1_000_000, 3_200_000],
      settings: { center_frequency: 137_500_000, sample_rate: 3_200_000 },
    },
  };

  it('uses valid source defaults and explicit metadata values', () => {
    expect(resolveFrequencySpan?.([], source)).toEqual({
      centerFrequencyHz: 137_500_000,
      sampleRateHz: 3_200_000,
    });
    expect(
      resolveFrequencySpan?.([
        '--center-frequency',
        '1618000',
        '--sample-rate',
        '3200000',
      ], source),
    ).toEqual({ centerFrequencyHz: 1_618_000, sampleRateHz: 3_200_000 });
  });

  it('rejects missing, negative, and out-of-range capture spans', () => {
    expect(() => resolveFrequencySpan?.([], {
      ...source,
      sdr: { ...source.sdr, settings: { center_frequency: 0, sample_rate: 3_200_000 } },
    })).toThrow(/center frequency/i);
    expect(() => resolveFrequencySpan?.([
      '--center-frequency',
      '1000000',
      '--sample-rate',
      '3200000',
    ], {
      ...source,
      sdr: { ...source.sdr, settings: { center_frequency: 1_000_000, sample_rate: 3_200_000 } },
    })).toThrow(/minimum/i);
    expect(() => resolveFrequencySpan?.([
      '--center-frequency',
      '30000000000',
      '--sample-rate',
      '3200000',
    ], {
      ...source,
      sdr: { ...source.sdr, settings: { center_frequency: 30_000_000_000, sample_rate: 3_200_000 } },
    })).toThrow(/maximum/i);
  });
});
