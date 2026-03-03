import { useRef, useEffect } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";

export interface FrequencyDragOptions {
  spectrumCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  spectrumGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Pass the canvas DOM node state values so the effect re-runs when they mount */
  spectrumCanvasNode?: HTMLCanvasElement | null;
  spectrumGpuCanvasNode?: HTMLCanvasElement | null;
  /** Container div wrapping the canvases (receives pointer events since canvas has pointer-events:none) */
  spectrumContainerRef?: React.RefObject<HTMLDivElement | null>;
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
  spectrumCanvasNode,
  spectrumGpuCanvasNode,
  spectrumContainerRef,
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
  const dragStartRangeRef = useRef<FrequencyRange>({ min: 0, max: 0 });

  useEffect(() => {
    // The canvas layers have pointer-events:none so we must attach to the
    // container div (CanvasWrapper) which sits behind all canvas layers and
    // naturally receives all pointer events.
    const getContainer = (): HTMLElement | null => {
      if (spectrumContainerRef?.current) return spectrumContainerRef.current;
      // Fallback: use the parent element of whichever canvas is active
      const canvas = spectrumWebgpuEnabled
        ? spectrumGpuCanvasRef.current
        : spectrumCanvasRef.current;
      return canvas?.parentElement ?? null;
    };

    // For getBoundingClientRect we still use the canvas dimensions (same as container in practice)
    const getActiveSpectrumCanvas = (): HTMLElement | null => {
      if (spectrumWebgpuEnabled) {
        return spectrumGpuCanvasRef.current ?? getContainer();
      } else {
        return spectrumCanvasRef.current ?? getContainer();
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const canvas = getActiveSpectrumCanvas();
      if (!isDraggingRef.current || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;

      const deltaX = e.clientX - dragStartXRef.current;
      const zoom = vizZoomRef?.current || 1;
      // Use the range captured at drag start to prevent feedback loops
      // where mid-drag range updates change sensitivity
      const fullRange =
        dragStartRangeRef.current.max - dragStartRangeRef.current.min;
      const visualRange = fullRange / zoom;
      const freqChange = (deltaX / width) * visualRange;

      if (zoom > 1 && onVizPanChange) {
        // Visual panning mode (zoomed)
        const maxPan = fullRange / 2 - visualRange / 2;

        // Dragging right (deltaX > 0) means looking at lower frequencies (shifting visual window left)
        // so we SUBTRACT freqChange from the pan offset
        let newPan = dragStartPanRef.current - freqChange;

        // Clamp to max allowable pan (so we stay within the hardware window)
        newPan = Math.max(-maxPan, Math.min(maxPan, newPan));

        onVizPanChange(newPan);
      } else if (onFrequencyRangeChange) {
        // Hardware retune mode (unzoomed, live SDR only).
        // Dragging right (deltaX > 0) means frequency decreases.
        let newMinFreq = dragStartFreqRef.current - freqChange;
        const rangeWidth = fullRange;
        let newMaxFreq = newMinFreq + rangeWidth;

        const bounds =
          signalAreaBounds?.[activeSignalArea] ??
          signalAreaBounds?.[activeSignalArea.toLowerCase()];
        if (bounds) {
          // Clamp to configured signal area bounds (e.g., from signals.yaml)
          const minBoundary = bounds.min;
          const maxBoundary = bounds.max;
          
          if (rangeWidth >= (maxBoundary - minBoundary)) {
            // Overscan: The window is larger than the bounds, so the bounds
            // must be fully contained within the window.
            // windowMax >= maxBoundary => newMinFreq + rangeWidth >= maxBoundary
            // windowMin <= minBoundary => newMinFreq <= minBoundary
            const minAllowedMinFreq = maxBoundary - rangeWidth;
            const maxAllowedMinFreq = minBoundary;
            
            newMinFreq = Math.max(minAllowedMinFreq, Math.min(maxAllowedMinFreq, newMinFreq));
            newMaxFreq = newMinFreq + rangeWidth;
          } else {
            // Underscan: The window is smaller than the bounds.
            if (newMinFreq < minBoundary) {
              newMinFreq = minBoundary;
              newMaxFreq = newMinFreq + rangeWidth;
            }
            if (newMaxFreq > maxBoundary) {
              newMaxFreq = maxBoundary;
              newMinFreq = newMaxFreq - rangeWidth;
            }
          }
        } else {
          // Fallback: clamp to the drag-start range so the VFO can't retune
          // beyond the frequency window that was visible when the drag began.
          const startMin = dragStartRangeRef.current.min;
          const startMax = dragStartRangeRef.current.max;
          if (newMinFreq < startMin) {
            newMinFreq = startMin;
            newMaxFreq = newMinFreq + rangeWidth;
          }
          if (newMaxFreq > startMax) {
            newMaxFreq = startMax;
            newMinFreq = newMaxFreq - rangeWidth;
          }
        }

        const newRange = { min: newMinFreq, max: newMaxFreq };
        frequencyRangeRef.current = newRange;
        onFrequencyRangeChange(newRange);

      } else if (onVizPanChange) {
        // View-only mode (file stitcher, zoom === 1): bounded visual pan so the
        // frequency window never leaves the file's actual frequency span.
        const maxPan = fullRange / 2 - visualRange / 2;
        let newPan = dragStartPanRef.current - freqChange;
        newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
        onVizPanChange(newPan);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const measurer = getActiveSpectrumCanvas();
      const container = getContainer();
      if (!measurer || !container) return;

      const rect = measurer.getBoundingClientRect();
      const height = rect.height;
      const y = e.clientY - rect.top;
      if (y >= height - 60) {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartFreqRef.current = frequencyRangeRef.current.min;
        dragStartPanRef.current = vizPanOffsetRef?.current || 0;
        dragStartRangeRef.current = { ...frequencyRangeRef.current };
        container.style.cursor = "grabbing";
        container.setPointerCapture(e.pointerId);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const container = getContainer();
      if (isDraggingRef.current && container) {
        container.style.cursor = "default";
        container.releasePointerCapture(e.pointerId);
      }
      isDraggingRef.current = false;
    };

    // Show grab cursor only in the bottom 60px VFO area
    const handlePointerMoveForCursor = (e: PointerEvent) => {
      const measurer = getActiveSpectrumCanvas();
      const container = getContainer();
      if (!measurer || !container || isDraggingRef.current) return;
      const rect = measurer.getBoundingClientRect();
      const y = e.clientY - rect.top;
      container.style.cursor = y >= rect.height - 60 ? "grab" : "default";
    };

    const handlePointerLeave = () => {
      const container = getContainer();
      if (container && !isDraggingRef.current)
        container.style.cursor = "default";
    };

    const container = getContainer();
    if (!container) return;

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMoveForCursor);
    container.addEventListener("pointerleave", handlePointerLeave);
    container.style.cursor = "default";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMoveForCursor);
      container.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [
    onFrequencyRangeChange,
    activeSignalArea,
    spectrumWebgpuEnabled,
    spectrumCanvasRef,
    spectrumGpuCanvasRef,
    spectrumContainerRef,
    // Canvas nodes (state values) ensure the effect re-runs when the DOM
    // elements actually mount, so event listeners are attached correctly.
    spectrumCanvasNode,
    spectrumGpuCanvasNode,
    frequencyRangeRef,
    vizZoomRef,
    vizPanOffsetRef,
    onVizPanChange,
  ]);

  useEffect(() => {
    const getContainer = (): HTMLElement | null => {
      if (spectrumContainerRef?.current) return spectrumContainerRef.current;
      const canvas = spectrumWebgpuEnabled
        ? spectrumGpuCanvasRef.current
        : spectrumCanvasRef.current;
      return canvas?.parentElement ?? null;
    };
    const container = getContainer();
    if (container && !isDraggingRef.current) {
      container.style.cursor = "default";
    }
  }, [
    spectrumWebgpuEnabled,
    spectrumCanvasRef,
    spectrumGpuCanvasRef,
    spectrumContainerRef,
  ]);
}
