import { useCallback, useEffect } from "react";
import { validateWaterfallDataComprehensive } from "@n-apt/validation";

export const SNAPSHOT_WAVEFORM_KEY = "n-apt-fft-waveform-snapshot";
export const SNAPSHOT_WATERFALL_KEY = "n-apt-fft-waterfall-snapshot";
export const SNAPSHOT_WATERFALL_DIMS_KEY = "n-apt-fft-waterfall-dims";
export const SNAPSHOT_IQ_KEY = "n-apt-fft-iq-snapshot";

export const getPauseSnapshotStorageKeys = (scope = "default") => ({
  waveform: `${SNAPSHOT_WAVEFORM_KEY}:${scope}`,
  waterfall: `${SNAPSHOT_WATERFALL_KEY}:${scope}`,
  waterfallDims: `${SNAPSHOT_WATERFALL_DIMS_KEY}:${scope}`,
  iq: `${SNAPSHOT_IQ_KEY}:${scope}`,
});

export interface PauseLogicOptions {
  isPaused: boolean;
  renderWaveformRef: React.MutableRefObject<Float32Array | null>;
  waveformFloatRef: React.MutableRefObject<Float32Array | null>;
  waterfallBufferRef: React.MutableRefObject<Uint8ClampedArray | null>;
  waterfallDimsRef: React.MutableRefObject<{
    width: number;
    height: number;
  } | null>;
  dataRef: React.MutableRefObject<{ iq_data?: Uint8Array; data_type?: string } | null>;
  forceRender: () => void;
  // Additional options for waterfall validation
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  snapshotScope?: string;
}

export function usePauseLogic({
  isPaused,
  renderWaveformRef,
  waveformFloatRef,
  waterfallBufferRef,
  waterfallDimsRef,
  dataRef,
  forceRender,
  fftSize,
  sampleRate,
  centerFrequencyHz,
  snapshotScope = "default",
}: PauseLogicOptions) {
  const storageKeys = getPauseSnapshotStorageKeys(snapshotScope);

  const saveFrameData = useCallback(() => {
    try {
      const data = dataRef.current;
      if (data?.iq_data) {
        const iq = data.iq_data;
        let iqBinary = "";
        const chunkSize = 8192;
        for (let i = 0; i < iq.length; i += chunkSize) {
          iqBinary += String.fromCharCode(...iq.subarray(i, i + chunkSize));
        }
        sessionStorage.setItem(storageKeys.iq, btoa(iqBinary));
      }
      const wfBuf = waterfallBufferRef.current;
      const wfDims = waterfallDimsRef.current;
      if (wfBuf && wfDims) {
        // Validate waterfall data when paused (comprehensive validation)
        if (isPaused) {
          const validationResult = validateWaterfallDataComprehensive(wfBuf, {
            width: wfDims.width,
            height: wfDims.height,
            fftSize,
            sampleRate,
            centerFrequencyHz,
            timestamp: Date.now(),
            isPaused: true,
            isFirstFrame: false
          });
          
          if (!validationResult.isValid) {
            console.error('Waterfall data validation failed on pause:', validationResult.errors);
            // Still save the data, but log the issues
          } else if (validationResult.warnings.length > 0) {
            console.warn('Waterfall data validation warnings on pause:', validationResult.warnings);
          }
          
          // Log validation metadata for debugging
          console.log('Waterfall validation metadata:', validationResult.metadata);
        }
        
        const bytes = new Uint8Array(wfBuf.buffer, wfBuf.byteOffset, wfBuf.byteLength);
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        sessionStorage.setItem(storageKeys.waterfall, btoa(binary));
        sessionStorage.setItem(
          storageKeys.waterfallDims,
          JSON.stringify(wfDims),
        );
      }
    } catch {
      /* ignore */
    }
  }, [
    centerFrequencyHz,
    dataRef,
    fftSize,
    isPaused,
    sampleRate,
    storageKeys.iq,
    storageKeys.waterfall,
    storageKeys.waterfallDims,
    waterfallBufferRef,
    waterfallDimsRef,
  ]);

  const restoreWaveformFromStorage = useCallback(() => {
    try {
      const iqBase64 = sessionStorage.getItem(storageKeys.iq);
      if (iqBase64) {
        const binary = atob(iqBase64);
        const iq = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          iq[i] = binary.charCodeAt(i);
        }
        if (dataRef.current) {
          dataRef.current.iq_data = iq;
        } else {
          dataRef.current = { iq_data: iq };
        }
      }

      const wfBase64 = sessionStorage.getItem(storageKeys.waterfall);
      const wfDimsJson = sessionStorage.getItem(storageKeys.waterfallDims);
      if (wfBase64 && wfDimsJson) {
        const dims = JSON.parse(wfDimsJson) as {
          width: number;
          height: number;
        };
        const binary = atob(wfBase64);
        const bytes = new Uint8ClampedArray(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        waterfallBufferRef.current = bytes;
        waterfallDimsRef.current = dims;
      }
    } catch {
      /* ignore */
    }
  }, [
    dataRef,
    renderWaveformRef,
    storageKeys.iq,
    storageKeys.waterfall,
    storageKeys.waterfallDims,
    waveformFloatRef,
    waterfallBufferRef,
    waterfallDimsRef,
  ]);

  const ensurePausedFrame = useCallback(() => {
    const data = dataRef.current;
    return !!(data?.iq_data && data.iq_data.length > 0);
  }, [dataRef]);

  useEffect(() => {
    if (!isPaused) return;
    restoreWaveformFromStorage();
    // Force a render after restoring from storage so the canvas isn't blank
    const timeoutId = setTimeout(() => forceRender(), 50);
    return () => clearTimeout(timeoutId);
  }, [isPaused, forceRender, restoreWaveformFromStorage]);

  useEffect(() => {
    return () => {
      saveFrameData();
    };
  }, [saveFrameData]);

  useEffect(() => {
    if (!isPaused) return;
    if (!ensurePausedFrame()) return;
    saveFrameData();
    forceRender();
  }, [isPaused, ensurePausedFrame, saveFrameData, forceRender]);

  return {
    saveFrameData,
    restoreWaveformFromStorage,
    ensurePausedFrame,
  };
}
