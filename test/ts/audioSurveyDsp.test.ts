import {
  analyzeAudioSurveyFrame,
  createAudioSurveyChannelizer,
  demodulateAudioCandidate,
  walkSpectralSpikeValleys,
} from "@n-apt/demodulation/survey/audioSurveyDsp";

const makeAmIq = (
  sampleRateHz: number,
  samples: number,
  centerHz: number,
  audioHz: number,
) => {
  const iq = new Uint8Array(samples * 2);
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRateHz;
    const amplitude = 0.55 + 0.35 * Math.sin(2 * Math.PI * audioHz * time);
    const phase = 2 * Math.PI * centerHz * time;
    iq[index * 2] = 128 + Math.round(120 * amplitude * Math.cos(phase));
    iq[index * 2 + 1] = 128 + Math.round(120 * amplitude * Math.sin(phase));
  }
  return iq;
};

const makeAptFmIq = (
  sampleRateHz: number,
  samples: number,
  carrierOffsetHz: number,
) => {
  const iq = new Uint8Array(samples * 2);
  let carrierPhase = 0;
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRateHz;
    const imageAmplitude =
      0.16 + 0.72 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * time));
    const subcarrier = imageAmplitude * Math.cos(2 * Math.PI * 2_400 * time);
    carrierPhase +=
      (2 * Math.PI * (carrierOffsetHz + 17_000 * subcarrier)) / sampleRateHz;
    iq[index * 2] = 128 + Math.round(115 * Math.cos(carrierPhase));
    iq[index * 2 + 1] = 128 + Math.round(115 * Math.sin(carrierPhase));
  }
  return iq;
};

const percentile = (samples: Float32Array, fraction: number) => {
  const sorted = Array.from(samples).sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
};

const makeSpikeComb = (
  peakCount: number,
  weakPeakIndex?: number,
  centerBin = 60,
  spacingBins = 5,
  binCount = 121,
): Float64Array => {
  const power = new Float64Array(binCount).fill(1);
  power[centerBin] = 20;
  for (let pair = 1; pair <= peakCount; pair++) {
    const peakPower = pair === weakPeakIndex ? 6.5 : 10;
    for (const direction of [-1, 1]) {
      power[centerBin + direction * pair * spacingBins] = peakPower;
    }
  }
  return power;
};

const makeIqToneComb = (
  sampleRateHz: number,
  sampleCount: number,
  centerOffsetHz: number,
  spacingHz: number,
  pairsToRight: number,
  pairsToLeft = pairsToRight,
) => {
  const iq = new Uint8Array(sampleCount * 2);
  for (let index = 0; index < sampleCount; index++) {
    const time = index / sampleRateHz;
    let inPhase = 0;
    let quadrature = 0;
    for (let pair = -pairsToLeft; pair <= pairsToRight; pair++) {
      const frequency = centerOffsetHz + pair * spacingHz;
      const amplitude = pair === 0 ? 35 : 5;
      const phase = (2 * Math.PI * frequency * time);
      inPhase += amplitude * Math.cos(phase);
      quadrature += amplitude * Math.sin(phase);
    }
    iq[index * 2] = 128 + Math.round(inPhase);
    iq[index * 2 + 1] = 128 + Math.round(quadrature);
  }
  return iq;
};

const rms = (values: Float32Array) =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

