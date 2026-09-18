import spectrumReducer, {
  setTxCenterFrequencyHz,
  setTxPowerDbm,
  setSdrSettingsBundle,
  setMaxVizZoom,
  mergeLastKnownRanges,
  setFrequencyRange,
  setVizPan,
  setSampleRate,
  setMinReceiveSampleRate,
  setActiveSignalArea,
} from "@n-apt/redux/slices/spectrumSlice";

describe("Spectrum Slice TX intent", () => {
  const getInitialState = () => {
    return spectrumReducer(undefined, { type: "@@INIT" });
  };

  test("starts with the Tx slider visible", () => {
    const state = getInitialState();
    expect(state.showTxSlider).toBe(true);
    expect(state.gain).toBe(49.6);
    expect(state.txSampleRateHz).toBe(2_400_000);
    expect(state.txViewerSampleRateHz).toBe(3_200_000);
  });

  test("keeps the Tx monitor rate at or above the receive floor", () => {
    const state = spectrumReducer(getInitialState(), {
      type: "spectrum/setTxViewerSampleRateHz",
      payload: 2_400_000,
    });

    expect(state.txSampleRateHz).toBe(2_400_000);
    expect(state.txViewerSampleRateHz).toBe(3_200_000);
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

  test("applies a sample-rate range override atomically", () => {
    let state = getInitialState();
    state = spectrumReducer(state, setActiveSignalArea("B"));
    state = spectrumReducer(
      state,
      setFrequencyRange({ min: 25_420_000, max: 29_420_000 }),
    );

    state = spectrumReducer(state, {
      ...setSampleRate(3_200_000),
      meta: {
        managedRxFrequencyRange: { min: 26_020_000, max: 29_220_000 },
      },
    } as any);

    expect(state.sampleRateHz).toBe(3_200_000);
    expect(state.frequencyRange).toEqual({
      min: 26_020_000,
      max: 29_220_000,
    });
    expect(state.lastKnownRanges.B).toEqual({
      min: 26_020_000,
      max: 29_220_000,
    });
  });

  test("rejects invalid sample rates loudly instead of dropping them silently", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      let state = getInitialState();
      const initialRate = state.sampleRateHz;
      expect(initialRate).toBeGreaterThan(0);

      for (const invalid of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        0,
        -5_200_000,
      ]) {
        state = spectrumReducer(state, setSampleRate(invalid));
        expect(state.sampleRateHz).toBe(initialRate);
      }

      expect(errorSpy).toHaveBeenCalledTimes(5);
      expect(errorSpy.mock.calls[0][0]).toContain(
        "Ignoring invalid sample rate",
      );
      expect(errorSpy.mock.calls[0][0]).toContain(String(initialRate));

      // A valid rate still applies, and says nothing.
      errorSpy.mockClear();
      state = spectrumReducer(state, setSampleRate(5_200_000));
      expect(state.sampleRateHz).toBe(5_200_000);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("rejects invalid minimum receive rates loudly", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      let state = getInitialState();
      const initialFloor = state.minReceiveSampleRateHz;

      for (const invalid of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        0,
        -3_200_000,
      ]) {
        state = spectrumReducer(state, setMinReceiveSampleRate(invalid));
        expect(state.minReceiveSampleRateHz).toBe(initialFloor);
      }

      expect(errorSpy).toHaveBeenCalledTimes(4);
      expect(errorSpy.mock.calls[0][0]).toContain(
        "Ignoring invalid minimum receive sample rate",
      );

      errorSpy.mockClear();
      state = spectrumReducer(state, setMinReceiveSampleRate(2_400_000));
      expect(state.minReceiveSampleRateHz).toBe(2_400_000);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("settings bundles cannot carry a zero or negative receive rate", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const initial = getInitialState();
      const state = spectrumReducer(
        initial,
        setSdrSettingsBundle({
          sampleRateHz: 0,
          minReceiveSampleRateHz: -1,
          // Legitimate neighbours in the same bundle still apply, and zero and
          // negative stay valid for non-rate numeric keys.
          fftSize: 2048,
          ppm: -3,
          hackrfBasebandBandwidth: 0,
        }),
      );

      expect(state.sampleRateHz).toBe(initial.sampleRateHz);
      expect(state.minReceiveSampleRateHz).toBe(initial.minReceiveSampleRateHz);
      expect(state.fftSize).toBe(2048);
      expect(state.ppm).toBe(-3);
      expect(state.hackrfBasebandBandwidth).toBe(0);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("stores the editable visualizer maximum zoom", () => {
    const state = spectrumReducer(getInitialState(), setMaxVizZoom(2250));

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
  const { default: reducer, setTxGeometry } =
    await import("@n-apt/redux/slices/spectrumSlice");
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
