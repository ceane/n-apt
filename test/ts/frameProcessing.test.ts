import {
  accumulateFullChannelWaveform,
  prepareSpectrumRenderData,
  resolveSpectrumWaveform,
  updateTemporalWaveform,
} from "@n-apt/components/fft/frameProcessing";

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
});
