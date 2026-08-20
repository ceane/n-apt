import {
  clampMirroredPanOffset,
  extendSpectrumBelowZero,
  getPositiveSourceRangeForDisplayRange,
  mapDisplayFrequencyToSource,
  mapPositiveHardwareFrequencyToDisplay,
  mapSourceFrequencyToDisplay,
  resolveMirroredHardwareMarkerFrequencies,
  resolveHardwareLimitAliasRanges,
  normalizePositiveHardwareRange,
  resolveMirroredAcquisition,
  resolveMirroredDevicePanOffset,
  resolveMirroredDisplayCenter,
  resolveMirroredRetune,
  resolveMirroredTuning,
  resolveDisplayRangeForPanOffset,
  resolvePanZoomForDisplayRange,
  sourceCoversMirroredDisplay,
} from "@n-apt/math/basebandMirror";
import { prepareSpectrumRenderData, resolveLiveSpectrumPaintContract } from "@n-apt/spectrum/fft/frameProcessing";
import { createFFTZoomProcessor } from "@n-apt/spectrum/utils/rendering/fftZoom";

const FLOOR = -200;

/** Compares a rendered row tolerantly, since Float32 storage rounds. */
const expectRow = (actual: Float32Array, expected: number[]) => {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 5);
  });
};

describe("baseband negative-frequency presentation", () => {
  it("reflects only the display portion below zero and preserves positive bins", () => {
    const spectrum = new Float32Array([0, 1, 2, 3, 4]);

    expect(
      extendSpectrumBelowZero({
        spectrum,
        sourceRange: { min: 0, max: 4 },
        displayRange: { min: -2, max: 2 },
        outputLength: 5,
        floorDb: -150,
      }),
    ).toEqual(new Float32Array([2, 1, 0, 1, 2]));
  });

  it("does not reverse the complete source when the display is negative", () => {
    const spectrum = new Float32Array([0, 1, 2, 3, 4]);

    expect(
      extendSpectrumBelowZero({
        spectrum,
        sourceRange: { min: 0, max: 4 },
        displayRange: { min: -4, max: 0 },
        outputLength: 5,
        floorDb: -150,
      }),
    ).toEqual(new Float32Array([4, 3, 2, 1, 0]));
    expect(spectrum).toEqual(new Float32Array([0, 1, 2, 3, 4]));
  });

  it("reflects negative display coordinates across DC once", () => {
    expect(mapDisplayFrequencyToSource(-2_204_000)).toBe(2_204_000);
    expect(mapDisplayFrequencyToSource(2_204_000)).toBe(2_204_000);
    expect(mapSourceFrequencyToDisplay(2_204_000)).toBe(2_204_000);
  });

  it("maps positive hardware markers onto a wholly negative display axis", () => {
    expect(
      mapPositiveHardwareFrequencyToDisplay(105_000_000, {
        min: -110_000_000,
        max: -90_000_000,
      }),
    ).toBe(-105_000_000);
    expect(
      mapPositiveHardwareFrequencyToDisplay(105_000_000, {
        min: -110_000_000,
        max: 0,
      }),
    ).toBe(-105_000_000);
  });

  it("resolves hardware-limit alias bands using absolute frequency", () => {
    expect(
      resolveHardwareLimitAliasRanges({
        kind: "min_hardware_frequency",
        frequencyHz: 500_000,
        displayRange: { min: -500_000, max: 0 },
      }),
    ).toEqual([{ min: -500_000, max: 0 }]);
    expect(
      resolveHardwareLimitAliasRanges({
        kind: "max_hardware_frequency",
        frequencyHz: 105_000_000,
        displayRange: { min: -110_000_000, max: -90_000_000 },
      }),
    ).toEqual([{ min: -110_000_000, max: -105_000_000 }]);
  });

  it("emits mirrored hardware marker positions when the display crosses DC", () => {
    expect(
      resolveMirroredHardwareMarkerFrequencies(500_000, {
        min: -1_000_000,
        max: 1_000_000,
      }),
    ).toEqual([-500_000, 500_000]);
    expect(
      resolveMirroredHardwareMarkerFrequencies(500_000, {
        min: -1_000_000,
        max: 0,
      }),
    ).toEqual([-500_000]);
  });

  it("re-bases an absolute display window onto a CF ± fs/2 acquisition axis", () => {
    // Redux still points at a start-anchored request; the live frame is centered.
    const displayRange = { min: 100, max: 104 };
    const acquisition = { min: 101, max: 105 };
    const { zoom, panOffsetHz } = resolvePanZoomForDisplayRange({
      hardwareRange: acquisition,
      displayRange,
    });

    expect(zoom).toBeCloseTo(1, 5);
    expect(panOffsetHz).toBeCloseTo(-1, 5);
    expect(
      resolveDisplayRangeForPanOffset({
        hardwareRange: acquisition,
        zoom,
        panOffsetHz,
      }),
    ).toEqual(displayRange);
  });

  it("maps a display window to the positive hardware equivalent", () => {
    expect(
      getPositiveSourceRangeForDisplayRange({ min: -6_240_000, max: 30_000 }),
    ).toEqual({ min: 0, max: 6_240_000 });
    expect(
      getPositiveSourceRangeForDisplayRange({
        min: -25_962_000,
        max: -19_692_000,
      }),
    ).toEqual({ min: 19_692_000, max: 25_962_000 });
    expect(
      getPositiveSourceRangeForDisplayRange({
        min: 19_692_000,
        max: 25_962_000,
      }),
    ).toEqual({ min: 19_692_000, max: 25_962_000 });
  });

  it("keeps hardware requests non-negative without applying a channel clamp", () => {
    expect(normalizePositiveHardwareRange({ min: -3, max: 2 })).toEqual({
      min: 0,
      max: 5,
    });
    expect(
      normalizePositiveHardwareRange({ min: 24_100_000, max: 30_370_000 }),
    ).toEqual({ min: 24_100_000, max: 30_370_000 });
  });

  it("does not treat an unrelated positive window as the reflected source", () => {
    const spectrum = new Float32Array([0, 10, 20, 30, 40]);

    expect(
      extendSpectrumBelowZero({
        spectrum,
        sourceRange: { min: 10, max: 14 },
        displayRange: { min: -14, max: -10 },
        outputLength: 5,
        floorDb: -150,
      }),
    ).toEqual(new Float32Array([40, 30, 20, 10, 0]));
  });

  it("resamples both halves of the row in frequency space", () => {
    // A bin-indexed positive half against a frequency-interpolated negative
    // half only agrees at zoom 1; here the output grid is deliberately coarser
    // than the source so a bin-copied half would show up as a lopsided seam.
    const spectrum = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    expectRow(
      extendSpectrumBelowZero({
        spectrum,
        sourceRange: { min: 0, max: 8 },
        displayRange: { min: -2, max: 2 },
        outputLength: 4,
        floorDb: FLOOR,
      }),
      [2, 2 / 3, 2 / 3, 2],
    );
  });

  it("writes into a provided target buffer instead of allocating", () => {
    const target = new Float32Array(5);

    const output = extendSpectrumBelowZero({
      spectrum: new Float32Array([0, 1, 2, 3, 4]),
      sourceRange: { min: 0, max: 4 },
      displayRange: { min: -2, max: 2 },
      outputLength: 5,
      floorDb: -150,
      target,
    });

    expect(output).toBe(target);
    expect(Array.from(target)).toEqual([2, 1, 0, 1, 2]);
  });

  it("reflects across DC exactly once and never repeats the channel", () => {
    // |f| runs 12 -> 8 here, all outside the acquisition. Repeating the window
    // would paint a copy of the tuned channel; that spectrum is the retune's
    // job to fetch, not the mirror's to invent.
    expect(
      Array.from(
        extendSpectrumBelowZero({
          spectrum: new Float32Array([0, 1, 2, 3, 4]),
          sourceRange: { min: 0, max: 4 },
          displayRange: { min: -12, max: -8 },
          outputLength: 5,
          floorDb: FLOOR,
        }),
      ),
    ).toEqual([FLOOR, FLOOR, FLOOR, FLOOR, FLOOR]);
  });
});

