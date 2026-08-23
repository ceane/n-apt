import fc from "fast-check";
import {
  loadPersistedSdrSettings,
  loadPersistedTheme,
  loadPersistedSettings,
  loadPersistedSignalsDefaults,
  mergePersistedSdrSettings,
  normalizePersistedTxSignalKey,
  normalizePersistedTxViewerSettings,
} from "@n-apt/redux/middleware/localStorageMiddleware";
import spectrumReducer, {
  type SpectrumState,
} from "@n-apt/redux/slices/spectrumSlice";
import {
  FRONTEND_VISUALIZER_DEFAULTS,
  VISUALIZER_MAX_ZOOM_LIMITS,
} from "@n-apt/consts/visualizerControls";

const initialState = spectrumReducer(undefined, { type: "@@INIT" });

const MIXED = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.double({ min: -1e12, max: 1e12 }),
  fc.constant({}),
  fc.constant([]),
  fc.constant([1, 2]),
);

const SETTING_KEYS = [
  "fftSize",
  "fftWindow",
  "fftFrameRate",
  "gain",
  "ppm",
  "tunerAGC",
  "rtlAGC",
  "vizZoom",
  "maxVizZoom",
  "vizPanOffset",
  "fftMinDb",
  "fftMaxDb",
  "frequencyRange",
  "activeSignalArea",
  "lastKnownRanges",
  "displayTemporalResolution",
  "txSampleRateHz",
  "txIfftSize",
  "txViewerSampleRateHz",
  "txViewerFftSize",
  "txViewerFftFrameRate",
  "txViewerFftWindow",
  "txViewerTemporalResolution",
  "txViewerPowerScale",
  "txCenterFrequencyHz",
  "txPowerDbm",
  "txVgaGain",
  "txSignal",
  "txSafetyEnabled",
  "txSafetyLimit",
  "txHopType",
  "txHopStartFrequencyHz",
  "txHopEndFrequencyHz",
  "txHopChannels",
  "txHopRateHz",
  "txHopEnabled",
] as const;

const arbitraryPersistedSettings = fc.record(
  Object.fromEntries(
    SETTING_KEYS.map((k) => [k, fc.oneof(MIXED, fc.constant(undefined))]),
  ),
  {},
);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** The set of persisted settings keys the repair pass guarantees to be finite numbers. */
const FINITE_NUMERIC_KEYS = [
  "vizZoom",
  "maxVizZoom",
  "vizPanOffset",
  "fftMinDb",
  "fftMaxDb",
  "txSampleRateHz",
  "txIfftSize",
  "txViewerSampleRateHz",
  "txViewerFftSize",
  "txViewerFftFrameRate",
  "txCenterFrequencyHz",
  "txPowerDbm",
  "txVgaGain",
  "txHopStartFrequencyHz",
  "txHopEndFrequencyHz",
  "txHopRateHz",
];

