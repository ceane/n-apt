import {
  accumulateFullChannelWaveform,
  prepareSpectrumRenderData,
  resolveLiveSpectrumCoordinateModel,
  resolveLiveSpectrumPaintContract,
  shouldClearSpectrumWaveformForRangeChange,
  resolveFrameTemporalWindow,
  resolveSpectrumWaveform,
  shouldPresentSpectrumFrameForRange,
  shouldAdoptLiveFrameRange,
  updateTemporalWaveform,
} from "@n-apt/spectrum/fft/frameProcessing";
import { createFFTZoomProcessor } from "@n-apt/spectrum/utils/rendering/fftZoom";

function createState() {
  return {
    framePool: [] as Float32Array[],
    activeFrames: [] as Float32Array[],
    writeIndex: 0,
    activeCount: 0,
    renderWaveform: null as Float32Array | null,
  };
}

describe("updateTemporalWaveform", () => {
  it("returns the current waveform without buffering for a lossless window", () => {
    const state = createState();
    const waveform = new Float32Array([1, 2]);

    const result = updateTemporalWaveform(waveform, 1, state);

    expect(result.renderWaveform).toBe(waveform);
    expect(result.activeCount).toBe(0);
    expect(state.framePool).toHaveLength(0);
  });

  it("averages the frames currently in the ring", () => {
    const state = createState();

    const first = updateTemporalWaveform(new Float32Array([2, 4]), 2, state);
    expect(Array.from(first.renderWaveform)).toEqual([2, 4]);
    expect(first.activeCount).toBe(1);

    const second = updateTemporalWaveform(
      new Float32Array([4, 8]),
      2,
      state,
    );
    expect(Array.from(second.renderWaveform)).toEqual([3, 6]);
    expect(second.activeCount).toBe(2);
  });

  it("resets storage when the waveform shape or window changes", () => {
    const state = createState();
    updateTemporalWaveform(new Float32Array([1, 2]), 3, state);
    const result = updateTemporalWaveform(new Float32Array([5, 7, 9]), 2, state);

    expect(state.framePool).toHaveLength(2);
    expect(state.framePool[0]).toHaveLength(3);
    expect(result.activeCount).toBe(1);
    expect(Array.from(result.renderWaveform)).toEqual([5, 7, 9]);
  });
});

describe("accumulateFullChannelWaveform", () => {
  it("starts a channel buffer and maps a hop into its range", () => {
    const result = accumulateFullChannelWaveform({
      state: { waveform: null, range: null },
      channelRange: { min: 0, max: 100 },
      hopCenterHz: 50,
      hopSampleRate: 20,
      waveform: new Float32Array([1, 2, 3]),
    });

    expect(result.waveform).toHaveLength(4096);
    expect(result.range).toEqual({ min: 0, max: 100 });
    expect(result.waveform?.some((value) => value !== -200)).toBe(true);
  });

  it("resets the accumulated buffer when the channel range changes", () => {
    const first = accumulateFullChannelWaveform({
      state: { waveform: null, range: null },
      channelRange: { min: 0, max: 100 },
      hopCenterHz: 50,
      hopSampleRate: 20,
      waveform: new Float32Array([10]),
    });
    const second = accumulateFullChannelWaveform({
      state: first,
      channelRange: { min: 100, max: 200 },
      hopCenterHz: 150,
      hopSampleRate: 20,
      waveform: new Float32Array([20]),
    });

    expect(second.waveform?.includes(10)).toBe(false);
    expect(second.waveform?.includes(20)).toBe(true);
  });
});

describe("resolveSpectrumWaveform", () => {
  it("processes IQ payloads through the supplied spectrum function", () => {
    const result = resolveSpectrumWaveform({
      source: { iq_data: new Uint8Array([1, 2]) },
      processIq: (iqData) => new Float32Array([iqData[0] + iqData[1]]),
    });

    expect(Array.from(result ?? [])).toEqual([3]);
  });

  it("preserves preprocessed playback waveforms", () => {
    const waveform = new Float32Array([4, 5]);
    const result = resolveSpectrumWaveform({ source: { waveform } });

    expect(result).toBe(waveform);
  });
});

