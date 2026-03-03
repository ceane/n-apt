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
  dataRef: React.MutableRefObject<{ waveform?: number[] } | null>;
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
      const wfBuf = waterfallBufferRef.current;
      const wfDims = waterfallDimsRef.current;
      if (wfBuf && wfDims) {
        const bytes = new Uint8Array(
          wfBuf.buffer,
          wfBuf.byteOffset,
          wfBuf.byteLength,
        );
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
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
    const waveformData = dataRef.current?.waveform ?? waveformFloatRef.current;
    if (!waveformData) return false;
    const waveform =
      waveformData instanceof Float32Array
        ? waveformData
        : ensureFloat32Waveform(waveformData);
    if (!waveform || waveform.length === 0) return false;
    renderWaveformRef.current = new Float32Array(waveform);
    waveformFloatRef.current = renderWaveformRef.current;
    return true;
  }, [renderWaveformRef, waveformFloatRef, dataRef, ensureFloat32Waveform]);

  useEffect(() => {
    if (!isPaused) return;
    restoreWaveformFromStorage();
    // Force a render after restoring from storage so the canvas isn't blank
    setTimeout(() => forceRender(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
