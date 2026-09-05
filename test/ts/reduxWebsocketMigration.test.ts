import { configureStore } from "@reduxjs/toolkit";
import websocketSlice, {
  updateDeviceState,
  setCaptureStatus,
  setSpectrumFrames,
} from "@n-apt/redux/slices/websocketSlice";
import {
  liveDataRef,
  liveDataBySourceRef,
  sourceVisualizationRuntime,
} from "@n-apt/redux/middleware/websocketMiddleware";
import { demodFrameQueue } from "@n-apt/app/infrastructure/visualization/demodFrameQueue";
import {
  shouldAcceptPausedFrameRequest,
  resetPausedFrameRequestGate,
  getFrequencyRequestCenterHz,
  resetWebSocketMiddlewareState,
  trimLiveFrameQueue,
  normalizeFrequencyRangeMessageData,
  resolveIncomingChannelsFrequencyRange,
  resolveIncomingChannelsActiveSignalArea,
  isSourceModePaused,
  resolveTxPreviewSourceId,
  resolveOptimisticTransmitStatus,
  applyOptimisticTxPreviewState,
  resolveRxFrameToRestore,
  isBoundTxPreviewStandby,
  preserveTransmittingSourceStatuses,
  normalizeManagedStreamFrame,
  shouldRetireRemovedSourceRequest,
  resolveSourceSelectionAfterFailedSwitch,
  resolveSourceSelectionAfterBackendFallback,
  shouldSyncManagedStreamOptions,
  resolveManagedTxSourceId,
  resolveManagedRxSourceId,
  shouldPublishManagedRxTransportReady,
  isCurrentManagedRxTarget,
  txStreamConflictsWithActiveRx,
  handleManagedStreamEvent,
  resolveManagedRxDeviceOptionUpdates,
  resolveManagedRxOptionsOverride,
  resolveLocalRxTuningOverride,
  shouldApplySourceStatusToPresentation,
  processWebSocketMessage,
  CLIENT_ORIGIN_ID,
  __testQueueLiveDataForMiddleware,
} from "@n-apt/redux/middleware/websocketMiddleware";
import websocketMiddleware from "@n-apt/redux/middleware/websocketMiddleware";
import {
  sendFrequencyRange,
  sendCenterFrequency,
  sendCaptureCommand,
} from "@n-apt/redux/thunks/websocketThunks";
import { tuneDemod } from "@n-apt/redux/thunks/demodThunks";
import spectrumSlice, {
  setDeviceSdrSettingsBundle,
  setFrequencyRange,
  setFftSize,
  setSampleRate,
  setTxSampleRateHz,
  setTxGeometry,
} from "@n-apt/redux/slices/spectrumSlice";
import sourceRoutingSlice, {
  setSourceBinding,
} from "@n-apt/redux/slices/sourceRoutingSlice";
import sourceSelectionSlice, {
  setSelectedSourceId,
  setSelectionIntentSourceId,
} from "@n-apt/redux/slices/sourceSelectionSlice";
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import { collapsePausedFrameBatch } from "@n-apt/redux/middleware/websocketMiddleware";
import { shouldPauseSourceOnSwitch } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { waitFor } from "@testing-library/react";
import * as websocketMiddlewareExports from "@n-apt/redux/middleware/websocketMiddleware";

describe("hardware source transition cleanup", () => {
  it("follows Mock APT when the backend falls back from the selected hardware", () => {
    expect(
      resolveSourceSelectionAfterBackendFallback({
        previousActiveSourceId: "rtl-sdr-00000001",
        nextActiveSourceId: "mock-apt",
        selectedSourceId: "rtl-sdr-00000001",
        selectionIntentSourceId: "rtl-sdr-00000001",
        sources: [{ id: "mock-apt" }] as any,
      }),
    ).toEqual({ fallbackSourceId: "mock-apt" });
    expect(
      resolveSourceSelectionAfterBackendFallback({
        previousActiveSourceId: "mock-apt",
        nextActiveSourceId: "mock-apt",
        selectedSourceId: "rtl-sdr-00000001",
        selectionIntentSourceId: "rtl-sdr-00000001",
        sources: [{ id: "mock-apt" }] as any,
      }),
    ).toBeNull();
  });

  it("retires a pending hardware request when hot-unplug removes it", () => {
    expect(
      shouldRetireRemovedSourceRequest({
        requestedSourceId: "rtl-sdr-00000001",
        sources: [{ id: "mock-apt" } as any],
      }),
    ).toBe(true);
    expect(
      shouldRetireRemovedSourceRequest({
        requestedSourceId: "rtl-sdr-00000001",
        sources: [{ id: "rtl-sdr-00000001" } as any],
      }),
    ).toBe(false);
  });

  it("falls back to the confirmed active source after a failed hardware switch", () => {
    expect(
      resolveSourceSelectionAfterFailedSwitch({
        failedSourceId: "rtl-sdr-00000001",
        activeSourceId: "mock-apt",
        selectedSourceId: "rtl-sdr-00000001",
      }),
    ).toEqual({ fallbackSourceId: "mock-apt" });
    expect(
      resolveSourceSelectionAfterFailedSwitch({
        failedSourceId: "rtl-sdr-00000001",
        activeSourceId: "mock-apt",
        selectedSourceId: "mock-apt",
      }),
    ).toBeNull();
  });

  it("does not retire a source that remains in the global source inventory", () => {
    expect(
      resolveSourceSelectionAfterBackendFallback({
        previousActiveSourceId: "mock-tx",
        nextActiveSourceId: "mock-apt",
        selectedSourceId: "mock-tx",
        selectionIntentSourceId: "mock-tx",
        sources: [{ id: "mock-apt" }, { id: "mock-tx" }] as any,
      }),
    ).toBeNull();
  });
});
import { bytesToBase64 } from "@n-apt/crypto/webcrypto";

describe("client-local presentation status isolation", () => {
  it("does not freeze a local RX presentation for a foreign global pause", () => {
    expect(
      shouldApplySourceStatusToPresentation({
        sourceId: "mock-apt",
        status: "paused",
        activeSourceId: "mock-tx",
        managedRxSourceId: "mock-apt",
        subscriberPaused: false,
      }),
    ).toBe(false);

    expect(
      shouldApplySourceStatusToPresentation({
        sourceId: "mock-apt",
        status: "paused",
        activeSourceId: "mock-tx",
        managedRxSourceId: "mock-apt",
        subscriberPaused: true,
      }),
    ).toBe(true);

    expect(
      shouldApplySourceStatusToPresentation({
        sourceId: "mock-tx",
        status: "paused",
        activeSourceId: "mock-tx",
        managedRxSourceId: "mock-apt",
        subscriberPaused: false,
      }),
    ).toBe(true);
  });
});

