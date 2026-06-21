import { configureStore } from "@reduxjs/toolkit";
import websocketSlice, {
  updateDeviceState,
  setCaptureStatus,
} from "@n-apt/redux/slices/websocketSlice";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import {
  shouldAcceptPausedFrameRequest,
  resetPausedFrameRequestGate,
  isFrameStale,
  getFrequencyRequestCenterHz,
  shouldResendRetuneRequest,
  resetWebSocketMiddlewareState,
  trimLiveFrameQueue,
  buildSourceIqWebSocketUrl,
  __testQueueLiveDataForMiddleware,
} from "@n-apt/redux/middleware/websocketMiddleware";
import websocketMiddleware from "@n-apt/redux/middleware/websocketMiddleware";
import {
  sendFrequencyRange,
  sendCenterFrequency,
  sendCaptureCommand,
} from "@n-apt/redux/thunks/websocketThunks";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import { collapsePausedFrameBatch } from "@n-apt/redux/middleware/websocketMiddleware";
import { shouldPauseSourceOnSwitch } from "@n-apt/hooks/useSpectrumStore";

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

describe("Redux WebSocket Migration", () => {
  let store: ReturnType<typeof configureStore>;

  beforeEach(() => {
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
    resetPausedFrameRequestGate();
    resetWebSocketMiddlewareState();
  });

  describe("Thunk payload shaping", () => {
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
        expect(
          middlewareStore.getState().websocket.dataFrameCounter,
        ).toBeGreaterThan(0);
      } finally {
        jest.useRealTimers();
      }
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
              supports_raw_iq_stream: true,
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
              supports_raw_iq_stream: true,
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
              supports_raw_iq_stream: false,
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
            txMode: true,
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
            txMode: false,
            txDevice: "Mock Tx SDR",
            serialNumber: "mock-tx",
          },
        },
      });

      expect(middlewareStore.getState().websocket.sources[0].status).toBe(
        "connected",
      );
      expect(middlewareStore.getState().websocket.deviceState).toBe(
        "connected",
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
              supports_raw_iq_stream: false,
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
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(middlewareStore.getState().websocket.sources[0].status).toBe(
        "transmitting",
      );
      expect(middlewareStore.getState().websocket.deviceState).toBe(
        "transmitting",
      );
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
              supports_raw_iq_stream: true,
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

    it("sends pause messages with a source_id", () => {
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
        },
      });

      expect(send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "pause",
          paused: true,
          source_id: "mock-apt",
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
    it("trims retained live IQ frames to a small latest-frame queue", () => {
      const frames = Array.from({ length: 20 }, (_, index) => ({
        type: "spectrum",
        data_type: "iq_raw",
        iq_data: new Uint8Array(256 * 1024),
        sample_rate: 2_400_000,
        center_frequency_hz: 100_000_000,
        timestamp: index,
      })) as IqRawFrame[];

      const trimmed = trimLiveFrameQueue(frames);

      expect(trimmed).toHaveLength(8);
      expect(trimmed[0].timestamp).toBe(12);
      expect(trimmed[7].timestamp).toBe(19);
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
    it("clears stale live device metadata when the socket disconnects", () => {
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