describe("prepareSpectrumRenderData", () => {
  it("keeps ordinary live pan and zoom resampling on WebGPU", () => {
    const waveform = new Float32Array([1, 2, 3, 4]);
    const getZoomedData = jest.fn(() => {
      throw new Error("live WebGPU rendering must not CPU-slice the FFT");
    });

    const result = prepareSpectrumRenderData({
      waveform,
      frequencyRange: { min: 100, max: 200 },
      zoom: 2,
      panOffset: 20,
      invert: false,
      dbMin: -120,
      dbMax: 0,
      resampleOnGpu: true,
      getZoomedData,
    });

    expect(getZoomedData).not.toHaveBeenCalled();
    expect(result.spectrumWaveform).toBe(waveform);
    expect(result.visualRange).toEqual({ min: 145, max: 195 });
    expect(result.clampedPan).toBe(20);
  });

  it("keeps mirror-enabled positive viewport resampling on the GPU", () => {
    const waveform = new Float32Array([1, 2, 3, 4]);
    const getZoomedData = jest.fn(() => {
      throw new Error("mirror-enabled WebGPU must own viewport resampling");
    });
    const result = prepareSpectrumRenderData({
      waveform,
      frequencyRange: { min: 0, max: 100 },
      sourceFrequencyRange: { min: 0, max: 100 },
      zoom: 2,
      panOffset: 0,
      invert: false,
      dbMin: -120,
      dbMax: 0,
      allowNegativeFrequencies: true,
      mirrorOnGpu: true,
      getZoomedData,
    });

    expect(getZoomedData).not.toHaveBeenCalled();
    expect(result.spectrumWaveform).toBe(waveform);
    expect(result.slicedWaveform).toBe(waveform);
    expect(result.visualRange).toEqual({ min: 25, max: 75 });
  });

  it("does not run the CPU zoom/slice when the GPU owns mirror resampling", () => {
    const waveform = new Float32Array([1, 2, 3, 4]);
    const getZoomedData = jest.fn(() => {
      throw new Error("the GPU mirror path must not slice on the CPU");
    });

    const result = prepareSpectrumRenderData({
      waveform,
      frequencyRange: { min: 0, max: 100 },
      sourceFrequencyRange: { min: 0, max: 100 },
      zoom: 2,
      panOffset: -60,
      invert: false,
      dbMin: -120,
      dbMax: 0,
      allowNegativeFrequencies: true,
      mirrorOnGpu: true,
      getZoomedData,
    });

    expect(getZoomedData).not.toHaveBeenCalled();
    expect(result.spectrumWaveform).toBe(waveform);
    expect(result.slicedWaveform).toBe(waveform);
    expect(result.visualRange).toEqual({ min: -35, max: 15 });
    expect(result.clampedPan).toBe(-60);
  });

  it("preserves the zoom processor result and applies inversion when requested", () => {
    const result = prepareSpectrumRenderData({
      waveform: new Float32Array([1, 2]),
      frequencyRange: { min: 0, max: 10 },
      zoom: 2,
      panOffset: 0,
      invert: true,
      dbMin: -10,
      dbMax: 0,
      getZoomedData: () => ({
        slicedWaveform: new Float32Array([1, 2]),
        visualRange: { min: 2, max: 8 },
        clampedPan: 0.25,
      }),
    });

    expect(Array.from(result.spectrumWaveform)).toEqual([-11, -12]);
    expect(result.visualRange).toEqual({ min: 2, max: 8 });
    expect(result.clampedPan).toBe(0.25);
  });

  it("extends only the crossed negative viewport from positive source bins", () => {
    const result = prepareSpectrumRenderData({
      waveform: new Float32Array([0, 1, 2, 3, 4]),
      frequencyRange: { min: 0, max: 4 },
      zoom: 1,
      panOffset: -2,
      invert: false,
      dbMin: -150,
      dbMax: 0,
      allowNegativeFrequencies: true,
      getZoomedData: (
        _waveform,
        _range,
        _zoom,
        _pan,
        _allowNegative,
      ) => ({
        slicedWaveform: new Float32Array(5),
        visualRange: { min: -2, max: 2 },
        clampedPan: -2,
      }),
    });

    expect(Array.from(result.spectrumWaveform)).toEqual([2, 1, 0, 1, 2]);
  });

  it("resamples the mirror from the waveform axis after pan/zoom re-base", () => {
    // Callers re-base Redux pan onto CF ± fs/2 before prepare. Geometry and
    // source must share that axis — a stale start-anchored request is what
    // produced the channel island.
    const result = prepareSpectrumRenderData({
      waveform: new Float32Array([0, 1, 2, 3, 4]),
      frequencyRange: { min: 10, max: 14 },
      sourceFrequencyRange: { min: 10, max: 14 },
      zoom: 1,
      panOffset: -24,
      invert: false,
      dbMin: -150,
      dbMax: 0,
      allowNegativeFrequencies: true,
      getZoomedData: createFFTZoomProcessor(-200).process,
    });

    expect(result.visualRange).toEqual({ min: -14, max: -10 });
    expect(Array.from(result.spectrumWaveform)).toEqual([4, 3, 2, 1, 0]);
  });

  it("anchors mirror geometry to the positive acquisition window", () => {
    const result = prepareSpectrumRenderData({
      waveform: new Float32Array([0, 1, 2, 3, 4]),
      // Pan is measured against the view base (= positive acquisition). A pan
      // of -24 around center 12 lands the viewport on the reflection [-14, -10].
      frequencyRange: { min: 10, max: 14 },
      sourceFrequencyRange: { min: 10, max: 14 },
      zoom: 1,
      panOffset: -24,
      invert: false,
      dbMin: -150,
      dbMax: 0,
      allowNegativeFrequencies: true,
      getZoomedData: createFFTZoomProcessor(-200).process,
    });

    expect(result.visualRange).toEqual({ min: -14, max: -10 });
    expect(Array.from(result.spectrumWaveform)).toEqual([4, 3, 2, 1, 0]);
  });

  it("uses the same acquisition origin on the GPU mirror path", () => {
    const waveform = new Float32Array([0, 1, 2, 3, 4]);
    const getZoomedData = jest.fn(() => {
      throw new Error("GPU mirror geometry must not slice on the CPU");
    });

    const result = prepareSpectrumRenderData({
      waveform,
      frequencyRange: { min: 10, max: 14 },
      sourceFrequencyRange: { min: 10, max: 14 },
      zoom: 1,
      panOffset: -24,
      invert: false,
      dbMin: -150,
      dbMax: 0,
      allowNegativeFrequencies: true,
      mirrorOnGpu: true,
      getZoomedData,
    });

    expect(getZoomedData).not.toHaveBeenCalled();
    expect(result.visualRange).toEqual({ min: -14, max: -10 });
    expect(result.slicedWaveform).toBe(waveform);
  });

  it("keeps free pan above 0 Hz so positive tunes are not re-clamped", () => {
    const getZoomedData = jest.fn(
      (
        waveform: Float32Array,
        frequencyRange: { min: number; max: number },
        zoom: number,
        panOffset: number,
        allowNegative?: boolean,
      ) =>
        createFFTZoomProcessor(-200).process(
          waveform,
          frequencyRange,
          zoom,
          panOffset,
          allowNegative,
        ),
    );

    const result = prepareSpectrumRenderData({
      waveform: new Float32Array([0, 1, 2, 3, 4]),
      frequencyRange: { min: 10, max: 14 },
      sourceFrequencyRange: { min: 10, max: 14 },
      zoom: 2,
      panOffset: -1.5,
      invert: false,
      dbMin: -150,
      dbMax: 0,
      allowNegativeFrequencies: true,
      mirrorOnGpu: true,
      getZoomedData,
    });

    // Viewport stays positive: the shader fold stays off, but the original
    // acquisition remains on the GPU and only the viewport uniforms change.
    expect(result.visualRange).toEqual({ min: 9.5, max: 11.5 });
    expect(result.clampedPan).toBe(-1.5);
    expect(getZoomedData).not.toHaveBeenCalled();
    expect(result.spectrumWaveform).toEqual(new Float32Array([0, 1, 2, 3, 4]));
  });

  it("keeps available bins when only part of the mirrored viewport is uncovered", () => {
    const result = prepareSpectrumRenderData({
      waveform: new Float32Array([0, 1, 2, 3, 4]),
      frequencyRange: { min: 0, max: 4 },
      sourceFrequencyRange: { min: 0, max: 4 },
      zoom: 1,
      panOffset: 0,
      invert: false,
      dbMin: -200,
      dbMax: 0,
      allowNegativeFrequencies: true,
      getZoomedData: () => ({
        slicedWaveform: new Float32Array(4),
        visualRange: { min: -6, max: 3 },
        clampedPan: -3.5,
      }),
    });

    expect(result.visualRange).toEqual({ min: -6, max: 3 });
    expect(Array.from(result.spectrumWaveform)).toEqual([-200, 3, 0, 3]);
  });
});

