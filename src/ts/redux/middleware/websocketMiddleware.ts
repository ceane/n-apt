import { Middleware, Dispatch } from '@reduxjs/toolkit';
import { 
  setConnecting, 
  setConnected, 
  setDisconnected, 
  setReconnecting, 
  setError,
  updateDeviceState,
  setCaptureStatus,
  setAutoFftOptions,
  setCryptoCorrupted,
  queueMessage,
  clearQueuedMessages,
} from '../slices/websocketSlice';
import { decryptPayload, decryptBinaryPayload } from '@n-apt/crypto/webcrypto';
import { AutoFftOptionsResponse } from '@n-apt/consts/schemas/websocket';
import { scannerWorkerManager } from '../../workers/scannerWorkerManager';
import { 
  processWebSocketMessageWithValidation,
  validateStatusMessage,
  validateCaptureStatus,
  validateAutoFftOptions,
  isValidSpectrumData,
  validateSpectrumDataComprehensive,
} from '@n-apt/validation';

// Module-level ref for high-frequency live frame data.
// Written directly — never goes through Redux state — so no React rerenders per frame.
export const liveDataRef: { current: any } = { current: null };

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
  a: Array<Record<string, unknown>> | null | undefined,
  b: Array<Record<string, unknown>> | null | undefined,
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

