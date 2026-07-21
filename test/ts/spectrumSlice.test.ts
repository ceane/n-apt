import spectrumReducer, {
  setTxCenterFrequencyHz,
  setTxPowerDbm,
  setSdrSettingsBundle,
  setDeviceKind,
  mergeLastKnownRanges,
  getMaxTxPowerDbm,
  getMinTxPowerDbm,
} from "../../src/ts/redux/slices/spectrumSlice";

describe("Spectrum Slice Power Clamping", () => {
  const getInitialState = () => {
    return spectrumReducer(undefined, { type: "@@INIT" });
  };

  test("starts with the Tx slider visible", () => {
    const state = getInitialState();
    expect(state.showTxSlider).toBe(true);
    expect(state.gain).toBe(49.6);
  });

  test("mergeLastKnownRanges updates inactive channel remembered ranges", () => {
    const state = spectrumReducer(
      getInitialState(),
      mergeLastKnownRanges({
        C: { min: 4_750_000, max: 7_950_000 },
        c: { min: 4_750_000, max: 7_950_000 },
      }),
    );

    expect(state.lastKnownRanges.C).toEqual({
      min: 4_750_000,
      max: 7_950_000,
    });
    expect(state.lastKnownRanges.c).toEqual({
      min: 4_750_000,
      max: 7_950_000,
    });
  });

  test("getMaxTxPowerDbm returns correct caps", () => {
    // With hackrf_one
    // 10 MHz - 2.15 GHz -> +15 dBm
    expect(getMaxTxPowerDbm(100_000_000, "hackrf_one")).toBe(15);
    expect(getMaxTxPowerDbm(2_000_000_000, "hackrf_one")).toBe(15);

    // 2.15 GHz - 2.75 GHz -> +15 dBm
    expect(getMaxTxPowerDbm(2_400_000_000, "hackrf_one")).toBe(15);

    // 2.75 GHz - 4 GHz -> +5 dBm
    expect(getMaxTxPowerDbm(3_000_000_000, "hackrf_one")).toBe(5);

    // 4 GHz - 6 GHz -> 0 dBm
    expect(getMaxTxPowerDbm(5_000_000_000, "hackrf_one")).toBe(0);
    expect(getMaxTxPowerDbm(6_500_000_000, "hackrf_one")).toBe(0);

    // With other devices (should return Infinity / no cap)
    expect(getMaxTxPowerDbm(100_000_000, "rtl_sdr")).toBe(Infinity);
    expect(getMaxTxPowerDbm(5_000_000_000, null)).toBe(Infinity);
  });

  test("getMinTxPowerDbm returns correct caps", () => {
    // With hackrf_one
    // 1–30 MHz -> -65
    expect(getMinTxPowerDbm(10_000_000, "hackrf_one")).toBe(-65);
    // 30–100 MHz -> -70
    expect(getMinTxPowerDbm(50_000_000, "hackrf_one")).toBe(-70);
    // 100 MHz–1 GHz -> -75
    expect(getMinTxPowerDbm(500_000_000, "hackrf_one")).toBe(-75);
    // 1–3 GHz -> -70
    expect(getMinTxPowerDbm(2_000_000_000, "hackrf_one")).toBe(-70);
    // 3–6 GHz -> -60
    expect(getMinTxPowerDbm(5_000_000_000, "hackrf_one")).toBe(-60);

    // With other devices (should return -Infinity / no minimum clamp)
    expect(getMinTxPowerDbm(10_000_000, "rtl_sdr")).toBe(-Infinity);
    expect(getMinTxPowerDbm(5_000_000_000, null)).toBe(-Infinity);
  });

  test("setTxPowerDbm clamps power based on current frequency when device is hackrf_one", () => {
    let state = getInitialState();

    // Set frequency to 3 GHz (cap is +5 dBm, minimum is -60 dBm)
    state = spectrumReducer(state, setTxCenterFrequencyHz(3_000_000_000));
    expect(state.txCenterFrequencyHz).toBe(3_000_000_000);

    // Attempt to set power to 10 dBm (should clamp to 5 dBm since default deviceKind is hackrf_one)
    state = spectrumReducer(state, setTxPowerDbm(10));
    expect(state.txPowerDbm).toBe(5);

    // Attempt to set power to -80 dBm (should clamp to -60 dBm)
    state = spectrumReducer(state, setTxPowerDbm(-80));
    expect(state.txPowerDbm).toBe(-60);

    // Change deviceKind to rtl_sdr (no cap) and try setting power to -80 dBm (should succeed)
    state = spectrumReducer(state, setDeviceKind("rtl_sdr"));
    state = spectrumReducer(state, setTxPowerDbm(-80));
    expect(state.txPowerDbm).toBe(-80);
  });

  test("setTxCenterFrequencyHz clamps existing power if new frequency cap/minimum is out of range", () => {
    let state = getInitialState();

    // Set frequency to 500 MHz (min -75 dBm, max 15 dBm)
    state = spectrumReducer(state, setTxCenterFrequencyHz(500_000_000));
    // Set power to -72 dBm (within range)
    state = spectrumReducer(state, setTxPowerDbm(-72));
    expect(state.txPowerDbm).toBe(-72);

    // Change frequency to 5 GHz (min -60 dBm, max 0 dBm. -72 < -60, so should clamp to -60)
    state = spectrumReducer(state, setTxCenterFrequencyHz(5_000_000_000));
    expect(state.txPowerDbm).toBe(-60);
  });

  test("setSdrSettingsBundle clamps power", () => {
    let state = getInitialState();

    // Load bundle with 5 GHz frequency and -80 dBm power (min is -60 dBm)
    state = spectrumReducer(
      state,
      setSdrSettingsBundle({
        txCenterFrequencyHz: 5_000_000_000,
        txPowerDbm: -80,
      }),
    );
    expect(state.txPowerDbm).toBe(-60);
  });

  test("setDeviceKind clamps existing power if new device has tighter limits", () => {
    let state = getInitialState();

    // Set deviceKind to rtl_sdr (unlimited)
    state = spectrumReducer(state, setDeviceKind("rtl_sdr"));
    // Set frequency to 5 GHz and power to -80 dBm
    state = spectrumReducer(state, setTxCenterFrequencyHz(5_000_000_000));
    state = spectrumReducer(state, setTxPowerDbm(-80));
    expect(state.txPowerDbm).toBe(-80);

    // Switch deviceKind back to hackrf_one (cap at 5 GHz is min -60 dBm, -80 < -60 so power should clamp to -60)
    state = spectrumReducer(state, setDeviceKind("hackrf_one"));
    expect(state.txPowerDbm).toBe(-60);
  });

  test("ignores NaN inputs and prevents state corruption", () => {
    let state = getInitialState();
    const initialPower = state.txPowerDbm;
    const initialCenter = state.txCenterFrequencyHz;

    // Send NaN values to setTxPowerDbm and setTxCenterFrequencyHz
    state = spectrumReducer(state, setTxPowerDbm(NaN));
    expect(state.txPowerDbm).toBe(initialPower);

    state = spectrumReducer(state, setTxCenterFrequencyHz(NaN));
    expect(state.txCenterFrequencyHz).toBe(initialCenter);

    // Send NaN through bundle
    state = spectrumReducer(
      state,
      setSdrSettingsBundle({
        txPowerDbm: NaN,
        txCenterFrequencyHz: NaN,
      }),
    );
    expect(state.txPowerDbm).toBe(initialPower);
    expect(state.txCenterFrequencyHz).toBe(initialCenter);
  });
});