describe("explicit tuning with the mirror on", () => {
  it("tunes a positive channel exactly where asked, with no pan and no offset", () => {
    expect(
      resolveMirroredTuning({ min: 24_100_000, max: 30_370_000 }),
    ).toEqual({
      hardwareRange: { min: 24_100_000, max: 30_370_000 },
      panOffsetHz: 0,
    });
  });

  it("never tunes a positive channel to a negative window", () => {
    const { hardwareRange, panOffsetHz } = resolveMirroredTuning({
      min: 88_000_000,
      max: 92_000_000,
    });

    expect(hardwareRange.min).toBeGreaterThanOrEqual(0);
    expect(panOffsetHz).toBe(0);
  });

  it("presents a below-zero request from a positive window", () => {
    // The window in the reported screenshot: 4.372 MHz of bandwidth centred on
    // 1.102 MHz, which reaches 1.084 MHz below DC.
    const requested = { min: -1_084_000, max: 3_288_000 };
    const { hardwareRange, panOffsetHz } = resolveMirroredTuning(requested);

    expect(hardwareRange).toEqual({ min: 0, max: 4_372_000 });

    const center =
      (hardwareRange.min + hardwareRange.max) / 2 + panOffsetHz;
    const half = (hardwareRange.max - hardwareRange.min) / 2;
    expect(center - half).toBeCloseTo(requested.min, 6);
    expect(center + half).toBeCloseTo(requested.max, 6);
  });

  it("maps a wholly negative request to the corresponding positive RF window", () => {
    expect(
      resolveMirroredTuning({ min: -30_000_000, max: -26_000_000 }),
    ).toEqual({
      hardwareRange: { min: 26_000_000, max: 30_000_000 },
      panOffsetHz: -56_000_000,
    });
  });

  it("keeps the requested bandwidth when clearing 0 Hz", () => {
    const { hardwareRange } = resolveMirroredTuning({
      min: -1_084_000,
      max: 3_288_000,
    });

    expect(hardwareRange.max - hardwareRange.min).toBe(4_372_000);
  });

  it("respects hardware tuning limits", () => {
    const { hardwareRange } = resolveMirroredTuning(
      { min: 28_000_000, max: 32_000_000 },
      { min: 0, max: 30_000_000 },
    );

    expect(hardwareRange).toEqual({ min: 26_000_000, max: 30_000_000 });
  });

  it("does not widen past the sample rate when a channel thumb spans the whole band", () => {
    // FrequencyRangeSlider reports the full channel (e.g. A = 0–20 MHz) while
    // the radio only acquires `sampleRateHz`. Widening Redux to the channel
    // span is what painted one SR-sized island and flatlined the rest.
    const sampleRateHz = 8_780_000;
    const { hardwareRange, panOffsetHz } = resolveMirroredTuning(
      { min: 0, max: 20_000_000 },
      null,
      { maxAcquisitionSpanHz: sampleRateHz },
    );

    expect(hardwareRange).toEqual({ min: 0, max: sampleRateHz });
    expect(panOffsetHz).toBe(0);
  });

  it("keeps a DC-crossing slider drag at the sample-rate window, fully mirror-filled", () => {
    const sampleRateHz = 8_780_000;
    const requested = { min: -10_000_000, max: 10_000_000 };
    const { hardwareRange, panOffsetHz } = resolveMirroredTuning(
      requested,
      null,
      { maxAcquisitionSpanHz: sampleRateHz },
    );

    expect(hardwareRange.max - hardwareRange.min).toBe(sampleRateHz);
    expect(hardwareRange.min).toBe(0);

    // Viewport is acquisition-sized and centred on DC — mirror fills it.
    const center = (hardwareRange.min + hardwareRange.max) / 2 + panOffsetHz;
    const half = (hardwareRange.max - hardwareRange.min) / 2;
    expect(center).toBeCloseTo(0, 6);
    expect(center - half).toBeCloseTo(-sampleRateHz / 2, 6);
    expect(center + half).toBeCloseTo(sampleRateHz / 2, 6);
  });
});