const equalValue = (current: unknown, next: unknown): boolean => {
  if (current === next) return true;
  if (Array.isArray(current) && Array.isArray(next)) {
    return equalSpectrumFrames(
      current as Array<Record<string, unknown>>,
      next as Array<Record<string, unknown>>,
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

interface WebSocketInstance {
  ws: WebSocket | null;
  reconnectTimeout: number | null;
  disconnectTimeout: number | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  url: string;
  aesKey: CryptoKey | null;
  enabled: boolean;
  disposed: boolean;
}

// Store WebSocket instance reference in middleware closure
let wsInstance: WebSocketInstance = {
  ws: null,
  reconnectTimeout: null,
  disconnectTimeout: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  url: '',
  aesKey: null,
  enabled: false,
  disposed: false,
};

// Batching for high-frequency data
let dataBatchTimeout: number | null = null;
let pendingDataUpdate: any = null;
const BATCH_DELAY_MS = 16; // ~60fps
const DISCONNECT_GRACE_MS = 150;

// Process batched data updates — writes directly to liveDataRef, no Redux dispatch.
const processBatchedData = () => {
  if (pendingDataUpdate !== null) {
    liveDataRef.current = pendingDataUpdate;
    pendingDataUpdate = null;
  }
  dataBatchTimeout = null;
};

const getPausedValue = (payload: unknown): boolean | null => {
  if (typeof payload === 'boolean') {
    return payload;
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'isPaused' in payload &&
    typeof (payload as { isPaused?: unknown }).isPaused === 'boolean'
  ) {
    return (payload as { isPaused: boolean }).isPaused;
  }

  return null;
};

const queueLiveData = (data: unknown) => {
  pendingDataUpdate = data;
  if (dataBatchTimeout === null) {
    dataBatchTimeout = window.setTimeout(() => processBatchedData(), BATCH_DELAY_MS);
  }
};

const sameAesKeyReference = (
  current: CryptoKey | null,
  next: CryptoKey | null,
): boolean => current === next;

const cleanupSocket = () => {
  if (wsInstance.reconnectTimeout) {
    clearTimeout(wsInstance.reconnectTimeout);
    wsInstance.reconnectTimeout = null;
  }

  if (wsInstance.ws) {
    wsInstance.ws.onclose = null;
    wsInstance.ws.onerror = null;
    wsInstance.ws.onmessage = null;
    wsInstance.ws.onopen = null;
    wsInstance.ws.close();
    wsInstance.ws = null;
  }

  wsInstance.disposed = true;
};

// WebSocket message processing
const processMessage = (dispatch: Dispatch, getState: () => any, parsedData: any) => {
  // Validate the message first (skip binary data for performance)
  if (!processWebSocketMessageWithValidation(dispatch, getState, parsedData)) {
    console.warn('WebSocket message failed validation:', parsedData);
    return;
  }

  // Status messages (backend-driven device state)
  if (parsedData?.type === "status") {
    // Additional validation for status messages
    if (!validateStatusMessage(parsedData)) {
      console.error('Status message validation failed:', parsedData);
      return;
    }
    
    try {
      const updates: any = {
        serverPaused: parsedData.paused || false,
      };

      if (typeof parsedData.backend === "string") {
        updates.backend = parsedData.backend;
      }
      if (typeof parsedData.device_info === "string") {
        updates.deviceInfo = parsedData.device_info;
      }
      // More aggressive device name updates - update even if empty to clear stale data
      if (typeof parsedData.device_name === "string") {
        updates.deviceName = parsedData.device_name;
      }
      if (parsedData.device_profile) {
        updates.deviceProfile = parsedData.device_profile;
      }
      if (typeof parsedData.max_sample_rate === "number") {
        updates.maxSampleRateHz = parsedData.max_sample_rate;
      }
      if (parsedData.sdr_settings) {
        updates.sdrSettings = parsedData.sdr_settings;
        if (typeof parsedData.sdr_settings.sample_rate === "number") {
          updates.sampleRateHz = parsedData.sdr_settings.sample_rate;
        }
      }
      if (typeof parsedData.device_state === "string") {
        updates.deviceState = parsedData.device_state;
        // When device connects, force immediate update of device info
        if (parsedData.device_state === "connected" && !updates.deviceName) {
          // Set a default name immediately if backend hasn't provided one yet
          updates.deviceName = updates.deviceInfo || "RTL-SDR Device";
        }
      }
      if (Array.isArray(parsedData.channels)) {
        updates.spectrumFrames = parsedData.channels
          .filter((f: any) => f && typeof f.id === "string")
          .map((f: any) => ({
            id: f.id,
            label: typeof f.label === "string" ? f.label : "",
            min_mhz: Number(f.min_mhz),
            max_mhz: Number(f.max_mhz),
            description: typeof f.description === "string" ? f.description : "",
          }))
          .filter((f: any) =>
            typeof f.label === "string" &&
            f.label.length > 0 &&
            Number.isFinite(f.min_mhz) &&
            Number.isFinite(f.max_mhz) &&
            f.max_mhz > f.min_mhz,
          );
      }
      
      const reason = parsedData.device_loading_reason;
      if (reason === "connect" || reason === "restart" || reason === null) {
        updates.deviceLoadingReason = reason;
      }
      
      const websocketState = getState().websocket;
      const hasChanges = Object.entries(updates).some(([key, value]) => {
        return !equalValue(websocketState[key], value);
      });
      if (hasChanges) {
        dispatch(updateDeviceState(updates));
      }
    } catch (e) {
      console.error('Failed to parse status message:', e);
    }
    return;
  }

  // Capture status messages
  if (parsedData?.type === "capture_status") {
    // Validate capture status
    const statusData = parsedData.status || parsedData;
    if (!validateCaptureStatus(statusData)) {
      console.error('Capture status validation failed:', statusData);
      return;
    }
    
    try {
      const statusObj = parsedData.status || {};
      if (
        typeof statusObj.jobId === "string" &&
        (statusObj.status === "started" ||
          statusObj.status === "progress" ||
          statusObj.status === "done" ||
          statusObj.status === "failed")
      ) {
        const newStatus = {
          jobId: statusObj.jobId,
          status: statusObj.status,
          message: statusObj.message,
          progress: statusObj.progress,
          downloadUrl: statusObj.downloadUrl,
          filename: statusObj.filename,
          fileCount: typeof statusObj.fileCount === "number" ? statusObj.fileCount : undefined,
        };
        if (statusObj.error) {
          (newStatus as any).error = statusObj.error;
        }
        const currentStatus = getState().websocket.captureStatus;
        if (!equalValue(currentStatus, newStatus)) {
          dispatch(setCaptureStatus(newStatus));
        }
      }
    } catch (e) {
      console.error('Failed to parse capture status:', e);
    }
    return;
  }

  // Auto FFT options messages
  if (parsedData?.type === "auto_fft_options") {
    // Validate auto FFT options
    if (!validateAutoFftOptions(parsedData)) {
      console.error('Auto FFT options validation failed:', parsedData);
      return;
    }
    
    try {
      if (
        Array.isArray(parsedData.autoSizes) &&
        typeof parsedData.recommended === "number"
      ) {
        const options: AutoFftOptionsResponse = {
          type: "auto_fft_options" as const,
          autoSizes: parsedData.autoSizes,
          recommended: parsedData.recommended,
        };
        const currentOptions = getState().websocket.autoFftOptions;
        if (!equalValue(currentOptions, options)) {
          dispatch(setAutoFftOptions(options));
        }
      }
    } catch (e) {
      console.error('Failed to parse auto FFT options:', e);
    }
    return;
  }

  // Scan and Demodulation result messages
  if (
    parsedData?.type === "scan_result" ||
    parsedData?.type === "scan_progress" ||
    parsedData?.type === "demod_result"
  ) {
    scannerWorkerManager.handleWSResponse(parsedData);
    return;
  }

  // APT Analysis result messages
  if (parsedData?.type === "apt_analysis_result") {
    try {
      // Dispatch custom event for APT analysis results
      // This will be handled by the DemodContext
      const event = new CustomEvent('aptAnalysisResult', {
        detail: parsedData
      });
      window.dispatchEvent(event);
    } catch (e) {
      console.error('Failed to process APT analysis result:', e);
    }
    return;
  }
};

// Binary message processing
const processBinaryMessage = async (dispatch: Dispatch, getState: () => any, buffer: ArrayBuffer, aesKey: CryptoKey) => {
  try {
    const view = new DataView(buffer);
    
    // Extract metadata
    const timestamp = Number(view.getBigUint64(0, true));
    const centerFrequencyHz = Number(view.getBigUint64(8, true));
    const dataType = Number(view.getUint32(16, true));
    const sampleRate = Number(view.getUint32(20, true));
    
    // Extract encrypted payload
    const encryptedPayload = new Uint8Array(buffer, 24);
    
    // Decrypt the binary payload
    const decryptedBytes = await decryptBinaryPayload(aesKey, encryptedPayload);
    
    let spectrumData;
    if (dataType === 1) {
      // I/Q data
      spectrumData = {
        type: "spectrum",
        waveform: new Float32Array(decryptedBytes.length / 2),
        is_mock_apt: false,
        center_frequency_hz: centerFrequencyHz,
        waveform_span_mhz: null,
        timestamp: timestamp,
        data_type: "iq_raw",
        sample_rate: sampleRate,
        iq_data: decryptedBytes,
      };
    } else {
      // Spectrum data
      const waveform = new Float32Array(
        decryptedBytes.buffer,
        decryptedBytes.byteOffset,
        decryptedBytes.byteLength / 4,
      );
      
      // Enhanced validation for pause and first render scenarios
      const isPaused = getState().websocket.isPaused;
      const isFirstFrame = !liveDataRef.current; // No data exists yet
      
      // Skip validation for real-time streaming, but validate on pause and first frame
      if (isPaused || isFirstFrame) {
        // Comprehensive validation for checkpoint scenarios
        const validationResult = validateSpectrumDataComprehensive(waveform, {
          fftSize: getState().websocket.sdrSettings?.fft_size,
          sampleRate,
          centerFrequencyHz,
          timestamp,
          isPaused,
          isFirstFrame
        });
        
        if (!validationResult.isValid) {
          console.warn(`Spectrum data validation failed (${isPaused ? 'paused' : 'first render'}):`, validationResult.errors);
          return;
        }
        
        if (validationResult.warnings.length > 0) {
          console.warn(`Spectrum data warnings (${isPaused ? 'paused' : 'first render'}):`, validationResult.warnings);
        }
      } else {
        // Minimal validation for real-time streaming (performance optimized)
        if (!isValidSpectrumData(waveform)) {
          console.warn('Invalid spectrum data received, skipping frame');
          return;
        }
      }
      
      spectrumData = {
        type: "spectrum",
        waveform: waveform,
        is_mock_apt: false,
        center_frequency_hz: centerFrequencyHz,
        waveform_span_mhz: null,
        timestamp: timestamp,
        data_type: "spectrum_db",
        sample_rate: sampleRate,
      };
    }
    
    // Batch the data update to prevent excessive re-renders
    queueLiveData(spectrumData);
  } catch (e) {
    console.error("Binary decryption failed:", e);
    dispatch(setCryptoCorrupted());
  }
};

// Create WebSocket middleware
const createWebSocketMiddleware = (): Middleware<{}, any> => (store) => (next) => (action: any) => {
  const { dispatch, getState } = store;
  
  // Handle WebSocket connection management actions
  switch (action.type) {
    case 'websocket/connect': {
      const { url, aesKey, enabled = true } = action.payload;

      if (wsInstance.disconnectTimeout) {
        clearTimeout(wsInstance.disconnectTimeout);
        wsInstance.disconnectTimeout = null;
      }

      const existingSocket = wsInstance.ws;
      const hasReusableSocket =
        !!existingSocket &&
        !wsInstance.disposed &&
        wsInstance.enabled === enabled &&
        wsInstance.url === url &&
        sameAesKeyReference(wsInstance.aesKey, aesKey) &&
        (existingSocket.readyState === WebSocket.CONNECTING ||
          existingSocket.readyState === WebSocket.OPEN);

      if (hasReusableSocket) {
        if (existingSocket?.readyState === WebSocket.OPEN) {
          dispatch(setConnected());
        } else {
          dispatch(setConnecting());
        }
        return next(action);
      }
      
      // Cleanup existing connection
      cleanupSocket();
      
      if (!enabled || !url) {
        dispatch(setDisconnected());
        return next(action);
      }
      
      wsInstance.url = url;
      wsInstance.aesKey = aesKey;
      wsInstance.enabled = enabled;
      wsInstance.reconnectAttempts = 0;
      wsInstance.disposed = false;
      
      const connect = () => {
        if (wsInstance.disposed) return;
        
        try {
          dispatch(setConnecting());
          const ws = new WebSocket(url);
          ws.binaryType = "arraybuffer";
          wsInstance.ws = ws;
          
          ws.onopen = () => {
            if (wsInstance.disposed) {
              ws.close();
              return;
            }
            dispatch(setConnected());
            wsInstance.reconnectAttempts = 0;
            
            // Send queued messages
            const state = getState();
            const queuedMessages = state.websocket.queuedMessages;
            if (queuedMessages.length > 0) {
              queuedMessages.forEach(({ type, data }: { type: string; data: any }) => {
                ws.send(JSON.stringify({ type, ...data }));
              });
              dispatch(clearQueuedMessages());
            }
          };
          
          ws.onmessage = async (event) => {
            if (wsInstance.disposed) return;
            
            // Binary fast-path for spectrum data
            if (event.data instanceof ArrayBuffer) {
              if (wsInstance.aesKey) {
                await processBinaryMessage(dispatch, getState, event.data, wsInstance.aesKey);
              }
              return;
            }
            
            const raw = event.data as string;
            let parsed: any;
            try {
              parsed = JSON.parse(raw);
            } catch (e) {
              console.error('Failed to parse websocket message:', e);
              return;
            }

            // Priority: Handle critical control messages immediately before any other processing
            if (parsed?.type === "auto_fft_options" || 
                parsed?.type === "status" ||
                parsed?.type === "capture_status") {
              processMessage(dispatch, getState, parsed);
              return;
            }

            if (parsed?.type === "spectrum") {
              queueLiveData(parsed);
              return;
            }

            if (parsed?.type === "encrypted_spectrum") {
              if (wsInstance.aesKey && typeof parsed.payload === "string") {
                try {
                  const plaintext = await decryptPayload(wsInstance.aesKey, parsed.payload);
                  const decrypted = JSON.parse(plaintext);
                  if (
                    decrypted?.type === "batch" &&
                    Array.isArray(decrypted.messages) &&
                    decrypted.messages.length > 0
                  ) {
                    queueLiveData(JSON.parse(decrypted.messages[0]));
                  } else {
                    queueLiveData(decrypted);
                  }
                } catch (e) {
                  console.error('Failed to decrypt spectrum data:', e);
                }
              }
              return;
            }

            // Process status and control messages immediately
            processMessage(dispatch, getState, parsed);
          };
          
          ws.onclose = () => {
            if (wsInstance.disposed) return;
            dispatch(setDisconnected());
            
            // Exponential backoff reconnection
            if (wsInstance.reconnectAttempts < wsInstance.maxReconnectAttempts) {
              const delay = Math.min(1000 * Math.pow(2, wsInstance.reconnectAttempts), 30000);
              wsInstance.reconnectTimeout = window.setTimeout(() => {
                wsInstance.reconnectAttempts++;
                dispatch(setReconnecting(wsInstance.reconnectAttempts));
                connect();
              }, delay);
            }
          };
          
          ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            dispatch(setError("WebSocket connection error"));
          };
          
        } catch (error) {
          console.error("Failed to create WebSocket:", error);
          dispatch(setError("Failed to create WebSocket connection"));
        }
      };
      
      connect();
      return next(action);
    }
    
    case 'websocket/disconnect': {
      if (wsInstance.disconnectTimeout) {
        clearTimeout(wsInstance.disconnectTimeout);
      }

      wsInstance.disconnectTimeout = window.setTimeout(() => {
        wsInstance.disconnectTimeout = null;
        cleanupSocket();
      }, DISCONNECT_GRACE_MS);
      
      if (dataBatchTimeout) {
        clearTimeout(dataBatchTimeout);
        dataBatchTimeout = null;
      }
      
      dispatch(setDisconnected());
      return next(action);
    }
    
    case 'websocket/sendMessage': {
      const { type, data }: { type: string; data: any } = action.payload;
      
      if (wsInstance.ws && wsInstance.ws.readyState === WebSocket.OPEN) {
        wsInstance.ws.send(JSON.stringify({ type, ...data }));
      } else {
        // Queue the message for when connection is restored
        dispatch(queueMessage({ type, data }));
      }
      return next(action);
    }
    
    case 'websocket/setPaused': {
      const isPaused = getPausedValue(action.payload);

      if (isPaused === null) {
        return next(action);
      }
      
      if (wsInstance.ws && wsInstance.ws.readyState === WebSocket.OPEN) {
        wsInstance.ws.send(JSON.stringify({
          type: "pause",
          paused: isPaused,
        }));
      }

      return next({
        ...action,
        payload: isPaused,
      });
    }
    
    default:
      return next(action);
  }
};

// Export the middleware factory
const websocketMiddleware = createWebSocketMiddleware();
export default websocketMiddleware;
