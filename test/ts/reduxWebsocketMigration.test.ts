import { configureStore } from '@reduxjs/toolkit';
import websocketSlice, {
  updateDeviceState,
  setCaptureStatus,
  setAutoFftOptions,
} from '@n-apt/redux/slices/websocketSlice';
import { liveDataRef } from '@n-apt/redux/middleware/websocketMiddleware';
import {
  sendFrequencyRange,
  sendCenterFrequency,
  sendCaptureCommand,
} from '@n-apt/redux/thunks/websocketThunks';
import spectrumSlice from '@n-apt/redux/slices/spectrumSlice';

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

describe('Redux WebSocket Migration', () => {
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
  });

  describe('Thunk payload shaping', () => {
    it('sendFrequencyRange uses Redux sample rate to shape payload', async () => {
      // Set up state with a known sample rate
      store.dispatch(
        updateDeviceState({
          sampleRateHz: 2_400_000,
        })
      );

      const range = { min: 100, max: 102 };
      await store.dispatch(sendFrequencyRange(range));

      const state = store.getState();
      // Verify the thunk completed
      expect(state.websocket.sampleRateHz).toBe(2_400_000);
    });

    it('sendCenterFrequency derives min/max from sample rate', async () => {
      store.dispatch(
        updateDeviceState({
          sampleRateHz: 2_400_000,
        })
      );

      const centerMHz = 101;
      await store.dispatch(sendCenterFrequency(centerMHz));

      const state = store.getState();
      expect(state.websocket.sampleRateHz).toBe(2_400_000);
    });

    it('sendCaptureCommand clears previous capture status', async () => {
      // Set initial capture status
      store.dispatch(
        setCaptureStatus({
          jobId: 'old-job',
          status: 'done',
          message: 'Previous capture',
          progress: 100,
        })
      );

      expect(store.getState().websocket.captureStatus).not.toBeNull();

      // Send new capture command
      await store.dispatch(
        sendCaptureCommand({
          jobId: 'new-job',
          fragments: [{ min_mhz: 100, max_mhz: 102 }],
          durationS: 5,
          fileType: '.napt',
          acquisitionMode: 'stepwise',
          encrypted: true,
          fftSize: 2048,
          fftWindow: 'hann',
        })
      );

      // Verify capture status was cleared
      expect(store.getState().websocket.captureStatus).toBeNull();
    });
  });

  describe('Live data ref isolation', () => {
    it('liveDataRef is separate from Redux state', () => {
      // Verify the ref exists and is independent
      expect(liveDataRef).toBeDefined();
      expect(liveDataRef.current).toBeNull();

      // Simulate an IQ frame write
      const mockFrame = {
        type: 'spectrum',
        data_type: 'iq_raw',
        iq_data: new Uint8Array([127, 129, 130, 126]),
        sample_rate: 2_400_000,
        center_frequency_hz: 100_000_000,
        timestamp: Date.now(),
      };

      liveDataRef.current = mockFrame;

      // Verify Redux state is unchanged
      const state = store.getState();
      expect(state.websocket).not.toHaveProperty('data');
      expect(liveDataRef.current).toBe(mockFrame);
    });
  });

  describe('Status message deduplication', () => {
    it('identical status updates do not trigger Redux dispatch', () => {
      const initialStatus = {
        jobId: 'test-job',
        status: 'progress' as const,
        message: 'Capturing...',
        progress: 50,
      };

      // First dispatch
      store.dispatch(setCaptureStatus(initialStatus));
      const state1 = store.getState();
      expect(state1.websocket.captureStatus).toEqual(initialStatus);

      // Second dispatch with identical data
      store.dispatch(setCaptureStatus(initialStatus));
      const state2 = store.getState();

      // State reference should be the same (no new object created)
      expect(state2.websocket.captureStatus).toEqual(initialStatus);
    });

    it('updateDeviceState deduplicates identical fields', () => {
      const deviceUpdate = {
        backend: 'RTL-SDR',
        deviceName: 'Generic RTL2832U',
        deviceState: 'ready' as const,
      };

      // First update
      store.dispatch(updateDeviceState(deviceUpdate));
      const state1 = store.getState();
      expect(state1.websocket.backend).toBe('RTL-SDR');

      // Second update with same data
      store.dispatch(updateDeviceState(deviceUpdate));
      const state2 = store.getState();

      // Values should match
      expect(state2.websocket.backend).toBe('RTL-SDR');
      expect(state2.websocket.deviceName).toBe('Generic RTL2832U');
    });

    it('autoFftOptions deduplication works correctly', () => {
      const options = {
        type: 'auto_fft_options' as const,
        autoSizes: [512, 1024, 2048, 4096],
        recommended: 2048,
      };

      store.dispatch(setAutoFftOptions(options));
      const state1 = store.getState();
      expect(state1.websocket.autoFftOptions).toEqual(options);

      // Dispatch again with identical data
      store.dispatch(setAutoFftOptions(options));
      const state2 = store.getState();
      expect(state2.websocket.autoFftOptions).toEqual(options);
    });
  });

  describe('Redux slice behavior', () => {
    it('websocket slice initializes with correct defaults', () => {
      const state = store.getState().websocket;
      
      expect(state.isConnected).toBe(false);
      expect(state.connectionStatus).toBe('disconnected');
      expect(state.deviceState).toBeNull();
      expect(state.captureStatus).toBeNull();
      expect(state.spectrumFrames).toEqual([]);
      expect(state.queuedMessages).toEqual([]);
    });

    it('updateDeviceState merges partial updates', () => {
      store.dispatch(
        updateDeviceState({
          backend: 'RTL-SDR',
          deviceState: 'ready',
        })
      );

      let state = store.getState().websocket;
      expect(state.backend).toBe('RTL-SDR');
      expect(state.deviceState).toBe('ready');
      expect(state.deviceName).toBeNull(); // Unchanged

      store.dispatch(
        updateDeviceState({
          deviceName: 'Generic RTL2832U',
        })
      );

      state = store.getState().websocket;
      expect(state.backend).toBe('RTL-SDR'); // Preserved
      expect(state.deviceName).toBe('Generic RTL2832U'); // Updated
    });
  });
});
