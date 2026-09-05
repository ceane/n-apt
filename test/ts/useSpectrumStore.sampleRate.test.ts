import fc from "fast-check";
import {
  buildPersistedSourceViewState,
  resolveInitialSourceHydrationSettings,
  resolveSourceSwitchDisplaySettings,
  resolveEffectiveLiveSampleRateHz,
  normalizePersistedSourceViewState,
  shouldPersistSelectedSourceView,
  resolveLeavingSourceViewSnapshot,
  shouldRequestPausedPreview,
  buildPausedPreviewSignature,
  selectLiveSampleRateForSync,
  shouldHydrateLiveSampleRate,
  shouldSendSignalDisplaySettings,
  resolveLiveAcquisitionBounds,
} from "@n-apt/spectrum/hooks/useSpectrumStore";
import { buildLiveSampleRateRange } from "@n-apt/spectrum/hooks/useLiveSampleRateControl";

const DEVICE_OWNED_SOURCE_FIELDS = [
  "activeSignalArea",
  "frequencyRange",
  "sampleRateHz",
  "fftSize",
  "fftFrameRate",
  "fftWindow",
  "gain",
  "hackrfLnaGain",
  "hackrfVgaGain",
  "hackrfAmpEnabled",
  "hackrfBasebandBandwidth",
  "ppm",
  "tunerAGC",
  "rtlAGC",
  "lastKnownRanges",
] as const;

const SOURCE_VIEW_FIELDS = [
  ...DEVICE_OWNED_SOURCE_FIELDS,
  "displayTemporalResolution",
  "powerScale",
  "vizZoom",
  "vizZoomFloor",
  "vizZoomFloorPan",
  "autoZoomStability",
  "vizPanOffset",
  "fftMinDb",
  "fftMaxDb",
  "showSpikeOverlay",
  "removeDcSpike",
  "displayMode",
  "fftAvgEnabled",
  "fftSmoothEnabled",
  "wfSmoothEnabled",
] as const;

