import { useRef, useEffect } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";

export interface FrequencyDragOptions {
  disabled?: boolean;
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
  disabled = false,
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
  
  // Refs for multi-touch pinch-to-zoom
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const initialPinchDistRef = useRef<number | null>(null);
  const lastPinchDistRef = useRef<number | null>(null);
  const initialPinchZoomRef = useRef<number>(1);
  const initialPinchPanRef = useRef<number>(0);
  const initialPinchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const PINCH_LOG_GAIN = 2.5;
  const PINCH_LOG_SPREAD = 5;
  const PINCH_VELOCITY_GAIN = 0.012;

  const containerRefCacheRef = useRef<HTMLElement | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    if (disabled) return;

    const getContainer = (): HTMLElement | null => {
      if (containerRefCacheRef.current) return containerRefCacheRef.current;
      if (spectrumContainerRef?.current) {
        containerRefCacheRef.current = spectrumContainerRef.current;
        return spectrumContainerRef.current;
      }
      const el = spectrumGpuCanvasRef.current?.parentElement ?? null;
      containerRefCacheRef.current = el;
      return el;
    };

    const getActiveSpectrumCanvas = (): HTMLElement | null => {
      return spectrumGpuCanvasRef.current ?? getContainer();
    };

    const setPointerCaptureIfAvailable = (container: HTMLElement, pointerId: number) => {
      if (typeof container.setPointerCapture === "function") {
        container.setPointerCapture(pointerId);
      }
    };

    const releasePointerCaptureIfAvailable = (
      container: HTMLElement,
      pointerId: number,
    ) => {
      if (typeof container.releasePointerCapture === "function") {
        container.releasePointerCapture(pointerId);
      }
    };

    const addClassIfAvailable = (container: HTMLElement, className: string) => {
      if (container.classList && !container.classList.contains(className)) {
        container.classList.add(className);
      }
    };

    const removeClassIfAvailable = (container: HTMLElement, className: string) => {
      if (container.classList) {
        container.classList.remove(className);
      }
    };