describe("resolveLiveSpectrumCoordinateModel", () => {
  it("does not move the viewport when mirroring is toggled on the same axis", () => {
    const range = { min: 18_000, max: 4_390_000 };
    const positive = resolveLiveSpectrumCoordinateModel({
      viewportBaseRange: range,
      sourceRange: range,
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: false,
    });
    const mirrored = resolveLiveSpectrumCoordinateModel({
      viewportBaseRange: range,
      sourceRange: range,
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: true,
    });

    expect(mirrored.displayRange).toEqual(positive.displayRange);
    expect(mirrored.sourceRange).toEqual(positive.sourceRange);
    expect(mirrored.displayRange).toEqual(range);
  });

  it("mirrors below DC when pan crosses zero", () => {
    const acquisition = { min: 0, max: 8 };
    const mirrored = resolveLiveSpectrumCoordinateModel({
      viewportBaseRange: acquisition,
      sourceRange: acquisition,
      zoom: 1,
      panOffsetHz: -4,
      mirrorEnabled: true,
    });

    expect(mirrored.displayRange).toEqual({ min: -4, max: 4 });
  });
});

describe("resolveLiveSpectrumPaintContract", () => {
  const FLOOR = -120;

  it("re-bases a start-anchored redux pan onto the live CF ± fs/2 axis", () => {
    const requestedViewRange = { min: 0, max: 4_372_000 };
    const sourceFrequencyRange = { min: 4_294_000, max: 8_666_000 };
    const panOffsetHz = 4_294_000;

    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz,
      mirrorEnabled: true,
      frameCenterHz: 6_480_000,
      frameSampleRateHz: 4_372_000,
    });

    expect(contract.paintViewportRange).toEqual(sourceFrequencyRange);
    expect(contract.displayRange).toEqual({
      min: 4_294_000,
      max: 8_666_000,
    });
    expect(contract.panOffsetHz).toBeCloseTo(0, 0);
  });

  it("keeps a lagging live frame on its own axis instead of painting a gap", () => {
    const sourceFrequencyRange = { min: 26_000_000, max: 30_000_000 };
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange: { min: 24_000_000, max: 28_000_000 },
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: true,
    });

    expect(contract.displayRange).toEqual(sourceFrequencyRange);
    expect(contract.panOffsetHz).toBe(0);
  });

  it("keeps an uncovered DC-crossing frame whole instead of painting two islands", () => {
    const requestedViewRange = {
      min: -11_417_900,
      max: 6_832_100,
    };
    const sourceFrequencyRange = {
      min: 4_700_000,
      max: 22_950_000,
    };
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: true,
    });

    // The pending VFO is negative, so present the complete resident frame on
    // its reflected axis until a replacement frame can cover the requested
    // DC-crossing viewport. Never stretch the old frame over the new axis.
    expect(contract.displayRange).toEqual({
      min: -22_950_000,
      max: -4_700_000,
    });

    const result = prepareSpectrumRenderData({
      waveform: new Float32Array(2048).fill(-75),
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

    expect(result.coversDisplay).toBe(true);
    expect(result.visualRange).toEqual(contract.displayRange);
  });

  it("fills the row instead of a channel island when redux and frame axes differ", () => {
    const requestedViewRange = { min: 0, max: 4_372_000 };
    const sourceFrequencyRange = { min: 4_294_000, max: 8_666_000 };
    const waveform = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz: 4_294_000,
      mirrorEnabled: true,
      frameCenterHz: 6_480_000,
      frameSampleRateHz: 4_372_000,
    });

    const getZoomedData = jest.fn(createFFTZoomProcessor(FLOOR).process);
    const result = prepareSpectrumRenderData({
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
      getZoomedData,
    });

    expect(result.visualRange).toEqual(contract.displayRange);
    expect(result.coversDisplay).toBe(true);
    expect(Array.from(result.spectrumWaveform)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.spectrumWaveform.every((value) => value !== FLOOR)).toBe(true);
    expect(getZoomedData).not.toHaveBeenCalled();
  });

  it("does not widen a cold-start capped frame back to the channel span", () => {
    const sourceFrequencyRange = { min: 0, max: 4_372_000 };
    const contract = resolveLiveSpectrumPaintContract({
      // The persisted channel selection can still be present for the first
      // frame while the live source has only accepted its sample-rate window.
      requestedViewRange: { min: 0, max: 20_000_000 },
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: true,
      frameCenterHz: 2_186_000,
      frameSampleRateHz: 4_372_000,
    });

    expect(contract.displayRange).toEqual(sourceFrequencyRange);
    expect(contract.zoom).toBe(1);
    expect(contract.panOffsetHz).toBe(0);
  });

  it("mirrors below DC on the acquisition axis after re-base", () => {
    const acquisition = { min: 0, max: 8 };
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange: acquisition,
      sourceFrequencyRange: acquisition,
      zoom: 1,
      panOffsetHz: -4,
      mirrorEnabled: true,
    });
    const result = prepareSpectrumRenderData({
      waveform: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      frequencyRange: contract.paintViewportRange,
      sourceFrequencyRange: contract.sourceFrequencyRange,
      zoom: contract.zoom,
      panOffset: contract.panOffsetHz,
      invert: false,
      dbMin: FLOOR,
      dbMax: 0,
      allowNegativeFrequencies: true,
      getZoomedData: createFFTZoomProcessor(FLOOR).process,
    });

    expect(result.visualRange).toEqual({ min: -4, max: 4 });
    expect(Array.from(result.spectrumWaveform)).toEqual([4, 3, 2, 1, 0, 1, 2, 3, 4]);
    expect(result.spectrumWaveform.every((value) => value !== FLOOR)).toBe(true);
  });

  it("does not lock the FFT in place when mirroring below DC", () => {
    const acquisition = { min: 0, max: 4_372_000 };
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange: acquisition,
      sourceFrequencyRange: acquisition,
      zoom: 1,
      panOffsetHz: -2_186_000,
      mirrorEnabled: true,
      frameCenterHz: 2_186_000,
      frameSampleRateHz: 4_372_000,
    });

    expect(contract.displayRange).toEqual({
      min: -2_186_000,
      max: 2_186_000,
    });
  });

  it("does not snap a DC-straddling scroll to the positive live-frame center", () => {
    const requestedViewRange = { min: 0, max: 4_372_000 };
    const sourceFrequencyRange = { min: 4_294_000, max: 8_666_000 };
    const hardwareCenter =
      (requestedViewRange.min + requestedViewRange.max) / 2;
    const panOffsetHz = -hardwareCenter + 1_000;
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz,
      mirrorEnabled: true,
      frameCenterHz: 6_480_000,
      frameSampleRateHz: 4_372_000,
    });

    const displayCenter =
      (contract.displayRange.min + contract.displayRange.max) / 2;
    const frameCenter =
      (sourceFrequencyRange.min + sourceFrequencyRange.max) / 2;
    expect(contract.displayRange.min).toBeLessThan(0);
    expect(contract.displayRange.max).toBeGreaterThan(0);
    expect(displayCenter).toBeCloseTo(hardwareCenter + panOffsetHz, 0);
    expect(Math.abs(displayCenter - frameCenter)).toBeGreaterThan(1_000_000);
  });

  it("does not snap a Channel A scroll past -A.max onto the positive A axis", () => {
    const channelA = { min: 18_000, max: 4_390_000 };
    const hardwareCenter = (channelA.min + channelA.max) / 2;
    const panOffsetHz = -5_000_000 - hardwareCenter;
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange: channelA,
      sourceFrequencyRange: channelA,
      zoom: 1,
      panOffsetHz,
      mirrorEnabled: true,
    });

    const displayCenter =
      (contract.displayRange.min + contract.displayRange.max) / 2;
    expect(displayCenter).toBeCloseTo(-5_000_000, 0);
    expect(displayCenter).toBeLessThan(0);
    expect(contract.displayRange.min).toBeLessThan(-channelA.max);
  });

  it("does not flip a -5 MHz mirror center to the positive |f| image", () => {
    const requestedViewRange = { min: 0, max: 10_000_000 };
    const laggedFrame = { min: 4_294_000, max: 8_666_000 };
    const panOffsetHz = -10_000_000;
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange: laggedFrame,
      zoom: 1,
      panOffsetHz,
      mirrorEnabled: true,
      frameCenterHz: 6_480_000,
      frameSampleRateHz: 4_372_000,
    });

    const displayCenter =
      (contract.displayRange.min + contract.displayRange.max) / 2;
    expect(displayCenter).toBeCloseTo(-5_000_000, -3);
    expect(displayCenter).toBeLessThan(0);
  });

  it("does not jump to the reflected frame when scroll center just crosses below DC", () => {
    const requestedViewRange = { min: 0, max: 4_372_000 };
    const sourceFrequencyRange = { min: 4_294_000, max: 8_666_000 };
    const hardwareCenter =
      (requestedViewRange.min + requestedViewRange.max) / 2;
    const panOffsetHz = -hardwareCenter - 1_000;
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange,
      zoom: 1,
      panOffsetHz,
      mirrorEnabled: true,
      frameCenterHz: 6_480_000,
      frameSampleRateHz: 4_372_000,
    });

    const displayCenter =
      (contract.displayRange.min + contract.displayRange.max) / 2;
    expect(contract.displayRange.min).toBeLessThan(0);
    expect(displayCenter).toBeCloseTo(hardwareCenter + panOffsetHz, 0);
    expect(displayCenter).toBeGreaterThan(-1_000_000);
  });

  it("keeps a wholly negative mirror center when edge rounding misses coverage by a few Hz", () => {
    const acquisition = { min: 0, max: 4_372_000 };
    const hardwareCenter = 2_186_000;
    const panOffsetHz = -4_384_000;
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange: acquisition,
      sourceFrequencyRange: acquisition,
      zoom: 1,
      panOffsetHz,
      mirrorEnabled: true,
      frameCenterHz: hardwareCenter,
      frameSampleRateHz: 4_372_000,
    });

    expect(contract.displayRange.min).toBeLessThan(0);
    expect(contract.displayRange.max).toBeLessThanOrEqual(0);
    expect(
      (contract.displayRange.min + contract.displayRange.max) / 2,
    ).toBeCloseTo(hardwareCenter + panOffsetHz, 0);
    expect(contract.panOffsetHz).toBeCloseTo(panOffsetHz, 0);

    const painted = prepareSpectrumRenderData({
      waveform: new Float32Array(2048).fill(-50),
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
    expect(
      (painted.visualRange.min + painted.visualRange.max) / 2,
    ).toBeCloseTo(hardwareCenter + panOffsetHz, 0);
  });

  it("reflects the resident frame for an uncovered negative request", () => {
    const requestedViewRange = { min: -7_416_000, max: -3_044_000 };
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange: { min: 0, max: 4_372_000 },
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: true,
      frameCenterHz: 2_186_000,
      frameSampleRateHz: 4_372_000,
    });

    expect(contract.displayRange).toEqual({ min: -4_372_000, max: -0 });
  });

  it("keeps the resident frame whole for an uncovered positive request", () => {
    const requestedViewRange = { min: 4_294_000, max: 8_666_000 };
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange,
      sourceFrequencyRange: { min: 0, max: 4_372_000 },
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: true,
      frameCenterHz: 2_186_000,
      frameSampleRateHz: 4_372_000,
    });

    expect(contract.displayRange).toEqual({ min: 0, max: 4_372_000 });
  });

  it("uses the resident axis during an uncovered mirror-off retune", () => {
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange: { min: 4_294_000, max: 8_666_000 },
      sourceFrequencyRange: { min: 0, max: 4_372_000 },
      zoom: 1,
      panOffsetHz: 0,
      mirrorEnabled: false,
      frameCenterHz: 2_186_000,
      frameSampleRateHz: 4_372_000,
    });

    expect(contract.displayRange).toEqual({ min: 0, max: 4_372_000 });
  });
});

