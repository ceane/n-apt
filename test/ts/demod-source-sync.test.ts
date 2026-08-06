import {
  resolveDemodSourceRange,
  syncDemodSpanFromSourceContext,
  updateSpanStateThunk,
  syncRadioDemodFromSource,
  shouldPreservePendingFmTune,
  type DemodSourceSyncPayload,
} from "../../src/ts/redux/thunks/demodThunks";
import { configureStore } from "@reduxjs/toolkit";
import demodReducer from "../../src/ts/redux/slices/demodSlice";
import spectrumReducer from "../../src/ts/redux/slices/spectrumSlice";

describe("resolveDemodSourceRange", () => {
  it("uses loaded file metadata before playback processing exists", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "file",
      loadedFileMetadata: {
        center_frequency_hz: 137_500_000,
        capture_sample_rate_hz: 3_200_000,
      },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 135_900_000, max: 139_100_000 },
      reason: "file_metadata",
    });
  });

  it("prefers processed playback frequency range over selected file metadata", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "file",
      activePlaybackMetadata: {
        activeChannel: 0,
        channelCount: 1,
        frequency_range: [240_000_000, 243_200_000],
      },
      loadedFileMetadata: {
        center_frequency_hz: 137_500_000,
        capture_sample_rate_hz: 3_200_000,
      },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 240_000_000, max: 243_200_000 },
      reason: "playback_metadata",
    });
  });

  it("keeps absolute file metadata when playback reports a baseband range", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "file",
      activePlaybackMetadata: {
        activeChannel: 0,
        channelCount: 1,
        frequency_range: [18_000, 3_218_000],
      },
      loadedFileMetadata: {
        center_frequency_hz: 27_320_000,
        capture_sample_rate_hz: 3_200_000,
      },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 25_720_000, max: 28_920_000 },
      reason: "file_metadata",
    });
  });

  it("uses the active metadata channel when playback identifies a channel", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "file",
      activePlaybackMetadata: {
        activeChannel: 1,
        channelCount: 2,
        frequency_range: [18_000, 3_218_000],
      },
      loadedFileMetadata: {
        channels: [
          { center_freq_hz: 10_000_000, sample_rate_hz: 3_200_000 },
          { center_freq_hz: 27_300_000, sample_rate_hz: 3_200_000 },
        ],
      },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 25_700_000, max: 28_900_000 },
      reason: "file_metadata",
    });
  });

  it("uses first channel metadata before processing when top-level file range is baseband", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "file",
      loadedFileMetadata: {
        frequency_range: [0, 1_000],
        capture_sample_rate_hz: 1_000,
        channels: [
          {
            center_freq_hz: 27_320_000,
            sample_rate_hz: 3_200_000,
            requested_min_freq_hz: 25_720_000,
            requested_max_freq_hz: 28_920_000,
          },
        ],
      },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 25_720_000, max: 28_920_000 },
      reason: "file_metadata",
    });
  });

  it("uses the latest live frame range for live source sync", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "live",
      liveFrame: {
        center_frequency_hz: 162_550_000,
        sample_rate: 3_200_000,
      },
      liveFrequencyRange: { min: 160_000_000, max: 164_000_000 },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 160_950_000, max: 164_150_000 },
      reason: "live_frame",
    });
  });

  it("rejects a stale live frame when it does not overlap the selected live channel", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "live",
      liveFrame: {
        center_frequency_hz: 1_618_000,
        sample_rate: 3_200_000,
      },
      liveFrequencyRange: { min: 24_720_000, max: 29_880_000 },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 24_720_000, max: 29_880_000 },
      reason: "live_frequency_range",
    });
  });

  it("falls back to the selected visualizer channel range when no live frame exists", () => {
    const payload: DemodSourceSyncPayload = {
      sourceMode: "live",
      liveFrequencyRange: { min: 24_720_000, max: 29_880_000 },
    };

    expect(resolveDemodSourceRange(payload)).toEqual({
      range: { min: 24_720_000, max: 29_880_000 },
      reason: "live_frequency_range",
    });
  });

  it("does not let a stale live frame overwrite a pending FM station", () => {
    expect(
      shouldPreservePendingFmTune({
        sourceMode: "live",
        algorithm: "fm",
        pendingCenterHz: 92_700_000,
        currentSelection: { min: 92_600_000, max: 92_800_000 },
        incomingRange: { min: 0, max: 3_200_000 },
      }),
    ).toBe(true);
  });

  it("releases the FM tune fence when the selected range is confirmed", () => {
    expect(
      shouldPreservePendingFmTune({
        sourceMode: "live",
        algorithm: "fm",
        pendingCenterHz: 92_700_000,
        currentSelection: { min: 92_600_000, max: 92_800_000 },
        incomingRange: { min: 92_600_000, max: 92_800_000 },
      }),
    ).toBe(false);
  });
});