describe("channel-slider island regression", () => {
  it("paints a fully filled mirror after a sample-rate-capped channel tune", () => {
    // Reproduce: tune channel A (0–20 MHz) with SR 8.78 MHz, then look at the
    // DC-centred mirror. The row must be fully populated from the acquisition
    // — not one narrow island with floor on either side.
    const sampleRateHz = 8;
    const tune = resolveMirroredTuning(
      { min: 0, max: 20 },
      null,
      { maxAcquisitionSpanHz: sampleRateHz },
    );
    expect(tune.hardwareRange).toEqual({ min: 0, max: sampleRateHz });

    const waveform = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const crossing = resolveMirroredTuning(
      { min: -10, max: 10 },
      null,
      { maxAcquisitionSpanHz: sampleRateHz },
    );
    const { spectrumWaveform, visualRange, coversDisplay } =
      prepareSpectrumRenderData({
        waveform,
        frequencyRange: crossing.hardwareRange,
        sourceFrequencyRange: crossing.hardwareRange,
        zoom: 1,
        panOffset: crossing.panOffsetHz,
        invert: false,
        dbMin: FLOOR,
        dbMax: 0,
        allowNegativeFrequencies: true,
        getZoomedData: createFFTZoomProcessor(FLOOR).process,
      });

    expect(visualRange).toEqual({ min: -4, max: 4 });
    expect(coversDisplay).toBe(true);
    expect(Array.from(spectrumWaveform)).toEqual([4, 3, 2, 1, 0, 1, 2, 3, 4]);
    expect(spectrumWaveform.every((value) => value !== FLOOR)).toBe(true);
  });

  it("does not island when redux is start-anchored but the frame is CF ± fs/2 centered", () => {
    const sampleRateHz = 4_372_000;
    const requestedViewRange = { min: 0, max: sampleRateHz };
    const sourceFrequencyRange = {
      min: 4_294_000,
      max: 8_666_000,
    };
    const waveform = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz: 4_294_000,
      mirrorEnabled: true,
      frameCenterHz: 6_480_000,
      frameSampleRateHz: sampleRateHz,
    });
    const { spectrumWaveform, visualRange, coversDisplay } =
      prepareSpectrumRenderData({
        waveform,
        frequencyRange: contract.paintViewportRange,
        sourceFrequencyRange: contract.sourceFrequencyRange,
        zoom: contract.zoom,
        panOffset: contract.panOffsetHz,
        invert: false,
        dbMin: FLOOR,
        dbMax: 0,
        allowNegativeFrequencies: true,
        mirrorOnGpu: true,
        resampleOnGpu: true,
        getZoomedData: createFFTZoomProcessor(FLOOR).process,
      });

    expect(visualRange).toEqual(contract.displayRange);
    expect(coversDisplay).toBe(true);
    expect(Array.from(spectrumWaveform)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(spectrumWaveform.every((value) => value !== FLOOR)).toBe(true);
  });
});

