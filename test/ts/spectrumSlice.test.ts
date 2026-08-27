import spectrumReducer, {
  setTxCenterFrequencyHz,
  setTxPowerDbm,
  setSdrSettingsBundle,
  setMaxVizZoom,
  mergeLastKnownRanges,
  setFrequencyRange,
  setVizPan,
} from "@n-apt/redux/slices/spectrumSlice";

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

  test("stores the editable visualizer maximum zoom", () => {
    const state = spectrumReducer(
      getInitialState(),
      setMaxVizZoom(2250),
    );

    expect(state.maxVizZoom).toBe(2250);
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

describe("Spectrum Slice mirror pan", () => {
  it("does not zero a DC-crossing pan when Redux publishes the gesture", () => {
    let state = spectrumReducer(undefined, { type: "@@INIT" });
    state = spectrumReducer(
      state,
      setFrequencyRange({ min: 0, max: 4_372_000 }),
    );
    state = spectrumReducer(state, setVizPan(-2_186_000));
    expect(state.vizPanOffset).toBe(-2_186_000);
  });

  it("does not zero a mirrored pan of twice the hardware center", () => {
    let state = spectrumReducer(undefined, { type: "@@INIT" });
    state = spectrumReducer(
      state,
      setFrequencyRange({ min: 10_000_000, max: 14_372_000 }),
    );
    const pan = -24_372_000;
    state = spectrumReducer(state, setVizPan(pan));
    expect(state.vizPanOffset).toBe(pan);
  });
});

it("updates Tx center and bandwidth atomically", async () => {
  const { default: reducer, setTxGeometry } = await import(
    "@n-apt/redux/slices/spectrumSlice"
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
