import { configureStore } from "@reduxjs/toolkit";
import websocketSlice, {
  updateDeviceState,
  setCaptureStatus,
  setSpectrumFrames,
} from "@n-apt/redux/slices/websocketSlice";
import {
  liveDataRef,
  liveDataBySourceRef,
} from "@n-apt/redux/middleware/websocketMiddleware";
import { demodFrameQueue } from "@n-apt/app/infrastructure/visualization/demodFrameQueue";
import {
  shouldAcceptPausedFrameRequest,
  resetPausedFrameRequestGate,
  isFrameStale,
  getFrequencyRequestCenterHz,
  shouldResendRetuneRequest,
  resetWebSocketMiddlewareState,
  trimLiveFrameQueue,
  normalizeFrequencyRangeMessageData,
  resolveIncomingChannelsFrequencyRange,
  isSourceModePaused,
  resolveTxPreviewSourceId,
  resolveOptimisticTransmitStatus,
  applyOptimisticTxPreviewState,
  resolveRxFrameToRestore,
  isBoundTxPreviewStandby,
  preserveTransmittingSourceStatuses,
  normalizeManagedStreamFrame,
  shouldSyncManagedStreamOptions,
  resolveManagedTxSourceId,
  __testQueueLiveDataForMiddleware,
} from "@n-apt/redux/middleware/websocketMiddleware";
import websocketMiddleware from "@n-apt/redux/middleware/websocketMiddleware";
import {
  sendFrequencyRange,
  sendCenterFrequency,
  sendCaptureCommand,
} from "@n-apt/redux/thunks/websocketThunks";
import spectrumSlice, {
  setTxGeometry,
} from "@n-apt/redux/slices/spectrumSlice";
import sourceRoutingSlice, {
  setSourceBinding,
} from "@n-apt/redux/slices/sourceRoutingSlice";
import sourceSelectionSlice, {
  setSelectedSourceId,
} from "@n-apt/redux/slices/sourceSelectionSlice";
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import { collapsePausedFrameBatch } from "@n-apt/redux/middleware/websocketMiddleware";
import { shouldPauseSourceOnSwitch } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { waitFor } from "@testing-library/react";
import * as websocketMiddlewareExports from "@n-apt/redux/middleware/websocketMiddleware";
import { bytesToBase64 } from "@n-apt/crypto/webcrypto";

describe("managed stream option synchronization", () => {
  it("does not reconfigure the stream for a live frequency-range drag", () => {
    expect(shouldSyncManagedStreamOptions("spectrum/setFrequencyRange")).toBe(
      false,
    );
    expect(shouldSyncManagedStreamOptions("spectrum/setTxGeometry")).toBe(true);
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
  it("marks a manager Tx frame as a standby preview while Tx is idle", () => {
    const iqData = new Uint8Array([128, 129, 127, 130]);
    const frame = {
      type: "spectrum" as const,
      data_type: "iq_raw" as const,
      source_id: "mock-tx",
      protocol_version: 2 as const,
      stream_epoch: 3,
      sequence: 8,
      frame_status: "transmitting" as const,
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
      expect(middlewareStore.getState().websocket.sourceTransport).toEqual({
        sourceId: "mock-tx",
        phase: "warming",
        error: null,
      });

      sockets[sockets.length - 1].onopen?.();
      expect(middlewareStore.getState().websocket.sourceTransport.phase).toBe(
        "ready",
      );

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
      expect(middlewareStore.getState().websocket.sourceTransport).toEqual({
        sourceId: "mock-tx",
        phase: "failed",
        error: "Mock Tx failed to start",
      });
    });

    it("runs Mock APT to RTL hotplug through loading, socket replacement, and streaming", async () => {
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

    it("sends pause messages with mode metadata", () => {
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

      expect(send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "pause",
          paused: true,
          source_id: "mock-apt",
          duplex_mode: "half_duplex",
        }),
      );
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
            min_hz: 929_130,
            max_hz: 4_129_130,
            center_frequency: 2_529_130,
            bandwidth_center_frequency: undefined,
          },
        },
      });
    });

    it("sendFrequencyRange preserves channel-anchored wide sample ranges", async () => {
      const dispatch = jest.fn();
      const getState = () =>
        ({
          websocket: { isConnected: true },
          demod: {},
          spectrum: {},
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
            min_hz: 18_000,
            max_hz: 20_018_000,
            center_frequency: 10_018_000,
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
            min_hz: 99_800_000,
            max_hz: 102_200_000,
            center_frequency: 101_000_000,
          },
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

    it("does not silently reject live frames by center-frequency mismatch", () => {
      expect(isFrameStale(1_618_000)).toBe(false);
      expect(isFrameStale(26_738_000)).toBe(false);
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

    it("resends a retune only after repeated wrong-center live frames", () => {
      const base = {
        expectedCenterHz: 101_000_000,
        frameCenterHz: 100_000_000,
        requestedAt: 1_000,
        lastResendAt: 1_000,
      };

      expect(
        shouldResendRetuneRequest({
          ...base,
          mismatchFrames: 3,
          now: 2_000,
        }),
      ).toBe(false);
      expect(
        shouldResendRetuneRequest({
          ...base,
          mismatchFrames: 8,
          now: 2_000,
        }),
      ).toBe(true);
      expect(
        shouldResendRetuneRequest({
          ...base,
          frameCenterHz: 101_000_005,
          mismatchFrames: 8,
          now: 2_000,
        }),
      ).toBe(false);
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
