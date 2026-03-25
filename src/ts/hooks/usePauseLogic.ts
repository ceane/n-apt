import { useCallback, useEffect } from "react";

export const SNAPSHOT_WAVEFORM_KEY = "n-apt-fft-waveform-snapshot";
export const SNAPSHOT_WATERFALL_KEY = "n-apt-fft-waterfall-snapshot";
export const SNAPSHOT_WATERFALL_DIMS_KEY = "n-apt-fft-waterfall-dims";

export interface PauseLogicOptions {
  isPaused: boolean;
  renderWaveformRef: React.MutableRefObject<Float32Array | null>;
  waveformFloatRef: React.MutableRefObject<Float32Array | null>;
  waterfallBufferRef: React.MutableRefObject<Uint8ClampedArray | null>;
  waterfallDimsRef: React.MutableRefObject<{
    width: number;
    height: number;
  } | null>;
  dataRef: React.MutableRefObject<{ waveform?: number[]; iq_data?: Uint8Array; data_type?: string } | null>;
  ensureFloat32Waveform: (
    spectrumData: number[] | Float32Array | null | undefined,
  ) => Float32Array;
  forceRender: () => void;
}

export function usePauseLogic({
  isPaused,
  renderWaveformRef,
  waveformFloatRef,
  waterfallBufferRef,
  waterfallDimsRef,
  dataRef,
  ensureFloat32Waveform,
  forceRender,
}: PauseLogicOptions) {
  const saveFrameData = useCallback(() => {
    try {
      const waveform = renderWaveformRef.current || waveformFloatRef.current;
      if (waveform && waveform.length > 0) {
        sessionStorage.setItem(
          SNAPSHOT_WAVEFORM_KEY,
          JSON.stringify(Array.from(waveform)),
        );
      }
      const data = dataRef.current;
      if (data?.iq_data) {
        const iq = data.iq_data;
        let iqBinary = "";
        const chunkSize = 8192;
        for (let i = 0; i < iq.length; i += chunkSize) {
          iqBinary += String.fromCharCode(...iq.subarray(i, i + chunkSize));
        }
        sessionStorage.setItem("n-apt-fft-iq-snapshot", btoa(iqBinary));
      }
      const wfBuf = waterfallBufferRef.current;
      const wfDims = waterfallDimsRef.current;
      if (wfBuf && wfDims) {
        const bytes = new Uint8Array(wfBuf.buffer, wfBuf.byteOffset, wfBuf.byteLength);
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        sessionStorage.setItem(SNAPSHOT_WATERFALL_KEY, btoa(binary));
        sessionStorage.setItem(
          SNAPSHOT_WATERFALL_DIMS_KEY,
          JSON.stringify(wfDims),
        );
      }
    } catch {
      /* ignore */
    }
  }, [renderWaveformRef, waterfallBufferRef, waterfallDimsRef]);

  const restoreWaveformFromStorage = useCallback(() => {
    try {
      const waveformJson = sessionStorage.getItem(SNAPSHOT_WAVEFORM_KEY);
      if (waveformJson) {
        const arr = JSON.parse(waveformJson) as number[];
        const restored = Float32Array.from(arr);
        if (restored.length > 0) {
          renderWaveformRef.current = restored;
          waveformFloatRef.current = restored;
        }
      }

      const iqBase64 = sessionStorage.getItem("n-apt-fft-iq-snapshot");
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

      const wfBase64 = sessionStorage.getItem(SNAPSHOT_WATERFALL_KEY);
      const wfDimsJson = sessionStorage.getItem(SNAPSHOT_WATERFALL_DIMS_KEY);
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
    renderWaveformRef,
    waveformFloatRef,
    waterfallBufferRef,
    waterfallDimsRef,
  ]);

  const ensurePausedFrame = useCallback(() => {
    const existing = renderWaveformRef.current;
    if (existing && existing.length > 0) return true;
    const data = dataRef.current;
    const waveformData = data?.waveform ?? data?.iq_data ?? waveformFloatRef.current;
    if (!waveformData) return false;
    const waveform =
      waveformData instanceof Float32Array
        ? waveformData
        : (data?.waveform ? ensureFloat32Waveform(data.waveform) : null);
    
    // If we only have iq_data, we can't process it here without the hooks, 
    // but onRenderFrame will handle it if we return false here and it's there.
    if (!waveform || waveform.length === 0) return false;

    renderWaveformRef.current = new Float32Array(waveform);
    waveformFloatRef.current = renderWaveformRef.current;
    return true;
  }, [renderWaveformRef, waveformFloatRef, dataRef, ensureFloat32Waveform]);

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