describe("managed stream option synchronization", () => {
  it("does not hydrate Redux from a local stream option echo", () => {
    const dispatch = jest.fn();
    const options = {
      mode: "rx" as const,
      centerFrequencyHz: 138_000_000,
      sampleRateHz: 5_200_000,
      fftSize: 2048,
    };

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 3,
        optionsRevision: 2,
        origin: "local",
        options,
      },
      dispatch,
      () => ({ websocket: {}, spectrum: {} }),
    );

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not re-anchor a local mirrored view during stream startup hydration", () => {
    const dispatch = jest.fn();

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_opened",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 4,
        optionsRevision: 1,
        state: "ready",
        options: {
          mode: "rx",
          centerFrequencyHz: 4_000_000,
          sampleRateHz: 4_000_000,
          fftSize: 1024,
        },
      },
      dispatch,
      () => ({
        websocket: {
          activeSourceId: null,
          sources: [{ id: "mock-apt", sdr: { settings: {} } }],
          channels: [],
        },
        spectrum: {
          frequencyRange: { min: 0, max: 4_000_000 },
          vizPanOffset: -4_000_000,
          activeSignalArea: "A",
        },
        settings: { mirrorIqBasebandBelowZero: true },
      }),
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSdrSettingsBundle",
        payload: expect.not.objectContaining({
          vizPanOffset: expect.any(Number),
        }),
      }),
    );
  });

  it("records managed RX readiness before the source commit arrives", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: null,
        sourceTransport: { sourceId: null, phase: "idle", error: null },
        sourceTransportByMode: {
          rx: { sourceId: null, phase: "idle", error: null },
          tx: { sourceId: null, phase: "idle", error: null },
        },
      },
    };

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_opened",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 9,
        optionsRevision: 4,
        state: "ready",
      },
      dispatch,
      () => state,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "websocket/updateDeviceState",
        payload: expect.objectContaining({
          sourceTransportByMode: expect.objectContaining({
            rx: { sourceId: "mock-apt", phase: "ready", error: null },
          }),
        }),
      }),
    );
  });

  it("keeps TX lifecycle events from overwriting the RX transport", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sourceTransport: {
          sourceId: "mock-apt",
          phase: "ready",
          error: null,
        },
        sourceTransportByMode: {
          rx: { sourceId: "mock-apt", phase: "ready", error: null },
          tx: { sourceId: null, phase: "idle", error: null },
        },
      },
    };

    handleManagedStreamEvent(
      "mock-tx",
      "tx",
      {
        type: "stream_state",
        sourceId: "mock-tx",
        mode: "tx",
        streamEpoch: 2,
        optionsRevision: 1,
        state: "opening",
        reason: "secondary subscriber warming",
      },
      dispatch,
      () => state,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "websocket/updateDeviceState",
        payload: expect.objectContaining({
          sourceTransportByMode: {
            rx: { sourceId: "mock-apt", phase: "ready", error: null },
            tx: {
              sourceId: "mock-tx",
              phase: "warming",
              error: "secondary subscriber warming",
            },
          },
        }),
      }),
    );
  });

  it("hydrates Redux and the source snapshot when the device applies RX options", () => {
    const dispatch = jest.fn();
    const source = {
      id: "mock-apt",
      name: "Mock APT SDR",
      kind: "mock_apt",
      capability: "rx",
      status: "receiving",
      sdr: {
        max_sample_rate: 20_000_000,
        sample_rate_options: [2_400_000, 5_200_000],
        fft_display: { markers: [] },
        settings: {
          sample_rate: 2_400_000,
          center_frequency: 137_100_000,
          fft_size: 1024,
          fft_window: "Rectangular",
          frame_rate: 30,
          gain: 10,
        },
      },
    };
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [source],
        channels: [
          { label: "A", min_hz: 100_000_000, max_hz: 120_000_000 },
          { label: "C", min_hz: 135_000_000, max_hz: 140_000_000 },
        ],
        sampleRateHz: 2_400_000,
        sdrSettings: null,
      },
      spectrum: {
        sampleRateHz: 2_400_000,
        fftSize: 1024,
        fftWindow: "Rectangular",
        fftFrameRate: 30,
        gain: 10,
        frequencyRange: {
          min: 135_800_000,
          max: 138_200_000,
        },
      },
    };

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 3,
        optionsRevision: 2,
        options: {
          mode: "rx",
          centerFrequencyHz: 138_000_000,
          sampleRateHz: 5_200_000,
          fftSize: 2048,
          fftWindow: "Hann",
          frameRate: 12,
          gain: 18,
        },
      },
      dispatch,
      () => state,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "websocket/updateDeviceState",
        payload: expect.objectContaining({
          sampleRateHz: 5_200_000,
          sources: [
            expect.objectContaining({
              id: "mock-apt",
              sdr: expect.objectContaining({
                settings: expect.objectContaining({
                  center_frequency: 138_000_000,
                  sample_rate: 5_200_000,
                  fft_size: 2048,
                  fft_window: "Hann",
                  frame_rate: 12,
                  gain: 18,
                }),
              }),
            }),
          ],
        }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSdrSettingsBundle",
        payload: expect.objectContaining({
          activeSignalArea: "C",
          sampleRateHz: 5_200_000,
          fftSize: 2048,
          fftWindow: "Hann",
          fftFrameRate: 12,
          gain: 18,
          frequencyRange: {
            min: 135_400_000,
            max: 140_600_000,
          },
        }),
      }),
    );

    dispatch.mockClear();
    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_opened",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 4,
        optionsRevision: 3,
        state: "ready",
        options: {
          mode: "rx",
          centerFrequencyHz: 138_000_000,
          sampleRateHz: 5_200_000,
          fftSize: 2048,
          fftWindow: "Hann",
          frameRate: 12,
          gain: 18,
        },
      },
      dispatch,
      () => state,
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "spectrum/setDeviceSdrSettingsBundle" }),
    );
  });

  it("publishes local RX tuning changes as device-scoped stream options", () => {
    expect(shouldSyncManagedStreamOptions("spectrum/setFrequencyRange")).toBe(
      true,
    );
    expect(shouldSyncManagedStreamOptions("spectrum/setSampleRate")).toBe(true);
    expect(
      shouldSyncManagedStreamOptions("spectrum/setSignalAreaAndRange"),
    ).toBe(true);
    expect(shouldSyncManagedStreamOptions("spectrum/setFftSize")).toBe(true);
    expect(
      shouldSyncManagedStreamOptions("spectrum/setDeviceSignalAreaAndRange"),
    ).toBe(false);
    expect(shouldSyncManagedStreamOptions("spectrum/setTxGeometry")).toBe(true);
    expect(
      resolveLocalRxTuningOverride("spectrum/setSignalAreaAndRange", {
        spectrum: {
          frequencyRange: { min: 24_100_000, max: 30_370_000 },
        },
      }),
    ).toEqual({ centerFrequencyHz: 27_235_000 });
    expect(
      resolveLocalRxTuningOverride("spectrum/setSampleRate", {
        spectrum: { sampleRateHz: 4_372_000 },
      }),
    ).toEqual({ sampleRateHz: 4_372_000 });
    expect(
      resolveLocalRxTuningOverride(
        "spectrum/setSampleRate",
        {
          spectrum: {
            frequencyRange: { min: 24_100_000, max: 30_370_000 },
            sampleRateHz: 4_000_000,
          },
        },
        { min: 25_420_000, max: 29_420_000 },
      ),
    ).toEqual({
      centerFrequencyHz: 27_420_000,
      sampleRateHz: 4_000_000,
    });
    expect(
      resolveLocalRxTuningOverride("spectrum/setDeviceSignalAreaAndRange", {
        spectrum: {
          frequencyRange: { min: 24_100_000, max: 30_370_000 },
        },
      }),
    ).toEqual({});
  });

  it("keeps subscriber-local visualizer controls out of device stream options", () => {
    expect(
      [
        "spectrum/setVizZoom",
        "spectrum/setVizPan",
        "spectrum/setFftDbLimits",
        "spectrum/setPowerScale",
        "spectrum/setFftAvgEnabled",
        "spectrum/setFftSmoothEnabled",
        "spectrum/setWfSmoothEnabled",
      ].every((type) => !shouldSyncManagedStreamOptions(type)),
    ).toBe(true);
  });

  it("converts device-scoped settings into managed RX option overrides", () => {
    expect(
      resolveManagedRxOptionsOverride({
        sampleRate: 5_200_000,
        fftSize: 2048,
        fftWindow: "Hann",
        frameRate: 12,
        gain: 18,
        vizZoom: 4,
      }),
    ).toEqual({
      sampleRateHz: 5_200_000,
      fftSize: 2048,
      fftWindow: "Hann",
      frameRate: 12,
      gain: 18,
    });
  });

  it("keeps the managed center when the follow-up settings write carries a new rate", () => {
    expect(
      resolveManagedRxOptionsOverride(
        { sampleRate: 3_200_000 },
        {
          spectrum: {
            frequencyRange: { min: 26_020_000, max: 29_220_000 },
          },
        },
      ),
    ).toEqual({
      sampleRateHz: 3_200_000,
      centerFrequencyHz: 27_620_000,
    });
  });

  it("sends RX device settings through the managed stream transport", async () => {
    const sockets: any[] = [];
    (global.WebSocket as unknown as jest.Mock).mockImplementation(() => {
      const socket = {
        readyState:
          sockets.length === 0 ? WebSocket.OPEN : WebSocket.CONNECTING,
        close: jest.fn(),
        send: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        onopen: null as (() => void) | null,
        onclose: null,
        onerror: null,
        onmessage: null,
      };
      sockets.push(socket);
      return socket;
    });

    const middlewareStore = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }).concat(
          websocketMiddleware,
        ),
    });
    middlewareStore.dispatch({
      type: "websocket/connect",
      payload: {
        url: "ws://localhost/ws",
        aesKey: {} as CryptoKey,
        enabled: true,
      },
    });
    sockets[0]?.onopen?.();
    middlewareStore.dispatch(
      updateDeviceState({
        activeSourceId: "mock-apt",
        sources: [
          {
            id: "mock-apt",
            name: "Mock APT SDR",
            kind: "mock_apt",
            capability: "rx",
            status: "receiving",
            iq_format: {
              element_type: "u8",
              layout: "interleaved_iq",
              typed_array: "Uint8Array",
            },
            sdr: {
              max_sample_rate: 20_000_000,
              sample_rate_options: [2_400_000, 5_200_000],
              fft_display: { markers: [] },
              settings: {
                center_frequency: 137_100_000,
                sample_rate: 2_400_000,
                fft_size: 1024,
                fft_window: "Rectangular",
                frame_rate: 30,
                gain: 10,
              },
            },
          },
        ],
        sourceStatuses: { "mock-apt": "receiving" },
      } as any),
    );

    expect(sockets.length).toBeGreaterThanOrEqual(2);
    const streamSocket = sockets[1];
    streamSocket.readyState = WebSocket.OPEN;
    streamSocket.onopen?.();
    await Promise.resolve();
    await Promise.resolve();
    streamSocket.send.mockClear();

    middlewareStore.dispatch({
      type: "websocket/sendMessage",
      payload: {
        type: "settings",
        data: {
          scope: "device",
          sampleRate: 5_200_000,
          fftSize: 2048,
          fftWindow: "Hann",
          frameRate: 12,
          gain: 18,
        },
      },
    });

    expect(streamSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"stream_update_options"'),
    );
    expect(streamSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"sampleRateHz":5200000'),
    );
    expect(streamSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"fftSize":2048'),
    );

    streamSocket.send.mockClear();
    middlewareStore.dispatch(setSampleRate(6_270_000));

    expect(streamSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"stream_update_options"'),
    );
    expect(streamSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"sampleRateHz":6270000'),
    );

    streamSocket.send.mockClear();
    middlewareStore.dispatch(
      setFrequencyRange({ min: 13_000_000, max: 19_270_000 }),
    );
    await waitFor(() => {
      expect(streamSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"sampleRateHz":6270000'),
      );
    });

    streamSocket.send.mockClear();
    middlewareStore.dispatch(setFftSize(4096));
    expect(streamSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"sampleRateHz":6270000'),
    );
    expect(streamSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"fftSize":4096'),
    );

    streamSocket.send.mockClear();
    middlewareStore.dispatch(setTxSampleRateHz(1_200_000));

    expect(streamSocket.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"sampleRateHz":2400000'),
    );
    expect(streamSocket.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"sampleRateHz":3200000'),
    );

    streamSocket.send.mockClear();
    middlewareStore.dispatch(
      updateDeviceState({
        sourceStatuses: { "mock-apt": "receiving" },
      } as any),
    );

    expect(streamSocket.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"stream_update_options"'),
    );
  });

  it("opens a managed Tx stream for selected Mock Tx standby preview delivery", () => {
    expect(
      resolveManagedTxSourceId({
        activeSourceId: "mock-apt",
        sources: [
          {
            id: "mock-tx",
            name: "Mock Tx SDR",
            kind: "mock_tx",
            capability: "tx",
            status: "standby",
          },
        ],
        sourceStatuses: { "mock-tx": "standby" },
        sourceSelection: { selectedSourceId: "mock-tx" },
        sourceRouting: { bindings: { "tx-suite:tx": "mock-tx" } },
      }),
    ).toBe("mock-tx");
  });

  it("attaches a passive client to selected RX while another source owns global Tx", () => {
    expect(
      resolveManagedRxSourceId({
        activeSourceId: "mock-tx",
        selectedSourceId: "mock-apt",
        requestedSourceId: null,
        sources: [
          {
            id: "mock-tx",
            kind: "mock_tx",
            capability: "tx",
            capabilities: { can_receive: false },
          },
          {
            id: "mock-apt",
            kind: "mock_apt",
            capability: "mock",
            capabilities: { can_receive: true },
          },
        ] as any,
      }),
    ).toBe("mock-apt");
  });

  it("keeps a selected transmitting Mock Tx stream when RX remains active", () => {
    expect(
      resolveManagedTxSourceId({
        activeSourceId: "mock-apt",
        sources: [
          {
            id: "mock-apt",
            kind: "mock_apt",
            capability: "mock",
            status: "receiving",
          },
          {
            id: "mock-tx",
            name: "Mock Tx SDR",
            kind: "mock_tx",
            capability: "tx",
            status: "transmitting",
          },
        ],
        sourceStatuses: {
          "mock-apt": "receiving",
          "mock-tx": "transmitting",
        },
        sourceSelection: { selectedSourceId: "mock-tx" },
        sourceRouting: { bindings: {} },
      }),
    ).toBe("mock-tx");
  });

  it("keeps the global transmitting Tx stream when this client views RX", () => {
    expect(
      resolveManagedTxSourceId({
        activeSourceId: "mock-apt",
        sources: [
          {
            id: "mock-apt",
            name: "Mock APT SDR",
            kind: "mock_apt",
            capability: "rx",
            status: "receiving",
          },
          {
            id: "mock-tx",
            name: "Mock Tx SDR",
            kind: "mock_tx",
            capability: "tx",
            status: "transmitting",
          },
        ],
        sourceStatuses: {
          "mock-apt": "receiving",
          "mock-tx": "transmitting",
        },
        sourceSelection: { selectedSourceId: "mock-apt" },
        sourceRouting: { bindings: {} },
      }),
    ).toBe("mock-tx");
  });

  it("marks a selected passive RX stream ready while another source owns TX", () => {
    expect(
      shouldPublishManagedRxTransportReady({
        isCurrentRxTarget: true,
        streamEpoch: 4,
      }),
    ).toBe(true);
  });

  it("keeps a selected passive RX subscription current after global TX changes", () => {
    expect(
      isCurrentManagedRxTarget(
        {
          websocket: {
            activeSourceId: "mock-tx",
            sourceStatuses: {
              "mock-apt": "connected",
              "mock-tx": "transmitting",
            },
            sources: [
              {
                id: "mock-apt",
                kind: "mock_apt",
                capability: "rx",
                iq_format: { typed_array: "Uint8Array" },
              },
              {
                id: "mock-tx",
                kind: "mock_tx",
                capability: "tx",
              },
            ],
          },
          sourceSelection: { selectedSourceId: "mock-apt" },
        },
        "mock-apt",
      ),
    ).toBe(true);
  });

  it("opens a managed Tx stream while actively transmitting", () => {
    expect(
      resolveManagedTxSourceId({
        activeSourceId: "mock-tx",
        sources: [
          {
            id: "mock-tx",
            name: "Mock Tx SDR",
            capability: "tx",
            status: "transmitting",
          },
        ],
        sourceStatuses: { "mock-tx": "transmitting" },
        sourceRouting: { bindings: {} },
      }),
    ).toBe("mock-tx");
  });

  it("opens a managed Tx stream for a bound half-duplex hardware standby source", () => {
    // A physical HackRF bound as the Tx-suite source is in standby while a
    // separate Rx source stays active. The Tx stream must subscribe so the
    // request_next_frame preview is delivered to the bound device.
    expect(
      resolveManagedTxSourceId({
        activeSourceId: "rtl-sdr-1",
        sources: [
          {
            id: "rtl-sdr-1",
            name: "RTL-SDR",
            kind: "rtl-sdr",
            capability: "rx",
            status: "receiving",
          },
          {
            id: "hackrf_one-00000001",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "tx_rx",
            duplex_mode: "half_duplex",
            status: "standby",
          },
        ],
        sourceStatuses: {
          "rtl-sdr-1": "receiving",
          "hackrf_one-00000001": "standby",
        },
        sourceSelection: { selectedSourceId: "rtl-sdr-1" },
        sourceRouting: {
          bindings: { "tx-suite:tx": "hackrf_one-00000001" },
        },
      }),
    ).toBe("hackrf_one-00000001");
  });

  it("does not open a Tx stream for an unbound idle hardware source", () => {
    // Without a Tx-suite binding or an active/selected standby state, a
    // half-duplex device must not hold a Tx subscription open.
    expect(
      resolveManagedTxSourceId({
        activeSourceId: "rtl-sdr-1",
        sources: [
          {
            id: "rtl-sdr-1",
            name: "RTL-SDR",
            kind: "rtl-sdr",
            capability: "rx",
            status: "receiving",
          },
          {
            id: "hackrf_one-00000001",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "tx_rx",
            duplex_mode: "half_duplex",
            status: "standby",
          },
        ],
        sourceStatuses: {
          "rtl-sdr-1": "receiving",
          "hackrf_one-00000001": "standby",
        },
        sourceSelection: { selectedSourceId: "rtl-sdr-1" },
        sourceRouting: { bindings: {} },
      }),
    ).toBeNull();
  });

  it("releases the Rx stream when an active half-duplex source wants its Tx stream", () => {
    const hackrf = {
      id: "hackrf_one-00000001",
      name: "HackRF One",
      kind: "hackrf_one",
      capability: "tx_rx",
      duplex_mode: "half_duplex",
      status: "standby",
    };
    // Same active source + half-duplex + Tx wanted → the Rx stream must be
    // released so the backend arbitration accepts the Tx subscription.
    expect(
      txStreamConflictsWithActiveRx({
        activeSourceId: "hackrf_one-00000001",
        txSource: hackrf,
      }),
    ).toBe(true);
    // A different active source (Tx Suite with separate Rx device) does not
    // conflict.
    expect(
      txStreamConflictsWithActiveRx({
        activeSourceId: "rtl-sdr-1",
        txSource: hackrf,
      }),
    ).toBe(false);
    // Full-duplex sources never conflict.
    expect(
      txStreamConflictsWithActiveRx({
        activeSourceId: "mock-tx",
        txSource: {
          id: "mock-tx",
          duplex_mode: "full_duplex",
        },
      }),
    ).toBe(false);
  });
});

describe("signal_display_settings device-scoped hydration", () => {
  it("hydrates device settings but never local viewer state", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
        channels: [],
      },
      spectrum: {
        sampleRateHz: 2_400_000,
        fftSize: 1024,
        fftFrameRate: 30,
        gain: 10,
        hackrfLnaGain: 0,
        hackrfVgaGain: 30,
        hackrfAmpEnabled: false,
        hackrfBasebandBandwidth: 3_200_000,
        ppm: 1,
        tunerAGC: false,
        rtlAGC: false,
        // Local viewer state that must survive hydration untouched.
        fftWindow: "Rectangular",
        displayTemporalResolution: "reduced",
        removeDcSpike: true,
        powerScale: "dB",
        displayMode: "fft",
        vizPanOffset: -1_000_000,
        vizZoom: 2,
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "signal_display_settings",
      source_id: "mock-apt",
      sample_rate: 5_200_000,
      fft_size: 4096,
      frame_rate: 12,
      fft_window: "Hann",
      gain: 24,
      hackrf_lna_gain: 8,
      hackrf_vga_gain: 20,
      hackrf_amp_enable: true,
      tuner_bandwidth: 5_200_000,
      ppm: 3,
      tuner_agc: true,
      rtl_agc: false,
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSdrSettingsBundle",
        payload: {
          sampleRateHz: 5_200_000,
          fftSize: 4096,
          fftFrameRate: 12,
          gain: 24,
          hackrfLnaGain: 8,
          hackrfVgaGain: 20,
          hackrfAmpEnabled: true,
          hackrfBasebandBandwidth: 5_200_000,
          ppm: 3,
          tunerAGC: true,
        },
      }),
    );
    // The local viewer fields must not be included in the bundle.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSdrSettingsBundle",
        payload: expect.objectContaining({
          fftWindow: expect.anything(),
          displayTemporalResolution: expect.anything(),
          removeDcSpike: expect.anything(),
          powerScale: expect.anything(),
          displayMode: expect.anything(),
          vizPanOffset: expect.anything(),
          vizZoom: expect.anything(),
        }),
      }),
    );
  });

  it("does not dispatch when a broadcast carries no changed device settings", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
        channels: [],
      },
      spectrum: {
        sampleRateHz: 5_200_000,
        fftSize: 4096,
        fftFrameRate: 12,
        gain: 24,
        ppm: 3,
        tunerAGC: true,
        rtlAGC: false,
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "signal_display_settings",
      source_id: "mock-apt",
      sample_rate: 5_200_000,
      fft_size: 4096,
      frame_rate: 12,
      gain: 24,
      ppm: 3,
      tuner_agc: true,
      rtl_agc: false,
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "spectrum/setDeviceSdrSettingsBundle" }),
    );
  });
});

const decodeIqFrameEnvelope = (
  websocketMiddlewareExports as typeof websocketMiddlewareExports & {
    decodeIqFrameEnvelope?: (
      buffer: ArrayBuffer,
      fallbackSourceId: string,
    ) => {
      metadata: Record<string, unknown>;
      encryptedPayload: Uint8Array;
    };
  }
).decodeIqFrameEnvelope;