describe("mirrored viewport bounds", () => {
  it("never traps the viewport inside the current acquisition", () => {
    // Panning well past the acquired window is allowed; it is what asks for
    // more spectrum. Only the radio's tuning range may stop it.
    expect(
      clampMirroredPanOffset({
        panOffsetHz: -50_000_000,
        hardwareRange: { min: 0, max: 4_372_000 },
        zoom: 1,
      }),
    ).toBe(-50_000_000);
  });

  it("stops at the radio's tuning limit, mirrored across DC", () => {
    const hardwareRange = { min: 0, max: 8 };

    expect(
      clampMirroredPanOffset({
        panOffsetHz: -1000,
        hardwareRange,
        tuningBounds: { min: 0, max: 32 },
        zoom: 1,
      }),
    ).toBe(-32);
    expect(
      clampMirroredPanOffset({
        panOffsetHz: 1000,
        hardwareRange,
        tuningBounds: { min: 0, max: 32 },
        zoom: 1,
      }),
    ).toBe(24);
  });

  it("leaves an in-range pan offset untouched", () => {
    expect(
      clampMirroredPanOffset({
        panOffsetHz: -4,
        hardwareRange: { min: 0, max: 8 },
        tuningBounds: { min: 0, max: 32 },
        zoom: 1,
      }),
    ).toBe(-4);
  });
});

