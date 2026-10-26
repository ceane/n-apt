import { useCallback, useEffect, useRef } from "react";
import { validateWaterfallDataComprehensive } from "@n-apt/validation";
import { clearPersistedPauseSnapshots } from "@n-apt/app/infrastructure/storage/clearPersistedPauseSnapshots";
import type {
  PausedFrameSnapshot,
  PausedWaterfallTextureMeta,
} from "@n-apt/spectrum/types/PausedFrameSnapshot";
import type { PendingWaterfallRestore } from "@n-apt/spectrum/utils/waterfallRestore";

export interface PauseLogicOptions {
  isPaused: boolean;
  waterfallBufferRef: React.MutableRefObject<Uint8ClampedArray | null>;
  waterfallDimsRef: React.MutableRefObject<{
    width: number;
    height: number;
  } | null>;
  /** CPU copy of the complete circular WebGPU waterfall history. */
  waterfallTextureSnapshotRef?: React.MutableRefObject<Uint8Array | null>;
  waterfallTextureMetaRef?: React.MutableRefObject<PausedWaterfallTextureMeta | null>;
  pendingWaterfallRestoreRef?: React.MutableRefObject<PendingWaterfallRestore | null>;
  restoredWaterfallRef?: React.MutableRefObject<boolean>;
  dataRef: React.MutableRefObject<{
    iq_data?: Uint8Array;
    data_type?: string;
  } | null>;
  forceRender: () => void;
  // Additional options for waterfall validation
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  /** Identity used to keep an in-memory pause frame with its source view. */
  snapshotScope?: string;
  /** Disable in-memory paused frame retention for source modes with their own frame store. */
  enabled?: boolean;
  /** In-memory pause state for waveform recovery; never persisted. */
  pausedSnapshotRef?: React.MutableRefObject<PausedFrameSnapshot | null>;
}

export function usePauseLogic({
  isPaused,
  waterfallBufferRef,
  waterfallDimsRef,
  waterfallTextureSnapshotRef,
  waterfallTextureMetaRef,
  pendingWaterfallRestoreRef,
  restoredWaterfallRef,
  dataRef,
  forceRender,
  fftSize,
  sampleRate,
  centerFrequencyHz,
  snapshotScope = "default",
  enabled = true,
  pausedSnapshotRef,
}: PauseLogicOptions) {
  const snapshotScopeRef = useRef(snapshotScope);

  const clearSnapshotOnScopeChange = useCallback(() => {
    if (snapshotScopeRef.current === snapshotScope) return;
    snapshotScopeRef.current = snapshotScope;
    if (pausedSnapshotRef) pausedSnapshotRef.current = null;
  }, [snapshotScope, pausedSnapshotRef]);

  const capturePausedSnapshot = useCallback((): PausedFrameSnapshot => {
    const data = dataRef.current;
    const waterfall = waterfallBufferRef.current;
    const dimensions = waterfallDimsRef.current;
    const waterfallTexture = waterfallTextureSnapshotRef?.current;
    const waterfallTextureMeta = waterfallTextureMetaRef?.current;
    const hasCompleteTextureHistory = !!(
      waterfallTexture &&
      waterfallTextureMeta &&
      waterfallTextureMeta.width > 0 &&
      waterfallTextureMeta.height > 0 &&
      waterfallTexture.length ===
        waterfallTextureMeta.width * waterfallTextureMeta.height * 4
    );
    return {
      iqData: data?.iq_data ? new Uint8Array(data.iq_data) : null,
      waterfall: waterfall ? new Uint8ClampedArray(waterfall) : null,
      waterfallDimensions: dimensions ? { ...dimensions } : null,
      waterfallTextureSnapshot: hasCompleteTextureHistory
        ? new Uint8Array(waterfallTexture)
        : null,
      waterfallTextureMeta: hasCompleteTextureHistory
        ? { ...waterfallTextureMeta }
        : null,
    };
  }, [
    dataRef,
    waterfallBufferRef,
    waterfallDimsRef,
    waterfallTextureSnapshotRef,
    waterfallTextureMetaRef,
  ]);

  const retainPausedSnapshot = useCallback(() => {
    if (!enabled || !isPaused) return null;
    clearSnapshotOnScopeChange();
    try {
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
            // Keep the frame in memory even when its waterfall is imperfect.
          } else if (validationResult.warnings.length > 0) {
            console.warn(
              "Waterfall data validation warnings on pause:",
              validationResult.warnings,
            );
          }
        }
      }
      const snapshot = capturePausedSnapshot();
      if (pausedSnapshotRef) pausedSnapshotRef.current = snapshot;
      return snapshot;
    } catch {
      return null;
    }
  }, [
    enabled,
    isPaused,
    clearSnapshotOnScopeChange,
    waterfallBufferRef,
    waterfallDimsRef,
    fftSize,
    sampleRate,
    centerFrequencyHz,
    capturePausedSnapshot,
    pausedSnapshotRef,
  ]);

  const hydratePauseSnapshot = useCallback(() => {
    if (!enabled || !isPaused) return null;
    clearSnapshotOnScopeChange();
    const snapshot = pausedSnapshotRef?.current ?? retainPausedSnapshot();
    if (!snapshot) return null;
    if (snapshot.waterfall && snapshot.waterfallDimensions) {
      waterfallBufferRef.current = snapshot.waterfall;
      waterfallDimsRef.current = snapshot.waterfallDimensions;
    }
    const texture = snapshot.waterfallTextureSnapshot;
    const textureMeta = snapshot.waterfallTextureMeta;
    if (texture && textureMeta) {
      const restoredTexture = new Uint8Array(texture);
      if (waterfallTextureSnapshotRef) {
        waterfallTextureSnapshotRef.current = restoredTexture;
      }
      if (waterfallTextureMetaRef) {
        waterfallTextureMetaRef.current = { ...textureMeta };
      }
      if (pendingWaterfallRestoreRef) {
        pendingWaterfallRestoreRef.current = {
          data: new Uint8Array(restoredTexture),
          ...textureMeta,
        };
      }
      if (restoredWaterfallRef) restoredWaterfallRef.current = false;
    }
    return snapshot;
  }, [
    waterfallBufferRef,
    waterfallDimsRef,
    waterfallTextureSnapshotRef,
    waterfallTextureMetaRef,
    pendingWaterfallRestoreRef,
    restoredWaterfallRef,
    enabled,
    isPaused,
    clearSnapshotOnScopeChange,
    pausedSnapshotRef,
    retainPausedSnapshot,
  ]);

  useEffect(() => {
    if (enabled && isPaused) {
      retainPausedSnapshot();
      return;
    }
    if (pausedSnapshotRef) pausedSnapshotRef.current = null;
    clearPersistedPauseSnapshots();
  }, [enabled, isPaused, pausedSnapshotRef, retainPausedSnapshot]);

  const ensurePausedFrame = useCallback(() => {
    const data = dataRef.current;
    const snapshot = pausedSnapshotRef?.current;
    return !!(
      (data?.iq_data && data.iq_data.length > 0) ||
      (snapshot?.iqData && snapshot.iqData.length > 0)
    );
  }, [dataRef, pausedSnapshotRef]);

  useEffect(() => {
    if (!enabled || !isPaused) return;
    hydratePauseSnapshot();
    forceRender();
  }, [enabled, isPaused, forceRender, hydratePauseSnapshot]);

  useEffect(() => {
    return () => {
      if (pausedSnapshotRef) pausedSnapshotRef.current = null;
      clearPersistedPauseSnapshots();
    };
  }, [pausedSnapshotRef]);

  return {
    hydratePauseSnapshot,
    ensurePausedFrame,
  };
}
