import { useRef, useCallback } from "react";

export interface SnapshotData {
  bitmap: ImageBitmap;
  dataUrl: Promise<string>;
  width: number;
  height: number;
}

export interface OffscreenCanvasSnapshotProps {
  sourceCanvas: HTMLCanvasElement | null;
  width: number;
  height: number;
  onSnapshot?: (data: SnapshotData) => void;
}

/**
 * OffscreenCanvas component for capturing WebGPU canvas snapshots
 * 
 * This component creates an offscreen 2D canvas to copy WebGPU canvas content
 * and convert it to exportable image formats. WebGPU textures cannot be
 * directly exported, so we copy them to a 2D canvas first.
 */
export function OffscreenCanvasSnapshot({
  sourceCanvas,
  width,
  height,
  onSnapshot,
}: OffscreenCanvasSnapshotProps) {
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);

  const ensureOffscreenCanvas = useCallback(() => {
    if (!offscreenCanvasRef.current || 
        offscreenCanvasRef.current.width !== width || 
        offscreenCanvasRef.current.height !== height) {
      offscreenCanvasRef.current = new OffscreenCanvas(width, height);
    }
    return offscreenCanvasRef.current;
  }, [width, height]);

  const captureSnapshot = useCallback((): SnapshotData | null => {
    if (!sourceCanvas) return null;

    const offscreenCanvas = ensureOffscreenCanvas();
    const ctx = offscreenCanvas.getContext('2d');
    
    if (!ctx) return null;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);

    const bitmap = offscreenCanvas.transferToImageBitmap();

    const dataUrl = offscreenCanvas.convertToBlob({ type: 'image/png' })
      .then(blob => {
        if (!blob) throw new Error('Failed to create blob');
        return URL.createObjectURL(blob);
      });

    const snapshotData: SnapshotData = {
      bitmap,
      dataUrl,
      width,
      height,
    };

    onSnapshot?.(snapshotData);

    return snapshotData;
  }, [sourceCanvas, width, height, ensureOffscreenCanvas, onSnapshot]);

  const captureRef = useRef<() => SnapshotData | null>(captureSnapshot);
  captureRef.current = captureSnapshot;

  return null;
}

/**
 * Hook for using OffscreenCanvas snapshot functionality
 */
export function useOffscreenCanvasSnapshot() {
  const captureRef = useRef<() => SnapshotData | null>(() => null);

  const setupCapture = useCallback((
    sourceCanvas: HTMLCanvasElement | null,
    width: number,
    height: number,
    onSnapshot?: (data: SnapshotData) => void
  ) => {
    const offscreenCanvas = new OffscreenCanvas(width, height);
    const ctx = offscreenCanvas.getContext('2d');
    
    if (!ctx) return null;

    const capture = (): SnapshotData | null => {
      if (!sourceCanvas) return null;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(sourceCanvas, 0, 0, width, height);

      const bitmap = offscreenCanvas.transferToImageBitmap();

      const dataUrl = offscreenCanvas.convertToBlob({ type: 'image/png' })
        .then(blob => {
          if (!blob) throw new Error('Failed to create blob');
          return URL.createObjectURL(blob);
        });

      const snapshotData: SnapshotData = {
        bitmap,
        dataUrl,
        width,
        height,
      };

      onSnapshot?.(snapshotData);

      return snapshotData;
    };

    captureRef.current = capture;
    return capture;
  }, []);

  const captureSnapshot = useCallback(() => {
    return captureRef.current();
  }, []);

  return {
    setupCapture,
    captureSnapshot,
  };
}
