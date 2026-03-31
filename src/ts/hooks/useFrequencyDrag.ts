import { useRef, useEffect } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";

export interface FrequencyDragOptions {
  spectrumGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
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
  clampedVizRangeRef?: React.MutableRefObject<FrequencyRange>;
  onVizPanChange?: (pan: number) => void;
  vizDbMinRef?: React.MutableRefObject<number>;
  vizDbMaxRef?: React.MutableRefObject<number>;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  onVizZoomChange?: (zoom: number) => void;
  /** Reference to the full current waveform data to check if selection is empty */
  renderWaveformRef?: React.MutableRefObject<Float32Array | null>;
}

export function useFrequencyDrag({
  spectrumGpuCanvasRef,
  spectrumGpuCanvasNode,
  spectrumContainerRef,
  frequencyRangeRef,
  spectrumWebgpuEnabled,
  activeSignalArea,
  signalAreaBounds,
  onFrequencyRangeChange,
  vizZoomRef,
  vizPanOffsetRef,
  clampedVizRangeRef,
  onVizPanChange,
  vizDbMinRef,
  vizDbMaxRef,
  onFftDbLimitsChange,
  onVizZoomChange,
  renderWaveformRef,
}: FrequencyDragOptions) {
  const isDraggingRef = useRef(false);
  const isBoxDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartFreqRef = useRef(0);
  const dragStartPanRef = useRef(0);
  const dragStartRangeRef = useRef<FrequencyRange>({ min: 0, max: 0 });
  const boxStartRef = useRef({ x: 0, y: 0 });
  const boxCurrentRef = useRef({ x: 0, y: 0 });
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // The canvas layer has pointer-events:none so we must attach to the
    // container div (CanvasWrapper) which sits behind the canvas and
    // naturally receives all pointer events.
    const getContainer = (): HTMLElement | null => {
      if (spectrumContainerRef?.current) return spectrumContainerRef.current;
      return spectrumGpuCanvasRef.current?.parentElement ?? null;
    };

    const getActiveSpectrumCanvas = (): HTMLElement | null => {
      return spectrumGpuCanvasRef.current ?? getContainer();
    };

    const handlePointerMove = (e: PointerEvent) => {
      const container = getContainer();
      if (!container) return;
      const rect = container.getBoundingClientRect();

      if (isBoxDraggingRef.current) {
        boxCurrentRef.current = { x: e.clientX, y: e.clientY };
        
        // Render box
        if (!selectionBoxRef.current) {
          const div = document.createElement("div");
          if (div.style) {
            div.style.position = "absolute";
            div.style.border = "1px dashed rgba(255, 255, 255, 0.8)";
            div.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
            div.style.pointerEvents = "none";
            div.style.zIndex = "100";
          }
          container.appendChild(div);
          selectionBoxRef.current = div;
        }

        const div = selectionBoxRef.current;
        const startX = boxStartRef.current.x - rect.left;
        const startY = boxStartRef.current.y - rect.top;
        const currentX = boxCurrentRef.current.x - rect.left;
        const currentY = boxCurrentRef.current.y - rect.top;

        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        // Clamp to container bounds
        div.style.left = `${Math.max(0, left)}px`;
        div.style.top = `${Math.max(0, top)}px`;
        div.style.width = `${Math.min(rect.width - left, width)}px`;
        div.style.height = `${Math.min(rect.height - top, height)}px`;
        return;
      }

      const canvas = getActiveSpectrumCanvas();
      if (!isDraggingRef.current || !canvas) return;


      const canvasRect = canvas.getBoundingClientRect();
      const width = canvasRect.width;

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
        const desiredPan = dragStartPanRef.current - freqChange;

        if (onFrequencyRangeChange) {
          // Check if we need to shift the hardware window (pan-retune)
          if (Math.abs(desiredPan) > maxPan + 0.001) {
            // Calculate where the center SHOULD be in absolute frequency space
            const currentHardwareCenter =
              (dragStartRangeRef.current.min + dragStartRangeRef.current.max) /
              2;
            const visualCenter = currentHardwareCenter + desiredPan;

            // Calculate a new hardware window centered on this visual center
            const hardwareSpan = fullRange;
            const halfHardware = hardwareSpan / 2;

            let newHardwareMin = visualCenter - halfHardware;
            let newHardwareMax = visualCenter + halfHardware;

            // Clamp hardware window to signal area bounds
            const bounds =
              signalAreaBounds?.[activeSignalArea] ??
              signalAreaBounds?.[activeSignalArea.toLowerCase()];
            if (bounds) {
              if (newHardwareMin < bounds.min) {
                newHardwareMin = bounds.min;
                newHardwareMax = bounds.min + hardwareSpan;
              }
              if (newHardwareMax > bounds.max) {
                newHardwareMax = bounds.max;
                newHardwareMin = newHardwareMax - hardwareSpan;
              }
            }

            const newHardwareCenter = (newHardwareMin + newHardwareMax) / 2;

            // 1. Notify hardware to shift its window
            onFrequencyRangeChange({ min: newHardwareMin, max: newHardwareMax });

            // 2. Set visual pan relative to this NEW hardware center
            const remainingPan = visualCenter - newHardwareCenter;
            onVizPanChange(remainingPan);
            return;
          }
        }

        // Standard behavior: Clamp to max allowable pan (stay within window)
        const clampedPan = Math.max(-maxPan, Math.min(maxPan, desiredPan));
        onVizPanChange(clampedPan);
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
      
      // Bottom 60px is the VFO area
      if (y >= height - 60) {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartFreqRef.current = frequencyRangeRef.current.min;
        dragStartPanRef.current = vizPanOffsetRef?.current || 0;
        dragStartRangeRef.current = { ...frequencyRangeRef.current };
        container.style.cursor = "move";
        container.setPointerCapture(e.pointerId);
      } else {
        // Upper area is for box zooming
        isBoxDraggingRef.current = true;
        boxStartRef.current = { x: e.clientX, y: e.clientY };
        boxCurrentRef.current = { x: e.clientX, y: e.clientY };
        container.setPointerCapture(e.pointerId);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const container = getContainer();
      
      if (isBoxDraggingRef.current && container) {
        isBoxDraggingRef.current = false;
        container.releasePointerCapture(e.pointerId);

        if (selectionBoxRef.current) {
          const rect = container.getBoundingClientRect();
          const startX = boxStartRef.current.x - rect.left;
          const startY = boxStartRef.current.y - rect.top;
          const currentX = boxCurrentRef.current.x - rect.left;
          const currentY = boxCurrentRef.current.y - rect.top;

          const boxWidth = Math.abs(currentX - startX);
          const boxHeight = Math.abs(currentY - startY);

          // Only zoom if the box is reasonably sized (avoid accidental clicks)
          if (boxWidth > 10 && boxHeight > 10 && onVizZoomChange && onVizPanChange && onFftDbLimitsChange) {
            const zoom = vizZoomRef?.current || 1;
            const fullRange = frequencyRangeRef.current.max - frequencyRangeRef.current.min;
            
            // Use the actual clamped visual range from the renderer for precise mapping
            const currentVisualRange = clampedVizRangeRef?.current || {
              min: frequencyRangeRef.current.min,
              max: frequencyRangeRef.current.max
            };
            const visualMin = currentVisualRange.min;
            const visualRangeSpan = currentVisualRange.max - currentVisualRange.min;
            
            const left = Math.min(startX, currentX);
            const top = Math.min(startY, currentY);

            // Account for FFT plot area margins (in CSS pixels).
            // The overlay renderer and 2D spectrum trace both use:
            //   Left:   FFT_AREA_MIN.x = 50 CSS px
            //   Top:    FFT_AREA_MIN.y = 20 CSS px
            //   Right:  containerWidth - 40 CSS px
            //   Bottom: containerHeight - 40 CSS px
            const plotLeftCSS = 50;
            const plotRightCSS = rect.width - 40;
            const plotTopCSS = 20;
            const plotBottomCSS = rect.height - 40;
            const plotWidthCSS = plotRightCSS - plotLeftCSS;
            const plotHeightCSS = plotBottomCSS - plotTopCSS;

            // Clamp selection coordinates to the plot area
            const selLeft = Math.max(left, plotLeftCSS);
            const selRight = Math.min(left + boxWidth, plotRightCSS);
            const selTop = Math.max(top, plotTopCSS);
            const selBottom = Math.min(top + boxHeight, plotBottomCSS);

            const clampedBoxWidth = selRight - selLeft;
            const clampedBoxHeight = selBottom - selTop;

            if (clampedBoxWidth < 5 || clampedBoxHeight < 5) {
              // Too small after clamping to plot area
              selectionBoxRef.current.remove();
              selectionBoxRef.current = null;
              return;
            }

            // Map plot-area-relative coordinates to frequency
            const freqFracLeft = (selLeft - plotLeftCSS) / plotWidthCSS;
            const freqFracRight = (selRight - plotLeftCSS) / plotWidthCSS;
            const newFreqMin = visualMin + freqFracLeft * visualRangeSpan;
            const newFreqMax = visualMin + freqFracRight * visualRangeSpan;
            
            // Zoom multiplier based on ratio of plot width to selection width
            const newZoomMultiplier = plotWidthCSS / clampedBoxWidth;
            const newZoomRaw = zoom * newZoomMultiplier;
            const newZoom = Math.max(1, Math.min(1000, newZoomRaw));
            
            // Calculate new pan to center the selection
            const targetVisualCenter = (newFreqMin + newFreqMax) / 2;
            const trueCenter = (frequencyRangeRef.current.min + frequencyRangeRef.current.max) / 2;
            let newPan = targetVisualCenter - trueCenter;

            // Clamp pan
            const clampedVisualRange = fullRange / newZoom;
            const maxPan = fullRange / 2 - clampedVisualRange / 2;
            newPan = Math.max(-maxPan, Math.min(maxPan, newPan));

            // Calculate dB bounds from plot-area-relative Y coordinates
            const currentDbMax = vizDbMaxRef?.current ?? 0;
            const currentDbMin = vizDbMinRef?.current ?? -120;
            const dbRange = currentDbMax - currentDbMin;

            // Y is inverted: top of plot area = dbMax, bottom = dbMin
            const dbFracTop = (selTop - plotTopCSS) / plotHeightCSS;
            const dbFracBottom = (selBottom - plotTopCSS) / plotHeightCSS;
            const newDbMax = Math.round(currentDbMax - dbFracTop * dbRange);
            const newDbMin = Math.round(currentDbMax - dbFracBottom * dbRange);

            // Check if there is actual signal intersecting this box
            let hasSignal = true;
            if (renderWaveformRef?.current) {
              const waveform = renderWaveformRef.current;
              const totalBins = waveform.length;
              const fullFreqMin = frequencyRangeRef.current.min;
              const fullFreqMax = frequencyRangeRef.current.max;
              const fullFreqSpan = fullFreqMax - fullFreqMin;

              const binStart = Math.max(0, Math.floor(((newFreqMin - fullFreqMin) / fullFreqSpan) * totalBins));
              const binEnd = Math.min(totalBins - 1, Math.ceil(((newFreqMax - fullFreqMin) / fullFreqSpan) * totalBins));

              if (binStart <= binEnd) {
                let maxSignal = -Infinity;
                let minSignal = Infinity;
                
                for (let i = binStart; i <= binEnd; i++) {
                  const val = waveform[i];
                  if (val > maxSignal) maxSignal = val;
                  if (val < minSignal) minSignal = val;
                }

                if (maxSignal < newDbMin || minSignal > newDbMax) {
                  hasSignal = false; // Box is completely above or below the signal
                }
              }
            }

            if (hasSignal) {
              onVizZoomChange(newZoom);
              onVizPanChange(newPan);
              onFftDbLimitsChange(newDbMin, newDbMax);
            }
          }

          selectionBoxRef.current.remove();
          selectionBoxRef.current = null;
        }
      }

      if (isDraggingRef.current && container) {
        container.style.cursor = "default";
        container.releasePointerCapture(e.pointerId);
      }
      isDraggingRef.current = false;
    };

    // Show grab cursor only in the bottom 60px VFO area, crosshair in upper area
    const handlePointerMoveForCursor = (e: PointerEvent) => {
      const measurer = getActiveSpectrumCanvas();
      const container = getContainer();
      if (!measurer || !container || isDraggingRef.current) return;
      const rect = measurer.getBoundingClientRect();
      const y = e.clientY - rect.top;
      container.style.cursor = y >= rect.height - 60 ? "grab" : "crosshair";
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
    container.style.cursor = "crosshair";

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
    spectrumGpuCanvasRef,
    spectrumContainerRef,
    spectrumGpuCanvasNode,
    frequencyRangeRef,
    vizZoomRef,
    vizPanOffsetRef,
    onVizPanChange,
    vizDbMinRef,
    vizDbMaxRef,
    onFftDbLimitsChange,
    onVizZoomChange,
    renderWaveformRef,
  ]);

  useEffect(() => {
    const getContainer = (): HTMLElement | null => {
      if (spectrumContainerRef?.current) return spectrumContainerRef.current;
      return spectrumGpuCanvasRef.current?.parentElement ?? null;
    };
    const container = getContainer();
    if (container && !isDraggingRef.current) {
      container.style.cursor = "crosshair";
    }
  }, [
    spectrumWebgpuEnabled,
    spectrumGpuCanvasRef,
    spectrumContainerRef,
  ]);
}
