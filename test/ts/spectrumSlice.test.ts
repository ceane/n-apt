import spectrumReducer, {
  setTxCenterFrequencyHz,
  setTxPowerDbm,
  setSdrSettingsBundle,
  getMaxTxPowerDbm,
} from "../../src/ts/redux/slices/spectrumSlice";

describe("Spectrum Slice Power Clamping", () => {
  const getInitialState = () => {
    return spectrumReducer(undefined, { type: "@@INIT" });
  };

  test("getMaxTxPowerDbm returns correct caps", () => {
    // 10 MHz - 2.15 GHz -> +15 dBm
    expect(getMaxTxPowerDbm(100_000_000)).toBe(15);
    expect(getMaxTxPowerDbm(2_000_000_000)).toBe(15);

    // 2.15 GHz - 2.75 GHz -> +15 dBm
    expect(getMaxTxPowerDbm(2_400_000_000)).toBe(15);

    // 2.75 GHz - 4 GHz -> +5 dBm
    expect(getMaxTxPowerDbm(3_000_000_000)).toBe(5);

    // 4 GHz - 6 GHz -> 0 dBm
    expect(getMaxTxPowerDbm(5_000_000_000)).toBe(0);
    expect(getMaxTxPowerDbm(6_500_000_000)).toBe(0);
  });

  test("setTxPowerDbm clamps power based on current frequency", () => {
    let state = getInitialState();
    
    // Set frequency to 3 GHz (cap is 5 dBm)
    state = spectrumReducer(state, setTxCenterFrequencyHz(3_000_000_000));
    expect(state.txCenterFrequencyHz).toBe(3_000_000_000);

    // Attempt to set power to 10 dBm (should clamp to 5 dBm)
    state = spectrumReducer(state, setTxPowerDbm(10));
    expect(state.txPowerDbm).toBe(5);

    // Set power to 2 dBm (within cap, should succeed)
    state = spectrumReducer(state, setTxPowerDbm(2));
    expect(state.txPowerDbm).toBe(2);
  });

  test("setTxCenterFrequencyHz clamps existing power if new frequency cap is lower", () => {
    let state = getInitialState();

    // Set frequency to 1 GHz (cap is 15 dBm)
    state = spectrumReducer(state, setTxCenterFrequencyHz(1_000_000_000));
    // Set power to 12 dBm
    state = spectrumReducer(state, setTxPowerDbm(12));
    expect(state.txPowerDbm).toBe(12);

    // Change frequency to 3 GHz (cap is 5 dBm, 12 > 5 so power should clamp to 5)
    state = spectrumReducer(state, setTxCenterFrequencyHz(3_000_000_000));
    expect(state.txPowerDbm).toBe(5);

    // Change frequency to 5 GHz (cap is 0 dBm, 5 > 0 so power should clamp to 0)
    state = spectrumReducer(state, setTxCenterFrequencyHz(5_000_000_000));
    expect(state.txPowerDbm).toBe(0);
  });

  test("setSdrSettingsBundle clamps power", () => {
    let state = getInitialState();

    // Load bundle with 5 GHz frequency and 10 dBm power (cap at 5 GHz is 0 dBm)
    state = spectrumReducer(
      state,
      setSdrSettingsBundle({
        txCenterFrequencyHz: 5_000_000_000,
        txPowerDbm: 10,
      })
    );
    expect(state.txPowerDbm).toBe(0);
  });
});