describe("mirrored acquisition threshold", () => {
  const sourceRange = { min: 0, max: 4_000_000 };

  it("does not retune while the viewport stays inside the mirrored window", () => {
    expect(
      resolveMirroredAcquisition({
        displayRange: { min: -2_000_000, max: 2_000_000 },
        sourceRange,
      }),
    ).toEqual({ range: sourceRange, needsRetune: false });
  });

  it("does not retune merely because the displayed center is negative", () => {
    const sourceRange = { min: 24_000_000, max: 30_000_000 };
    const result = resolveMirroredAcquisition({
      displayRange: { min: -29_000_000, max: -25_000_000 },
      sourceRange,
    });

    expect(result).toEqual({ range: sourceRange, needsRetune: false });
  });

  it("retunes when a wholly negative viewport needs |f| beyond the acquisition", () => {
    const result = resolveMirroredAcquisition({
      displayRange: { min: -5_780_000, max: -1_405_000 },
      sourceRange: { min: 0, max: 4_372_000 },
    });

    expect(result.needsRetune).toBe(true);
    expect(result.range.min).toBeGreaterThanOrEqual(0);
    expect(result.range.max).toBeGreaterThan(4_372_000);
  });

  it("uses the current frame as the hold source for a negative center", () => {
    expect(
      resolveMirroredDisplayCenter({
        displayCenterHz: -27_000_000,
        displaySpanHz: 4_000_000,
        sourceRange: { min: 24_000_000, max: 30_000_000 },
      }),
    ).toEqual({
      range: { min: 24_000_000, max: 30_000_000 },
      needsRetune: false,
      panOffsetHz: -54_000_000,
    });

    const retune = resolveMirroredDisplayCenter({
      displayCenterHz: -32_000_000,
      displaySpanHz: 4_000_000,
      sourceRange: { min: 24_000_000, max: 30_000_000 },
    });
    expect(retune.needsRetune).toBe(true);
    expect(retune.range.min).toBeGreaterThanOrEqual(0);
    expect(retune.range.max - retune.range.min).toBe(6_000_000);
  });

  it("retunes when a DC-crossing viewport is not covered by the acquisition", () => {
    const sourceRange = { min: 4_294_000, max: 8_666_000 };
    const { range, needsRetune } = resolveMirroredAcquisition({
      displayRange: { min: -1_764_000, max: 2_608_000 },
      sourceRange,
    });

    expect(needsRetune).toBe(true);
    expect(range.min).toBe(0);
    expect(range.max - range.min).toBeCloseTo(4_372_000, -3);
  });

  it("grabs more spectrum once the viewport needs frequencies we never acquired", () => {
    const { range, needsRetune } = resolveMirroredAcquisition({
      displayRange: { min: 5_000_000, max: 9_000_000 },
      sourceRange,
    });

    expect(needsRetune).toBe(true);
    expect(range).toEqual({ min: 5_000_000, max: 9_000_000 });
  });

  it("keeps the current sample rate when retuning", () => {
    const { range } = resolveMirroredAcquisition({
      displayRange: { min: -6_000_000, max: -5_000_000 },
      sourceRange,
    });

    expect(range.max - range.min).toBe(4_000_000);
  });

  it("never asks the radio for a window below 0 Hz", () => {
    const { range } = resolveMirroredAcquisition({
      displayRange: { min: -4_500_000, max: -500_000 },
      sourceRange,
    });

    expect(range.min).toBeGreaterThanOrEqual(0);
  });

  it("respects hardware tuning limits", () => {
    const { range } = resolveMirroredAcquisition({
      displayRange: { min: 50_000_000, max: 54_000_000 },
      sourceRange,
      hardwareBounds: { min: 0, max: 30_000_000 },
    });

    expect(range).toEqual({ min: 26_000_000, max: 30_000_000 });
  });
});

/**
 * End-to-end coverage of the exact wiring FFTCanvas uses. The source spectrum
 * is a ramp whose value equals its frequency, so any misalignment between the
 * two halves of the row shows up directly in the numbers.
 */