describe("audio survey demodulation", () => {
  it.each([2, 3, 4, 5, 6, 7])(
    "measures %i rightward spike/valley pairs",
    (pairCount) => {
      const power = makeSpikeComb(pairCount);
      const result = walkSpectralSpikeValleys({
        power,
        startBin: 60 - pairCount * 5,
        endBin: 60 + pairCount * 5,
        centerBin: 60,
        threshold: 5,
      });

      expect(result.pairCount).toBe(pairCount);
      expect(result.stopReason).toBe(
        pairCount === 7 ? "pair-limit" : "spectrum-edge",
      );
    },
  );

  it("cuts at the valley before a weak rightward spike", () => {
    const power = makeSpikeComb(6, 6);
    const result = walkSpectralSpikeValleys({
      power,
      startBin: 0,
      endBin: power.length - 1,
      centerBin: 60,
      threshold: 5,
    });

    expect(result.pairCount).toBe(5);
    expect(result.stopReason).toBe("weak-next-spike");
    expect(result.startBin).toBe(59);
    expect(result.endBin).toBeGreaterThan(85);
    expect(result.endBin).toBeLessThan(90);
  });

  it("walks up to seven rightward pairs when the spike train remains strong", () => {
    const power = makeSpikeComb(8);
    const result = walkSpectralSpikeValleys({
      power,
      startBin: 0,
      endBin: power.length - 1,
      centerBin: 60,
      threshold: 5,
    });

    expect(result.pairCount).toBe(7);
    expect(result.stopReason).toBe("pair-limit");
    expect(result.startBin).toBe(59);
    expect(result.endBin).toBe(95);
  });

  it("keeps occupied-bandwidth bounds when the spectrum has too few spikes", () => {
    const power = new Float64Array(121).fill(1);
    power[60] = 20;
    const result = walkSpectralSpikeValleys({
      power,
      startBin: 50,
      endBin: 70,
      centerBin: 60,
      threshold: 5,
    });

    expect(result.pairCount).toBeUndefined();
    expect(result.startBin).toBe(50);
    expect(result.endBin).toBe(70);
    expect(result.stopReason).toBe("insufficient-spikes");
  });

  it("meets the 34 kHz rightward width targets at two and seven pairs", () => {
    const centerBin = 1_024;
    const spacingBins = 34;
    const binWidthHz = 1_000;
    const fftBins = 2_049;
    const twoPairPower = makeSpikeComb(
      2,
      undefined,
      centerBin,
      spacingBins,
      fftBins,
    );
    const twoPairWalk = walkSpectralSpikeValleys({
      power: twoPairPower,
      startBin: 0,
      endBin: fftBins - 1,
      centerBin,
      threshold: 5,
      binWidthHz,
    });
    const twoPairWidthHz =
      (twoPairWalk.endBin - twoPairWalk.startBin + 1) * binWidthHz;

    expect(twoPairWalk.pairCount).toBe(2);
    expect(twoPairWalk.spikeSpacingHz).toBe(34_000);
    expect(twoPairWalk.stopReason).toBe("spectrum-edge");
    expect(twoPairWalk.anchorBin).toBe(centerBin);
    expect(centerBin - twoPairWalk.startBin).toBeLessThanOrEqual(2);
    expect(twoPairWidthHz).toBeGreaterThanOrEqual(66_000);
    expect(twoPairWidthHz).toBeLessThanOrEqual(72_000);

    const weakThirdPower = makeSpikeComb(
      3,
      3,
      centerBin,
      spacingBins,
      fftBins,
    );
    const weakThirdWalk = walkSpectralSpikeValleys({
      power: weakThirdPower,
      startBin: 0,
      endBin: fftBins - 1,
      centerBin,
      threshold: 5,
      binWidthHz,
    });
    const weakThirdWidthHz =
      (weakThirdWalk.endBin - weakThirdWalk.startBin + 1) * binWidthHz;

    expect(weakThirdWalk.pairCount).toBe(2);
    expect(weakThirdWalk.spikeSpacingHz).toBe(34_000);
    expect(weakThirdWalk.stopReason).toBe("weak-next-spike");
    expect(weakThirdWalk.endBin).toBeLessThan(centerBin + 3 * spacingBins);
    expect(weakThirdWidthHz).toBeGreaterThanOrEqual(80_000);
    expect(weakThirdWidthHz).toBeLessThanOrEqual(90_000);

    const sevenPairPower = makeSpikeComb(
      8,
      undefined,
      centerBin,
      spacingBins,
      fftBins,
    );
    const sevenPairWalk = walkSpectralSpikeValleys({
      power: sevenPairPower,
      startBin: 0,
      endBin: fftBins - 1,
      centerBin,
      threshold: 5,
      binWidthHz,
    });
    const sevenPairWidthHz =
      (sevenPairWalk.endBin - sevenPairWalk.startBin + 1) * binWidthHz;

    expect(sevenPairWalk.pairCount).toBe(7);
    expect(sevenPairWalk.spikeSpacingHz).toBe(34_000);
    expect(sevenPairWalk.stopReason).toBe("pair-limit");
    expect(sevenPairWidthHz).toBeGreaterThanOrEqual(230_000);
    expect(sevenPairWidthHz).toBeLessThanOrEqual(245_000);
  });

  it("measures a 34 kHz-spaced signal section through the survey analyzer", () => {
    const sampleRateHz = 1_024_000;
    const fftSize = 16_384;
    const candidates = analyzeAudioSurveyFrame({
      iqData: makeIqToneComb(
        sampleRateHz,
        fftSize,
        256_000,
        34_000,
        7,
      ),
      sampleRateHz,
      frameCenterFrequencyHz: 10_000_000,
      allowedRangeHz: { min: 10_000_000, max: 10_700_000 },
      fftSize,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].spikeValleyPairs).toBe(7);
    expect(candidates[0].spikeSpacingHz).toBeCloseTo(34_000, -2);
    expect(candidates[0].bandwidthHz).toBeGreaterThanOrEqual(230_000);
    expect(candidates[0].bandwidthHz).toBeLessThanOrEqual(245_000);
    expect(candidates[0].centerHz).toBeGreaterThan(10_350_000);
    expect(candidates[0].centerHz).toBeLessThan(10_400_000);
  });

  it("extracts an AM waveform as listenable PCM from the selected IQ channel", () => {
    const sampleRateHz = 256_000;
    const pcm = demodulateAudioCandidate({
      iqData: makeAmIq(sampleRateHz, sampleRateHz / 4, 24_000, 1_000),
      sampleRateHz,
      frameCenterFrequencyHz: 0,
      centerFrequencyHz: 24_000,
      bandwidthHz: 12_000,
      modulation: "am",
    });

    expect(pcm.sampleRateHz).toBe(48_000);
    expect(pcm.samples.length).toBeGreaterThan(10_000);
    expect(rms(pcm.samples)).toBeGreaterThan(0.02);
    expect(Array.from(pcm.samples).every(Number.isFinite)).toBe(true);
  });

  it("finds a modulated carrier near its RF center and returns both baseline decodes", () => {
    const sampleRateHz = 256_000;
    const candidates = analyzeAudioSurveyFrame({
      iqData: makeAmIq(sampleRateHz, sampleRateHz / 4, 24_000, 1_000),
      sampleRateHz,
      frameCenterFrequencyHz: 10_000_000,
      allowedRangeHz: { min: 9_900_000, max: 10_100_000 },
      targetSampleRateHz: 48_000,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].centerHz).toBeCloseTo(10_024_000, -2);
    expect(candidates[0].bandwidthHz).toBeGreaterThan(0);
    expect(candidates[0].audioPcm.length).toBeGreaterThan(0);
    expect(["am", "fm", "apt", "unknown"]).toContain(candidates[0].modulation);
  });

  it("maps candidate frequencies without running a decoder when discovery-only is selected", () => {
    const candidates = analyzeAudioSurveyFrame({
      iqData: makeAmIq(256_000, 8_192, 24_000, 700),
      sampleRateHz: 256_000,
      frameCenterFrequencyHz: 10_000_000,
      allowedRangeHz: { min: 9_900_000, max: 10_100_000 },
      decoderStrategy: null,
    } as any);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].modulation).toBe("unknown");
    expect(candidates[0].audioPcm).toHaveLength(0);
    expect(candidates[0].modulationScores).toEqual({ am: 0, fm: 0, apt: 0 });
  });

  it("runs only the chosen baseline decoder", () => {
    const candidates = analyzeAudioSurveyFrame({
      iqData: makeAmIq(256_000, 8_192, 24_000, 700),
      sampleRateHz: 256_000,
      frameCenterFrequencyHz: 10_000_000,
      allowedRangeHz: { min: 9_900_000, max: 10_100_000 },
      decoderStrategy: "am",
    } as any);

    expect(candidates[0].modulation).toBe("am");
    expect(candidates[0].modulationScores.am).toBeGreaterThan(0);
    expect(candidates[0].modulationScores.fm).toBe(0);
    expect(candidates[0].modulationScores.apt).toBe(0);
    expect(candidates[0].audioPcm.length).toBeGreaterThan(0);
  });

  it("stores a selected narrowband channel at a compact sample rate", () => {
    const sampleRateHz = 256_000;
    const channelizer = createAudioSurveyChannelizer({
      centerFrequencyHz: 24_000,
      bandwidthHz: 12_000,
    });
    const output = channelizer.process(
      makeAmIq(sampleRateHz, 16_384, 24_000, 1_000),
      sampleRateHz,
      0,
    );

    expect(output.sampleRateHz).toBeLessThan(sampleRateHz);
    expect(output.sampleRateHz).toBeGreaterThanOrEqual(48_000);
    expect(output.iqData.length).toBeLessThan(16_384 * 2);
    expect(output.iqData.length % 2).toBe(0);
  });

  it("keeps the APT amplitude envelope, including its valleys, as a live baseline", () => {
    const sampleRateHz = 256_000;
    const frameCenterFrequencyHz = 10_000_000;
    const pcm = demodulateAudioCandidate({
      iqData: makeAptFmIq(sampleRateHz, sampleRateHz / 2, 24_000),
      sampleRateHz,
      frameCenterFrequencyHz,
      centerFrequencyHz: frameCenterFrequencyHz + 24_000,
      bandwidthHz: 50_000,
      modulation: "apt",
      targetSampleRateHz: 48_000,
    });

    const stablePcm = pcm.samples.slice(2_400);
    expect(pcm.sampleRateHz).toBe(48_000);
    expect(stablePcm.length).toBeGreaterThan(20_000);
    expect(percentile(stablePcm, 0.1)).toBeGreaterThanOrEqual(0);
    expect(percentile(stablePcm, 0.1)).toBeLessThan(0.3);
    expect(percentile(stablePcm, 0.9)).toBeGreaterThan(0.4);
    expect(Array.from(stablePcm).every(Number.isFinite)).toBe(true);
  });

  it("scores the APT baseline independently while locating an A/B candidate", () => {
    const sampleRateHz = 256_000;
    const frameCenterFrequencyHz = 10_000_000;
    const candidates = analyzeAudioSurveyFrame({
      iqData: makeAptFmIq(sampleRateHz, sampleRateHz / 2, 24_000),
      sampleRateHz,
      frameCenterFrequencyHz,
      allowedRangeHz: { min: 9_900_000, max: 10_100_000 },
      targetSampleRateHz: 48_000,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].modulationScores.apt).toBeGreaterThan(0.2);
    expect(candidates[0].modulation).toBe("apt");
    expect(candidates[0].centerHz).toBeGreaterThan(10_024_000);
    expect(candidates[0].centerHz).toBeLessThan(10_060_000);
    expect(candidates[0].bandwidthHz).toBeGreaterThanOrEqual(68_000);
    expect(percentile(candidates[0].audioPcm, 0.1)).toBeLessThan(
      percentile(candidates[0].audioPcm, 0.9),
    );
  });
});