const buildV2IqEnvelope = () => {
  const sourceId = new TextEncoder().encode("rtl-sdr-v4");
  const headerLength = 56 + sourceId.length;
  const bytes = new Uint8Array(headerLength + 3);
  bytes.set(new TextEncoder().encode("NAPT"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint8(4, 2);
  view.setUint8(5, 0);
  view.setUint16(6, headerLength, true);
  view.setUint16(8, sourceId.length, true);
  view.setUint8(10, 0);
  view.setBigUint64(16, 7n, true);
  view.setBigUint64(24, 11n, true);
  view.setBigUint64(32, 1234n, true);
  view.setBigUint64(40, 137_100_000n, true);
  view.setUint32(48, 1, true);
  view.setUint32(52, 2_400_000, true);
  bytes.set(sourceId, 56);
  bytes.set([9, 8, 7], headerLength);
  return bytes.buffer;
};

describe("Tx preview source state", () => {
  it("marks a manager Tx frame as live transmitting data while Tx is active", () => {
    const iqData = new Uint8Array([128, 129, 127, 130]);
    const frame = {
      type: "spectrum" as const,
      data_type: "iq_raw" as const,
      source_id: "mock-tx",
      protocol_version: 2 as const,
      stream_epoch: 3,
      sequence: 9,
      iq_data: iqData,
    };

    const normalized = normalizeManagedStreamFrame({
      frame,
      mode: "tx",
      sourceStatus: "transmitting",
    });

    expect(normalized).toMatchObject({
      frame_status: "transmitting",
      is_tx_preview: false,
      is_mock_tx_preview: false,
    });
    expect(normalized.iq_data).toBe(iqData);
  });

  it("marks a manager Tx frame as a standby preview while Tx is idle", () => {
    const iqData = new Uint8Array([128, 129, 127, 130]);
    const frame = {
      type: "spectrum" as const,
      data_type: "iq_raw" as const,
      source_id: "mock-tx",
      protocol_version: 2 as const,
      stream_epoch: 3,
      sequence: 8,
      frame_status: "standby" as const,
      iq_data: iqData,
    };

    const normalized = normalizeManagedStreamFrame({
      frame,
      mode: "tx",
      sourceStatus: "standby",
    });

    expect(normalized).toMatchObject({
      frame_status: "standby",
      is_tx_preview: true,
      is_mock_tx_preview: true,
    });
    expect(normalized.iq_data).toBe(iqData);
  });

  it("records the first accepted stream frame as source readiness", () => {
    jest.useFakeTimers();
    try {
      const readinessStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }),
      });
      readinessStore.dispatch(
        updateDeviceState({
          activeSourceId: "rtl-sdr-v4",
          sources: [
            {
              id: "rtl-sdr-v4",
              name: "RTL-SDR v4",
              kind: "rtl_sdr",
              capability: "rx",
              status: "receiving",
              loading_attempt: 0,
              loading_attempt_max: 0,
              supports_approx_dbm: false,
              sdr: {
                max_sample_rate: 2_400_000,
                sample_rate_options: [2_400_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 2_400_000,
                  center_frequency: 137_100_000,
                },
              },
            },
          ],
          sourceStatuses: { "rtl-sdr-v4": "receiving" },
          isPaused: false,
        }),
      );

      const frame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "rtl-sdr-v4",
        stream_epoch: 4,
        sequence: 11,
        center_frequency_hz: 137_100_000,
        sample_rate: 2_400_000,
        iq_data: new Uint8Array([128, 129, 127, 130]),
      };
      __testQueueLiveDataForMiddleware(
        frame,
        readinessStore.dispatch as any,
        readinessStore.getState as any,
      );

      jest.runOnlyPendingTimers();

      expect(readinessStore.getState().websocket.sourceFrameReadiness).toEqual({
        sourceId: "rtl-sdr-v4",
        streamEpoch: 4,
        sequence: 11,
      });
      expect(
        readinessStore.getState().websocket.sourceFrameReadinessByMode.rx,
      ).toEqual({
        sourceId: "rtl-sdr-v4",
        streamEpoch: 4,
        sequence: 11,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("records a Tx frame in Tx readiness without making RX ready", () => {
    jest.useFakeTimers();
    try {
      const readinessStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }),
      });
      readinessStore.dispatch(
        updateDeviceState({
          activeSourceId: "mock-tx",
          sources: [
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status: "transmitting",
              loading_attempt: 0,
              loading_attempt_max: 0,
              supports_approx_dbm: true,
              sdr: {
                max_sample_rate: 2_400_000,
                sample_rate_options: [2_400_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 2_400_000,
                  center_frequency: 137_100_000,
                },
              },
            },
          ],
          sourceStatuses: { "mock-tx": "transmitting" },
          isPaused: false,
        }),
      );

      __testQueueLiveDataForMiddleware(
        {
          type: "spectrum",
          data_type: "iq_raw",
          source_id: "mock-tx",
          frame_status: "transmitting",
          stream_epoch: 7,
          sequence: 5,
          center_frequency_hz: 437_500_000,
          sample_rate: 2_400_000,
          iq_data: new Uint8Array([128, 129, 127, 130]),
        },
        readinessStore.dispatch as any,
        readinessStore.getState as any,
      );

      jest.runOnlyPendingTimers();

      expect(
        readinessStore.getState().websocket.sourceFrameReadinessByMode.tx,
      ).toEqual({
        sourceId: "mock-tx",
        streamEpoch: 7,
        sequence: 5,
      });
      expect(
        readinessStore.getState().websocket.sourceFrameReadiness,
      ).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns a standby source to receiving when its Tx binding is cleared", () => {
    const source = {
      id: "hackrf-1",
      capability: "tx_rx",
      status: "standby",
      duplex_mode: "half_duplex",
    } as any;

    expect(
      resolveOptimisticTransmitStatus({
        enabled: false,
        source,
        txBindingSourceId: null,
      }),
    ).toBe("receiving");
    expect(
      resolveOptimisticTransmitStatus({
        enabled: false,
        source,
        txBindingSourceId: source.id,
      }),
    ).toBe("standby");
  });

  it("keeps a transmitting source transmitting across an unrelated source switch", () => {
    const previousSources = [
      { id: "mock-tx", status: "transmitting" },
      { id: "rtl-sdr-v4", status: "connected" },
    ];
    const incomingSources = [
      { id: "mock-tx", status: "connected" },
      { id: "rtl-sdr-v4", status: "receiving" },
    ];

    expect(
      preserveTransmittingSourceStatuses(
        previousSources as any,
        incomingSources as any,
      ),
    ).toEqual([
      { id: "mock-tx", status: "transmitting" },
      { id: "rtl-sdr-v4", status: "receiving" },
    ]);
  });

  it("marks the bound source as paused Tx standby immediately", () => {
    const sources = [
      {
        id: "hackrf-1",
        name: "HackRF One",
        capability: "tx_rx",
        status: "streaming",
        paused: false,
      },
    ] as any;

    expect(applyOptimisticTxPreviewState(sources, "hackrf-1")).toEqual([
      expect.objectContaining({
        id: "hackrf-1",
        status: "standby",
        paused: true,
      }),
    ]);
  });

  it("restores the cached Rx frame for the source leaving Tx preview", () => {
    const rxFrame = {
      source_id: "hackrf-1",
      sequence: 12,
      waveform: new Float32Array([1, 2, 3]),
    } as any;

    expect(resolveRxFrameToRestore(rxFrame, "hackrf-1")).toBe(rxFrame);
    expect(resolveRxFrameToRestore(rxFrame, "rtl-sdr-1")).toBeNull();
  });

  it("recognizes a bound hardware source in Tx preview standby", () => {
    expect(
      isBoundTxPreviewStandby({
        activeSourceId: "hackrf-1",
        boundTxSourceId: "hackrf-1",
        sourceStatus: "standby",
      }),
    ).toBe(true);
    expect(
      isBoundTxPreviewStandby({
        activeSourceId: "hackrf-1",
        boundTxSourceId: "hackrf-1",
        sourceStatus: "streaming",
      }),
    ).toBe(false);
  });
});

// Mock WebSocket to prevent actual connections
global.WebSocket = jest.fn(() => ({
  readyState: WebSocket.CONNECTING,
  close: jest.fn(),
  send: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
  onopen: null,
  onclose: null,
  onerror: null,
  onmessage: null,
})) as any;
Object.assign(global.WebSocket, {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
});