    const updateContainerRect = () => {
      const container = getContainer();
      if (container) {
        containerRectRef.current = container.getBoundingClientRect();
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const container = getContainer();
      if (!container) return;

      let rect = containerRectRef.current;
      if (!rect) {
        rect = container.getBoundingClientRect();
        containerRectRef.current = rect;
      }

      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Handle multi-touch pinch-to-zoom (mobile)
      if (activePointersRef.current.size === 2 && initialPinchDistRef.current && onVizZoomChange) {
        const pointers = Array.from(activePointersRef.current.values());
        const p1 = pointers[0];
        const p2 = pointers[1];
        
        const currentDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const zoomScale = currentDist / initialPinchDistRef.current;
        const lastDist = lastPinchDistRef.current ?? initialPinchDistRef.current;
        const distDelta = currentDist - lastDist;
        const distVelocity = Math.abs(distDelta);
        const normalizedDelta = zoomScale - 1;
        const logResponse =
          Math.sign(normalizedDelta) *
          Math.log1p(Math.abs(normalizedDelta) * PINCH_LOG_SPREAD);
        const easedZoomScale =
          Math.exp(
            logResponse * PINCH_LOG_GAIN +
              Math.min(0.2, distVelocity * PINCH_VELOCITY_GAIN),
          ) || 1;
        let newZoom = initialPinchZoomRef.current * easedZoomScale;
        newZoom = Math.max(1, Math.min(1000, newZoom));
        lastPinchDistRef.current = currentDist;
        
        if (newZoom !== vizZoomRef?.current) {
          onVizZoomChange(newZoom);
          
          // Optionally add panning logic here to make it "stick" to the fingers,
          // but just zooming is already a huge improvement for mobile.
        }
        return;
      }

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
            onFrequencyRangeChange({
              min: newHardwareMin,
              max: newHardwareMax,
            });

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

          if (rangeWidth >= maxBoundary - minBoundary) {
            // Overscan: The window is larger than the bounds, so the bounds
            // must be fully contained within the window.
            // windowMax >= maxBoundary => newMinFreq + rangeWidth >= maxBoundary
            // windowMin <= minBoundary => newMinFreq <= minBoundary
            const minAllowedMinFreq = maxBoundary - rangeWidth;
            const maxAllowedMinFreq = minBoundary;

            newMinFreq = Math.max(
              minAllowedMinFreq,
              Math.min(maxAllowedMinFreq, newMinFreq),
            );
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
      const container = getContainer();
      if (!container) return;

      // Track all pointers for multi-touch
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointersRef.current.size === 2) {
        // Start multi-touch pinch
        const pointers = Array.from(activePointersRef.current.values());
        const p1 = pointers[0];
        const p2 = pointers[1];
        initialPinchDistRef.current = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        lastPinchDistRef.current = initialPinchDistRef.current;
        initialPinchZoomRef.current = vizZoomRef?.current || 1;
        initialPinchPanRef.current = vizPanOffsetRef?.current || 0;
        initialPinchCenterRef.current = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2,
        };
        
        // Cancel single-touch interactions
        isDraggingRef.current = false;
        isBoxDraggingRef.current = false;
        if (selectionBoxRef.current) {
          selectionBoxRef.current.remove();
          selectionBoxRef.current = null;
        }
        setPointerCaptureIfAvailable(container, e.pointerId);
        return;
      }

      const rect = container.getBoundingClientRect();
      const height = rect.height;
      const y = e.clientY - rect.top;
      const vfoThreshold = 60;

      // Bottom area is the VFO area
      if (y >= height - vfoThreshold) {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartFreqRef.current = frequencyRangeRef.current.min;
        dragStartPanRef.current = vizPanOffsetRef?.current || 0;
        dragStartRangeRef.current = { ...frequencyRangeRef.current };
        addClassIfAvailable(container, "cursor-grabbing");
        removeClassIfAvailable(container, "cursor-grab");
        setPointerCaptureIfAvailable(container, e.pointerId);
      } else {
        // Upper area is for box zooming
        isBoxDraggingRef.current = true;
        boxStartRef.current = { x: e.clientX, y: e.clientY };
        boxCurrentRef.current = { x: e.clientX, y: e.clientY };
        setPointerCaptureIfAvailable(container, e.pointerId);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const container = getContainer();

      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        initialPinchDistRef.current = null;
        lastPinchDistRef.current = null;
        initialPinchCenterRef.current = null;
      }

      if (isBoxDraggingRef.current && container) {
        isBoxDraggingRef.current = false;
        releasePointerCaptureIfAvailable(container, e.pointerId);

        if (selectionBoxRef.current) {
          const rect = container.getBoundingClientRect();
          const startX = boxStartRef.current.x - rect.left;
          const startY = boxStartRef.current.y - rect.top;
          const currentX = boxCurrentRef.current.x - rect.left;
          const currentY = boxCurrentRef.current.y - rect.top;

          const boxWidth = Math.abs(currentX - startX);
          const boxHeight = Math.abs(currentY - startY);

          // Only zoom if the box is reasonably sized (avoid accidental clicks)
          if (
            boxWidth > 10 &&
            boxHeight > 10 &&
            onVizZoomChange &&
            onVizPanChange &&
            onFftDbLimitsChange
          ) {
            const zoom = vizZoomRef?.current || 1;
            const fullRange =
              frequencyRangeRef.current.max - frequencyRangeRef.current.min;

            // Use the actual clamped visual range from the renderer for precise mapping
            const currentVisualRange = clampedVizRangeRef?.current || {
              min: frequencyRangeRef.current.min,
              max: frequencyRangeRef.current.max,
            };
            const visualMin = currentVisualRange.min;
            const visualRangeSpan =
              currentVisualRange.max - currentVisualRange.min;

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
            const trueCenter =
              (frequencyRangeRef.current.min + frequencyRangeRef.current.max) /
              2;
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

              const binStart = Math.max(
                0,
                Math.floor(
                  ((newFreqMin - fullFreqMin) / fullFreqSpan) * totalBins,
                ),
              );
              const binEnd = Math.min(
                totalBins - 1,
                Math.ceil(
                  ((newFreqMax - fullFreqMin) / fullFreqSpan) * totalBins,
                ),
              );

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
        container.releasePointerCapture(e.pointerId);
        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const vfoThreshold = 60;
        if (y >= rect.height - vfoThreshold) {
          addClassIfAvailable(container, "cursor-grab");
          removeClassIfAvailable(container, "cursor-crosshair");
        } else {
          addClassIfAvailable(container, "cursor-crosshair");
          removeClassIfAvailable(container, "cursor-grab");
        }
        removeClassIfAvailable(container, "cursor-grabbing");
      }
      isDraggingRef.current = false;
    };

    const handlePointerMoveForCursor = (e: PointerEvent) => {
      const container = getContainer();
      if (!container || isDraggingRef.current) return;

      const rect = containerRectRef.current || container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const vfoThreshold = 60;

      const isOverVfo = y >= rect.height - vfoThreshold;
      
      if (isOverVfo) {
        if (!container.classList || !container.classList.contains("cursor-grab")) {
          addClassIfAvailable(container, "cursor-grab");
          removeClassIfAvailable(container, "cursor-crosshair");
        }
      } else {
        if (!container.classList || !container.classList.contains("cursor-crosshair")) {
          addClassIfAvailable(container, "cursor-crosshair");
          removeClassIfAvailable(container, "cursor-grab");
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      const container = getContainer();
      if (!container) return;

      const rect =
        containerRectRef.current || container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const vfoThreshold = 60;

      // 1. Handle Pinch-to-Zoom (ctrlKey is true on trackpad pinches)
      if (e.ctrlKey) {
        e.preventDefault();
        if (!onVizZoomChange || !vizZoomRef) return;

        const zoom = vizZoomRef.current;
        // Use an exponential scale for a smoother, "premium" feel.
        // deltaY is negative for zooming in, positive for zooming out.
        // Sensitivity 0.003 provides a "stronger" response than the previous linear 1.05 factor.
        const sensitivity = 0.003;
        let newZoom = zoom * Math.exp(-e.deltaY * sensitivity);

        newZoom = Math.max(1, Math.min(1000, newZoom));

        if (Math.abs(newZoom - zoom) > 0.001) {
          // Zoom relative to the gesture or mouse position so the content
          // stays anchored under the user's fingers/pointer.
          const canvas = getActiveSpectrumCanvas();
          if (canvas) {
            const canvasRect = canvas.getBoundingClientRect();
            const focusX =
              activePointersRef.current.size === 2 && initialPinchCenterRef.current
                ? initialPinchCenterRef.current.x
                : e.clientX;
            const anchorX =
              activePointersRef.current.size === 2 && initialPinchCenterRef.current
                ? initialPinchCenterRef.current.x
                : e.clientX;
            const currentAnchorX = focusX - canvasRect.left;
            const initialAnchorX = anchorX - canvasRect.left;
            const width = canvasRect.width;

            const fullRange =
              frequencyRangeRef.current.max - frequencyRangeRef.current.min;
            const currentVisualRange = fullRange / zoom;
            const currentPan = vizPanOffsetRef?.current || 0;
            const centerFreq =
              (frequencyRangeRef.current.min + frequencyRangeRef.current.max) /
              2;
            const visualMin =
              centerFreq + currentPan - currentVisualRange / 2;

            // Frequency currently under the gesture anchor at the start.
            const freqAtAnchor =
              visualMin + (initialAnchorX / width) * currentVisualRange;

            // Update zoom
            onVizZoomChange(newZoom);

            // Adjust pan so freqAtAnchor stays under the current anchor position.
            if (onVizPanChange) {
              const newVisualRange = fullRange / newZoom;
              const newVisualMin =
                freqAtAnchor - (currentAnchorX / width) * newVisualRange;
              let newPan = newVisualMin + newVisualRange / 2 - centerFreq;

              const maxPan = fullRange / 2 - newVisualRange / 2;
              newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
              onVizPanChange(newPan);
            }
          } else {
            onVizZoomChange(newZoom);
          }
        }
        return;
      }

      if (y >= rect.height - vfoThreshold) {
        // Move laterally on scroll
        e.preventDefault();

        // Use deltaY for vertical scroll wheels to move laterally
        // Use deltaX for horizontal scroll wheels/gestures
        const delta =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;

        const canvas = getActiveSpectrumCanvas();
        if (!canvas) return;
        const width = canvas.getBoundingClientRect().width || 1;

        const zoom = vizZoomRef?.current || 1;
        const fullRange =
          frequencyRangeRef.current.max - frequencyRangeRef.current.min;
        const visualRange = fullRange / zoom;

        // Scroll sensitivity: roughly 1 pixel per unit of delta
        const deltaPx = delta;
        const freqChange = (deltaPx / width) * visualRange;

        if (zoom > 1 && onVizPanChange && vizPanOffsetRef) {
          // Visual panning mode (zoomed)
          const currentPan = vizPanOffsetRef.current;
          const maxPan = fullRange / 2 - visualRange / 2;

          // Scrolling down/right (delta > 0) shows higher frequencies -> increase pan
          let newPan = currentPan + freqChange;
          newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
          onVizPanChange(newPan);
        } else if (onFrequencyRangeChange) {
          // Hardware retune mode
          const currentRange = frequencyRangeRef.current;
          const currentMin = currentRange.min;
          const newMin = currentMin + freqChange;
          const newMax = newMin + fullRange;

          // Simple boundary check
          const bounds =
            signalAreaBounds?.[activeSignalArea] ||
            signalAreaBounds?.[activeSignalArea.toLowerCase()];
          if (bounds) {
            if (newMin < bounds.min) {
              onFrequencyRangeChange({
                min: bounds.min,
                max: bounds.min + fullRange,
              });
            } else if (newMax > bounds.max) {
              onFrequencyRangeChange({
                min: bounds.max - fullRange,
                max: bounds.max,
              });
            } else {
              onFrequencyRangeChange({ min: newMin, max: newMax });
            }
          } else {
            onFrequencyRangeChange({ min: newMin, max: newMax });
          }
        }
      }
    };

    const handlePointerLeave = () => {
      const container = getContainer();
      if (container && !isDraggingRef.current) {
        removeClassIfAvailable(container, "cursor-grab");
        removeClassIfAvailable(container, "cursor-crosshair");
        removeClassIfAvailable(container, "cursor-grabbing");
      }
    };

    const container = getContainer();
    if (!container) return;

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMoveForCursor);
    container.addEventListener("pointerleave", handlePointerLeave);
    container.addEventListener("wheel", handleWheel, { passive: false });
    
    addClassIfAvailable(container, "cursor-crosshair");

    const resizeObserver = new ResizeObserver(updateContainerRect);
    resizeObserver.observe(container);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      resizeObserver.disconnect();
      containerRefCacheRef.current = null;
      containerRectRef.current = null;
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMoveForCursor);
      container.removeEventListener("pointerleave", handlePointerLeave);
      container.removeEventListener("wheel", handleWheel);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [
    disabled,
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
}
