import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  DeviceState,
  DeviceLoadingReason,
  SdrSettingsConfig,
  SpectrumFrame,
  AutoFftOptionsResponse,
  DeviceProfile,
  CaptureStatus,
} from '@n-apt/consts/schemas/websocket';
import {
  isValidSpectrumFrameEnhanced,
  isValidCaptureStatus,
  isValidAutoFftOptions,
  hasValidIntegrity,
} from '@n-apt/validation';
import { loadPersistedAutoFftOptions } from '../middleware/localStorageMiddleware';

const shallowEqualObject = (
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const equalSpectrumFrames = (
  a: SpectrumFrame[] | null | undefined,
  b: SpectrumFrame[] | null | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.min_mhz !== right.min_mhz ||
      left.max_mhz !== right.max_mhz ||
      left.description !== right.description
    ) {
      return false;
    }
  }
  return true;
};

// Enhanced validation for spectrum frames with integrity checks
const validateSpectrumFrames = (frames: unknown[]): SpectrumFrame[] => {
  return frames.filter(isValidSpectrumFrameEnhanced);
};

// Enhanced validation for capture status
const validateCaptureStatusEnhanced = (status: unknown): CaptureStatus | null => {
  return isValidCaptureStatus(status) ? status : null;
};

// Enhanced validation for auto FFT options
const validateAutoFftOptionsEnhanced = (options: unknown): AutoFftOptionsResponse | null => {
  return isValidAutoFftOptions(options) ? options : null;
};

const equalValue = (current: unknown, next: unknown): boolean => {
  if (current === next) return true;
  if (Array.isArray(current) && Array.isArray(next)) {
    return equalSpectrumFrames(
      current as SpectrumFrame[],
      next as SpectrumFrame[],
    );
  }
  if (
    current &&
    next &&
    typeof current === 'object' &&
    typeof next === 'object'
  ) {
    return shallowEqualObject(
      current as Record<string, unknown>,
      next as Record<string, unknown>,
    );
  }
  return false;
};

export interface WebSocketState {
  // Connection state
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  
  // Device state
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  serverPaused: boolean;
  
  // Device info
  backend: string | null;
  deviceInfo: string | null;
  deviceName: string | null;
  deviceProfile: DeviceProfile | null;
  maxSampleRateHz: number | null;
  sampleRateHz: number | null;
  sdrSettings: SdrSettingsConfig | null;
  
  // Data
  spectrumFrames: SpectrumFrame[];
  
  // Capture and processing
  captureStatus: CaptureStatus;
  autoFftOptions: AutoFftOptionsResponse | null;
  
  // Error handling
  error: string | null;
  cryptoCorrupted: boolean;
  
  // Message queue for offline/reconnecting
  queuedMessages: Array<{
    type: string;
    data: any;
    timestamp: number;
  }>;
}

const initialState: WebSocketState = {
  isConnected: false,
  connectionStatus: 'disconnected',
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  
  deviceState: null,
  deviceLoadingReason: null,
  isPaused: false,
  serverPaused: false,
  
  backend: null,
  deviceInfo: null,
  deviceName: null,
  deviceProfile: null,
  maxSampleRateHz: null,
  sampleRateHz: null,
  sdrSettings: null,
  
  spectrumFrames: [],
  
  captureStatus: null,
  autoFftOptions: loadPersistedAutoFftOptions(), // Load cached options on startup
  
  error: null,
  cryptoCorrupted: false,
  
  queuedMessages: [],
};

const websocketSlice = createSlice({
  name: 'websocket',
  initialState,
  reducers: {
    // Connection management
    setConnecting: (state) => {
      state.connectionStatus = 'connecting';
      state.error = null;
    },
    
    setConnected: (state) => {
      state.isConnected = true;
      state.connectionStatus = 'connected';
      state.reconnectAttempts = 0;
      state.error = null;
      state.cryptoCorrupted = false;
    },
    
    setDisconnected: (state) => {
      state.isConnected = false;
      state.connectionStatus = 'disconnected';
    },
    
    setReconnecting: (state, action: PayloadAction<number>) => {
      state.connectionStatus = 'reconnecting';
      state.reconnectAttempts = action.payload;
    },
    
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.connectionStatus = 'error';
    },
    
    reset: (state) => {
      Object.assign(state, initialState);
    },
    
    // Device state updates
    updateDeviceState: (state, action: PayloadAction<Partial<WebSocketState>>) => {
      const draftState = state as WebSocketState;
      const mutableState = state as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(action.payload) as Array<
        [keyof WebSocketState, WebSocketState[keyof WebSocketState]]
      >) {
        if (!equalValue(draftState[key], value)) {
          mutableState[key] = value as unknown;
        }
      }
    },
    
    setServerPaused: (state, action: PayloadAction<boolean>) => {
      state.serverPaused = action.payload;
    },
    
    // Spectrum frames
    setSpectrumFrames: (state, action: PayloadAction<SpectrumFrame[]>) => {
      // Validate spectrum frames before storing
      const validatedFrames = validateSpectrumFrames(action.payload);
      if (validatedFrames.length !== action.payload.length) {
        console.warn(`Filtered ${action.payload.length - validatedFrames.length} invalid spectrum frames`);
      }
      state.spectrumFrames = validatedFrames;
    },
    
    // Capture status
    setCaptureStatus: (state, action: PayloadAction<CaptureStatus | null>) => {
      // Allow null to clear capture status
      if (action.payload === null) {
        state.captureStatus = null;
        return;
      }
      
      // Validate capture status before storing
      const validatedStatus = validateCaptureStatusEnhanced(action.payload);
      if (validatedStatus) {
        state.captureStatus = validatedStatus;
      } else {
        console.error('Invalid capture status rejected:', action.payload);
      }
    },
    
    // Auto FFT options
    setAutoFftOptions: (state, action: PayloadAction<AutoFftOptionsResponse>) => {
      // Validate auto FFT options before storing
      const validatedOptions = validateAutoFftOptionsEnhanced(action.payload);
      if (validatedOptions) {
        state.autoFftOptions = validatedOptions;
      } else {
        console.error('Invalid auto FFT options rejected:', action.payload);
      }
    },
    
    // Crypto corruption
    setCryptoCorrupted: (state) => {
      state.cryptoCorrupted = true;
    },
    
    // Message queue management
    queueMessage: (state, action: PayloadAction<{ type: string; data: any }>) => {
      state.queuedMessages.push({
        ...action.payload,
        timestamp: Date.now(),
      });
    },
    
    clearQueuedMessages: (state) => {
      state.queuedMessages = [];
    },
    
    // Pause state (user-controlled)
    setPaused: (state, action: PayloadAction<boolean>) => {
      state.isPaused = action.payload;
    },
  },
});

export const {
  setConnecting,
  setConnected,
  setDisconnected,
  setReconnecting,
  setError,
  reset,
  updateDeviceState,
  setServerPaused,
  setSpectrumFrames,
  setCaptureStatus,
  setAutoFftOptions,
  setCryptoCorrupted,
  queueMessage,
  clearQueuedMessages,
  setPaused,
} = websocketSlice.actions;

export default websocketSlice.reducer;
