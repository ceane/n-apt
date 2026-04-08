import { useRef, useCallback } from "react";
import { useAppSelector } from "@n-apt/redux";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";
import type { FrequencyRange } from "@n-apt/consts/types";
import type { PendingWaterfallRestore } from "@n-apt/utils/waterfallRestore";
import type { CanvasState } from "./useCanvasState";
import type { VisualizationState } from "./useVisualizationState";

export interface WaterfallHandlersState {
  // Waterfall processing refs
  lastWaterfallRowRef: React.MutableRefObject<Float32Array | null>;
  pausedWaterfallRowRef: React.MutableRefObject<Float32Array | null>;
  waterfallTextureSnapshotRef: React.MutableRefObject<Uint8Array | null>;
  waterfallTextureMetaRef: React.MutableRefObject<{
    width: number;
    height: number;
    writeRow: number;
  } | null>;
  heterodyningHistoryRef: React.MutableRefObject<Float32Array[]>;
  lastHeterodyningRequestIdRef: React.MutableRefObject<number>;
  pendingWaterfallRestoreRef: React.MutableRefObject<PendingWaterfallRestore | null>;
  restoredWaterfallRef: React.MutableRefObject<boolean>;

  // Waterfall processing buffers
  waterfallBufferRef: React.MutableRefObject<Uint8ClampedArray | null>;
  waterfallDataWidthRef: React.MutableRefObject<number | null>;
  bufferPoolRef: React.MutableRefObject<Uint8ClampedArray[]>;
  waterfallCappedBufferRef: React.MutableRefObject<Float32Array | null>;
  waterfallDimsRef: React.MutableRefObject<{ width: number; height: number } | null>;
  waterfallGpuDimsRef: React.MutableRefObject<{
    width: number;
    height: number;
  } | null>;

  // Waterfall motion refs
  retuneSmearRef: React.MutableRefObject<number>;
  retuneDriftPxRef: React.MutableRefObject<number>;
  lastWaterfallVisualRangeRef: React.MutableRefObject<FrequencyRange | null>;

  // Rendering functions
  drawWebGPUFIFOWaterfall: ReturnType<typeof useDrawWebGPUFIFOWaterfall>["drawWebGPUFIFOWaterfall"];

  // Utility functions
  getBufferFromPool: (size: number) => Uint8ClampedArray;
  returnBufferToPool: (buffer: Uint8ClampedArray) => void;
  clearWaterfallState: () => void;
}

export interface WaterfallHandlersProps {
  isPaused: boolean;
  isWaterfallCleared?: boolean;
  onResetWaterfallCleared?: () => void;
  heterodyningVerifyRequestId?: number;
  canvasState: CanvasState;
  visualizationState: VisualizationState;
  webgpuEnabled: boolean;
  webgpuDeviceRef: React.MutableRefObject<GPUDevice | null>;
  webgpuFormatRef: React.MutableRefObject<GPUTextureFormat | null>;
  wfSmoothEnabled?: boolean;
}

export const useWaterfallHandlers = ({
  isPaused: _isPaused,
  isWaterfallCleared = false,
  onResetWaterfallCleared,
  heterodyningVerifyRequestId: _heterodyningVerifyRequestId = 0,
  canvasState,
  visualizationState,
  webgpuEnabled: _webgpuEnabled,
  webgpuDeviceRef: _webgpuDeviceRef,
  webgpuFormatRef: _webgpuFormatRef,
  wfSmoothEnabled: _wfSmoothEnabled = false,
}: WaterfallHandlersProps): WaterfallHandlersState => {
  const { waterfallGpuCanvasRef: _waterfallGpuCanvasRef } = canvasState;

  const { effectivePowerScale: _effectivePowerScale } = visualizationState;

  // Redux state
  useAppSelector((reduxState) => reduxState.theme.waterfallTheme);

  // Waterfall processing refs
  const lastWaterfallRowRef = useRef<Float32Array | null>(null);
  const pausedWaterfallRowRef = useRef<Float32Array | null>(null);
  const waterfallTextureSnapshotRef = useRef<Uint8Array | null>(null);
  const waterfallTextureMetaRef = useRef<{
    width: number;
    height: number;
    writeRow: number;
  } | null>(null);
  const heterodyningHistoryRef = useRef<Float32Array[]>([]);
  const lastHeterodyningRequestIdRef = useRef(0);
  const pendingWaterfallRestoreRef = useRef<PendingWaterfallRestore | null>(null);
  const restoredWaterfallRef = useRef(false);

  // Waterfall processing buffers
  const waterfallBufferRef = useRef<Uint8ClampedArray | null>(null);
  const waterfallDataWidthRef = useRef<number | null>(null);
  const bufferPoolRef = useRef<Uint8ClampedArray[]>([]);
  const maxBufferPoolSize = 3;
  const waterfallCappedBufferRef = useRef<Float32Array | null>(null);
  const waterfallDimsRef = useRef<{ width: number; height: number } | null>(null);
  const waterfallGpuDimsRef = useRef<{
    width: number;
    height: number;
  } | null>(null);

  // Waterfall motion refs
  const retuneSmearRef = useRef(0);
  const retuneDriftPxRef = useRef(0);
  const lastWaterfallVisualRangeRef = useRef<FrequencyRange | null>(null);

  // Buffer pool management
  const getBufferFromPool = (size: number): Uint8ClampedArray => {
    const pool = bufferPoolRef.current;
    for (let i = 0; i < pool.length; i++) {
      const buffer = pool[i];
      if (buffer.length === size) {
        pool.splice(i, 1);
        buffer.fill(0);
        return buffer;
      }
    }
    return new Uint8ClampedArray(size);
  };

  const returnBufferToPool = (buffer: Uint8ClampedArray) => {
    const pool = bufferPoolRef.current;
    if (pool.length < maxBufferPoolSize) {
      pool.push(buffer);
    }
  };

  // Clear waterfall state
  const clearWaterfallState = useCallback(() => {
    waterfallBufferRef.current = null;
    waterfallTextureSnapshotRef.current = null;
    waterfallTextureMetaRef.current = null;
    lastWaterfallRowRef.current = null;
    pausedWaterfallRowRef.current = null;
    pendingWaterfallRestoreRef.current = null;
    restoredWaterfallRef.current = false;
    heterodyningHistoryRef.current = [];
  }, []);

  // Clear waterfall effect
  if (isWaterfallCleared) {
    clearWaterfallState();
    onResetWaterfallCleared?.();
  }

  // Waterfall rendering hook
  const { drawWebGPUFIFOWaterfall } = useDrawWebGPUFIFOWaterfall();

  return {
    // Waterfall processing refs
    lastWaterfallRowRef,
    pausedWaterfallRowRef,
    waterfallTextureSnapshotRef,
    waterfallTextureMetaRef,
    heterodyningHistoryRef,
    lastHeterodyningRequestIdRef,
    pendingWaterfallRestoreRef,
    restoredWaterfallRef,

    // Waterfall processing buffers
    waterfallBufferRef,
    waterfallDataWidthRef,
    bufferPoolRef,
    waterfallCappedBufferRef,
    waterfallDimsRef,
    waterfallGpuDimsRef,

    // Waterfall motion refs
    retuneSmearRef,
    retuneDriftPxRef,
    lastWaterfallVisualRangeRef,

    // Rendering functions
    drawWebGPUFIFOWaterfall,

    // Utility functions
    getBufferFromPool,
    returnBufferToPool,
    clearWaterfallState,
  };
};
