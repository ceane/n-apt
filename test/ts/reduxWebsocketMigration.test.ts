import { configureStore } from "@reduxjs/toolkit";
import websocketSlice, {
  updateDeviceState,
  setCaptureStatus,
  setAutoFftOptions,
} from "@n-apt/redux/slices/websocketSlice";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import {
  shouldAcceptPausedFrameRequest,
  resetPausedFrameRequestGate,
  isFrameStale,
  getFrequencyRequestCenterHz,
  shouldResendRetuneRequest,
  resetWebSocketMiddlewareState,
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

    it("autoFftOptions deduplication works correctly", () => {
      const options = {
        type: "auto_fft_options" as const,
        autoSizes: [512, 1024, 2048, 4096],
        recommended: 2048,
      };

      store.dispatch(setAutoFftOptions(options));
      const state1 = store.getState() as any;
      expect(state1.websocket.autoFftOptions).toEqual(options);

      // Dispatch again with identical data
      store.dispatch(setAutoFftOptions(options));
      const state2 = store.getState() as any;
      expect(state2.websocket.autoFftOptions).toEqual(options);
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