describe("syncDemodSpanFromSourceContext", () => {
  it("uses file metadata for capture span without replacing overlay bandwidth with sample rate", async () => {
    const store = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
      } as any,
      preloadedState: {
        demod: {
          sourceMode: "file",
          sourceRange: null,
          sourceRangeReason: null,
          spanRange: null,
          hardwareRange: null,
          sampleRateHz: null,
          algorithm: "fm",
          bandwidthKhz: 1_866,
          centerFreqHz: 500,
          isListening: false,
          hardwareSpanHz: 1_000,
          bandwidthHz: 1_000,
          bandwidthStartHz: 0,
          alignment: "centered",
        },
      } as any,
    });

    await store.dispatch(
      syncDemodSpanFromSourceContext({
        sourceMode: "file",
        loadedFileMetadata: {
          frequency_range: [0, 1_000],
          capture_sample_rate_hz: 1_000,
          channels: [
            {
              center_freq_hz: 27_320_000,
              sample_rate_hz: 3_200_000,
              requested_min_freq_hz: 25_720_000,
              requested_max_freq_hz: 28_920_000,
            },
          ],
        },
      }) as any,
    );

    expect(store.getState().demod).toMatchObject({
      centerFreqHz: 27_320_000,
      hardwareSpanHz: 3_200_000,
      bandwidthHz: 1_866_000,
      bandwidthKhz: 1_866,
      bandwidthStartHz: 26_387_000,
    });
    expect(store.getState().spectrum.previewRange).toEqual({
      min: 26_387_000,
      max: 28_253_000,
    });
  });

  it("preserves an existing overlay selection when processing publishes file metadata", async () => {
    const store = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
      } as any,
      preloadedState: {
        demod: {
          sourceMode: "file",
          sourceRange: { min: 25_720_000, max: 28_920_000 },
          sourceRangeReason: "file_metadata",
          spanRange: null,
          hardwareRange: null,
          sampleRateHz: null,
          algorithm: "fm",
          bandwidthKhz: 1_000,
          centerFreqHz: 27_320_000,
          isListening: false,
          hardwareSpanHz: 3_200_000,
          bandwidthHz: 1_000_000,
          bandwidthStartHz: 26_000_000,
          alignment: "centered",
        },
        spectrum: {
          previewRange: { min: 26_000_000, max: 27_000_000 },
        },
      } as any,
    });

    await store.dispatch(
      syncDemodSpanFromSourceContext({
        sourceMode: "file",
        activePlaybackMetadata: {
          activeChannel: 0,
          channelCount: 1,
          frequency_range: [25_720_000, 28_920_000],
        },
        loadedFileMetadata: {
          channels: [
            {
              center_freq_hz: 27_320_000,
              sample_rate_hz: 3_200_000,
              requested_min_freq_hz: 25_720_000,
              requested_max_freq_hz: 28_920_000,
            },
          ],
        },
      }) as any,
    );

    expect(store.getState().demod).toMatchObject({
      centerFreqHz: 27_320_000,
      hardwareSpanHz: 3_200_000,
      bandwidthHz: 1_000_000,
      bandwidthStartHz: 26_000_000,
    });
    expect(store.getState().spectrum.previewRange).toEqual({
      min: 26_000_000,
      max: 27_000_000,
    });
  });

  it("uses a centered default overlay when stale overlay bandwidth covers the full source span", async () => {
    const store = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
      } as any,
      preloadedState: {
        demod: {
          sourceMode: "file",
          sourceRange: null,
          sourceRangeReason: null,
          spanRange: null,
          hardwareRange: null,
          sampleRateHz: null,
          algorithm: "fm",
          bandwidthKhz: 3_200,
          centerFreqHz: 500,
          isListening: false,
          hardwareSpanHz: 1_000,
          bandwidthHz: 3_200_000,
          bandwidthStartHz: 0,
          alignment: "centered",
        },
      } as any,
    });

    await store.dispatch(
      syncDemodSpanFromSourceContext({
        sourceMode: "file",
        loadedFileMetadata: {
          channels: [
            {
              center_freq_hz: 27_320_000,
              sample_rate_hz: 3_200_000,
              requested_min_freq_hz: 25_720_000,
              requested_max_freq_hz: 28_920_000,
            },
          ],
        },
      }) as any,
    );

    expect(store.getState().demod).toMatchObject({
      centerFreqHz: 27_320_000,
      hardwareSpanHz: 3_200_000,
      bandwidthHz: 200_000,
      bandwidthStartHz: 27_220_000,
    });
    expect(store.getState().spectrum.previewRange).toEqual({
      min: 27_220_000,
      max: 27_420_000,
    });
  });
});

