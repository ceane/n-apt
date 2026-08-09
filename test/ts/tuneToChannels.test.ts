import { configureStore } from "@reduxjs/toolkit";
import spectrumReducer, {
  tuneToChannels,
  setTxHopType,
} from "@n-apt/redux/slices/spectrumSlice";

describe("tuneToChannels Redux Action", () => {
  it("initializes state to the primary channel when tuning to multiple channels without ghost frequencies or summed bandwidths", () => {
    const store = configureStore({
      reducer: {
        spectrum: spectrumReducer,
      },
    });

    const channelA = { label: "A", min: 18_000, max: 4_390_000 };
    const channelB = { label: "B", min: 24_100_000, max: 30_370_000 };

    store.dispatch(setTxHopType("channels"));
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

    // Tx sample rate and Rx sample rate should be Channel A's bandwidth (4.372 MHz), NOT summed (10.642 MHz)
    expect(state.txSampleRateHz).toBe(4_372_000);
    expect(state.sampleRateHz).toBe(4_372_000);
  });
});