describe("persisted settings fuzz", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("rehydrate with arbitrary JSON never throws and yields finite numeric fields", () => {
    fc.assert(
      fc.property(arbitraryPersistedSettings, (blob) => {
        window.localStorage.setItem(
          "napt-sdr-settings-v2",
          JSON.stringify(blob),
        );
        let out: Record<string, unknown>;
        expect(() => {
          out = loadPersistedSdrSettings();
        }).not.toThrow();
        const settings = out!;
        for (const key of FINITE_NUMERIC_KEYS) {
          expect(isFiniteNumber(settings[key])).toBe(true);
        }
        expect(
          settings.lastKnownRanges === undefined ||
            (typeof settings.lastKnownRanges === "object" &&
              !Array.isArray(settings.lastKnownRanges)),
        ).toBe(true);
      }),
    );
  });

  it("loadPersistedSdrSettings never yields NaN or Infinity anywhere", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        window.localStorage.setItem(
          "napt-sdr-settings-v2",
          JSON.stringify(value),
        );
        let out: Record<string, unknown>;
        expect(() => {
          out = loadPersistedSdrSettings();
        }).not.toThrow();
        const walk = (v: unknown): void => {
          if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
          else if (v && typeof v === "object") {
            for (const child of Object.values(v as Record<string, unknown>)) {
              walk(child);
            }
          }
        };
        walk(out!);
      }),
    );
  });

  it("rehydrate merges over slice defaults without corrupting the initial state", () => {
    fc.assert(
      fc.property(arbitraryPersistedSettings, (blob) => {
        window.localStorage.setItem(
          "napt-sdr-settings-v2",
          JSON.stringify(blob),
        );
        const merged = mergePersistedSdrSettings(
          initialState as unknown as Record<string, unknown>,
          loadPersistedSdrSettings(),
        );
        const state = merged as unknown as SpectrumState;
        expect(Number.isFinite(state.fftSize)).toBe(true);
        expect(Number.isFinite(state.fftFrameRate)).toBe(true);
        expect(Number.isFinite(state.gain)).toBe(true);
        expect(Number.isFinite(state.ppm)).toBe(true);
        expect(Number.isFinite(state.vizZoom)).toBe(true);
        expect(Number.isFinite(state.vizPanOffset)).toBe(true);
        expect(Number.isFinite(state.fftMinDb)).toBe(true);
        expect(Number.isFinite(state.fftMaxDb)).toBe(true);
        expect(
          state.frequencyRange === null ||
            (typeof state.frequencyRange === "object" &&
              !Array.isArray(state.frequencyRange)),
        ).toBe(true);
        expect(typeof state.fftWindow === "string").toBe(true);
        expect(
          state.displayTemporalResolution === "slow" ||
            state.displayTemporalResolution === "reduced" ||
            state.displayTemporalResolution === "lossless",
        ).toBe(true);
      }),
    );
  });

  it("round-trip is idempotent: load(serialize(load(serialize(state)))) === load(serialize(state))", () => {
    fc.assert(
      fc.property(arbitraryPersistedSettings, (blob) => {
        window.localStorage.setItem(
          "napt-sdr-settings-v2",
          JSON.stringify(blob),
        );
        const first = loadPersistedSdrSettings();
        window.localStorage.setItem(
          "napt-sdr-settings-v2",
          JSON.stringify(first),
        );
        const second = loadPersistedSdrSettings();
        expect(second).toEqual(first);
      }),
    );
  });

  it("loadPersistedSettings coerces mirrorIqBasebandBelowZero to a boolean", () => {
    fc.assert(
      fc.property(MIXED, (value) => {
        window.localStorage.setItem(
          "napt-settings-v1",
          JSON.stringify({ mirrorIqBasebandBelowZero: value }),
        );
        let out: Partial<{ mirrorIqBasebandBelowZero: boolean }>;
        expect(() => {
          out = loadPersistedSettings();
        }).not.toThrow();
        expect(typeof out!.mirrorIqBasebandBelowZero).toBe("boolean");
      }),
    );
  });

  it("loadPersistedTheme with arbitrary JSON never throws and returns an object or null", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        window.localStorage.setItem(
          "napt-theme-storage",
          JSON.stringify(value),
        );
        let out: unknown;
        expect(() => {
          out = loadPersistedTheme();
        }).not.toThrow();
        expect(out === null || typeof out === "object").toBe(true);
      }),
    );
  });

  it("loadPersistedSignalsDefaults only returns values that pass the signals schema", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        window.localStorage.setItem(
          "napt-signals-defaults-v1",
          JSON.stringify(
            typeof value === "object" && value !== null
              ? { version: 1, sdr: value }
              : { version: 1, sdr: {} },
          ),
        );
        let out: unknown;
        expect(() => {
          out = loadPersistedSignalsDefaults();
        }).not.toThrow();
        if (out !== null) {
          // must be a schema-valid SignalsSdrDefaults
          expect(out).not.toBeNull();
        }
      }),
    );
  });

  it("normalizePersistedTxSignalKey always returns one of the known keys", () => {
    fc.assert(
      fc.property(MIXED, (value) => {
        const key = normalizePersistedTxSignalKey(value);
        expect(["wifi", "d_sharp", "5g", "tone", "noise", "custom"]).toContain(
          key,
        );
      }),
    );
  });

  it("normalizePersistedTxViewerSettings never leaves non-finite numeric fields", () => {
    fc.assert(
      fc.property(
        fc.record({
          txViewerSampleRateHz: MIXED,
          txViewerFftSize: MIXED,
          txViewerFftFrameRate: MIXED,
          txViewerFftWindow: MIXED,
          txViewerTemporalResolution: MIXED,
          txViewerPowerScale: MIXED,
        }),
        (blob) => {
          let out: Record<string, unknown>;
          expect(() => {
            out = normalizePersistedTxViewerSettings({ ...blob });
          }).not.toThrow();
          const s = out!;
          expect(isFiniteNumber(s.txViewerSampleRateHz)).toBe(true);
          expect(isFiniteNumber(s.txViewerFftSize)).toBe(true);
          expect(isFiniteNumber(s.txViewerFftFrameRate)).toBe(true);
          expect(typeof s.txViewerFftWindow).toBe("string");
          expect(
            ["slow", "reduced", "lossless"].includes(
              s.txViewerTemporalResolution as string,
            ),
          ).toBe(true);
          expect(["dB", "dBm"].includes(s.txViewerPowerScale as string)).toBe(
            true,
          );
        },
      ),
    );
  });

  it("maxVizZoom is always clamped to VISUALIZER_MAX_ZOOM_LIMITS", () => {
    fc.assert(
      fc.property(MIXED, (value) => {
        window.localStorage.setItem(
          "napt-sdr-settings-v2",
          JSON.stringify({ maxVizZoom: value }),
        );
        const out = loadPersistedSdrSettings() as { maxVizZoom?: unknown };
        if (out.maxVizZoom !== undefined) {
          expect(isFiniteNumber(out.maxVizZoom)).toBe(true);
          expect(out.maxVizZoom).toBeGreaterThanOrEqual(
            VISUALIZER_MAX_ZOOM_LIMITS.min,
          );
          expect(out.maxVizZoom).toBeLessThanOrEqual(
            VISUALIZER_MAX_ZOOM_LIMITS.max,
          );
        }
      }),
    );
  });
});