describe("Redux WebSocket Migration", () => {
  it("does not fall back to Tx preview for a paused half-duplex Rx source", () => {
    expect(
      resolveTxPreviewSourceId({
        activeSourceId: "hackrf-1",
        sourceRouting: { bindings: { "tx-suite:tx": null } },
        sources: [
          {
            id: "hackrf-1",
            kind: "hackrf_one",
            capability: "tx_rx",
            duplex_mode: "half_duplex",
            status: "paused",
            paused: true,
          },
        ],
      }),
    ).toBeNull();
  });

  let store: ReturnType<typeof configureStore>;

  it("preserves the user frequency range when a source switch republishes channels", () => {
    const enteredRange = { min: 24_700_000, max: 29_900_000 };
    const backendDefaultRange = { min: 18_000, max: 4_390_000 };

    expect(
      resolveIncomingChannelsFrequencyRange(enteredRange, backendDefaultRange),
    ).toEqual(enteredRange);
    expect(
      resolveIncomingChannelsFrequencyRange(null, backendDefaultRange),
    ).toEqual(backendDefaultRange);
  });

  it("derives the channel label from the preserved range instead of a stale message label", () => {
    const channels = [
      { label: "A", min_hz: 0, max_hz: 10 },
      { label: "C", min_hz: 20, max_hz: 30 },
    ];

    expect(
      resolveIncomingChannelsActiveSignalArea({
        channels,
        currentRange: { min: 20, max: 30 },
        incomingActiveSignalArea: "A",
        currentActiveSignalArea: "C",
      }),
    ).toBe("C");
  });

  it("hydrates an authoritative channel selection into Redux for a new subscriber", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [
          {
            id: "mock-apt",
            sdr: {
              settings: {
                center_frequency: 20_000_000,
                sample_rate: 4_372_000,
              },
            },
          },
        ],
      },
      spectrum: {
        activeSignalArea: "A",
        frequencyRange: { min: 18_000, max: 4_390_000 },
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "channels",
      source_id: "mock-apt",
      channels: [
        {
          id: "a",
          label: "A",
          min_hz: 18_000,
          max_hz: 4_390_000,
          description: "APT A",
        },
        {
          id: "b",
          label: "B",
          min_hz: 24_100_000,
          max_hz: 30_370_000,
          description: "APT B",
        },
      ],
      active_signal_area: "B",
      frequency_range: { min: 24_100_000, max: 30_370_000 },
      sample_rate: 6_270_000,
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "spectrum/setDeviceSignalAreaAndRange",
      payload: {
        area: "B",
        range: { min: 24_100_000, max: 30_370_000 },
      },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "spectrum/setSdrSettingsBundle",
      payload: {
        sampleRateHz: 6_270_000,
        frequencyRange: { min: 24_100_000, max: 30_370_000 },
      },
    });
  });

  it("hydrates the shared mirror-axis choice for every subscriber", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: { activeSourceId: "mock-apt", sources: [] },
      spectrum: {
        activeSignalArea: "A",
        frequencyRange: { min: 0, max: 4_000_000 },
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "channels",
      source_id: "mock-apt",
      channels: [
        {
          id: "a",
          label: "A",
          min_hz: 0,
          max_hz: 4_000_000,
          description: "APT A",
        },
      ],
      frequency_range: { min: 0, max: 4_000_000 },
      mirror_spectrum_below_zero: true,
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "settings/setMirrorIqBasebandBelowZero",
      payload: true,
    });
  });

  it("does not overwrite the sample rate from a self-echoed channels message", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
      },
      spectrum: {
        activeSignalArea: "A",
        // The optimistic write from the sample-rate control is authoritative.
        sampleRateHz: 5_200_000,
        frequencyRange: { min: 18_000, max: 4_390_000 },
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "channels",
      source_id: "mock-apt",
      origin_id: CLIENT_ORIGIN_ID,
      channels: [
        {
          id: "a",
          label: "A",
          min_hz: 18_000,
          max_hz: 4_390_000,
          description: "APT A",
        },
      ],
      active_signal_area: "A",
      frequency_range: { min: 18_000, max: 4_390_000 },
      // A stale value replayed by the backend must not clobber the local rate.
      sample_rate: 4_372_000,
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setSdrSettingsBundle",
        payload: expect.objectContaining({ sampleRateHz: 4_372_000 }),
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "websocket/updateDeviceState",
        payload: expect.objectContaining({ sampleRateHz: 4_372_000 }),
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSignalAreaAndRange",
      }),
    );
  });

  it("preserves a local 5 MHz window when a same-channel refresh carries the channel range", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
      },
      spectrum: {
        activeSignalArea: "B",
        sampleRateHz: 5_000_000,
        frequencyRange: { min: 26_000_000, max: 31_000_000 },
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "channels",
      source_id: "mock-apt",
      active_signal_area: "B",
      channels: [
        {
          id: "a",
          label: "A",
          min_hz: 18_000,
          max_hz: 4_390_000,
          description: "APT A",
        },
        {
          id: "b",
          label: "B",
          min_hz: 24_100_000,
          max_hz: 30_370_000,
          description: "APT B",
        },
      ],
      frequency_range: { min: 24_100_000, max: 30_370_000 },
      sample_rate: 5_000_000,
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSignalAreaAndRange",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "websocket/updateDeviceState",
        payload: expect.objectContaining({
          channels: expect.any(Array),
        }),
      }),
    );
  });

  it("still applies the sample rate from a foreign subscriber's channels message", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
      },
      spectrum: {
        activeSignalArea: "A",
        sampleRateHz: 5_200_000,
        frequencyRange: { min: 18_000, max: 4_390_000 },
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "channels",
      source_id: "mock-apt",
      origin_id: "another-browser-client",
      channels: [
        {
          id: "a",
          label: "A",
          min_hz: 18_000,
          max_hz: 4_390_000,
          description: "APT A",
        },
      ],
      active_signal_area: "A",
      frequency_range: { min: 18_000, max: 4_390_000 },
      sample_rate: 6_270_000,
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setSdrSettingsBundle",
        payload: expect.objectContaining({ sampleRateHz: 6_270_000 }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "websocket/updateDeviceState",
        payload: expect.objectContaining({ sampleRateHz: 6_270_000 }),
      }),
    );
  });

  it("does not re-dispatch an identical stream-options sample-rate echo", () => {
    const dispatch = jest.fn();
    const options = {
      mode: "rx" as const,
      centerFrequencyHz: 138_000_000,
      sampleRateHz: 5_200_000,
      fftSize: 2048,
    };
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
        channels: [],
      },
      spectrum: {
        sampleRateHz: 5_200_000,
        frequencyRange: { min: 135_400_000, max: 140_600_000 },
      },
      settings: { mirrorIqBasebandBelowZero: false },
    };

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 3,
        optionsRevision: 2,
        origin: "backend",
        options,
      },
      dispatch,
      () => state,
    );

    // The device snapshot still syncs...
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "websocket/updateDeviceState" }),
    );
    // ...but the identical spectrum rate/range must not rewrite the bundle.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "spectrum/setDeviceSdrSettingsBundle" }),
    );
  });

  it("still hydrates the spectrum bundle when a stream-options echo changes the rate", () => {
    const dispatch = jest.fn();
    const options = {
      mode: "rx" as const,
      centerFrequencyHz: 138_000_000,
      sampleRateHz: 6_270_000,
      fftSize: 2048,
    };
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
        channels: [],
      },
      spectrum: {
        sampleRateHz: 5_200_000,
        frequencyRange: { min: 135_400_000, max: 140_600_000 },
      },
      settings: { mirrorIqBasebandBelowZero: false },
    };

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 3,
        optionsRevision: 2,
        origin: "backend",
        options,
      },
      dispatch,
      () => state,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSdrSettingsBundle",
        payload: expect.objectContaining({ sampleRateHz: 6_270_000 }),
      }),
    );
  });

  it("hydrates the spectrum bundle when a stream-options echo changes only the FFT size", () => {
    const dispatch = jest.fn();
    const options = {
      mode: "rx" as const,
      centerFrequencyHz: 138_000_000,
      sampleRateHz: 5_200_000,
      fftSize: 4096,
    };
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
        channels: [],
      },
      spectrum: {
        sampleRateHz: 5_200_000,
        fftSize: 2048,
        frequencyRange: { min: 135_400_000, max: 140_600_000 },
      },
      settings: { mirrorIqBasebandBelowZero: false },
    };

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 3,
        optionsRevision: 2,
        origin: "backend",
        options,
      },
      dispatch,
      () => state,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spectrum/setDeviceSdrSettingsBundle",
        payload: expect.objectContaining({ fftSize: 4096 }),
      }),
    );
  });

  it("does not hydrate an identical spectrum bundle when only the FFT size is unchanged", () => {
    const dispatch = jest.fn();
    const options = {
      mode: "rx" as const,
      centerFrequencyHz: 138_000_000,
      sampleRateHz: 5_200_000,
      fftSize: 2048,
    };
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
        channels: [],
      },
      spectrum: {
        sampleRateHz: 5_200_000,
        fftSize: 2048,
        frequencyRange: { min: 135_400_000, max: 140_600_000 },
      },
      settings: { mirrorIqBasebandBelowZero: false },
    };

    handleManagedStreamEvent(
      "mock-apt",
      "rx",
      {
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 3,
        optionsRevision: 2,
        origin: "backend",
        options,
      },
      dispatch,
      () => state,
    );

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "spectrum/setDeviceSdrSettingsBundle" }),
    );
  });

  it("does not grow Redux dispatches under repeated self-echo/echo cycles", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        activeSourceId: "mock-apt",
        sources: [],
      },
      spectrum: {
        activeSignalArea: "A",
        sampleRateHz: 5_200_000,
        frequencyRange: { min: 18_000, max: 4_390_000 },
      },
    };

    // A pessimistic fuzz-like loop: the local client's own tune echoed back
    // repeatedly (as if the server re-broadcast on every subscribe), interleaved
    // with the stream-options echo of the same value. The rate must stay put
    // and the self-echo must not produce spectrum-write dispatches.
    for (let cycle = 0; cycle < 30; cycle += 1) {
      processWebSocketMessage(dispatch, () => state, {
        type: "channels",
        source_id: "mock-apt",
        origin_id: CLIENT_ORIGIN_ID,
        channels: [
          {
            id: "a",
            label: "A",
            min_hz: 18_000,
            max_hz: 4_390_000,
          },
        ],
        active_signal_area: "A",
        frequency_range: { min: 18_000, max: 4_390_000 },
        sample_rate: 5_200_000,
      });
    }

    const spectrumWrites = dispatch.mock.calls.filter(
      ([action]) =>
        action?.type === "spectrum/setSdrSettingsBundle" ||
        action?.type === "spectrum/setDeviceSdrSettingsBundle",
    );
    // The self-echoes may carry the authoritative selection once; they must not
    // each rewrite the bundle with the same value on every cycle.
    expect(spectrumWrites.length).toBeLessThanOrEqual(1);
    expect(
      dispatch.mock.calls.filter(
        ([action]) =>
          action?.type === "websocket/updateDeviceState" &&
          (action as any)?.payload?.sampleRateHz === 5_200_000,
      ).length,
    ).toBe(0);
  });

  it("does not hydrate subscriber-local viewport state from a device snapshot", () => {
    const dispatch = jest.fn();
    const state = {
      websocket: {
        isConnected: true,
        hasConnectedOnce: true,
        connectionStatus: "connected",
        isPaused: true,
        activeSourceId: "mock-apt",
        sources: [],
      },
      settings: { mirrorIqBasebandBelowZero: true },
      spectrum: {
        activeSignalArea: "A",
        frequencyRange: { min: 0, max: 4_000_000 },
        vizPanOffset: 0,
        vizZoom: 1,
      },
    };

    processWebSocketMessage(dispatch, () => state, {
      type: "channels",
      source_id: "mock-apt",
      channels: [
        {
          id: "a",
          label: "A",
          min_hz: 0,
          max_hz: 4_000_000,
          description: "APT A",
        },
      ],
      active_signal_area: "A",
      frequency_range: { min: 0, max: 4_000_000 },
      display_range: {
        min: -3_000_000,
        max: 1_000_000,
        pan_hz: -3_000_000,
        zoom: 1,
        crosses_dc: true,
        direction_negative: true,
        mirror_below_zero: true,
      },
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "spectrum/setVizPan" }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "spectrum/setDeviceSignalAreaAndRange" }),
    );
  });

  it("marks managed device option acknowledgements as remote range hydration", () => {
    const initialState = spectrumSlice(undefined, { type: "@@init" });
    const nextState = spectrumSlice(
      initialState,
      setDeviceSdrSettingsBundle({
        activeSignalArea: "C",
        sampleRateHz: 6_270_000,
        frequencyRange: { min: 24_100_000, max: 30_370_000 },
      }),
    );

    expect(nextState.deviceFrequencyRangeRevision).toBe(
      initialState.deviceFrequencyRangeRevision + 1,
    );
    expect(nextState.lastKnownRanges.C).toEqual({
      min: 24_100_000,
      max: 30_370_000,
    });
  });

  it("preserves a mirrored subscriber's absolute frequency across remote range hydration", () => {
    const updates = resolveManagedRxDeviceOptionUpdates({
      sourceId: "mock-apt",
      options: {
        mode: "rx",
        centerFrequencyHz: 4_000_000,
        sampleRateHz: 4_000_000,
        fftSize: 1024,
      },
      reanchorMirroredView: true,
      rootState: {
        websocket: {
          activeSourceId: null,
          sources: [
            {
              id: "mock-apt",
              sdr: { settings: {} },
            },
          ],
          channels: [],
        },
        spectrum: {
          frequencyRange: { min: 0, max: 4_000_000 },
          vizPanOffset: -4_000_000,
          activeSignalArea: "A",
        },
        settings: {
          mirrorIqBasebandBelowZero: true,
        },
      },
    });

    expect(updates.spectrum).toEqual(
      expect.objectContaining({
        frequencyRange: { min: 2_000_000, max: 6_000_000 },
        // Keep the local mirrored view on the negative side while adopting
        // the new device center: -4 MHz here is the mirrored presentation of
        // the other subscriber's +4 MHz absolute tune.
        vizPanOffset: -8_000_000,
      }),
    );
  });

  it("treats a live server-selected source as resumed", () => {
    expect(isSourceModePaused("live")).toBe(false);
    expect(isSourceModePaused("file")).toBe(true);
  });

  beforeEach(() => {
    jest.useRealTimers();
    const requestAnimationFrame = jest.fn((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    const cancelAnimationFrame = jest.fn((id: number) => {
      window.clearTimeout(id);
    });
    window.requestAnimationFrame = requestAnimationFrame as any;
    window.cancelAnimationFrame = cancelAnimationFrame as any;
    global.requestAnimationFrame = requestAnimationFrame as any;
    global.cancelAnimationFrame = cancelAnimationFrame as any;

    // Create a minimal store with websocket and spectrum slices
    store = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
          serializableCheck: false,
        }),
    });

    // Clear the live data ref
    liveDataRef.current = null;
    liveDataBySourceRef.current = {};
    resetPausedFrameRequestGate();
    resetWebSocketMiddlewareState();
  });

  it("applies a global source snapshot without dropping the requesting tab's retained source", () => {
    const source = (id: string, kind: string, capability: "mock" | "tx") => ({
      id,
      name: id,
      kind,
      capability,
      status: "streaming",
      loading_attempt: 0,
      loading_attempt_max: 2,
      supports_approx_dbm: true,
      iq_format: {
        element_type: "u8",
        layout: "interleaved_iq",
        typed_array: "Uint8Array",
      },
      stream_key: id,
      stream_key_kind: "source_id",
      sdr: {
        max_sample_rate: 2_400_000,
        sample_rate_options: [2_400_000],
        fft_display: { markers: [] },
        settings: {
          sample_rate: 2_400_000,
          center_frequency: 137_100_000,
        },
      },
    });
    const mockTx = source("mock-tx", "mock_tx", "tx");
    const mockApt = source("mock-apt", "mock_apt", "mock");
    const middlewareStore = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
        sourceSelection: sourceSelectionSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }),
    });

    middlewareStore.dispatch(
      updateDeviceState({
        activeSourceId: "mock-tx",
        activeSourceMode: "live",
        sources: [mockTx, mockApt] as any,
        sourceStatuses: { "mock-tx": "streaming", "mock-apt": "streaming" },
      }),
    );
    middlewareStore.dispatch(setSelectedSourceId("mock-tx"));
    middlewareStore.dispatch(setSelectionIntentSourceId("mock-tx"));

    processWebSocketMessage(middlewareStore.dispatch, middlewareStore.getState, {
      type: "source_info",
      active_source: "mock-apt",
      active_source_mode: "live",
      sources: [mockApt, mockTx],
    });

    expect(
      middlewareStore.getState().websocket.sources.map((candidate) => candidate.id),
    ).toEqual(["mock-apt", "mock-tx"]);
  });

  describe("Thunk payload shaping", () => {
    it("decodes both legacy v1 and source-scoped v2 I/Q envelopes", () => {
      const v1 = new Uint8Array(27);
      const v1View = new DataView(v1.buffer);
      v1View.setBigUint64(0, 1234n, true);
      v1View.setBigUint64(8, 137_100_000n, true);
      v1View.setUint32(16, 1, true);
      v1View.setUint32(20, 2_400_000, true);
      v1.set([9, 8, 7], 24);

      expect(decodeIqFrameEnvelope?.(v1.buffer, "rtl-sdr-v4")).toMatchObject({
        metadata: {
          protocol_version: 1,
          source_id: "rtl-sdr-v4",
          timestamp: 1234,
          center_frequency_hz: 137_100_000,
          data_type: 1,
          sample_rate: 2_400_000,
          frame_status: "receiving",
        },
        encryptedPayload: new Uint8Array([9, 8, 7]),
      });
      expect(
        decodeIqFrameEnvelope?.(buildV2IqEnvelope(), "ignored-source"),
      ).toMatchObject({
        metadata: {
          protocol_version: 2,
          source_id: "rtl-sdr-v4",
          stream_epoch: 7,
          sequence: 11,
          timestamp: 1234,
          center_frequency_hz: 137_100_000,
          data_type: 1,
          sample_rate: 2_400_000,
        },
        encryptedPayload: new Uint8Array([9, 8, 7]),
      });
    });

    it("rejects truncated or malformed v2 I/Q envelopes", () => {
      expect(() =>
        decodeIqFrameEnvelope?.(new ArrayBuffer(12), "rtl-sdr-v4"),
      ).toThrow(/I\/Q frame/i);

      const malformed = new Uint8Array(buildV2IqEnvelope());
      new DataView(malformed.buffer).setUint16(6, 51, true);
      expect(() =>
        decodeIqFrameEnvelope?.(malformed.buffer, "rtl-sdr-v4"),
      ).toThrow(/header/i);

      const zeroSampleRate = new Uint8Array(buildV2IqEnvelope());
      new DataView(zeroSampleRate.buffer).setUint32(52, 0, true);
      expect(() =>
        decodeIqFrameEnvelope?.(zeroSampleRate.buffer, "rtl-sdr-v4"),
      ).toThrow(/sample rate/i);

      const wrongDataType = new Uint8Array(buildV2IqEnvelope());
      new DataView(wrongDataType.buffer).setUint32(48, 99, true);
      expect(() =>
        decodeIqFrameEnvelope?.(wrongDataType.buffer, "rtl-sdr-v4"),
      ).toThrow(/data type/i);
    });

    it("accepts active Mock Tx monitor frames while the visualizer is paused", async () => {
      jest.useFakeTimers();
      try {
        const middlewareStore = configureStore({
          reducer: {
            websocket: websocketSlice,
            spectrum: spectrumSlice,
          },
          middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
              serializableCheck: false,
            }),
        });
        middlewareStore.dispatch({
          type: "websocket/updateDeviceState",
          payload: {
            isPaused: true,
            activeSourceId: "mock-tx",
            sources: [
              {
                id: "mock-tx",
                name: "Mock Tx SDR",
                kind: "mock_tx",
                capability: "tx",
                status: "transmitting",
                sdr: {
                  max_sample_rate: 2_400_000,
                  sample_rate_options: [2_400_000],
                  fft_display: { markers: [] },
                  settings: {
                    sample_rate: 2_400_000,
                    center_frequency: 137_100_000,
                  },
                },
              },
            ],
            sourceStatuses: { "mock-tx": "transmitting" },
          },
        });

        const frame = {
          type: "spectrum",
          data_type: "iq_raw",
          center_frequency_hz: 137_100_000,
          sample_rate: 2_400_000,
          iq_data: new Uint8Array([128, 128, 129, 127]),
        };
        __testQueueLiveDataForMiddleware(
          frame,
          middlewareStore.dispatch as any,
          middlewareStore.getState as any,
        );

        jest.advanceTimersByTime(16);

        expect(liveDataRef.current).toEqual([frame]);
        expect(middlewareStore.getState().websocket.dataFrameCounter).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not accept unsolicited Mock Tx standby frames", async () => {
      jest.useFakeTimers();
      try {
        const middlewareStore = configureStore({
          reducer: {
            websocket: websocketSlice,
            spectrum: spectrumSlice,
          },
          middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
              serializableCheck: false,
            }),
        });
        middlewareStore.dispatch({
          type: "websocket/updateDeviceState",
          payload: {
            isPaused: false,
            activeSourceId: "mock-tx",
            sources: [
              {
                id: "mock-tx",
                name: "Mock Tx SDR",
                kind: "mock_tx",
                capability: "tx",
                status: "standby",
                sdr: {
                  max_sample_rate: 2_400_000,
                  sample_rate_options: [2_400_000],
                  fft_display: { markers: [] },
                  settings: {
                    sample_rate: 2_400_000,
                    center_frequency: 137_100_000,
                  },
                },
              },
            ],
            sourceStatuses: { "mock-tx": "standby" },
          },
        });

        __testQueueLiveDataForMiddleware(
          {
            type: "spectrum",
            data_type: "iq_raw",
            center_frequency_hz: 137_100_000,
            sample_rate: 2_400_000,
            iq_data: new Uint8Array([128, 128, 129, 127]),
          },
          middlewareStore.dispatch as any,
          middlewareStore.getState as any,
        );

        jest.advanceTimersByTime(16);

        expect(liveDataRef.current).toBeNull();
        expect(middlewareStore.getState().websocket.dataFrameCounter).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it("accepts a tagged Mock Tx standby frame while status is catching up", () => {
      jest.useFakeTimers();
      try {
        const middlewareStore = configureStore({
          reducer: {
            websocket: websocketSlice,
            spectrum: spectrumSlice,
          },
          middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({ serializableCheck: false }),
        });
        middlewareStore.dispatch({
          type: "websocket/updateDeviceState",
          payload: {
            isPaused: false,
            activeSourceId: "mock-tx",
            sources: [
              {
                id: "mock-tx",
                name: "Mock Tx SDR",
                kind: "mock_tx",
                capability: "tx",
                status: "connected",
                sdr: {
                  max_sample_rate: 2_400_000,
                  sample_rate_options: [2_400_000],
                  fft_display: { markers: [] },
                  settings: {
                    sample_rate: 2_400_000,
                    center_frequency: 137_100_000,
                  },
                },
              },
            ],
            sourceStatuses: { "mock-tx": "connected" },
          },
        });

        __testQueueLiveDataForMiddleware(
          {
            type: "spectrum",
            frame_status: "standby",
            is_tx_preview: true,
            source_id: "mock-tx",
            center_frequency_hz: 137_100_000,
            sample_rate: 2_400_000,
            iq_data: new Uint8Array([128, 129, 127, 126]),
          },
          middlewareStore.dispatch as any,
          middlewareStore.getState as any,
        );
        jest.advanceTimersByTime(16);

        expect(liveDataRef.current).toMatchObject({
          source_id: "mock-tx",
          frame_status: "standby",
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it("routes a selected secondary Tx standby frame while Rx remains active", () => {
      jest.useFakeTimers();
      try {
        const middlewareStore = configureStore({
          reducer: {
            websocket: websocketSlice,
            spectrum: spectrumSlice,
            sourceRouting: sourceRoutingSlice,
            sourceSelection: sourceSelectionSlice,
          },
          middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({ serializableCheck: false }),
        });

        middlewareStore.dispatch(
          updateDeviceState({
            isPaused: false,
            activeSourceId: "mock-apt",
            sources: [
              {
                id: "mock-apt",
                name: "Mock APT SDR",
                kind: "mock_apt",
                capability: "rx",
                status: "receiving",
              } as any,
              {
                id: "mock-tx",
                name: "Mock Tx SDR",
                kind: "mock_tx",
                capability: "tx",
                status: "standby",
              } as any,
            ],
            sourceStatuses: {
              "mock-apt": "receiving",
              "mock-tx": "standby",
            },
          }),
        );
        middlewareStore.dispatch(setSelectedSourceId("mock-tx"));
        middlewareStore.dispatch(
          setSourceBinding({
            group: "tx-suite",
            role: "tx",
            sourceId: "mock-tx",
          }),
        );

        const frame = {
          type: "spectrum" as const,
          data_type: "iq_raw" as const,
          source_id: "mock-tx",
          frame_status: "standby" as const,
          is_tx_preview: true,
          stream_epoch: 4,
          sequence: 9,
          center_frequency_hz: 137_100_000,
          sample_rate: 2_400_000,
          iq_data: new Uint8Array([128, 129, 127, 126]),
        };
        __testQueueLiveDataForMiddleware(
          frame,
          middlewareStore.dispatch as any,
          middlewareStore.getState as any,
        );
        jest.advanceTimersByTime(16);

        expect(liveDataRef.current).toMatchObject({
          source_id: "mock-tx",
          frame_status: "standby",
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it("keeps the latest Mock Tx standby preview frame", async () => {
      jest.useFakeTimers();
      try {
        const middlewareStore = configureStore({
          reducer: {
            websocket: websocketSlice,
            spectrum: spectrumSlice,
          },
          middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
              serializableCheck: false,
            }).concat(websocketMiddleware),
        });
        const sent: string[] = [];
        (global.WebSocket as unknown as jest.Mock).mockImplementation(() => ({
          readyState: WebSocket.OPEN,
          close: jest.fn(),
          send: jest.fn((message: string) => sent.push(message)),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
        }));
        middlewareStore.dispatch({
          type: "websocket/connect",
          payload: {
            url: "ws://localhost/ws",
            aesKey: {} as CryptoKey,
            enabled: true,
          },
        });
        middlewareStore.dispatch({
          type: "websocket/updateDeviceState",
          payload: {
            isPaused: false,
            activeSourceId: "mock-tx",
            sources: [
              {
                id: "mock-tx",
                name: "Mock Tx SDR",
                kind: "mock_tx",
                capability: "tx",
                status: "standby",
                sdr: {
                  max_sample_rate: 2_400_000,
                  sample_rate_options: [2_400_000],
                  fft_display: { markers: [] },
                  settings: {
                    sample_rate: 2_400_000,
                    center_frequency: 137_100_000,
                  },
                },
              },
            ],
            sourceStatuses: { "mock-tx": "standby" },
          },
        });
        const firstFrame = {
          type: "spectrum",
          data_type: "iq_raw",
          frame_status: "standby",
          center_frequency_hz: 137_100_000,
          sample_rate: 2_400_000,
          iq_data: new Uint8Array([128, 128, 129, 127]),
        };
        const secondFrame = {
          ...firstFrame,
          iq_data: new Uint8Array([128, 128, 130, 126]),
        };
        __testQueueLiveDataForMiddleware(
          firstFrame,
          middlewareStore.dispatch as any,
          middlewareStore.getState as any,
        );
        jest.advanceTimersByTime(16);

        __testQueueLiveDataForMiddleware(
          secondFrame,
          middlewareStore.dispatch as any,
          middlewareStore.getState as any,
        );
        jest.advanceTimersByTime(16);

        expect(liveDataRef.current).toEqual(secondFrame);
        expect(middlewareStore.getState().websocket.dataFrameCounter).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it("subscribes an active Mock Tx through the multiplexed stream socket", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(() => {
        const socket = {
          readyState:
            sockets.length === 0 ? WebSocket.OPEN : WebSocket.CONNECTING,
          close: jest.fn(),
          send: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
        };
        sockets.push(socket);
        return socket;
      });

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });
      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0]?.onopen?.();
      middlewareStore.dispatch(
        updateDeviceState({
          activeSourceId: "mock-tx",
          sources: [
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status: "transmitting",
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "mock-tx",
            },
          ],
          sourceStatuses: { "mock-tx": "transmitting" },
        } as any),
      );

      expect(sockets.length).toBeGreaterThanOrEqual(2);
      const controlSocket = sockets[0];
      const sourceSocket = sockets[1];
      sourceSocket.readyState = WebSocket.OPEN;
      controlSocket.readyState = WebSocket.OPEN;
      sourceSocket.onopen?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(sourceSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream_subscribe"'),
      );
      expect(sourceSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"mode":"tx"'),
      );
      expect(controlSocket.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream_subscribe"'),
      );

      sourceSocket.send.mockClear();
      jest.useFakeTimers();
      try {
        middlewareStore.dispatch(
          setTxGeometry({
            centerFrequencyHz: 2_000_000,
            sampleRateHz: 1_000_000,
          }),
        );
        middlewareStore.dispatch(
          setTxGeometry({
            centerFrequencyHz: 2_100_000,
            sampleRateHz: 1_100_000,
          }),
        );
        middlewareStore.dispatch(
          setTxGeometry({
            centerFrequencyHz: 2_200_000,
            sampleRateHz: 1_200_000,
          }),
        );

        expect(sourceSocket.send).toHaveBeenCalled();
        expect(sourceSocket.send).toHaveBeenCalledWith(
          expect.stringContaining('"type":"stream_update_options"'),
        );
        expect(sourceSocket.send).toHaveBeenCalledWith(
          expect.stringContaining('"centerFrequencyHz":2000000'),
        );

        sourceSocket.send.mockClear();
        middlewareStore.dispatch(setTxSampleRateHz(1_300_000));
        expect(sourceSocket.send).toHaveBeenCalledWith(
          expect.stringContaining('"sampleRateHz":1300000'),
        );
        expect(sourceSocket.send).toHaveBeenCalledWith(
          expect.stringContaining('"bandwidthHz":1300000'),
        );
      } finally {
        jest.useRealTimers();
      }

      // Verify the preview frame requested on open enters liveDataRef even when isPaused is false
      const previewFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "mock-tx",
        frame_status: "transmitting",
        center_frequency_hz: 137_100_000,
        sample_rate: 2_400_000,
        iq_data: new Uint8Array([128, 128, 129, 127]),
      };
      jest.useFakeTimers();
      try {
        __testQueueLiveDataForMiddleware(
          previewFrame,
          middlewareStore.dispatch as any,
          middlewareStore.getState as any,
        );
        jest.advanceTimersByTime(16);
        expect(liveDataRef.current).toEqual([previewFrame]);
      } finally {
        jest.useRealTimers();
      }
    });

    it("delivers an encrypted RX stream frame into the live FFT frame path", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(() => {
        const socket = {
          readyState:
            sockets.length === 0 ? WebSocket.OPEN : WebSocket.CONNECTING,
          close: jest.fn(),
          send: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
        };
        sockets.push(socket);
        return socket;
      });

      const rawKey = new Uint8Array(32).fill(7);
      const aesKey = await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws",
          aesKey,
          enabled: true,
        },
      });
      sockets[0]?.onopen?.();
      middlewareStore.dispatch(
        updateDeviceState({
          activeSourceId: "mock-apt",
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "rx",
              status: "receiving",
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "mock-apt",
              sdr: {
                settings: {
                  center_frequency: 137_100_000,
                  sample_rate: 2_400_000,
                  fft_size: 1024,
                },
              },
            },
          ],
          sourceStatuses: { "mock-apt": "receiving" },
        } as any),
      );

      expect(sockets.length).toBeGreaterThanOrEqual(2);
      const sourceSocket = sockets[1];
      sourceSocket.readyState = WebSocket.OPEN;
      sourceSocket.onopen?.();
      await Promise.resolve();
      await Promise.resolve();

      const iv = new Uint8Array(12).fill(3);
      const plaintext = new Uint8Array([128, 128, 129, 127]);
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        plaintext,
      );
      const encryptedPayload = new Uint8Array(
        iv.length + ciphertext.byteLength,
      );
      encryptedPayload.set(iv);
      encryptedPayload.set(new Uint8Array(ciphertext), iv.length);

      sourceSocket.onmessage?.({
        data: JSON.stringify({
          type: "stream_frame",
          sourceId: "mock-apt",
          mode: "rx",
          streamEpoch: 1,
          optionsRevision: 1,
          sequence: 1,
          timestamp: 1234,
          centerFrequencyHz: 137_100_000,
          sampleRateHz: 2_400_000,
          iqData: bytesToBase64(encryptedPayload),
        }),
      });

      await waitFor(() => {
        expect(liveDataRef.current).toEqual([
          expect.objectContaining({
            source_id: "mock-apt",
            sequence: 1,
            iq_data: new Uint8Array([128, 128, 129, 127]),
          }),
        ]);
      });
    });

    it("clears stale live spectrum caches immediately when disconnecting", () => {
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      const cachedSpectrumFrame = {
        id: "cached-frame",
        label: "cached-frame",
        min_hz: 1,
        max_hz: 2,
        description: "cached spectrum frame",
      };
      const liveFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        center_frequency_hz: 137_100_000,
        sample_rate: 2_400_000,
        iq_data: new Uint8Array([128, 128, 129, 127]),
      };

      middlewareStore.dispatch(
        updateDeviceState({
          activeSourceId: "mock-tx",
          activeSourceMode: "live",
          backend: "mock_apt",
          deviceInfo: "Mock Tx SDR",
          deviceName: "Mock Tx SDR",
          deviceProfile: {
            kind: "mock_tx",
            is_rtl_sdr: false,
            supports_approx_dbm: true,
          },
          sources: [
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status: "streaming",
              loading_attempt: 0,
              loading_attempt_max: 0,
              supports_approx_dbm: true,
              sdr: {
                max_sample_rate: 2_400_000,
                sample_rate_options: [2_400_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 2_400_000,
                  center_frequency: 137_100_000,
                },
              },
            },
          ],
          sourceStatuses: { "mock-tx": "streaming" },
          channels: [cachedSpectrumFrame as any],
          maxSampleRateHz: 2_400_000,
          sampleRateOptions: [2_400_000],
          sampleRateHz: 2_400_000,
          sdrSettings: {
            sample_rate: 2_400_000,
            center_frequency: 137_100_000,
          } as any,
          sdrLimitMarkers: [],
        }),
      );
      middlewareStore.dispatch(setSpectrumFrames([cachedSpectrumFrame as any]));
      liveDataRef.current = [liveFrame as any];

      middlewareStore.dispatch({ type: "websocket/disconnect" });

      const websocketState = middlewareStore.getState().websocket;

      expect(liveDataRef.current).toBeNull();
      expect(websocketState.spectrumFrames).toEqual([]);
      expect(websocketState.dataFrameCounter).toBe(0);
      expect(websocketState.channels).toEqual([]);
      expect(websocketState.sampleRateHz).toBeNull();
      expect(websocketState.sdrSettings).toBeNull();
      expect(websocketState.sources).toEqual([]);
      expect(websocketState.sourceStatuses).toEqual({});
      expect(websocketState.activeSourceId).toBeNull();
      expect(websocketState.backend).toBeNull();
      expect(websocketState.queuedMessages).toEqual([]);
    });

    it("clears cached spectrum frames when the active source changes to a stale placeholder", () => {
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      const cachedSpectrumFrame = {
        id: "cached-frame",
        label: "cached-frame",
        min_hz: 1,
        max_hz: 2,
        description: "cached spectrum frame",
      };

      middlewareStore.dispatch(
        updateDeviceState({
          activeSourceId: "mock-apt",
          activeSourceMode: "live",
          deviceState: "connected",
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "mock",
              status: "connected",
              loading_attempt: 0,
              loading_attempt_max: 0,
              supports_approx_dbm: true,
              sdr: {
                max_sample_rate: 2_400_000,
                sample_rate_options: [2_400_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 2_400_000,
                  center_frequency: 137_100_000,
                },
              },
            },
          ],
          sourceStatuses: { "mock-apt": "connected" },
          channels: [cachedSpectrumFrame as any],
          maxSampleRateHz: 2_400_000,
          sampleRateOptions: [2_400_000],
          sampleRateHz: 2_400_000,
          sdrSettings: {
            sample_rate: 2_400_000,
            center_frequency: 137_100_000,
          } as any,
          sdrLimitMarkers: [],
        }),
      );
      middlewareStore.dispatch(setSpectrumFrames([cachedSpectrumFrame as any]));
      liveDataRef.current = [cachedSpectrumFrame as any];

      middlewareStore.dispatch(
        updateDeviceState({
          activeSourceId: "hackrf-one",
          activeSourceMode: "live",
          deviceState: "stale",
          deviceLoadingReason: null,
          sources: [
            {
              id: "hackrf-one",
              name: "HackRF One",
              kind: "hackrf_one",
              capability: "tx_rx",
              status: "stale",
              loading_attempt: 0,
              loading_attempt_max: 0,
              supports_approx_dbm: true,
              sdr: {
                max_sample_rate: 20_000_000,
                sample_rate_options: [2_400_000, 10_000_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 2_400_000,
                  center_frequency: 137_100_000,
                },
              },
            },
          ],
          sourceStatuses: { "hackrf-one": "stale" },
          channels: [],
          maxSampleRateHz: 20_000_000,
          sampleRateOptions: [2_400_000, 10_000_000],
          sampleRateHz: 2_400_000,
          sdrSettings: {
            sample_rate: 2_400_000,
            center_frequency: 137_100_000,
          } as any,
          sdrLimitMarkers: [],
        }),
      );

      const websocketState = middlewareStore.getState().websocket;

      expect(liveDataRef.current).toBeNull();
      expect(websocketState.spectrumFrames).toEqual([]);
    });

    it("opens the multiplexed stream WebSocket after source_info activates a raw-IQ source", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "mock-apt",
          active_source_mode: "live",
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "mock",
              status: "streaming",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: true,
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "mock-apt",
              stream_key_kind: "source_id",
              serial_number: "mock-apt",
              manufacturer: "N-APT",
              product: "Mock APT SDR",
              sdr: {
                max_sample_rate: 2_400_000,
                sample_rate_options: [2_400_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 2_400_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(sockets.map((socket) => socket.url)).toContain(
        "ws://localhost/ws/streams?token=session-token",
      );
    });

    it("reuses the multiplexed stream WebSocket when reconnect reuses control", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });
      middlewareStore.dispatch(
        updateDeviceState({
          isConnected: true,
          connectionStatus: "connected",
          activeSourceId: "rtl-sdr-00000001",
          sources: [
            {
              id: "rtl-sdr-00000001",
              name: "RTL-SDR v4",
              kind: "rtl-sdr",
              capability: "rx",
              status: "streaming",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: true,
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "00000001",
              stream_key_kind: "serial",
              serial_number: "00000001",
              manufacturer: "RTLSDRBlog",
              product: "RTL-SDR Blog V4",
              sdr: {
                max_sample_rate: 3_200_000,
                sample_rate_options: [3_200_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 3_200_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        } as any),
      );

      const payload = {
        url: "ws://localhost/ws?token=session-token",
        aesKey: {} as CryptoKey,
        enabled: true,
      };
      middlewareStore.dispatch({ type: "websocket/connect", payload });
      sockets[0].onopen?.();
      middlewareStore.dispatch({ type: "websocket/connect", payload });

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(sockets.map((socket) => socket.url)).toContain(
        "ws://localhost/ws/streams?token=session-token",
      );
    });

    it("opens the multiplexed stream WebSocket when control opens after source state", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });
      middlewareStore.dispatch(
        updateDeviceState({
          isConnected: true,
          connectionStatus: "connected",
          activeSourceId: "rtl-sdr-00000001",
          sources: [
            {
              id: "rtl-sdr-00000001",
              name: "RTL-SDR v4",
              kind: "rtl-sdr",
              capability: "rx",
              status: "streaming",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: true,
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "00000001",
              stream_key_kind: "serial",
              serial_number: "00000001",
              manufacturer: "RTLSDRBlog",
              product: "RTL-SDR Blog V4",
              sdr: {
                max_sample_rate: 3_200_000,
                sample_rate_options: [3_200_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 3_200_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        } as any),
      );

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(sockets.map((socket) => socket.url)).toContain(
        "ws://localhost/ws/streams?token=session-token",
      );
    });

    it("waits for the control socket to open before opening the multiplexed stream WebSocket", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.CONNECTING,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      middlewareStore.dispatch(
        updateDeviceState({
          isConnected: true,
          connectionStatus: "connected",
          activeSourceId: "rtl-sdr-00000001",
          sources: [
            {
              id: "rtl-sdr-00000001",
              name: "RTL-SDR v4",
              kind: "rtl-sdr",
              capability: "rx",
              status: "streaming",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: true,
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "00000001",
              stream_key_kind: "serial",
              serial_number: "00000001",
              manufacturer: "RTLSDRBlog",
              product: "RTL-SDR Blog V4",
              sdr: {
                max_sample_rate: 3_200_000,
                sample_rate_options: [3_200_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 3_200_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        } as any),
      );

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(sockets.map((socket) => socket.url)).toEqual([
        "ws://localhost/ws?token=session-token",
      ]);

      sockets[0].readyState = WebSocket.OPEN;
      sockets[0].onopen?.();

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(sockets.map((socket) => socket.url)).toContain(
        "ws://localhost/ws/streams?token=session-token",
      );
    });

    it("retargets the logical stream subscription when active source changes", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();

      middlewareStore.dispatch(
        updateDeviceState({
          activeSourceId: "rtl-sdr-00000001",
          sources: [
            {
              id: "rtl-sdr-00000001",
              name: "RTL-SDR v4",
              kind: "rtl-sdr",
              capability: "rx",
              status: "streaming",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: true,
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "00000001",
              stream_key_kind: "serial",
              serial_number: "00000001",
              manufacturer: "RTLSDRBlog",
              product: "RTL-SDR Blog V4",
              sdr: {
                max_sample_rate: 3_200_000,
                sample_rate_options: [3_200_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 3_200_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        } as any),
      );

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(sockets.map((socket) => socket.url)).toContain(
        "ws://localhost/ws/streams?token=session-token",
      );
    });

    it("clears only the shared frame while retaining each source's last frame", () => {
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });
      const pausedPreviousSourceFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "hackrf-one",
        frame_status: "paused",
        iq_data: new Uint8Array([127, 129, 128, 126]),
        sample_rate: 2_400_000,
        center_frequency_hz: 137_100_000,
      } as IqRawFrame;
      liveDataRef.current = pausedPreviousSourceFrame;
      sourceVisualizationRuntime.publish(pausedPreviousSourceFrame);
      liveDataBySourceRef.current["hackrf-one"] =
        sourceVisualizationRuntime.getSourceRef("hackrf-one");

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "select_source",
          data: { source_id: "rtl-sdr-v4" },
        },
      });

      expect(liveDataRef.current).toBeNull();
      expect(liveDataBySourceRef.current["hackrf-one"]?.current).toBe(
        pausedPreviousSourceFrame,
      );
      expect(
        sourceVisualizationRuntime.getSourceRef("hackrf-one").current,
      ).toBe(pausedPreviousSourceFrame);
      expect(middlewareStore.getState().websocket.spectrumFrames).toEqual([]);
    });

    it("preconnects a requested logical stream and restores active transport on failure", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );
      const source = (id: string, kind: string, status: string) => ({
        id,
        name: id,
        kind,
        capability: kind === "mock_tx" ? "tx" : "mock",
        status,
        loading_attempt: 0,
        loading_attempt_max: 2,
        supports_approx_dbm: true,
        iq_format: {
          element_type: "u8",
          layout: "interleaved_iq",
          typed_array: "Uint8Array",
        },
        stream_key: id,
        stream_key_kind: "source_id",
        sdr: {
          max_sample_rate: 2_400_000,
          sample_rate_options: [2_400_000],
          fft_display: { markers: [] },
          settings: {
            sample_rate: 2_400_000,
            center_frequency: 137_100_000,
          },
        },
      });
      const middlewareStore = configureStore({
        reducer: { websocket: websocketSlice, spectrum: spectrumSlice },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "mock-apt",
          active_source_mode: "live",
          sources: [
            source("mock-apt", "mock_apt", "streaming"),
            source("mock-tx", "mock_tx", "connected"),
          ],
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "select_source",
          data: { source_id: "mock-tx" },
        },
      });

      expect(sockets.map((socket) => socket.url)).toContain(
        "ws://localhost/ws/streams?token=session-token",
      );
      expect(middlewareStore.getState().websocket.activeSourceId).toBe(
        "mock-apt",
      );
      expect(
        middlewareStore.getState().websocket.sourceTransportByMode.tx,
      ).toEqual({
        sourceId: "mock-tx",
        phase: "warming",
        error: null,
      });

      sockets[sockets.length - 1].onopen?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        middlewareStore.getState().websocket.sourceTransportByMode.rx.phase,
      ).toBe("ready");

      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: "error",
          source_id: "mock-tx",
          code: "source_switch_failed",
          message: "Mock Tx failed to start",
        }),
      });

      expect(sockets[sockets.length - 1]?.url).toBe(
        "ws://localhost/ws/streams?token=session-token",
      );
      expect(
        middlewareStore.getState().websocket.sourceTransportByMode.tx,
      ).toEqual({
        sourceId: "mock-tx",
        phase: "failed",
        error: "Mock Tx failed to start",
      });
    });

    it("queues the requested Rx stream before the backend confirms the source switch", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const source = (id: string, kind: string, status: string) => ({
        id,
        name: id,
        kind,
        capability: kind === "mock_apt" ? "mock" : "rx",
        status,
        loading_attempt: 0,
        loading_attempt_max: 2,
        supports_approx_dbm: true,
        iq_format: {
          element_type: "u8",
          layout: "interleaved_iq",
          typed_array: "Uint8Array",
        },
        stream_key: id,
        stream_key_kind: "source_id",
        sdr: {
          max_sample_rate: 2_400_000,
          sample_rate_options: [2_400_000],
          fft_display: { markers: [] },
          settings: { sample_rate: 2_400_000, center_frequency: 1_000_000 },
        },
      });
      const middlewareStore = configureStore({
        reducer: { websocket: websocketSlice, spectrum: spectrumSlice },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      const control = sockets[0];
      const mock = source("mock-apt", "mock_apt", "streaming");
      const rtl = source("rtl-sdr-v4", "rtl-sdr", "connected");
      control.onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: mock.id,
          active_source_mode: "live",
          sources: [mock, rtl],
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const streamSocket = sockets[1];
      streamSocket.onopen?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      streamSocket.send.mockClear();

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "select_source",
          data: { source_id: rtl.id },
        },
      });

      expect(middlewareStore.getState().websocket.activeSourceId).toBe(mock.id);
      expect(streamSocket.send).toHaveBeenCalledWith(
        expect.stringContaining(`"sourceId":"${rtl.id}"`),
      );
    });

    it("connects hardware through loading to streaming, then falls back cleanly on disconnect", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );
      const source = (
        id: string,
        kind: string,
        status: string,
        streamKey: string,
        sampleRate: number,
      ) => ({
        id,
        name: id,
        kind,
        capability: kind.startsWith("mock") ? "mock" : "rx",
        status,
        loading_attempt: status === "loading" ? 1 : 0,
        loading_attempt_max: 2,
        supports_approx_dbm: true,
        iq_format: {
          element_type: "u8",
          layout: "interleaved_iq",
          typed_array: "Uint8Array",
        },
        stream_key: streamKey,
        stream_key_kind: "source_id",
        serial_number: streamKey,
        manufacturer: "test",
        product: id,
        sdr: {
          max_sample_rate: sampleRate,
          sample_rate_options: [sampleRate],
          fft_display: { markers: [] },
          settings: { sample_rate: sampleRate, center_frequency: 1_000_000 },
        },
      });
      const middlewareStore = configureStore({
        reducer: { websocket: websocketSlice, spectrum: spectrumSlice },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      const control = sockets[0];
      const mock = source(
        "mock-apt",
        "mock_apt",
        "streaming",
        "mock-apt",
        2_400_000,
      );
      const rtlLoading = source(
        "rtl-sdr-v4",
        "rtl-sdr",
        "loading",
        "rtl-v4",
        3_200_000,
      );
      control.onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "mock-apt",
          active_source_mode: "live",
          sources: [mock],
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const mockIqSocket = sockets[1];
      liveDataRef.current = [{ iq_data: new Uint8Array([1, 2]) } as any];

      control.onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "rtl-sdr-v4",
          active_source_mode: "live",
          sources: [rtlLoading, mock],
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(mockIqSocket.close).not.toHaveBeenCalled();
      expect(liveDataRef.current).toBeNull();
      expect(middlewareStore.getState().websocket.activeSourceId).toBe(
        "rtl-sdr-v4",
      );
      expect(sockets).toHaveLength(2);

      control.onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "rtl-sdr-v4",
          active_source_mode: "live",
          sources: [
            { ...rtlLoading, status: "streaming", loading_attempt: 0 },
            mock,
          ],
        }),
      });
      expect(
        middlewareStore.getState().websocket.sourceStatuses["rtl-sdr-v4"],
      ).toBe("streaming");
      expect(sockets).toHaveLength(2);
      expect(sockets[1].url).toBe(
        "ws://localhost/ws/streams?token=session-token",
      );

      control.onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "mock-apt",
          active_source_mode: "live",
          sources: [mock],
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 25));

      const fallbackState = middlewareStore.getState().websocket;
      expect(fallbackState.activeSourceId).toBe("mock-apt");
      expect(fallbackState.sourceStatuses["mock-apt"]).toBe("streaming");
      expect(fallbackState.sourceStatuses["rtl-sdr-v4"]).toBeUndefined();
      expect(fallbackState.error).toBeNull();
    });

    it("clears a failed unplugged-device switch and restores the confirmed fallback", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
          sourceSelection: sourceSelectionSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      const control = sockets[0];
      const mock = {
        id: "mock-apt",
        name: "Mock APT SDR",
        kind: "mock_apt",
        capability: "mock",
        status: "receiving",
      } as any;
      const rtl = {
        id: "rtl-sdr-00000001",
        name: "RTL-SDR v4",
        kind: "rtl_sdr",
        capability: "rx",
        status: "connected",
      } as any;

      middlewareStore.dispatch(
        updateDeviceState({
          activeSourceId: "mock-apt",
          sources: [mock, rtl],
          sourceStatuses: {
            "mock-apt": "receiving",
            [rtl.id]: "connected",
          },
        }),
      );

      middlewareStore.dispatch(setSelectedSourceId(rtl.id));
      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "select_source",
          data: { source_id: rtl.id },
        },
      });

      control.onmessage?.({
        data: JSON.stringify({
          type: "error",
          source_id: rtl.id,
          code: "source_switch_failed",
          message: `No matching source found for source_id=${rtl.id}`,
        }),
      });

      const state = middlewareStore.getState();
      expect(state.websocket.activeSourceId).toBe("mock-apt");
      expect(state.websocket.error).toBeNull();
      expect(state.sourceSelection.selectedSourceId).toBe("mock-apt");
      expect(state.sourceSelection.pendingSourceSwitchId).toBeNull();
    });

    it("keeps transmitting source_info status in Redux after reconnect", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "hackrf_one-hackrf-test-serial",
          active_source_mode: "live",
          sources: [
            {
              id: "hackrf_one-hackrf-test-serial",
              name: "HackRF One",
              kind: "hackrf_one",
              capability: "tx_rx",
              status: "transmitting",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: true,
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "hackrf-test-serial",
              stream_key_kind: "serial",
              serial_number: "hackrf-test-serial",
              manufacturer: "Great Scott Gadgets",
              product: "HackRF One",
              sdr: {
                max_sample_rate: 20_000_000,
                sample_rate_options: [5_200_000, 10_000_000, 20_000_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 5_200_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                  hackrf_lna_gain: 0,
                  hackrf_vga_gain: 16,
                  hackrf_amp_enable: false,
                  ppm: 0,
                  tuner_agc: false,
                  rtl_agc: false,
                  fft_size: 262144,
                  fft_window: "Rectangular",
                  frame_rate: 12,
                },
              },
            },
          ],
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 25));

      const state = middlewareStore.getState().websocket;
      expect(state.activeSourceId).toBe("hackrf_one-hackrf-test-serial");
      expect(state.deviceState).toBe("transmitting");
      expect(state.sources[0].status).toBe("transmitting");
      expect(state.sourceStatuses["hackrf_one-hackrf-test-serial"]).toBe(
        "transmitting",
      );
    });

    it("optimistically reflects transmit status sends before backend echo", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "mock-tx",
          active_source_mode: "live",
          sources: [
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status: "connected",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: false,
              stream_key: "mock-tx",
              stream_key_kind: "source_id",
              serial_number: "mock-tx",
              manufacturer: "N-APT",
              product: "Mock Tx SDR",
              sdr: {
                max_sample_rate: 20_000_000,
                sample_rate_options: [5_200_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 5_200_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 25));

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "status",
          data: {
            status: "transmitting",
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });

      expect(middlewareStore.getState().websocket.sources[0].status).toBe(
        "transmitting",
      );
      expect(middlewareStore.getState().websocket.deviceState).toBe(
        "transmitting",
      );

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "status",
          data: {
            status: "standby",
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });

      expect(middlewareStore.getState().websocket.sources[0].status).toBe(
        "standby",
      );
      expect(middlewareStore.getState().websocket.deviceState).toBe("standby");
    });

    it("applies backend source_info status changes when only source status changed", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      const sourceInfo = (status: "connected" | "transmitting") =>
        JSON.stringify({
          type: "source_info",
          active_source: "mock-tx",
          active_source_mode: "live",
          sources: [
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status,
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: false,
              stream_key: "mock-tx",
              stream_key_kind: "source_id",
              serial_number: "mock-tx",
              manufacturer: "N-APT",
              product: "Mock Tx SDR",
              sdr: {
                max_sample_rate: 20_000_000,
                sample_rate_options: [5_200_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 5_200_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: sourceInfo("connected") });
      await new Promise((resolve) => setTimeout(resolve, 25));
      sockets[0].onmessage?.({ data: sourceInfo("transmitting") });
      await waitFor(() => {
        expect(middlewareStore.getState().websocket.sources[0].status).toBe(
          "transmitting",
        );
        expect(middlewareStore.getState().websocket.deviceState).toBe(
          "transmitting",
        );
      });
    });

    it("reopens the multiplexed stream WebSocket after an unexpected close", async () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(
        (url: string) => {
          const socket = {
            url,
            readyState: WebSocket.OPEN,
            binaryType: "",
            close: jest.fn(),
            send: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            onopen: null as (() => void) | null,
            onclose: null as (() => void) | null,
            onerror: null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          sockets.push(socket);
          return socket;
        },
      );

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws?token=session-token",
          aesKey: {} as CryptoKey,
          enabled: true,
        },
      });
      sockets[0].onopen?.();
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: "source_info",
          active_source: "mock-apt",
          active_source_mode: "live",
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "mock",
              status: "streaming",
              loading_attempt: 0,
              loading_attempt_max: 2,
              supports_approx_dbm: true,
              iq_format: {
                element_type: "u8",
                layout: "interleaved_iq",
                typed_array: "Uint8Array",
              },
              stream_key: "mock-apt",
              stream_key_kind: "source_id",
              serial_number: "mock-apt",
              manufacturer: "N-APT",
              product: "Mock APT SDR",
              sdr: {
                max_sample_rate: 2_400_000,
                sample_rate_options: [2_400_000],
                fft_display: { markers: [] },
                settings: {
                  sample_rate: 2_400_000,
                  center_frequency: 137_100_000,
                  gain: 0,
                },
              },
            },
          ],
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      jest.useFakeTimers();
      sockets[1].onclose?.();
      jest.advanceTimersByTime(250);
      jest.useRealTimers();

      expect(
        sockets.filter(
          (socket) =>
            socket.url === "ws://localhost/ws/streams?token=session-token",
        ),
      ).toHaveLength(2);
    });

    it("pauses a switched-away live source but not a transmitting source", () => {
      expect(
        shouldPauseSourceOnSwitch({
          id: "mock-apt",
          status: "streaming",
        } as any),
      ).toBe(true);
      expect(
        shouldPauseSourceOnSwitch({
          id: "mock-tx",
          status: "transmitting",
        } as any),
      ).toBe(false);
    });

  it("does not send a global pause command for a subscriber pause", () => {
      const send = jest.fn();
      (global.WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        readyState: WebSocket.OPEN,
        close: jest.fn(),
        send,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      }));

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws",
          aesKey: null,
          enabled: true,
        },
      });

      middlewareStore.dispatch({
        type: "websocket/setPaused",
        payload: {
          isPaused: true,
          sourceId: "mock-apt",
          duplexMode: "half_duplex",
          activeMode: "rx",
        },
      });

      expect(send).not.toHaveBeenCalledWith(
        JSON.stringify({
          type: "pause",
          paused: true,
          source_id: "mock-apt",
          duplex_mode: "half_duplex",
        }),
      );
    });

    it("tracks pause commands as in flight until the middleware resets", () => {
      const send = jest.fn();
      (global.WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        readyState: WebSocket.OPEN,
        close: jest.fn(),
        send,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      }));

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws",
          aesKey: null,
          enabled: true,
        },
      });

      expect(websocketMiddlewareExports.isPauseCommandInFlight()).toBe(false);

      middlewareStore.dispatch({
        type: "websocket/setPaused",
        payload: {
          isPaused: true,
          sourceId: "mock-apt",
          duplexMode: "half_duplex",
          activeMode: "rx",
        },
      });

      // A just-issued pause is awaiting backend confirmation, so the store
      // must not release its manual-pause latch on the pre-echo snapshot.
      expect(websocketMiddlewareExports.isPauseCommandInFlight()).toBe(true);

      resetWebSocketMiddlewareState();
      expect(websocketMiddlewareExports.isPauseCommandInFlight()).toBe(false);
    });

    it("sends transmit status messages", () => {
      const send = jest.fn();
      (global.WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        readyState: WebSocket.OPEN,
        close: jest.fn(),
        send,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      }));

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws",
          aesKey: null,
          enabled: true,
        },
      });

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "status",
          data: {
            status: "transmitting",
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });

      expect(send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "status",
          status: "transmitting",
          txDevice: "Mock Tx SDR",
          serialNumber: "mock-tx",
        }),
      );
    });

    it("sendFrequencyRange emits integer-Hz tuning payloads", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: {},
          spectrum: {},
        }) as any;

      await (
        sendFrequencyRange({
          min: 929_130.434_782_601_9,
          max: 4_129_130.434_782_606_5,
        }) as any
      )(dispatch, getState, undefined);

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            scope: "device",
            origin_id: CLIENT_ORIGIN_ID,
            min_hz: 929_130,
            max_hz: 4_129_130,
            center_frequency: 2_529_130,
            bandwidth_center_frequency: undefined,
          },
        },
      });
    });

    it("stamps frequency-range commands with this browser's unique origin", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: {},
          spectrum: {},
        }) as any;

      await (
        sendFrequencyRange({ min: 196_000_000, max: 200_000_000 }) as any
      )(dispatch, getState, undefined);

      const command = dispatch.mock.calls.find(
        ([action]) => action?.type === "websocket/sendMessage",
      )?.[0];
      expect(command?.payload?.data?.origin_id).toBe(CLIENT_ORIGIN_ID);
      expect(CLIENT_ORIGIN_ID).not.toBe("n-apt-client");
    });

    it("sendFrequencyRange preserves channel-anchored wide sample ranges", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: {},
          spectrum: { activeSignalArea: "B" },
        }) as any;

      await (
        sendFrequencyRange({
          min: 18_000,
          max: 20_018_000,
        }) as any
      )(dispatch, getState, undefined);

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            scope: "device",
            origin_id: CLIENT_ORIGIN_ID,
            min_hz: 18_000,
            max_hz: 20_018_000,
            center_frequency: 10_018_000,
            signal_area: "B",
            bandwidth_center_frequency: undefined,
          },
        },
      });
    });

    it("sendFrequencyRange keeps mirrored display coordinates out of the device payload", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: {},
          spectrum: {},
        }) as any;

      await (
        sendFrequencyRange({
          min: -614_314,
          max: 614_315,
        }) as any
      )(dispatch, getState, undefined);

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            scope: "device",
            origin_id: CLIENT_ORIGIN_ID,
            min_hz: 0,
            max_hz: 1_228_629,
            center_frequency: 614_315,
            bandwidth_center_frequency: undefined,
          },
        },
      });
    });

    it("does not send subscriber-local viewport state with the device range", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          settings: { mirrorIqBasebandBelowZero: true },
          demod: {},
          spectrum: {
            frequencyRange: { min: 0, max: 4_000_000 },
            vizZoom: 1,
            vizPanOffset: -3_000_000,
          },
        }) as any;

      await (
        sendFrequencyRange({ min: 0, max: 4_000_000 }) as any
      )(dispatch, getState, undefined);

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            scope: "device",
            origin_id: CLIENT_ORIGIN_ID,
            min_hz: 0,
            max_hz: 4_000_000,
            center_frequency: 2_000_000,
            bandwidth_center_frequency: undefined,
          },
        },
      });
    });

    it("rounds fractional bandwidth center frequency before dispatch", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: { bandwidthCenterFreqHz: 2_204_499.5 },
          spectrum: {},
        }) as any;

      await (
        sendFrequencyRange({
          min: 2_204_000,
          max: 2_204_001,
        }) as any
      )(dispatch, getState, undefined);

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            scope: "device",
            origin_id: CLIENT_ORIGIN_ID,
            min_hz: 2_204_000,
            max_hz: 2_204_001,
            center_frequency: 2_204_001,
            bandwidth_center_frequency: 2_204_500,
          },
        },
      });
    });

    it("normalizes direct frequency range websocket payloads to integer Hz", () => {
      expect(
        normalizeFrequencyRangeMessageData("frequency_range", {
          min_hz: 2_204_000,
          max_hz: 2_204_001,
          center_frequency: 2_204_000.5,
          bandwidth_center_frequency: 2_204_499.5,
        }),
      ).toEqual({
        min_hz: 2_204_000,
        max_hz: 2_204_001,
        center_frequency: 2_204_001,
        bandwidth_center_frequency: 2_204_500,
      });
    });

    it("normalizes signed mirrored viewport coordinates without dropping direction flags", () => {
      expect(
        normalizeFrequencyRangeMessageData("frequency_range", {
          min_hz: 2_204_000.4,
          max_hz: 2_204_001.4,
          display_min_hz: -1_000_000.6,
          display_max_hz: 3_000_000.4,
          display_pan_hz: -3_000_000.5,
          display_zoom: 1.25,
          display_crosses_dc: true,
          display_direction_negative: true,
          mirror_spectrum_below_zero: true,
        }),
      ).toEqual({
        min_hz: 2_204_000,
        max_hz: 2_204_001,
        display_min_hz: -1_000_001,
        display_max_hz: 3_000_000,
        display_pan_hz: -3_000_000,
        display_zoom: 1.25,
        display_crosses_dc: true,
        display_direction_negative: true,
        mirror_spectrum_below_zero: true,
      });
    });

    it("suppresses duplicate frequency_range sends in quick succession", () => {
      const send = jest.fn();
      (global.WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        readyState: WebSocket.OPEN,
        close: jest.fn(),
        send,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      }));

      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/connect",
        payload: {
          url: "ws://localhost/ws",
          aesKey: null,
          enabled: true,
        },
      });

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            min_hz: 99_000_000,
            max_hz: 101_000_000,
            center_frequency: 100_000_000,
          },
        },
      });
      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            min_hz: 99_000_000,
            max_hz: 101_000_000,
            center_frequency: 100_000_000,
          },
        },
      });

      expect(send).toHaveBeenCalledTimes(1);
    });

    it("sendCenterFrequency derives min/max from sample rate", async () => {
      store.dispatch(
        updateDeviceState({
          sampleRateHz: 2_400_000,
        }),
      );

      const centerMHz = 101;
      await (store.dispatch as any)(sendCenterFrequency(centerMHz));

      const state = store.getState() as any;
      expect(state.websocket.sampleRateHz).toBe(2_400_000);
    });

    it("sendCenterFrequency includes explicit center_frequency", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: { sampleRateHz: 2_400_000 },
          spectrum: {},
        }) as any;

      await (sendCenterFrequency(101_000_000) as any)(
        dispatch,
        getState,
        undefined,
      );

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            scope: "device",
            min_hz: 99_800_000,
            max_hz: 102_200_000,
            center_frequency: 101_000_000,
          },
        },
      });
    });

    it("never sends a negative hardware lower bound near zero Hz", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: { sampleRateHz: 1_228_629 },
          spectrum: {},
        }) as any;

      await (sendCenterFrequency(0) as any)(dispatch, getState, undefined);

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            scope: "device",
            min_hz: 0,
            max_hz: 1_228_629,
            center_frequency: 614_315,
          },
        },
      });
    });

    it("converts mirrored negative display ranges before sending demod tune", async () => {
      const dispatch = jest.fn();
      const getState = () => ({ websocket: { isConnected: true } }) as any;

      await (tuneDemod({ min_hz: -614_314, max_hz: 614_315 }) as any)(
        dispatch,
        getState,
        undefined,
      );

      expect(dispatch).toHaveBeenCalledWith({
        type: "websocket/sendMessage",
        payload: {
          type: "demod_tune",
          min_freq: 0,
          max_freq: 1_228_629,
        },
      });
    });

    it("sendCaptureCommand clears previous capture status", async () => {
      // Set initial capture status
      store.dispatch(
        setCaptureStatus({
          jobId: "old-job",
          status: "done",
          message: "Previous capture",
          progress: 100,
        }),
      );

      expect((store.getState() as any).websocket.captureStatus).not.toBeNull();

      // Send new capture command
      await (store.dispatch as any)(
        sendCaptureCommand({
          jobId: "new-job",
          fragments: [{ minFreq: 100, maxFreq: 102 }],
          durationS: 5,
          durationMode: "timed" as const,
          fileType: ".napt",
          acquisitionMode: "stepwise",
          encrypted: true,
          fftSize: 2048,
          fftWindow: "hann",
        }),
      );

      // Verify capture status was cleared
      expect((store.getState() as any).websocket.captureStatus).toBeNull();
    });
  });

  describe("Live data ref isolation", () => {
    it("never promotes a previous-source frame into the active Mock Tx canvas", () => {
      jest.useFakeTimers();
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch(
        updateDeviceState({
          isPaused: false,
          activeSourceId: "mock-tx",
          sourceStatuses: {
            "mock-apt": "connected",
            "mock-tx": "transmitting",
          },
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "rx",
              status: "connected",
            },
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status: "transmitting",
            },
          ],
        } as any),
      );

      const staleAptFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "mock-apt",
        stream_epoch: 4,
        sequence: 9,
        iq_data: new Uint8Array([128, 128, 129, 127]),
        sample_rate: 4_372_000,
        center_frequency_hz: 137_100_000,
      } as IqRawFrame;

      __testQueueLiveDataForMiddleware(
        staleAptFrame,
        middlewareStore.dispatch as any,
        middlewareStore.getState as any,
      );
      jest.advanceTimersByTime(16);

      expect(liveDataBySourceRef.current["mock-apt"]?.current).toBe(
        staleAptFrame,
      );
      expect(liveDataRef.current).toBeNull();
      jest.useRealTimers();
    });

    it("presents selected Mock APT RX frames while Mock Tx owns global TX", () => {
      jest.useFakeTimers();
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
          sourceSelection: sourceSelectionSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch(
        updateDeviceState({
          isPaused: false,
          activeSourceId: "mock-tx",
          sourceStatuses: {
            "mock-apt": "connected",
            "mock-tx": "transmitting",
          },
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "rx",
              status: "connected",
              iq_format: { typed_array: "Uint8Array" },
            },
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status: "transmitting",
            },
          ],
        } as any),
      );
      middlewareStore.dispatch(setSelectedSourceId("mock-apt"));

      const selectedRxFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "mock-apt",
        protocol_version: 2,
        stream_epoch: 4,
        sequence: 9,
        iq_data: new Uint8Array([128, 129, 127, 126]),
        sample_rate: 4_372_000,
        center_frequency_hz: 2_204_000,
      } as IqRawFrame;

      __testQueueLiveDataForMiddleware(
        selectedRxFrame,
        middlewareStore.dispatch as any,
        middlewareStore.getState as any,
      );
      jest.advanceTimersByTime(16);

      expect(liveDataRef.current).toEqual([selectedRxFrame]);
      expect(
        middlewareStore.getState().websocket.sourceFrameReadinessByMode.rx,
      ).toEqual({ sourceId: "mock-apt", streamEpoch: 4, sequence: 9 });

      const nextSelectedRxFrame = {
        ...selectedRxFrame,
        sequence: 10,
        iq_data: new Uint8Array([127, 130, 126, 129]),
      } as IqRawFrame;
      __testQueueLiveDataForMiddleware(
        nextSelectedRxFrame,
        middlewareStore.dispatch as any,
        middlewareStore.getState as any,
      );
      jest.advanceTimersByTime(16);

      expect(liveDataRef.current).toEqual([nextSelectedRxFrame]);
      jest.useRealTimers();
    });

    it("does not clear selected RX frames when a foreign client changes global TX", () => {
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
          sourceSelection: sourceSelectionSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });
      const selectedAptFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "mock-apt",
        protocol_version: 2,
        stream_epoch: 4,
        sequence: 9,
        iq_data: new Uint8Array([128, 129, 127, 126]),
        sample_rate: 4_372_000,
        center_frequency_hz: 2_204_000,
      } as IqRawFrame;

      middlewareStore.dispatch(
        updateDeviceState({
          isPaused: false,
          activeSourceId: "mock-apt",
          deviceState: "connected",
          sourceStatuses: { "mock-apt": "connected", "mock-tx": "standby" },
          sources: [
            {
              id: "mock-apt",
              kind: "mock_apt",
              capability: "rx",
              status: "connected",
              iq_format: { typed_array: "Uint8Array" },
            },
            {
              id: "mock-tx",
              kind: "mock_tx",
              capability: "tx",
              status: "standby",
            },
          ],
        } as any),
      );
      middlewareStore.dispatch(setSelectedSourceId("mock-apt"));
      liveDataRef.current = [selectedAptFrame];

      middlewareStore.dispatch(
        updateDeviceState({
          isPaused: false,
          activeSourceId: "mock-tx",
          deviceState: "connected",
          sourceStatuses: { "mock-apt": "connected", "mock-tx": "transmitting" },
          sources: [
            {
              id: "mock-apt",
              kind: "mock_apt",
              capability: "rx",
              status: "connected",
              iq_format: { typed_array: "Uint8Array" },
            },
            {
              id: "mock-tx",
              kind: "mock_tx",
              capability: "tx",
              status: "transmitting",
            },
          ],
        } as any),
      );

      expect(liveDataRef.current).toEqual([selectedAptFrame]);
    });

    it("publishes a paused secondary-source preview revision without playing Rx", () => {
      jest.useFakeTimers();
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch(
        updateDeviceState({
          isPaused: true,
          activeSourceId: "mock-apt",
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "rx",
              status: "connected",
            },
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              kind: "mock_tx",
              capability: "tx",
              status: "connected",
            },
          ],
        } as any),
      );

      const previewFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "mock-tx",
        iq_data: new Uint8Array([128, 128, 129, 127]),
        sample_rate: 2_400_000,
        center_frequency_hz: 137_100_000,
      } as IqRawFrame;
      __testQueueLiveDataForMiddleware(
        previewFrame,
        middlewareStore.dispatch as any,
        middlewareStore.getState as any,
      );

      jest.advanceTimersByTime(16);

      expect(liveDataBySourceRef.current["mock-tx"]?.current).toBe(
        previewFrame,
      );
      expect(liveDataRef.current).toBeNull();
      expect(middlewareStore.getState().websocket.dataFrameCounter).toBe(0);
      jest.useRealTimers();
    });

    it("does not advance the active source's per-source ref while paused", () => {
      jest.useFakeTimers();
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({ serializableCheck: false }).concat(
            websocketMiddleware,
          ),
      });

      middlewareStore.dispatch(
        updateDeviceState({
          isPaused: true,
          activeSourceId: "mock-apt",
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              kind: "mock_apt",
              capability: "rx",
              status: "connected",
            },
          ],
        } as any),
      );

      const liveFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "mock-apt",
        iq_data: new Uint8Array([128, 128, 129, 127]),
        sample_rate: 2_400_000,
        center_frequency_hz: 100_000_000,
      } as IqRawFrame;
      __testQueueLiveDataForMiddleware(
        liveFrame,
        middlewareStore.dispatch as any,
        middlewareStore.getState as any,
      );

      jest.advanceTimersByTime(16);

      // The active Rx source is paused: no new frame may enter its per-source
      // ref (which the canvas pause-polling loop reads and re-renders), and the
      // shared live ref must stay frozen too.
      expect(
        liveDataBySourceRef.current["mock-apt"]?.current ?? null,
      ).toBeNull();
      expect(liveDataRef.current).toBeNull();
      jest.useRealTimers();
    });

    it("retains only the latest live IQ presentation frame", () => {
      const frames = Array.from({ length: 20 }, (_, index) => ({
        type: "spectrum",
        data_type: "iq_raw",
        iq_data: new Uint8Array(256 * 1024),
        sample_rate: 2_400_000,
        center_frequency_hz: 100_000_000,
        timestamp: index,
      })) as IqRawFrame[];

      const trimmed = trimLiveFrameQueue(frames);

      expect(trimmed).toHaveLength(1);
      expect(trimmed[0].timestamp).toBe(19);
    });

    it("retains every eligible IQ frame for demodulation despite visualizer trimming", () => {
      jest.useFakeTimers();
      for (let index = 0; index < 4; index += 1) {
        __testQueueLiveDataForMiddleware(
          {
            type: "spectrum",
            data_type: "iq_raw",
            source_id: "rtl-sdr-v4",
            iq_data: new Uint8Array([128, 128]),
            sample_rate: 3_200_000,
            center_frequency_hz: 93_300_000,
            sequence: index,
          },
          store.dispatch as any,
          store.getState as any,
        );
      }

      expect(demodFrameQueue.drain().map((frame) => frame.sequence)).toEqual([
        0, 1, 2, 3,
      ]);
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it("keeps the live stream buffered while retuning frequency range", () => {
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });
      const mockFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        iq_data: new Uint8Array([127, 129, 130, 126]),
        sample_rate: 2_400_000,
        center_frequency_hz: 100_000_000,
        timestamp: Date.now(),
      } as IqRawFrame;
      liveDataRef.current = mockFrame;

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: { min_freq: 99_000_000, max_freq: 101_000_000 },
        },
      });

      expect(liveDataRef.current).toBe(mockFrame);
    });

    it("derives the expected retune center from outbound frequency payloads", () => {
      expect(
        getFrequencyRequestCenterHz("frequency_range", {
          min_hz: 99,
          max_hz: 103,
          center_frequency: 101,
        }),
      ).toBe(101);
      expect(
        getFrequencyRequestCenterHz("frequency_range", {
          min_hz: 99,
          max_hz: 103,
        }),
      ).toBe(101);
      expect(getFrequencyRequestCenterHz("settings", {})).toBeNull();
    });

    it("liveDataRef is separate from Redux state", () => {
      // Verify the ref exists and is independent
      expect(liveDataRef).toBeDefined();
      expect(liveDataRef.current).toBeNull();

      // Simulate an IQ frame write
      const mockFrame: IqRawFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        iq_data: new Uint8Array([127, 129, 130, 126]),
        sample_rate: 2_400_000,
        center_frequency_hz: 100_000_000,
        timestamp: Date.now(),
      };

      liveDataRef.current = mockFrame;

      // Verify Redux state is unchanged
      const state = store.getState() as any;
      expect(state.websocket).not.toHaveProperty("data");
      expect(liveDataRef.current).toBe(mockFrame);
    });
  });

  describe("Paused frame batching", () => {
    it("collapses a paused batch to the latest frame", () => {
      const firstFrame = {
        data_type: "iq_raw",
        iq_data: new Uint8Array([1, 2]),
      } as IqRawFrame;
      const latestFrame = {
        data_type: "iq_raw",
        iq_data: new Uint8Array([3, 4]),
      } as IqRawFrame;

      expect(collapsePausedFrameBatch([firstFrame, latestFrame])).toBe(
        latestFrame,
      );
      expect(collapsePausedFrameBatch(firstFrame)).toBe(firstFrame);
    });

    it("only accepts one paused frame request until the gate resets", () => {
      expect(shouldAcceptPausedFrameRequest()).toBe(true);
      expect(shouldAcceptPausedFrameRequest()).toBe(false);
      resetPausedFrameRequestGate();
      expect(shouldAcceptPausedFrameRequest()).toBe(true);
    });

    it("reports no pause command in flight after a middleware state reset", () => {
      resetWebSocketMiddlewareState();
      expect(websocketMiddlewareExports.isPauseCommandInFlight()).toBe(false);
    });
  });

  describe("Status message deduplication", () => {
    it("identical status updates do not trigger Redux dispatch", () => {
      const initialStatus = {
        jobId: "test-job",
        status: "progress" as const,
        message: "Capturing...",
        progress: 50,
      };

      // First dispatch
      store.dispatch(setCaptureStatus(initialStatus));
      const state1 = store.getState() as any;
      expect(state1.websocket.captureStatus).toEqual(initialStatus);

      // Second dispatch with identical data
      store.dispatch(setCaptureStatus(initialStatus));
      const state2 = store.getState() as any;

      // State reference should be the same (no new object created)
      expect(state2.websocket.captureStatus).toEqual(initialStatus);
    });

    it("updateDeviceState deduplicates identical fields", () => {
      const deviceUpdate = {
        backend: "RTL-SDR",
        deviceName: "Generic RTL2832U",
        deviceState: "ready" as any,
      };

      // First update
      store.dispatch(updateDeviceState(deviceUpdate));
      const state1 = store.getState() as any;
      expect(state1.websocket.backend).toBe("RTL-SDR");

      // Second update with same data
      store.dispatch(updateDeviceState(deviceUpdate));
      const state2 = store.getState() as any;

      // Values should match
      expect(state2.websocket.backend).toBe("RTL-SDR");
      expect(state2.websocket.deviceName).toBe("Generic RTL2832U");
    });
  });

  describe("Redux slice behavior", () => {
    it("websocket slice initializes with correct defaults", () => {
      const state = (store.getState() as any).websocket;

      expect(state.isConnected).toBe(false);
      expect(state.connectionStatus).toBe("disconnected");
      expect(state.deviceState).toBeNull();
      expect(state.captureStatus).toBeNull();
      expect(state.spectrumFrames).toEqual([]);
      expect(state.queuedMessages).toEqual([]);
    });

    it("updateDeviceState merges partial updates", () => {
      store.dispatch(
        updateDeviceState({
          backend: "RTL-SDR",
          deviceState: "ready" as any,
        }),
      );

      let state = (store.getState() as any).websocket;
      expect(state.backend).toBe("RTL-SDR");
      expect(state.deviceState).toBe("ready");
      expect(state.deviceName).toBeNull(); // Unchanged

      store.dispatch(
        updateDeviceState({
          deviceName: "Generic RTL2832U",
        }),
      );

      state = (store.getState() as any).websocket;
      expect(state.backend).toBe("RTL-SDR"); // Preserved
      expect(state.deviceName).toBe("Generic RTL2832U"); // Updated
    });

    it("updateDeviceState carries limit markers from websocket status", () => {
      const markers = [
        { kind: "lower_limit", freq_hz: 100, label: "Low" },
        { kind: "upper_limit", freq_hz: 200, label: "High" },
      ];

      store.dispatch(
        updateDeviceState({
          sdrLimitMarkers: markers,
        }),
      );

      const state = (store.getState() as any).websocket;
      expect(state.sdrLimitMarkers).toEqual(markers);
    });
  });

  it("does not replay a cached RX range during managed reconnect hydration", () => {
    const sockets: any[] = [];
    (global.WebSocket as unknown as jest.Mock).mockImplementation(
      (url: string) => {
        const socket = {
          url,
          readyState: WebSocket.OPEN,
          close: jest.fn(),
          send: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
          onopen: null as (() => void) | null,
          onclose: null,
          onerror: null,
          onmessage: null,
        };
        sockets.push(socket);
        return socket;
      },
    );

    const middlewareStore = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }).concat(
          websocketMiddleware,
        ),
    });
    middlewareStore.dispatch(
      updateDeviceState({
        hasConnectedOnce: true,
        activeSourceId: "mock-apt",
        sourceStatuses: { "mock-apt": "streaming" },
        sources: [
          {
            id: "mock-apt",
            status: "streaming",
            capability: "mock",
            iq_format: {
              element_type: "u8",
              layout: "interleaved_iq",
              typed_array: "Uint8Array",
            },
            sdr: {
              settings: {
                sample_rate: 2_400_000,
                center_frequency: 8_100_000,
              },
            },
          },
        ],
      } as any),
    );
    middlewareStore.dispatch(
      setDeviceSdrSettingsBundle({
        frequencyRange: { min: 6_000_000, max: 8_400_000 },
        sampleRateHz: 2_400_000,
      } as any),
    );

    middlewareStore.dispatch({
      type: "websocket/connect",
      payload: {
        url: "ws://localhost/ws",
        aesKey: {} as CryptoKey,
        enabled: true,
      },
    });
    sockets[0].onopen?.();

    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"frequency_range"'),
    );
    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"settings"'),
    );
    expect(sockets.some((socket) => socket.url.endsWith("/ws/streams"))).toBe(
      true,
    );
  });

  describe("WebSocket disconnect handling", () => {
    it("soft disconnect keeps source inventory while marking the control plane down", () => {
      const store = configureStore({
        reducer: { websocket: websocketSlice },
        middleware: (gDM) =>
          gDM({ serializableCheck: false }).concat(websocketMiddleware),
      });

      store.dispatch(
        updateDeviceState({
          isConnected: true,
          connectionStatus: "connected",
          hasConnectedOnce: true,
          activeSourceId: "mock-apt",
          sources: [
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              capability: "mock",
              status: "receiving",
            } as any,
          ],
          sourceStatuses: { "mock-apt": "receiving" },
        }),
      );

      store.dispatch({ type: "websocket/softDisconnect" });

      const state = store.getState().websocket;
      expect(state.isConnected).toBe(false);
      expect(state.connectionStatus).toBe("disconnected");
      expect(state.hasConnectedOnce).toBe(true);
      expect(state.activeSourceId).toBe("mock-apt");
      expect(state.sources).toHaveLength(1);
    });

    it("does not queue Tx or preview frame requests while disconnected", () => {
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "status",
          data: {
            status: "transmitting",
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });
      middlewareStore.dispatch({
        type: "websocket/refreshStream",
        payload: { mode: "tx", options: {} },
      });

      expect(middlewareStore.getState().websocket.queuedMessages).toEqual([]);
    });

    it("clears device metadata when the socket disconnects", () => {
      const middlewareStore = configureStore({
        reducer: {
          websocket: websocketSlice,
          spectrum: spectrumSlice,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
          }).concat(websocketMiddleware),
      });

      middlewareStore.dispatch(
        updateDeviceState({
          backend: "hackrf-one",
          deviceInfo: "HackRF One",
          deviceName: "HackRF One",
          deviceState: "connected" as any,
        }),
      );

      middlewareStore.dispatch({ type: "websocket/disconnect" });

      const state = middlewareStore.getState() as any;
      expect(state.websocket.isConnected).toBe(false);
      expect(state.websocket.connectionStatus).toBe("disconnected");
      expect(state.websocket.backend).toBeNull();
      expect(state.websocket.deviceInfo).toBeNull();
      expect(state.websocket.deviceName).toBeNull();
      expect(state.websocket.deviceProfile).toBeNull();
    });
  });
});