describe("shouldClearSpectrumWaveformForRangeChange", () => {
  it("retains the last live paint until the replacement frame arrives", () => {
    expect(
      shouldClearSpectrumWaveformForRangeChange({ isPaused: false }),
    ).toBe(false);
    expect(
      shouldClearSpectrumWaveformForRangeChange({ isPaused: true }),
    ).toBe(false);
  });
});

describe("resolveFrameTemporalWindow", () => {
  it("bypasses temporal history for explicitly requested next frames", () => {
    expect(
      resolveFrameTemporalWindow({
        configuredWindow: 8,
        isRequestedNextFrame: true,
      }),
    ).toBe(1);
  });

  it("preserves temporal history for continuous stream frames", () => {
    expect(
      resolveFrameTemporalWindow({
        configuredWindow: 8,
        isRequestedNextFrame: false,
      }),
    ).toBe(8);
  });
});

describe("shouldPresentSpectrumFrameForRange", () => {
  it("holds the previous complete canvas until the requested backend frame matches", () => {
    expect(
      shouldPresentSpectrumFrameForRange({
        frameCenterHz: 2_204_000,
        frameSampleRateHz: 4_372_000,
        requestedRange: { min: 1_000_000, max: 5_372_000 },
        requiresExactRange: true,
      }),
    ).toBe(false);
  });

  it("presents a complete backend frame matching the requested range", () => {
    expect(
      shouldPresentSpectrumFrameForRange({
        frameCenterHz: 3_186_000,
        frameSampleRateHz: 4_372_000,
        requestedRange: { min: 1_000_000, max: 5_372_000 },
        requiresExactRange: true,
      }),
    ).toBe(true);
  });

  it("presents an explicitly tagged Tx preview while its view range catches up", () => {
    expect(
      shouldPresentSpectrumFrameForRange({
        frameCenterHz: 2_204_000,
        frameSampleRateHz: 2_400_000,
        requestedRange: { min: 1_000_000, max: 5_372_000 },
        requiresExactRange: true,
        isTxPreviewFrame: true,
      }),
    ).toBe(true);
  });
});

describe("shouldAdoptLiveFrameRange", () => {
  it("rejects a frame from the previous hardware window", () => {
    expect(
      shouldAdoptLiveFrameRange({
        frameCenterHz: 105,
        frameSampleRateHz: 10,
        requestedRange: { min: 110, max: 120 },
      }),
    ).toBe(false);
  });

  it("accepts a frame whose center and span match the requested window", () => {
    expect(
      shouldAdoptLiveFrameRange({
        frameCenterHz: 115,
        frameSampleRateHz: 10,
        requestedRange: { min: 110, max: 120 },
      }),
    ).toBe(true);
  });

  it("accepts a wider acquisition frame when it fully covers the requested viewport", () => {
    expect(
      shouldAdoptLiveFrameRange({
        frameCenterHz: 1_618_000,
        frameSampleRateHz: 4_372_000,
        requestedRange: { min: 18_000, max: 3_218_000 },
      }),
    ).toBe(true);
  });
});
