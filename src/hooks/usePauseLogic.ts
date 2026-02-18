import { useCallback, useEffect } from "react";

// Keys for persisting last-frame data across unmount/remount
export const SNAPSHOT_WAVEFORM_KEY = "n-apt-fft-waveform-snapshot";
export const SNAPSHOT_WATERFALL_KEY = "n-apt-fft-waterfall-snapshot";
export const SNAPSHOT_WATERFALL_DIMS_KEY = "n-apt-fft-waterfall-dims-snapshot";

export interface PauseLogicOptions {
  isPaused: boolean;
  renderWaveformRef: React.MutableRefObject<Float32Array | null>;
  waveformFloatRef: React.MutableRefObject<Float32Array | null>;
  waterfallBufferRef: React.MutableRefObject<Uint8ClampedArray | null>;
  waterfallDimsRef: React.MutableRefObject<{ width: number; height: number } | null>;
  dataRef: React.MutableRefObject<{ waveform?: number[] } | null>;
  animationRunIdRef: React.MutableRefObject<number>;
  animationFrameRef: React.MutableRefObject<number | null>;
  ensureFloat32Waveform: (spectrumData: number[] | Float32Array | null | undefined) => Float32Array;
  animate: () => void;
}

export function usePauseLogic({
  isPaused,
  renderWaveformRef,
  waveformFloatRef,
  waterfallBufferRef,
  waterfallDimsRef,
  dataRef,
  animationRunIdRef,
  animationFrameRef,
  ensureFloat32Waveform,
  animate,
}: PauseLogicOptions) {
  // Save current frame data to sessionStorage for persistence
  const saveFrameData = useCallback(() => {
    try {
      // Save waveform
      if (renderWaveformRef.current) {
        sessionStorage.setItem(SNAPSHOT_WAVEFORM_KEY, JSON.stringify(Array.from(renderWaveformRef.current)));
      }

      // Save waterfall buffer
      if (waterfallBufferRef.current && waterfallDimsRef.current) {
        sessionStorage.setItem(SNAPSHOT_WATERFALL_KEY, JSON.stringify(Array.from(waterfallBufferRef.current)));
        sessionStorage.setItem(SNAPSHOT_WATERFALL_DIMS_KEY, JSON.stringify(waterfallDimsRef.current));
      }
    } catch (error) {
      console.warn("Failed to save frame data to sessionStorage:", error);
    }
  }, [renderWaveformRef, waterfallBufferRef, waterfallDimsRef]);

  // Restore waveform from sessionStorage
  const restoreWaveformFromStorage = useCallback(() => {
    try {
      const waveformJson = sessionStorage.getItem(SNAPSHOT_WAVEFORM_KEY);
      if (waveformJson) {
        const arr = JSON.parse(waveformJson) as number[];
        const restored = Float32Array.from(arr);
        if (restored.length > 0) {
          renderWaveformRef.current = restored;
          waveformFloatRef.current = restored;
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  }, [renderWaveformRef, waveformFloatRef]);

  // Ensure we have a renderable waveform when pausing/resizing
  const ensurePausedFrame = useCallback(() => {
    const existing = renderWaveformRef.current;
    if (existing && existing.length > 0) return true;
    
    const waveformData = dataRef.current?.waveform;
    if (!waveformData) return false;
    
    const waveform = ensureFloat32Waveform(waveformData);
    if (!waveform || waveform.length === 0) return false;
    
    renderWaveformRef.current = new Float32Array(waveform);
    waveformFloatRef.current = renderWaveformRef.current;
    return true;
  }, [renderWaveformRef, waveformFloatRef, dataRef, ensureFloat32Waveform]);

  // When paused, render a single frame so the last data remains visible
  useEffect(() => {
    if (!isPaused) return;
    
    if (!ensurePausedFrame()) return;
    
    // Persist the last frame for re-mounts/snapshots
    saveFrameData();
    
    // Increment run ID to force a fresh render cycle
    animationRunIdRef.current += 1;
    
    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Render exactly one frame
    animate();
  }, [isPaused, ensurePausedFrame, saveFrameData, animate]);

  return {
    saveFrameData,
    restoreWaveformFromStorage,
    ensurePausedFrame,
  };
}