describe("resolveSourceSwitchDisplaySettings", () => {
  it("does not restore a device-owned center frequency from client storage", () => {
    const resolved = resolveSourceSwitchDisplaySettings(
      {
        activeSignalArea: "C",
        frequencyRange: { min: 13_152_300, max: 16_352_300 },
        sampleRateHz: 3_200_000,
        fftFrameRate: 30,
        vizPanOffset: 0.25,
        powerScale: "dBm",
      },
      { sampleRateHz: 20_000_000, fftFrameRate: 12 } as any,
    );

    expect(resolved).not.toHaveProperty("activeSignalArea");
    expect(resolved).not.toHaveProperty("frequencyRange");
    expect(resolved.sampleRateHz).toBe(20_000_000);
    expect(resolved.fftFrameRate).toBe(12);
    expect(resolved).toEqual(
      expect.objectContaining({ vizPanOffset: 0.25, powerScale: "dBm" }),
    );
  });

  it("cannot let arbitrary local source state overwrite device-owned options", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom(...SOURCE_VIEW_FIELDS), fc.jsonValue()),
        (restored) => {
          const current = {
            activeSignalArea: "A",
            frequencyRange: { min: 0, max: 3_200_000 },
            sampleRateHz: 3_200_000,
            fftSize: 2_048,
            fftFrameRate: 30,
            fftWindow: "Rectangular",
            gain: 12,
            lastKnownRanges: { A: { min: 0, max: 3_200_000 } },
            vizZoom: 1,
            vizPanOffset: 0,
          };
          const before = {
            ...current,
            frequencyRange: { ...current.frequencyRange },
            lastKnownRanges: {
              A: { ...current.lastKnownRanges.A },
            },
          };
          const currentRecord = current as Record<string, unknown>;
          const normalized = normalizePersistedSourceViewState(
            restored as any,
          );
          const switched = resolveSourceSwitchDisplaySettings(
            restored as any,
            current,
          );

          expect(Object.keys(normalized)).toEqual(
            expect.arrayContaining(
              Object.keys(restored).filter(
                (key) => !DEVICE_OWNED_SOURCE_FIELDS.includes(key as never),
              ),
            ),
          );
          for (const key of DEVICE_OWNED_SOURCE_FIELDS) {
            expect(normalized).not.toHaveProperty(key);
            if (key in currentRecord) {
              expect(switched[key]).toEqual(currentRecord[key]);
            } else {
              expect(switched).not.toHaveProperty(key);
            }
          }
          expect(current).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("resolveLiveAcquisitionBounds", () => {
  it("prefers the device bounds over a subscriber-local channel frame", () => {
    expect(
      resolveLiveAcquisitionBounds({
        hardwareBounds: { min: 0, max: 30_000_000_000 },
        channelBounds: { min: 6_780, max: 4_390_000 },
      }),
    ).toEqual({ min: 0, max: 30_000_000_000 });
  });
});

describe("resolveInitialSourceHydrationSettings", () => {
  it("does not publish persisted device-scoped channel settings during page hydration", () => {
    const restored = resolveInitialSourceHydrationSettings({
      activeSignalArea: "C",
      frequencyRange: { min: 20, max: 30 },
      sampleRateHz: 3_200_000,
      fftSize: 262_144,
      gain: 42,
      vizPanOffset: 0.25,
      powerScale: "dBm",
    } as any);

    expect(restored).toEqual(
      expect.objectContaining({
        vizPanOffset: 0.25,
        powerScale: "dBm",
      }),
    );
    expect(restored).not.toHaveProperty("activeSignalArea");
    expect(restored).not.toHaveProperty("frequencyRange");
    expect(restored).not.toHaveProperty("sampleRateHz");
    expect(restored).not.toHaveProperty("fftSize");
    expect(restored).not.toHaveProperty("gain");
  });
});

describe("shouldRequestPausedPreview", () => {
  it("does not request a preview frame for a paused RTL-SDR", () => {
    expect(
      shouldRequestPausedPreview({
        id: "rtl-sdr-00000001",
        kind: "rtl_sdr",
        status: "connected",
      } as any),
    ).toBe(false);
  });

  it("leaves Mock Tx standby previews to SpectrumRoute", () => {
    expect(
      shouldRequestPausedPreview({
        id: "mock-tx",
        kind: "mock_tx",
        status: "connected",
      } as any),
    ).toBe(false);
  });

  it("requests a one-shot frame for a paused Rx source with raw I/Q", () => {
    expect(
      shouldRequestPausedPreview({
        id: "mock-apt",
        kind: "mock_apt",
        capability: "rx",
        iq_format: {
          element_type: "u8",
          layout: "interleaved_iq",
          typed_array: "Uint8Array",
        },
        status: "connected",
      } as any),
    ).toBe(true);
  });

  it("requests a fresh view frame when a half-duplex source is paused in Rx", () => {
    expect(
      shouldRequestPausedPreview({
        id: "hackrf-one",
        kind: "hackrf",
        capability: "tx_rx",
        duplex_mode: "half_duplex",
        iq_format: {
          element_type: "u8",
          layout: "interleaved_iq",
          typed_array: "Uint8Array",
        },
        status: "streaming",
      } as any),
    ).toBe(true);
  });

  it("does not request an Rx preview when the source is bound to the Tx view", () => {
    expect(
      shouldRequestPausedPreview(
        {
          id: "hackrf-one",
          kind: "hackrf",
          capability: "tx_rx",
          duplex_mode: "half_duplex",
          iq_format: {
            element_type: "u8",
            layout: "interleaved_iq",
            typed_array: "Uint8Array",
          },
          status: "streaming",
        } as any,
        "hackrf-one",
      ),
    ).toBe(false);
  });
});

describe("shouldPersistSelectedSourceView", () => {
  it("does not persist pending selection state into the next source key", () => {
    expect(
      shouldPersistSelectedSourceView({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        sourceMode: "live",
      }),
    ).toBe(false);
  });

  it("persists once the selected source is the active stream", () => {
    expect(
      shouldPersistSelectedSourceView({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        sourceMode: "live",
      }),
    ).toBe(true);
  });
});

describe("resolveLeavingSourceViewSnapshot", () => {
  it("preserves local presentation state without capturing the shared range", () => {
    const snapshot = resolveLeavingSourceViewSnapshot({
      previousSelectedSourceId: "mock-apt",
      nextSelectedSourceId: "mock-tx",
      previousSourceViewKey: "napt-spectrum-view-v1:mock-apt",
      state: {
        frequencyRange: { min: 18_000, max: 4_390_000 },
        sampleRateHz: 4_372_000,
        vizPanOffset: 0.2,
      } as any,
    });

    expect(snapshot?.key).toBe("napt-spectrum-view-v1:mock-apt");
    expect(snapshot?.view).not.toHaveProperty("frequencyRange");
    expect(snapshot?.view).not.toHaveProperty("sampleRateHz");
    expect(snapshot?.view.vizPanOffset).toBe(0.2);
  });

  it("does nothing when the selection has not changed", () => {
    expect(
      resolveLeavingSourceViewSnapshot({
        previousSelectedSourceId: "mock-apt",
        nextSelectedSourceId: "mock-apt",
        previousSourceViewKey: "napt-spectrum-view-v1:mock-apt",
        state: { frequencyRange: { min: 18_000, max: 4_390_000 } } as any,
      }),
    ).toBeNull();
  });
});

describe("buildPausedPreviewSignature", () => {
  it("changes when the paused source sample rate changes", () => {
    const base = {
      frequencyRange: { min: 18_000, max: 4_390_000 },
      sampleRateHz: 4_372_000,
      fftSize: 2048,
      fftWindow: "Rectangular",
      vizZoom: 1,
      vizPanOffset: 0,
      txCenterFrequencyHz: 137_100_000,
      txSampleRateHz: 2_400_000,
      txPowerDbm: -18,
      txSignal: "wifi",
      txIfftSize: 65_536,
    };

    expect(
      buildPausedPreviewSignature(base),
    ).not.toBe(
      buildPausedPreviewSignature({ ...base, sampleRateHz: 12_800_000 }),
    );
  });

  it("changes when a paused mirrored viewport moves through DC", () => {
    const base = {
      frequencyRange: { min: 0, max: 4_000_000 },
      sampleRateHz: 4_000_000,
      fftSize: 2048,
      fftWindow: "Rectangular",
      vizZoom: 1,
      vizPanOffset: 0,
      txCenterFrequencyHz: 137_100_000,
      txSampleRateHz: 2_400_000,
      txPowerDbm: -18,
      txSignal: "wifi",
      txIfftSize: 65_536,
    };

    expect(
      buildPausedPreviewSignature({ ...base, vizPanOffset: -2_100_000 }),
    ).not.toBe(buildPausedPreviewSignature(base));
  });
});

describe("selectLiveSampleRateForSync", () => {
  it("prefers the live websocket sample rate while connected", () => {
    expect(
      selectLiveSampleRateForSync({
        isConnected: true,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(20_000_000);
  });

  it("falls back to sdr settings when disconnected", () => {
    expect(
      selectLiveSampleRateForSync({
        isConnected: false,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(3_200_000);
  });

  it("does not accept a stale backend rate over a pending local request", () => {
    expect(
      shouldHydrateLiveSampleRate({
        rate: 3_200_000,
        localSampleRateHz: 18_250_000,
        pendingLocalSampleRateHz: 18_250_000,
        hydratedBackendSampleRate: false,
      }),
    ).toBe(false);
  });

  it("accepts the backend rate once it acknowledges the pending request", () => {
    expect(
      shouldHydrateLiveSampleRate({
        rate: 18_250_000,
        localSampleRateHz: 18_250_000,
        pendingLocalSampleRateHz: 18_250_000,
        hydratedBackendSampleRate: false,
      }),
    ).toBe(true);
  });

  it("keeps fuzzed Whole Channel/manual transitions within the channel bounds", () => {
    const channelBounds = { min: 4_750_000, max: 23_000_000 };
    const channelSpan = channelBounds.max - channelBounds.min;
    const rates = [
      3_200_000,
      4_372_000,
      5_200_000,
      8_000_000,
      12_800_000,
      18_250_000,
      20_000_000,
    ];

    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...rates), { minLength: 1, maxLength: 80 }),
        (sampleRates) => {
          let currentRange = { min: 13_875_000, max: 17_075_000 };
          for (const sampleRateHz of sampleRates) {
            currentRange = buildLiveSampleRateRange({
              currentRange,
              sampleRateHz,
              channelBounds,
            });
            const span = currentRange.max - currentRange.min;
            expect(span).toBe(sampleRateHz);
            if (sampleRateHz <= channelSpan) {
              expect(currentRange.min).toBeGreaterThanOrEqual(
                channelBounds.min,
              );
              expect(currentRange.max).toBeLessThanOrEqual(channelBounds.max);
            }
            if (sampleRateHz === channelSpan) {
              expect(currentRange).toEqual(channelBounds);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never hydrates a stale backend rate during fuzzed local requests", () => {
    const rates = [
      3_200_000,
      4_372_000,
      5_200_000,
      8_000_000,
      12_800_000,
      18_250_000,
      20_000_000,
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...rates),
        fc.constantFrom(...rates),
        (requestedRate, backendRate) => {
          const isAcknowledgement = requestedRate === backendRate;
          expect(
            shouldHydrateLiveSampleRate({
              rate: backendRate,
              localSampleRateHz: requestedRate,
              pendingLocalSampleRateHz: requestedRate,
              hydratedBackendSampleRate: false,
            }),
          ).toBe(isAcknowledgement);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("keeps the accepted source rate over an unacknowledged local Whole Channel request", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: 4_372_000,
        websocketSampleRateHz: 3_200_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(3_200_000);
  });

  it("keeps RTL-SDR whole-channel state from inheriting a stale connected rate", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: 4_372_000,
        websocketSampleRateHz: 4_372_000,
        sdrSettingsSampleRateHz: 3_200_000,
        minReceiveSampleRateHz: 3_200_000,
        maxSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
        backend: "rtl-sdr",
      }),
    ).toBe(3_200_000);
  });

  it("caps an invalid RTL-SDR configured whole-channel rate at the device maximum", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: 6_270_000,
        websocketSampleRateHz: 6_270_000,
        sdrSettingsSampleRateHz: 6_270_000,
        minReceiveSampleRateHz: 6_270_000,
        maxSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
        backend: "rtl-sdr",
      }),
    ).toBe(3_200_000);
  });

  it("falls back to websocket/backend rates when no local rate has been selected", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: null,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(20_000_000);
  });

  it("does not persist device-owned sample rate in a source view", () => {
    const persisted = buildPersistedSourceViewState({
      fftSize: 262_144,
      fftWindow: "Rectangular",
      fftFrameRate: 12,
      gain: 49.6,
      hackrfLnaGain: 0,
      hackrfVgaGain: 30,
      hackrfAmpEnabled: false,
      hackrfBasebandBandwidth: 5_200_000,
      ppm: 1,
      tunerAGC: false,
      rtlAGC: false,
      sampleRateHz: 5_200_000,
      lastKnownRanges: {},
      displayMode: "fft",
      fftAvgEnabled: false,
      fftSmoothEnabled: false,
      wfSmoothEnabled: false,
    } as any);

    expect(persisted.sampleRateHz).toBeUndefined();
    expect(
      normalizePersistedSourceViewState({
        ...persisted,
        sampleRateHz: 5_200_000,
      }),
    ).not.toHaveProperty("sampleRateHz");
  });
});

describe("shouldSendSignalDisplaySettings", () => {
  it("sends the first settings packet after a source handoff", () => {
    expect(
      shouldSendSignalDisplaySettings({
        previous: null,
        next: { sampleRateHz: 3_200_000, fftSize: 262_144, frameRate: 12 },
      }),
    ).toBe(true);
  });

  it("sends when Whole Channel changes the sample rate without changing frame rate", () => {
    expect(
      shouldSendSignalDisplaySettings({
        previous: { sampleRateHz: 3_200_000, fftSize: 262_144, frameRate: 12 },
        next: { sampleRateHz: 4_372_000, fftSize: 262_144, frameRate: 12 },
      }),
    ).toBe(true);
  });

  it("does not resend unchanged display settings", () => {
    expect(
      shouldSendSignalDisplaySettings({
        previous: { sampleRateHz: 4_372_000, fftSize: 262_144, frameRate: 12 },
        next: { sampleRateHz: 4_372_000, fftSize: 262_144, frameRate: 12 },
      }),
    ).toBe(false);
  });
});
