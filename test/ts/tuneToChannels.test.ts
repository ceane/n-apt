import { configureStore } from "@reduxjs/toolkit";
import spectrumReducer, {
  setDeviceSignalAreaAndRange,
  setSignalAreaAndRange,
  setSampleRate,
  setTuningPreviewActive,
  tuneToChannels,
  setTxHopType,
  setVizPan,
} from "@n-apt/redux/slices/spectrumSlice";

describe("tuneToChannels Redux Action", () => {
  it("preserves signed presentation pan when a device range acknowledgement omits it", () => {
    const store = configureStore({
      reducer: { spectrum: spectrumReducer },
    });
    store.dispatch(
      setSignalAreaAndRange({
        area: "A",
        range: { min: 0, max: 4_372_000 },
      }),
    );
    store.dispatch(setVizPan(-3_000_000));

    store.dispatch(
      setDeviceSignalAreaAndRange({
        area: "A",
        range: { min: 1_000_000, max: 5_372_000 },
      }),
    );

    expect(store.getState().spectrum.vizPanOffset).toBe(-3_000_000);
  });

  it("initializes state to the primary channel when tuning to multiple channels without ghost frequencies or summed bandwidths", () => {
    const store = configureStore({
      reducer: {
        spectrum: spectrumReducer,
      },
    });

    const channelA = { label: "A", min: 18_000, max: 4_390_000 };
    const channelB = { label: "B", min: 24_100_000, max: 30_370_000 };

    store.dispatch(setTxHopType("channels"));
    store.dispatch(setSampleRate(3_200_000));
    store.dispatch(
      tuneToChannels({
        channels: [channelA, channelB],
        selectedLabels: ["a", "b"],
      }),
    );

    const state = store.getState().spectrum;

    // Selected hop channels should contain both 'a' and 'b'
    expect(state.txHopChannels).toEqual(["a", "b"]);

    // Active signal area should be the primary channel 'A'
    expect(state.activeSignalArea).toBe("A");

    // Frequency range should be Channel A's native bounds, NOT summed (18kHz - 30.37MHz)
    expect(state.frequencyRange).toEqual({ min: 18_000, max: 4_390_000 });

    // Tx center frequency should be Channel A's center (2.204 MHz), NOT a ghost center (15.194 MHz)
    expect(state.txCenterFrequencyHz).toBe(2_204_000);

    // Tx planning follows the selected channel, but an RX channel tune must
    // not silently switch the acquisition out of the user's fixed 3.2 MHz
    // mode. Whole Channel is selected through the explicit sample-rate path.
    expect(state.txSampleRateHz).toBe(4_372_000);
    expect(state.sampleRateHz).toBe(3_200_000);
  });

  it("can retain the current range while a progressive tune owns the preview", () => {
    const store = configureStore({
      reducer: { spectrum: spectrumReducer },
    });
    const channel = { label: "B", min: 1_000, max: 10_000 };
    const previewRange = { min: 2_000, max: 3_000 };

    store.dispatch(setTuningPreviewActive(true));
    store.dispatch(
      tuneToChannels({ channels: [channel], frequencyRange: previewRange }),
    );

    expect(store.getState().spectrum.frequencyRange).toEqual(previewRange);
    expect(store.getState().spectrum.tuningPreviewActive).toBe(true);
  });
});