describe("updateSpanStateThunk preview sync", () => {
  it("keeps dragged bandwidth start independent from the hardware center frequency", async () => {
    const store = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
      } as any,
      preloadedState: {
        demod: {
          sourceMode: "file",
          sourceRange: { min: 25_700_000, max: 28_900_000 },
          sourceRangeReason: "file_metadata",
          spanRange: null,
          hardwareRange: null,
          sampleRateHz: null,
          algorithm: "fm",
          bandwidthKhz: 200,
          centerFreqHz: 27_300_000,
          isListening: false,
          hardwareSpanHz: 3_200_000,
          bandwidthHz: 200_000,
          bandwidthStartHz: 27_200_000,
          alignment: "centered",
        },
      } as any,
    });

    await store.dispatch(
      updateSpanStateThunk({
        params: {
          center: 27_300_000,
          bandwidth: 300_000,
          start: 25_900_000,
          span: 3_200_000,
          mode: "centered",
        },
        source: "preview_sync",
      }) as any,
    );

    expect(store.getState().demod).toMatchObject({
      centerFreqHz: 27_300_000,
      bandwidthHz: 300_000,
      bandwidthStartHz: 25_900_000,
      hardwareSpanHz: 3_200_000,
    });
    expect(store.getState().spectrum.previewRange).toBeNull();
  });

  it("does not clamp preview selection to center-based window bounds", async () => {
    const store = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
      } as any,
      preloadedState: {
        demod: {
          sourceMode: "file",
          sourceRange: { min: 25_700_000, max: 28_900_000 },
          sourceRangeReason: "file_metadata",
          spanRange: null,
          hardwareRange: null,
          sampleRateHz: null,
          algorithm: "fm",
          bandwidthKhz: 200,
          centerFreqHz: 27_300_000,
          isListening: false,
          hardwareSpanHz: 3_200_000,
          bandwidthHz: 200_000,
          bandwidthStartHz: 27_200_000,
          alignment: "centered",
        },
      } as any,
    });

    await store.dispatch(
      updateSpanStateThunk({
        params: {
          center: 27_300_000,
          bandwidth: 300_000,
          start: 25_900_000,
          span: 3_200_000,
          mode: "centered",
        },
        source: "preview_sync",
      }) as any,
    );

    expect(store.getState().demod).toMatchObject({
      centerFreqHz: 27_300_000,
      bandwidthHz: 300_000,
      bandwidthStartHz: 25_900_000,
      hardwareSpanHz: 3_200_000,
    });
    expect(store.getState().spectrum.previewRange).toBeNull();
  });
});

describe("syncRadioDemodFromSource - 1.6MHz Regression Prevention", () => {
  it("does not overwrite centerFreqHz when synced from span node, preserving hardware center frequency", async () => {
    const store = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
      } as any,
      preloadedState: {
        demod: {
          centerFreqHz: 1_600_000, // Hardware center locked at 1.6MHz
          bandwidthCenterFreqHz: null,
          hardwareSpanHz: 3_200_000,
          bandwidthHz: 200_000,
          bandwidthStartHz: 1_500_000,
        },
      } as any,
    });

    // Dispatch a sync update from the span node (which is selecting e.g. 1.25MHz center frequency)
    await store.dispatch(
      syncRadioDemodFromSource({
        source: "span",
        centerFreqHz: 1_250_000,
        bandwidthHz: 200_000,
      }) as any,
    );

    // Verify that the hardware center frequency (centerFreqHz) remains locked at 1.6MHz,
    // while the selection bandwidth center (bandwidthCenterFreqHz) is correctly set to 1.25MHz.
    // This locks down the regression and prevents snap-back bugs!
    expect(store.getState().demod.centerFreqHz).toBe(1_600_000);
    expect(store.getState().demod.bandwidthCenterFreqHz).toBe(1_250_000);
  });

  it("overwrites centerFreqHz when synced from normal radio source (e.g. fm)", async () => {
    const store = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
      } as any,
      preloadedState: {
        demod: {
          centerFreqHz: 1_600_000,
          bandwidthCenterFreqHz: null,
          hardwareSpanHz: 3_200_000,
          bandwidthHz: 200_000,
        },
      } as any,
    });

    await store.dispatch(
      syncRadioDemodFromSource({
        source: "fm",
        centerFreqHz: 98_100_000,
        bandwidthKhz: 200,
      }) as any,
    );

    // For FM tuning, centerFreqHz (hardware/center freq) is updated
    expect(store.getState().demod.centerFreqHz).toBe(98_100_000);
    expect(store.getState().demod.bandwidthCenterFreqHz).toBe(98_100_000);
    expect(store.getState().demod.bandwidthHz).toBe(200_000);
    expect(store.getState().demod.bandwidthStartHz).toBe(98_000_000);
  });
});
