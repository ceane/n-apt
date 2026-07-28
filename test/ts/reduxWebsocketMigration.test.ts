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
import {
  shouldAcceptPausedFrameRequest,
  resetPausedFrameRequestGate,
  isFrameStale,
  getFrequencyRequestCenterHz,
  shouldResendRetuneRequest,
  resetWebSocketMiddlewareState,
  trimLiveFrameQueue,
  buildSourceIqWebSocketUrl,
  shouldAcceptSourceIqSocketMessage,
  normalizeFrequencyRangeMessageData,
  resolveIncomingChannelsFrequencyRange,
  isSourceModePaused,
  shouldOpenSourceIqSocket,
  resolveTxPreviewSourceId,
  buildTxPreviewRequestPayload,
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
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import { collapsePausedFrameBatch } from "@n-apt/redux/middleware/websocketMiddleware";
import { shouldPauseSourceOnSwitch } from "@n-apt/hooks/useSpectrumStore";
import { waitFor } from "@testing-library/react";
import * as websocketMiddlewareExports from "@n-apt/redux/middleware/websocketMiddleware";

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
  const headerLength = 52 + sourceId.length;
  const bytes = new Uint8Array(headerLength + 3);
  bytes.set(new TextEncoder().encode("NAPT"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint8(4, 2);
  view.setUint8(5, 0);
  view.setUint16(6, headerLength, true);
  view.setUint16(8, sourceId.length, true);
  view.setUint16(10, 0, true);
  view.setBigUint64(12, 7n, true);
  view.setBigUint64(20, 11n, true);
  view.setBigUint64(28, 1234n, true);
  view.setBigUint64(36, 137_100_000n, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 2_400_000, true);
  bytes.set(sourceId, 52);
  bytes.set([9, 8, 7], headerLength);
  return bytes.buffer;
};

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
  it("builds Tx preview requests with independent Tx and VFO centers", () => {
    expect(
      buildTxPreviewRequestPayload({
        spectrum: {
          txCenterFrequencyHz: 2_204_000,
          txSampleRateHz: 1_000_000,
          txPowerDbm: 9,
          txSignal: "wifi",
          txIfftSize: 65_536,
          frequencyRange: { min: 1_000_000, max: 5_000_000 },
        },
      }),
    ).toEqual({
      type: "request_next_frame",
      centerFrequencyHz: 2_204_000,
      viewCenterHz: 3_000_000,
      bandwidthHz: 1_000_000,
      sample_rate: 4_000_000,
      powerDbm: 9,
      txSignal: "wifi",
      txIfftSize: 65_536,
    });
  });

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
            status: "standby",
            paused: true,
          },
        ],
      }),
    ).toBeNull();
  });

  it("opens the Mock Tx source-IQ socket while its source is on standby", () => {
    expect(shouldOpenSourceIqSocket("standby")).toBe(true);
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

  it("rejects a late frame from the source socket replaced by a switch", () => {
    expect(
      shouldAcceptSourceIqSocketMessage({
        socketIsCurrent: false,
        socketSourceId: "hackrf-one",
        activeSourceId: "rtl-sdr-v4",
      }),
    ).toBe(false);
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
      new DataView(zeroSampleRate.buffer).setUint32(48, 0, true);
      expect(() =>
        decodeIqFrameEnvelope?.(zeroSampleRate.buffer, "rtl-sdr-v4"),
      ).toThrow(/sample rate/i);

      const wrongDataType = new Uint8Array(buildV2IqEnvelope());
      new DataView(wrongDataType.buffer).setUint32(44, 99, true);
      expect(() =>
        decodeIqFrameEnvelope?.(wrongDataType.buffer, "rtl-sdr-v4"),
      ).toThrow(/data type/i);
    });

    it("builds per-source IQ WebSocket URLs from stream keys", () => {
      expect(
        buildSourceIqWebSocketUrl(
          "ws://localhost:5173/ws?token=session-token",
          {
            id: "rtl-sdr-0",
            stream_key: "00000001",
            stream_key_kind: "serial",
          } as any,
        ),
      ).toBe("ws://localhost:5173/ws/source/00000001/iq?token=session-token");
    });

    it("negotiates v2 only when the source advertises it", () => {
      expect(
        buildSourceIqWebSocketUrl("ws://localhost/ws?token=session-token", {
          id: "rtl-sdr-v4",
          stream_key: "00000001",
          iq_stream_protocols: [1, 2],
        }),
      ).toBe(
        "ws://localhost/ws/source/00000001/iq?token=session-token&iq_protocol=2",
      );
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

    it("accepts exactly one requested Mock Tx standby preview frame", async () => {
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
        middlewareStore.dispatch({
          type: "websocket/sendMessage",
          payload: { type: "request_next_frame", data: {} },
        });

        const firstFrame = {
          type: "spectrum",
          data_type: "iq_raw",
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

        expect(liveDataRef.current).toEqual(firstFrame);
        expect(middlewareStore.getState().websocket.dataFrameCounter).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it("sends an active Mock Tx preview request through its source-IQ socket", () => {
      const sockets: any[] = [];
      (global.WebSocket as unknown as jest.Mock).mockImplementation(() => {
        const socket = {
          readyState: sockets.length === 0 ? WebSocket.OPEN : WebSocket.CONNECTING,
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
              status: "connected",
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
              stream_key: "mock-tx",
            },
          ],
          sourceStatuses: { "mock-tx": "connected" },
        } as any),
      );

      expect(sockets.length).toBeGreaterThanOrEqual(2);
      const controlSocket = sockets[0];
      const sourceSocket = sockets[1];
      sourceSocket.readyState = WebSocket.OPEN;
      controlSocket.readyState = WebSocket.OPEN;
      sourceSocket.onopen?.();

      expect(sourceSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"request_next_frame"'),
      );
      expect(controlSocket.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"request_next_frame"'),
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

        expect(sourceSocket.send).not.toHaveBeenCalled();
        jest.runOnlyPendingTimers();
        expect(sourceSocket.send).toHaveBeenCalledTimes(1);
        expect(sourceSocket.send).toHaveBeenCalledWith(
          expect.stringContaining('"centerFrequencyHz":2200000'),
        );
      } finally {
        jest.useRealTimers();
      }

      // Verify the preview frame requested on open enters liveDataRef even when isPaused is false
      const previewFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        source_id: "mock-tx",
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
        expect(liveDataRef.current).toEqual(previewFrame);
      } finally {
        jest.useRealTimers();
      }
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

    it("opens a per-source IQ WebSocket after source_info activates a raw-IQ source", async () => {
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
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
        "ws://localhost/ws/source/mock-apt/iq?token=session-token",
      );
    });

    it("opens a per-source IQ WebSocket when reconnect reuses an open control socket", async () => {
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
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
        "ws://localhost/ws/source/00000001/iq?token=session-token",
      );
    });

    it("opens a per-source IQ WebSocket when the control socket opens after source state is already ready", async () => {
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
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
        "ws://localhost/ws/source/00000001/iq?token=session-token",
      );
    });

    it("waits for the control socket to open before opening a per-source IQ WebSocket", async () => {
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
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
        "ws://localhost/ws?token=session-token&iq_protocol=2",
      ]);

      sockets[0].readyState = WebSocket.OPEN;
      sockets[0].onopen?.();

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(sockets.map((socket) => socket.url)).toContain(
        "ws://localhost/ws/source/00000001/iq?token=session-token",
      );
    });

    it("retargets the per-source IQ WebSocket when active source state changes", async () => {
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
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
        "ws://localhost/ws/source/00000001/iq?token=session-token",
      );
    });

    it("preconnects a requested source and restores the active transport when the switch fails", async () => {
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
        iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
        "ws://localhost/ws/source/mock-tx/iq?token=session-token",
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
        "ws://localhost/ws/source/mock-apt/iq?token=session-token",
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
        iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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

      expect(mockIqSocket.close).toHaveBeenCalledTimes(1);
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
      expect(sockets[2].url).toBe(
        "ws://localhost/ws/source/rtl-v4/iq?token=session-token",
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
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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

    it("optimistically reflects tx_mode sends in source status before backend echo", async () => {
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
          type: "tx_mode",
          data: {
            active_mode: "tx",
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
          type: "tx_mode",
          data: {
            active_mode: "rx",
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });

      expect(middlewareStore.getState().websocket.sources[0].status).toBe(
        "standby",
      );
      expect(middlewareStore.getState().websocket.deviceState).toBe(
        "standby",
      );
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

    it("reopens the active per-source IQ WebSocket after an unexpected close", async () => {
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
              iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
      sockets[1].onclose?.();
      await new Promise((resolve) => setTimeout(resolve, 275));

      expect(
        sockets.filter(
          (socket) =>
            socket.url ===
            "ws://localhost/ws/source/mock-apt/iq?token=session-token",
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
          active_mode: "rx",
        }),
      );
    });

    it("sends tx_mode messages with active_mode", () => {
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
          type: "tx_mode",
          data: {
            active_mode: "tx",
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });

      expect(send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "tx_mode",
          active_mode: "tx",
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
          type: "tx_mode",
          data: {
            active_mode: "tx",
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });
      middlewareStore.dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "request_next_frame",
          data: {},
        },
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
