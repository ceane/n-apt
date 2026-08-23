import fc from "fast-check";
import spectrumReducer, {
  setFftSize,
  setFftFrameRate,
  setGain,
  setPpm,
  setSampleRate,
  setTxPowerDbm,
  setTxVgaGain,
  setSdrSettingsBundle,
  setDeviceSdrSettingsBundle,
  setGpuSpikeCount,
  type SpectrumState,
} from "@n-apt/redux/slices/spectrumSlice";
import {
  clampFrameRateToProtocolLimit,
  MAX_WEBSOCKET_FRAME_RATE,
} from "@n-apt/math/signals";

const initialState = spectrumReducer(undefined, { type: "@@INIT" });

const ANY_NUMBER = fc.oneof(
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
  fc.double({ min: -1e12, max: 1e12, noNaN: false, noDefaultInfinity: false }),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.constant(0),
  fc.constant(-0),
);

const ANY_VALUE = fc.oneof(
  ANY_NUMBER,
  fc.string(),
  fc.boolean(),
  fc.constant(null),
);

/**
 * Fuzz the numeric settings reducers: whatever the payload is, the resulting
 * state must stay finite and the guarded fields must stay within protocol
 * bounds. Each property starts from a fresh slice so payloads can't poison
 * later cases.
 */
describe("spectrum settings reducer fuzz", () => {
  const numericFieldReducerCases: Array<{
    name: string;
    reducer: (state: SpectrumState, payload: unknown) => SpectrumState;
    field: (state: SpectrumState) => number;
    bound?: { min: number; max: number };
  }> = [
    {
      name: "setFftSize",
      reducer: (s, p) => spectrumReducer(s, setFftSize(p as number)),
      field: (s) => s.fftSize,
    },
    {
      name: "setFftFrameRate",
      reducer: (s, p) => spectrumReducer(s, setFftFrameRate(p as number)),
      field: (s) => s.fftFrameRate,
    },
    {
      name: "setGain",
      reducer: (s, p) => spectrumReducer(s, setGain(p as number)),
      field: (s) => s.gain,
    },
    {
      name: "setPpm",
      reducer: (s, p) => spectrumReducer(s, setPpm(p as number)),
      field: (s) => s.ppm,
    },
    {
      name: "setSampleRate",
      reducer: (s, p) => spectrumReducer(s, setSampleRate(p as number)),
      field: (s) => s.sampleRateHz,
    },
    {
      name: "setTxPowerDbm",
      reducer: (s, p) => spectrumReducer(s, setTxPowerDbm(p as number)),
      field: (s) => s.txPowerDbm,
    },
    {
      name: "setTxVgaGain",
      reducer: (s, p) => spectrumReducer(s, setTxVgaGain(p as number)),
      field: (s) => s.txVgaGain,
    },
  ];

  it.each(numericFieldReducerCases.map((c) => c.name))(
    "%s never leaves a non-finite value and never throws",
    (name) => {
      const { reducer, field } = numericFieldReducerCases.find(
        (c) => c.name === name,
      )!;
      fc.assert(
        fc.property(ANY_VALUE, (payload) => {
          let state: SpectrumState;
          expect(() => {
            state = reducer(initialState, payload);
          }).not.toThrow();
          expect(Number.isFinite(field(state!))).toBe(true);
        }),
      );
    },
  );

  it("setFftSize stores finite payloads exactly and ignores non-finite ones", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9 }), (payload) => {
        const state = spectrumReducer(initialState, setFftSize(payload));
        if (!Number.isFinite(payload)) {
          expect(state.fftSize).toBe(initialState.fftSize);
          return;
        }
        expect(state.fftSize).toBe(payload);
        expect(Number.isFinite(state.fftSize)).toBe(true);
      }),
    );
  });

  it("setFftFrameRate stores finite payloads exactly and ignores non-finite ones", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6 }), (payload) => {
        const state = spectrumReducer(initialState, setFftFrameRate(payload));
        if (!Number.isFinite(payload)) {
          expect(state.fftFrameRate).toBe(initialState.fftFrameRate);
          return;
        }
        expect(state.fftFrameRate).toBe(payload);
        expect(Number.isFinite(state.fftFrameRate)).toBe(true);
      }),
    );
  });

  it("setGpuSpikeCount never yields NaN or negative counts", () => {
    fc.assert(
      fc.property(ANY_VALUE, (payload) => {
        let state: SpectrumState;
        expect(() => {
          state = spectrumReducer(
            initialState,
            setGpuSpikeCount(payload as number),
          );
        }).not.toThrow();
        const count = state!.gpuSpikeCount;
        expect(Number.isNaN(count)).toBe(false);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("setSdrSettingsBundle drops non-finite numbers and never corrupts state", () => {
    fc.assert(
      fc.property(
        fc.record({
          fftSize: ANY_VALUE,
          fftFrameRate: ANY_VALUE,
          gain: ANY_VALUE,
          ppm: ANY_VALUE,
          sampleRateHz: ANY_VALUE,
          txPowerDbm: ANY_VALUE,
        }),
        (bundle) => {
          let state: SpectrumState;
          expect(() => {
            state = spectrumReducer(
              initialState,
              setSdrSettingsBundle(bundle as Partial<SpectrumState>),
            );
          }).not.toThrow();
          const s = state!;
          expect(Number.isFinite(s.fftSize)).toBe(true);
          expect(Number.isFinite(s.fftFrameRate)).toBe(true);
          expect(Number.isFinite(s.gain)).toBe(true);
          expect(Number.isFinite(s.ppm)).toBe(true);
          expect(Number.isFinite(s.sampleRateHz)).toBe(true);
          expect(Number.isFinite(s.txPowerDbm)).toBe(true);
        },
      ),
    );
  });

  it("setDeviceSdrSettingsBundle drops non-finite numbers and never corrupts state", () => {
    fc.assert(
      fc.property(
        fc.record({
          fftSize: ANY_VALUE,
          sampleRateHz: ANY_VALUE,
          gain: ANY_VALUE,
          frequencyRange: fc.oneof(
            fc.constant(null),
            fc.constant({ min: 100_000_000, max: 101_000_000 }),
            fc.constant({ min: NaN, max: 101_000_000 }),
          ),
        }),
        (bundle) => {
          let state: SpectrumState;
          expect(() => {
            state = spectrumReducer(
              initialState,
              setDeviceSdrSettingsBundle(bundle as Partial<SpectrumState>),
            );
          }).not.toThrow();
          const s = state!;
          expect(Number.isFinite(s.fftSize)).toBe(true);
          expect(Number.isFinite(s.sampleRateHz)).toBe(true);
          expect(Number.isFinite(s.gain)).toBe(true);
          expect(s.deviceFrequencyRangeRevision).toBeGreaterThanOrEqual(
            initialState.deviceFrequencyRangeRevision,
          );
        },
      ),
    );
  });

  it("clampFrameRateToProtocolLimit always returns a rate in [1, 100]", () => {
    fc.assert(
      fc.property(ANY_NUMBER, (payload) => {
        const clamped = clampFrameRateToProtocolLimit(payload);
        expect(Number.isFinite(clamped)).toBe(true);
        expect(clamped).toBeGreaterThanOrEqual(1);
        expect(clamped).toBeLessThanOrEqual(MAX_WEBSOCKET_FRAME_RATE);
      }),
    );
  });
});
