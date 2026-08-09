import { useCallback, useEffect, useRef } from "react";
import { validateWaterfallDataComprehensive } from "@n-apt/validation";
import { readPauseSnapshot, writePauseSnapshot, type PauseSnapshot } from "@n-apt/capture/public/pauseSnapshotStorage";
import { presentationController } from "@n-apt/redux/middleware/websocketMiddleware";
export {
  getPauseSnapshotStorageKeys,
  SNAPSHOT_IQ_KEY,
  SNAPSHOT_WATERFALL_DIMS_KEY,
  SNAPSHOT_WATERFALL_KEY,
  SNAPSHOT_WAVEFORM_KEY,
} from "@n-apt/capture/public/pauseSnapshotStorage";

export interface PauseLogicOptions {
  isPaused: boolean;
  waterfallBufferRef: React.MutableRefObject<Uint8ClampedArray | null>;
  waterfallDimsRef: React.MutableRefObject<{
    width: number;
    height: number;
  } | null>;
  dataRef: React.MutableRefObject<{
    iq_data?: Uint8Array;
    data_type?: string;
  } | null>;
  forceRender: () => void;
  // Additional options for waterfall validation
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  snapshotScope?: string;
  /** Disable persisted paused frames for source modes with their own frame store. */
  enabled?: boolean;
  /** In-memory pause state for recovery; separate from the incoming live frame. */
  pausedSnapshotRef?: React.MutableRefObject<PauseSnapshot | null>;
}

export function usePauseLogic({
  isPaused,
  waterfallBufferRef,
  waterfallDimsRef,
  dataRef,
  forceRender,
  fftSize,
  sampleRate,
  centerFrequencyHz,
  snapshotScope = "default",
  enabled = true,
  pausedSnapshotRef,
}: PauseLogicOptions) {
  const hydratedSnapshotRef = useRef<PauseSnapshot | null>(null);
  const hydratedScopeRef = useRef<string | null>(null);
  const saveFrameData = useCallback(() => {
    if (!enabled) return;
    try {
      const data = dataRef.current;
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
            isFirstFrame: false,
          });

          if (!validationResult.isValid) {
            console.error(
              "Waterfall data validation failed on pause:",
              validationResult.errors,
            );
            // Still save the data, but log the issues
          } else if (validationResult.warnings.length > 0) {
            console.warn(
              "Waterfall data validation warnings on pause:",
              validationResult.warnings,
            );
          }

          // Log validation metadata for debugging
          console.log(
            "Waterfall validation metadata:",
            validationResult.metadata,
          );
        }
      }
      writePauseSnapshot(snapshotScope, {
        iqData: data?.iq_data ?? null,
        waterfall: wfBuf,
        waterfallDimensions: wfDims,
      });
    } catch {
      /* ignore */
    }
  }, [
    centerFrequencyHz,
    dataRef,
    fftSize,
    isPaused,
    sampleRate,
    waterfallBufferRef,
    waterfallDimsRef,
    enabled,
    snapshotScope,
  ]);

  const hydratePauseSnapshot = useCallback(() => {
    if (!enabled) return null;
    try {
      const snapshot =
        hydratedScopeRef.current === snapshotScope
          ? hydratedSnapshotRef.current
          : readPauseSnapshot(snapshotScope);
      if (!snapshot) return null;
      hydratedSnapshotRef.current = snapshot;
      hydratedScopeRef.current = snapshotScope;
      if (pausedSnapshotRef) {
        pausedSnapshotRef.current = snapshot;
      }

      if (snapshot.waterfall && snapshot.waterfallDimensions) {
        waterfallBufferRef.current = snapshot.waterfall;
        waterfallDimsRef.current = snapshot.waterfallDimensions;
      }
      return snapshot;
    } catch {
      return null;
    }
  }, [
    waterfallBufferRef,
    waterfallDimsRef,
    enabled,
    snapshotScope,
    pausedSnapshotRef,
  ]);

  const restoreWaveformFromStorage = useCallback(() => {
    hydratePauseSnapshot();
  }, [hydratePauseSnapshot]);

  useEffect(() => {
    if (enabled && isPaused) return;
    hydratedSnapshotRef.current = null;
    hydratedScopeRef.current = null;
    if (pausedSnapshotRef) {
      pausedSnapshotRef.current = null;
    }
  }, [enabled, isPaused, pausedSnapshotRef]);

  const ensurePausedFrame = useCallback(() => {
    const data = dataRef.current;
    return !!(data?.iq_data && data.iq_data.length > 0);
  }, [dataRef]);

  useEffect(() => {
    if (!enabled || !isPaused) return;
    hydratePauseSnapshot();
    // Force a render after restoring from storage so the canvas isn't blank
    const timeoutId = setTimeout(() => forceRender(), 50);
    return () => clearTimeout(timeoutId);
  }, [enabled, isPaused, forceRender, hydratePauseSnapshot]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      saveFrameData();
    };
  }, [enabled, saveFrameData]);

  useEffect(() => {
    if (!enabled || !isPaused) return;
    if (!ensurePausedFrame()) return;
    saveFrameData();
    forceRender();
  }, [enabled, isPaused, ensurePausedFrame, saveFrameData, forceRender]);

  return {
    saveFrameData,
    hydratePauseSnapshot,
    restoreWaveformFromStorage,
    ensurePausedFrame,
  };
}