describe("mirrored spectrum render pipeline", () => {
  const waveform = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const hardwareRange = { min: 0, max: 8 };

  const render = ({ zoom, pan }: { zoom: number; pan: number }) =>
    prepareSpectrumRenderData({
      waveform,
      frequencyRange: hardwareRange,
      sourceFrequencyRange: hardwareRange,
      zoom,
      panOffset: pan,
      invert: false,
      dbMin: FLOOR,
      dbMax: 0,
      allowNegativeFrequencies: true,
      getZoomedData: createFFTZoomProcessor(FLOOR).process,
    });

  it("mirrors symmetrically about DC at zoom 1", () => {
    const { spectrumWaveform, visualRange } = render({ zoom: 1, pan: -4 });

    expect(visualRange).toEqual({ min: -4, max: 4 });
    expect(Array.from(spectrumWaveform)).toEqual([4, 3, 2, 1, 0, 1, 2, 3, 4]);
  });

  it("mirrors symmetrically about DC when zoomed in", () => {
    const { spectrumWaveform, visualRange } = render({ zoom: 2, pan: -4 });

    expect(visualRange).toEqual({ min: -2, max: 2 });
    expectRow(spectrumWaveform, [2, 2 / 3, 2 / 3, 2]);
  });

  it("keeps the reflection symmetric when zoomed out", () => {
    const { spectrumWaveform } = render({ zoom: 0.5, pan: -4 });
    const row = Array.from(spectrumWaveform);

    expect(row).toEqual([...row].reverse());
  });

  it("lets the viewport pan past the acquisition so a retune can be asked for", () => {
    const { visualRange, clampedPan } = render({ zoom: 1, pan: -16 });

    expect(clampedPan).toBe(-16);
    expect(visualRange).toEqual({ min: -16, max: -8 });
  });

  it("resamples a wholly positive viewport in frequency space too", () => {
    // Same convention on both sides of DC, so zooming does not shift the trace.
    const { spectrumWaveform, visualRange } = render({ zoom: 2, pan: 2 });

    expect(visualRange).toEqual({ min: 4, max: 8 });
    expectRow(spectrumWaveform, [4, 16 / 3, 20 / 3, 8]);
  });

  it("shows no repeat of the tuned channel anywhere outside the mirror", () => {
    // Everything here is beyond +/-8, so a repeating fold would be obvious.
    for (const pan of [-40, -20, 20, 40]) {
      const { spectrumWaveform } = render({ zoom: 1, pan });
      expect(Array.from(spectrumWaveform)).toEqual(
        new Array(spectrumWaveform.length).fill(FLOOR),
      );
    }
  });
});

describe("re-anchoring the viewport across a retune", () => {
  it("keeps a mirrored subscriber on the new absolute device center", () => {
    const nextHardwareRange = { min: 2, max: 6 };
    const panOffsetHz = resolveMirroredDevicePanOffset({
      previousHardwareRange: { min: 0, max: 4 },
      nextHardwareRange,
      previousPanOffsetHz: -3,
      mirrorEnabled: true,
    });

    expect(panOffsetHz).toBe(-8);
    const displayRange = resolveDisplayRangeForPanOffset({
      hardwareRange: nextHardwareRange,
      zoom: 1,
      panOffsetHz: panOffsetHz ?? 0,
    });
    expect(displayRange).toEqual({ min: -6, max: -2 });
    expect(sourceCoversMirroredDisplay(nextHardwareRange, displayRange)).toBe(
      true,
    );
  });

  it("does not rewrite subscriber-local pan without a device-range change", () => {
    expect(
      resolveMirroredDevicePanOffset({
        previousHardwareRange: { min: 0, max: 4 },
        nextHardwareRange: { min: 0, max: 4 },
        previousPanOffsetHz: -3,
        mirrorEnabled: true,
      }),
    ).toBeNull();
    expect(
      resolveMirroredDevicePanOffset({
        previousHardwareRange: { min: 0, max: 4 },
        nextHardwareRange: { min: 2, max: 6 },
        previousPanOffsetHz: -3,
        mirrorEnabled: false,
      }),
    ).toBeNull();
  });

  it("does not retune a wholly negative viewport the acquisition already covers", () => {
    const sourceRange = { min: 3_005_000, max: 6_205_000 };
    expect(
      resolveMirroredRetune({
        displayRange: { min: -6_205_000, max: -3_005_000 },
        sourceRange,
      }),
    ).toEqual({
      range: sourceRange,
      needsRetune: false,
      panOffsetHz: -9_210_000,
    });
  });

  it("retunes an uncovered negative viewport and keeps the display still", () => {
    const displayRange = { min: -6_000_000, max: -2_000_000 };
    const { range, panOffsetHz, needsRetune } = resolveMirroredRetune({
      displayRange,
      sourceRange: { min: 0, max: 4_000_000 },
    });

    expect(needsRetune).toBe(true);
    expect(range.min).toBeGreaterThanOrEqual(0);

    const nextCenter = (range.min + range.max) / 2;
    const displaySpan = displayRange.max - displayRange.min;
    const nextDisplayCenter = nextCenter + panOffsetHz;

    expect(nextDisplayCenter - displaySpan / 2).toBeCloseTo(displayRange.min, 6);
    expect(nextDisplayCenter + displaySpan / 2).toBeCloseTo(displayRange.max, 6);

    expect(
      resolveMirroredRetune({ displayRange, sourceRange: range }).needsRetune,
    ).toBe(false);
  });
});
