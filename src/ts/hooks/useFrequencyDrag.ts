import { useRef, useEffect } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";

export interface FrequencyDragOptions {
  spectrumCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  spectrumGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  frequencyRangeRef: React.MutableRefObject<FrequencyRange>;
  spectrumWebgpuEnabled: boolean;
  activeSignalArea: string;
  signalAreaBounds?: Record<string, { min: number; max: number }>;
  onFrequencyRangeChange?: (range: FrequencyRange) => void;
  vizZoomRef?: React.MutableRefObject<number>;
  vizPanOffsetRef?: React.MutableRefObject<number>;
  onVizPanChange?: (pan: number) => void;
}

export function useFrequencyDrag({
  spectrumCanvasRef,
  spectrumGpuCanvasRef,
  frequencyRangeRef,
  spectrumWebgpuEnabled,
  activeSignalArea,
  signalAreaBounds,
  onFrequencyRangeChange,
  vizZoomRef,
  vizPanOffsetRef,
  onVizPanChange,
}: FrequencyDragOptions) {
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartFreqRef = useRef(0);
  const dragStartPanRef = useRef(0);

  useEffect(() => {
    const getActiveSpectrumCanvas = () => {
      if (spectrumWebgpuEnabled) {
        return spectrumGpuCanvasRef.current;
      } else {
        return spectrumCanvasRef.current;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const canvas = getActiveSpectrumCanvas();
      if (!isDraggingRef.current || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;

      const deltaX = e.clientX - dragStartXRef.current;
      const zoom = vizZoomRef?.current || 1;
      const fullRange = frequencyRangeRef.current.max - frequencyRangeRef.current.min;
      const visualRange = fullRange / zoom;
      const freqChange = (deltaX / width) * visualRange;

      if (zoom > 1 && onVizPanChange) {
        // Visual panning mode
        const maxPan = (fullRange / 2) - (visualRange / 2);
        
        // Dragging right (deltaX > 0) means looking at lower frequencies (shifting visual window left)
        // so we SUBTRACT freqChange from the pan offset
        let newPan = dragStartPanRef.current - freqChange;
        
        // Clamp to max allowable pan (so we stay within the hardware window)
        newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
        
        onVizPanChange(newPan);
      } else {
        // Hardware retune mode (unzoomed)
        // Dragging right (deltaX > 0) means frequency decreases
        let newMinFreq = dragStartFreqRef.current - freqChange;
        const rangeWidth = fullRange;
        let newMaxFreq = newMinFreq + rangeWidth;

        const bounds =
          signalAreaBounds?.[activeSignalArea] ??
          signalAreaBounds?.[activeSignalArea.toLowerCase()];
        if (bounds) {
          const minBoundary = bounds.min;
          const maxBoundary = bounds.max;
          if (newMinFreq < minBoundary) {
            newMinFreq = minBoundary;
            newMaxFreq = newMinFreq + rangeWidth;
          }
          if (newMaxFreq > maxBoundary) {
            newMaxFreq = maxBoundary;
            newMinFreq = newMaxFreq - rangeWidth;
          }
        }

        const newRange = { min: newMinFreq, max: newMaxFreq };
        frequencyRangeRef.current = newRange;

        if (onFrequencyRangeChange) {
          onFrequencyRangeChange(newRange);
        }
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const canvas = getActiveSpectrumCanvas();
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const height = rect.height;
      const y = e.clientY - rect.top;
      if (y >= height - 60) {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartFreqRef.current = frequencyRangeRef.current.min;
        dragStartPanRef.current = vizPanOffsetRef?.current || 0;
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const canvas = getActiveSpectrumCanvas();
      if (isDraggingRef.current && canvas) {
        canvas.style.cursor = "grab";
        canvas.releasePointerCapture(e.pointerId);
      }
      isDraggingRef.current = false;
    };

    const handlePointerEnter = () => {
      const canvas = getActiveSpectrumCanvas();
      if (canvas && !isDraggingRef.current) canvas.style.cursor = "grab";
    };

    const handlePointerLeave = () => {
      const canvas = getActiveSpectrumCanvas();
      if (canvas && !isDraggingRef.current) canvas.style.cursor = "default";
    };

    const gpuCanvas = spectrumGpuCanvasRef.current;
    const canvas2D = spectrumCanvasRef.current;

    [gpuCanvas, canvas2D].forEach((canvas) => {
      if (canvas) {
        canvas.addEventListener("pointerdown", handlePointerDown);
        canvas.addEventListener("pointerenter", handlePointerEnter);
        canvas.addEventListener("pointerleave", handlePointerLeave);
        if (canvas === getActiveSpectrumCanvas()) {
          canvas.style.cursor = "grab";
        }
      }
    });

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      [gpuCanvas, canvas2D].forEach((canvas) => {
        if (canvas) {
          canvas.removeEventListener("pointerdown", handlePointerDown);
          canvas.removeEventListener("pointerenter", handlePointerEnter);
          canvas.removeEventListener("pointerleave", handlePointerLeave);
        }
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [
    onFrequencyRangeChange,
    activeSignalArea,
    spectrumWebgpuEnabled,
    spectrumCanvasRef,
    spectrumGpuCanvasRef,
    frequencyRangeRef,
    vizZoomRef,
    vizPanOffsetRef,
    onVizPanChange,
  ]);

  useEffect(() => {
    const gpuCanvas = spectrumGpuCanvasRef.current;
    const canvas2D = spectrumCanvasRef.current;

    [gpuCanvas, canvas2D].forEach((canvas) => {
      if (canvas) {
        canvas.style.cursor = "default";
      }
    });

    const activeCanvas = spectrumWebgpuEnabled
      ? spectrumGpuCanvasRef.current
      : spectrumCanvasRef.current;
    if (activeCanvas && !isDraggingRef.current) {
      activeCanvas.style.cursor = "grab";
    }
  }, [spectrumWebgpuEnabled, spectrumCanvasRef, spectrumGpuCanvasRef]);
}
