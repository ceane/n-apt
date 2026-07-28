import spectrumReducer, {
  setTxCenterFrequencyHz,
  setTxPowerDbm,
  setSdrSettingsBundle,
  mergeLastKnownRanges,
} from "../../src/ts/redux/slices/spectrumSlice";

describe("Spectrum Slice TX intent", () => {
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

  test("stores TX power intent without frontend hardware clamping", () => {
    let state = getInitialState();
    state = spectrumReducer(state, setTxCenterFrequencyHz(3_000_000_000));
    expect(state.txCenterFrequencyHz).toBe(3_000_000_000);
    state = spectrumReducer(state, setTxPowerDbm(10));
    expect(state.txPowerDbm).toBe(10);
  });

  test("setSdrSettingsBundle clamps power", () => {
    let state = getInitialState();

    state = spectrumReducer(
      state,
      setSdrSettingsBundle({
        txCenterFrequencyHz: 5_000_000_000,
        txPowerDbm: -80,
      }),
    );
    expect(state.txPowerDbm).toBe(-80);
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

it("updates Tx center and bandwidth atomically", async () => {
  const { default: reducer, setTxGeometry } = await import(
    "../../src/ts/redux/slices/spectrumSlice"
  );
  const initial = reducer(undefined, { type: "@@init" });

  const next = reducer(
    initial,
    setTxGeometry({
      centerFrequencyHz: 3_439_000,
      sampleRateHz: 1_902_000,
    }),
  );

  expect(next.txCenterFrequencyHz).toBe(3_439_000);
  expect(next.txSampleRateHz).toBe(1_902_000);
});
