import { useRef, useEffect, useCallback } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";
import {
  clampVizZoom,
  getStableVizPanForZoomChange,
} from "@n-apt/spectrum/public/visualizationZoom";
import {
  clampFrequencyRangeToBounds,
  normalizeFrequencyRangeToHz,
} from "@n-apt/math/frequency";
import {
  computeEdgeResizedBand,
  getBandDragMode,
  getPointerOffsetWithinBandHz,
  computeBandPanWithEdgePanning,
} from "@n-apt/spectrum/public/edgePanning";
import {
  displayRangeNeedsBasebandMirror,
  resolveDisplayRangeForPanOffset,
  resolveMirroredRetune,
  sourceCoversMirroredDisplay,
} from "@n-apt/math/basebandMirror";

const LIVE_STATUS_ROW_HEIGHT = 56;

export type CanvasTxSliderState = {
  visible: boolean;
  visibleMinHz: number;
  visibleMaxHz: number;
  txCenterHz: number;
  txSampleRateHz: number;
  /** Standby preview uses the band body as an independent VFO control. */
  isPreviewVfo?: boolean;
  isTransmitting?: boolean;
  powerDbm?: number;
  onCenterFrequencyChange?: (valueHz: number, isDragging?: boolean) => void;
  onSampleRateChange?: (valueHz: number) => void;
  onGeometryChange?: (
    centerFrequencyHz: number,
    sampleRateHz: number,
    isDragging?: boolean,
  ) => void;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
  onOptionsRequest?: () => void;
};

export interface FrequencyDragOptions {
  disabled?: boolean;
  selectionMode?: "zoom" | "range";
  spectrumGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  spectrumGpuCanvasNode?: HTMLCanvasElement | null;
  /** Container div wrapping the canvases (receives pointer events since canvas has pointer-events:none) */
  spectrumContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** Mutable ref to store the live relative zoombox coordinates, keeping it out of React state. */
  zoomboxStateRef?: React.MutableRefObject<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>;
  frequencyRangeRef: React.MutableRefObject<FrequencyRange>;
  spectrumWebgpuEnabled: boolean;
  activeSignalArea: string;
  signalAreaBounds?: Record<string, { min: number; max: number }>;
  hardwareSpectrumBounds?: FrequencyRange | null;
  allowNegativeFrequencies?: boolean;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
  /** Currently active demodulation selection range */
  selectionRange?: FrequencyRange;
  /** Callback for selection range changes (dragging the box) */
  onSelectionChange?: (range: FrequencyRange) => void;
  /** Use the full canvas as the selectable plot area. React Flow FFT nodes render this way. */
  fullPlotSelection?: boolean;
  /** Shift the displayed frequency range at selection edges instead of overscrolling FFT data. */
  selectionEdgePanMode?: "visual" | "frequency-range";
  /** Whether a plain drag inside an existing range edits that band or starts a new range. */
  rangeSelectionInteraction?: "create-only" | "edit-existing";
  vizZoomRef?: React.MutableRefObject<number>;
  vizZoomFloorRef?: React.MutableRefObject<number>;
  maxVizZoom?: number;
  vizPanOffsetRef?: React.MutableRefObject<number>;
  clampedVizRangeRef?: React.MutableRefObject<FrequencyRange>;
  onVizPanChange?: (pan: number) => void;
  vizDbMinRef?: React.MutableRefObject<number>;
  vizDbMaxRef?: React.MutableRefObject<number>;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  onVizZoomChange?: (zoom: number) => void;
  onVizZoomFloorChange?: (zoomFloor: number) => void;
  /** Callback to update the floor pan offset (auto zoom stability). */
  onVizZoomFloorPanChange?: (pan: number) => void;
  /** Ref tracking the current auto zoom stability toggle. */
  autoZoomStabilityRef?: React.MutableRefObject<boolean>;
  /** Reference to the full current waveform data to check if selection is empty */
  renderWaveformRef?: React.MutableRefObject<Float32Array | null>;
  /** Maximum allowed bandwidth for the selection range */
  maxBandwidthHz?: number;
  /** Mutable ref to store the live selection range during drag, avoiding Redux thrashing */
  liveDragSelectionRef?: React.MutableRefObject<FrequencyRange | null>;
  /** Callback triggered on every drag step to force overlay repaint without React re-render */
  onDragRepaint?: () => void;
  /** Callback triggered when the mutable Tx slider geometry changes. */
  onTxSliderRepaint?: () => void;
  tooltipSpanRef?: React.RefObject<HTMLSpanElement | null>;
  powerLineDbRef?: React.MutableRefObject<number | null>;
  onPowerLineDbChange?: (db: number | null) => void;
  onPowerLineHoldChange?: (held: boolean) => void;
  powerScale?: "dB" | "dBm";
  txSliderRef?: React.MutableRefObject<CanvasTxSliderState | null>;
  txSliderEnabled?: boolean;
  txSliderLocked?: boolean;
}

export function useSpectrumInteraction({
  disabled = false,
  selectionMode = "zoom",
  spectrumGpuCanvasRef,
  spectrumGpuCanvasNode,
  spectrumContainerRef,
  zoomboxStateRef,
  frequencyRangeRef,
  spectrumWebgpuEnabled,
  activeSignalArea,
  signalAreaBounds,
  hardwareSpectrumBounds,
  allowNegativeFrequencies = false,
  onFrequencyRangeChange,
  selectionRange,
  onSelectionChange,
  fullPlotSelection = false,
  selectionEdgePanMode = "visual",
  rangeSelectionInteraction = "create-only",
  vizZoomRef,
  vizZoomFloorRef,
  maxVizZoom,
  vizPanOffsetRef,
  clampedVizRangeRef,
  onVizPanChange,
  vizDbMinRef,
  vizDbMaxRef,
  onFftDbLimitsChange,
  onVizZoomChange,
  onVizZoomFloorChange,
  onVizZoomFloorPanChange,
  autoZoomStabilityRef,
  renderWaveformRef,
  maxBandwidthHz,
  liveDragSelectionRef,
  onDragRepaint,
  onTxSliderRepaint,
  tooltipSpanRef,
  powerLineDbRef,
  onPowerLineDbChange,
  onPowerLineHoldChange,
  powerScale = "dB",
  txSliderRef,
  txSliderEnabled = false,
  txSliderLocked = false,
}: FrequencyDragOptions) {
  const isDraggingRef = useRef(false);
  const isBoxDraggingRef = useRef(false);
  const isPowerDraggingRef = useRef(false);
  const isPowerHeldRef = useRef(false);
  const isTxSliderDraggingRef = useRef(false);
  const txSliderHandleRef = useRef<"left" | "right" | "body" | null>(null);
  const txSliderBodyDragOffsetHzRef = useRef(0);
  const pendingTxGeometryRef = useRef<{
    centerFrequencyHz: number;
    sampleRateHz: number;
  } | null>(null);
  const txGeometryAnimationFrameRef = useRef<number | null>(null);
  const publishPendingTxGeometry = useCallback(
    (isDragging: boolean) => {
      if (txGeometryAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(txGeometryAnimationFrameRef.current);
        txGeometryAnimationFrameRef.current = null;
      }
      const pending = pendingTxGeometryRef.current;
      pendingTxGeometryRef.current = null;
      if (!pending) return;
      txSliderRef?.current?.onGeometryChange?.(
        pending.centerFrequencyHz,
        pending.sampleRateHz,
        isDragging,
      );
    },
    [txSliderRef],
  );
  const scheduleTxGeometryPublish = useCallback(
    (centerFrequencyHz: number, sampleRateHz: number) => {
      pendingTxGeometryRef.current = {
        centerFrequencyHz,
        sampleRateHz,
      };
      if (txGeometryAnimationFrameRef.current !== null) return;
      txGeometryAnimationFrameRef.current = window.requestAnimationFrame(() => {
        txGeometryAnimationFrameRef.current = null;
        publishPendingTxGeometry(true);
      });
    },
    [publishPendingTxGeometry],
  );
  useEffect(
    () => () => {
      if (txGeometryAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(txGeometryAnimationFrameRef.current);
      }
    },
    [],
  );
  const dragStartXRef = useRef(0);
  const dragStartFreqRef = useRef(0);
  const dragStartPanRef = useRef(0);
  const dragStartRangeRef = useRef<FrequencyRange>({ min: 0, max: 0 });
  const dragStartSelectionRef = useRef<FrequencyRange>({ min: 0, max: 0 });
  const isSelectionDraggingRef = useRef(false);
  const boxStartRef = useRef({ x: 0, y: 0 });
  const boxCurrentRef = useRef({ x: 0, y: 0 });
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const selectionDraftRangeRef = useRef<FrequencyRange | null>(null);
  const selectionDragOriginFreqRef = useRef<number | null>(null);
  const selectionDragModeRef = useRef<
    "create" | "move" | "resize-left" | "resize-right" | null
  >(null);
  const selectionEdgePanFrameRef = useRef<number | null>(null);
  const selectionEdgePanTimestampRef = useRef<number | null>(null);
  const selectionEdgePanPointerRef = useRef<{
    clientX: number;
    canvasRect: DOMRect;
  } | null>(null);
  const latestSelectionRangeRef = useRef<FrequencyRange | undefined>(
    selectionRange,
  );
  const latestOnSelectionChangeRef =
    useRef<typeof onSelectionChange>(onSelectionChange);

  // Throttled Redux dispatch refs
  const lastDispatchTimeRef = useRef<number>(0);
  const pendingDispatchRef = useRef<FrequencyRange | null>(null);
  const dispatchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep the callback fresh without recreating the native event listeners.
  // The backend owns latest-value coalescing; the browser must not add another
  // debounce or timer in front of a live VFO gesture.
  const onFrequencyRangeChangeRef = useRef(onFrequencyRangeChange);
  onFrequencyRangeChangeRef.current = onFrequencyRangeChange;
  const onDragRepaintRef = useRef(onDragRepaint);
  onDragRepaintRef.current = onDragRepaint;
  const publishHardwareRange = (range: FrequencyRange) => {
    frequencyRangeRef.current = range;
    // Overlay paint reads the ref on the existing rAF loop. Dirty it here so
    // VFO labels move with the gesture instead of waiting for a Redux render.
    onDragRepaintRef.current?.();
    onFrequencyRangeChangeRef.current?.(range);
  };

  /** Cached bounding rect for the active spectrum canvas — captured on pointerDown,
   *  invalidated on resize. Avoids per-move getBoundingClientRect layout thrashing. */
  const canvasDragRectRef = useRef<DOMRect | null>(null);

  // Refs for multi-touch pinch-to-zoom
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const initialPinchDistRef = useRef<number | null>(null);
  const lastPinchDistRef = useRef<number | null>(null);
  const initialPinchZoomRef = useRef<number>(1);
  const initialPinchPanRef = useRef<number>(0);
  const initialPinchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const txPinchInitialDistRef = useRef<number | null>(null);
  const txPinchInitialBandwidthRef = useRef<number>(1);
  const PINCH_LOG_GAIN = 2.5;
  const PINCH_LOG_SPREAD = 5;
  const PINCH_VELOCITY_GAIN = 0.012;

  const containerRefCacheRef = useRef<HTMLElement | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);
  const getReservedBottomHeight = () => LIVE_STATUS_ROW_HEIGHT;
  const getVfoInteractionHeight = () => 60 + getReservedBottomHeight();

  useEffect(() => {
    if (!txSliderLocked) return;
    isTxSliderDraggingRef.current = false;
    txSliderHandleRef.current = null;
    txSliderBodyDragOffsetHzRef.current = 0;
  }, [txSliderLocked]);

  const getPlotBounds = (rect: DOMRect) => {
    if (fullPlotSelection) {
      return {
        left: 0,
        right: rect.width,
        top: 0,
        bottom: rect.height,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
    }

    const left = Math.min(50, rect.width);
    const right = Math.max(left, rect.width - 40);
    const top = Math.min(20, rect.height);
    const bottom = Math.max(top, rect.height - 40 - getReservedBottomHeight());
    return {
      left,
      right,
      top,
      bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  };

  const frequencyFromClientX = (
    clientX: number,
    canvasRect: DOMRect,
    hardwareBounds: FrequencyRange,
    zoom: number = 1,
    pan: number = 0,
    clampToCanvas: boolean = true,
  ) => {
    const plot = getPlotBounds(canvasRect);
    // Use double-precision math for sub-pixel accuracy at high zoom
    let x = clientX - canvasRect.left;
    if (clampToCanvas) {
      x = Math.max(plot.left, Math.min(plot.right, x));
    }
    const frac = (x - plot.left) / plot.width;

    const fullSpan = hardwareBounds.max - hardwareBounds.min;
    const visualSpan = fullSpan / zoom;
    const hardwareCenter = (hardwareBounds.min + hardwareBounds.max) / 2;
    const visualCenter = hardwareCenter + pan;
    const visualMin = visualCenter - visualSpan / 2;

    return visualMin + frac * visualSpan;
  };

  const getTxSliderGeometry = (rect: DOMRect) => {
    const plot = getPlotBounds(rect);
    const rowInset = 3;
    const labelWidth = 47;
    const trailingInset = 37;
    const left = rowInset;
    const right = Math.max(left, rect.width - rowInset);
    const top = Math.max(
      plot.bottom - rowInset,
      rect.height - getReservedBottomHeight() + rowInset,
    );
    const bottom = rect.height - rowInset;
    const trackLeft = labelWidth;
    const trackRight = Math.max(trackLeft + 80, rect.width - trailingInset);
    return {
      left,
      right,
      top,
      bottom,
      trackLeft,
      trackRight,
      trackWidth: Math.max(1, trackRight - trackLeft),
    };
  };

  const isTxSliderReady = (
    slider: CanvasTxSliderState | null | undefined,
  ): slider is CanvasTxSliderState =>
    !!slider?.visible &&
    Number.isFinite(slider.visibleMinHz) &&
    Number.isFinite(slider.visibleMaxHz) &&
    slider.visibleMaxHz > slider.visibleMinHz &&
    Number.isFinite(slider.txCenterHz) &&
    Number.isFinite(slider.txSampleRateHz);

  const isPointInTxSlider = (
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ) => {
    const slider = txSliderRef?.current;
    if (!isTxSliderReady(slider)) return false;
    const geometry = getTxSliderGeometry(rect);
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return (
      x >= geometry.left &&
      x <= geometry.right &&
      y >= geometry.top &&
      y <= geometry.bottom
    );
  };

  /** Return the currently visible frequency range.
   *  `clampedVizRangeRef` is updated every render frame by the FFT
   *  canvas and already includes zoom + pan, so return it directly.
   *  Fall back to computing from the frequency range ref + zoom/pan
   *  when the clamped ref is unavailable. */
  const getTxVisualRange = (slider: CanvasTxSliderState) => {
    if (clampedVizRangeRef?.current) {
      return clampedVizRangeRef.current;
    }
    const zoom = vizZoomRef?.current ?? 1;
    const pan = vizPanOffsetRef?.current ?? 0;
    const range = frequencyRangeRef.current;
    const fullSpan = range.max - range.min;
    const visualSpan = fullSpan / zoom;
    const center = (range.min + range.max) / 2 + pan;
    return {
      min: center - visualSpan / 2,
      max: center + visualSpan / 2,
    };
  };

  const getTxSliderFrequencyForX = (
    x: number,
    rect: DOMRect,
    clampToTrack = true,
  ) => {
    const slider = txSliderRef?.current;
    const geometry = getTxSliderGeometry(rect);
    if (!isTxSliderReady(slider)) {
      return null;
    }
    const trackX = clampToTrack
      ? Math.max(geometry.trackLeft, Math.min(geometry.trackRight, x))
      : x;
    const frac = (trackX - geometry.trackLeft) / geometry.trackWidth;
    const visualRange = getTxVisualRange(slider);
    return visualRange.min + frac * (visualRange.max - visualRange.min);
  };

  const updateTxSliderFromPointer = (clientX: number) => {
    const slider = txSliderRef?.current;
    const canvasRect = canvasDragRectRef.current;
    const handle = txSliderHandleRef.current;
    if (!slider || !canvasRect || !handle) return;
    const pointerHz = getTxSliderFrequencyForX(
      clientX - canvasRect.left,
      canvasRect,
      false,
    );
    if (pointerHz === null) return;

    const visibleSpan = slider.visibleMaxHz - slider.visibleMinHz;
    if (!Number.isFinite(visibleSpan) || visibleSpan <= 0) return;

    const currentBandwidth = Math.max(1, slider.txSampleRateHz);
    if (slider.isPreviewVfo && handle === "body") {
      const pointerHz = getTxSliderFrequencyForX(
        clientX - canvasRect.left,
        canvasRect,
        false,
      );
      if (pointerHz === null) return;

      const nextCenter = pointerHz - txSliderBodyDragOffsetHzRef.current;
      slider.txCenterHz = nextCenter;
      slider.txSampleRateHz = currentBandwidth;
      scheduleTxGeometryPublish(nextCenter, currentBandwidth);
      onTxSliderRepaint?.();
      onDragRepaint?.();
      return;
    }
    const currentMin = slider.txCenterHz - currentBandwidth / 2;
    const currentMax = slider.txCenterHz + currentBandwidth / 2;
    const minBandwidth = Math.min(25_000, Math.max(1, visibleSpan * 0.01));
    const maxBandwidth = Math.max(minBandwidth, visibleSpan);
    const visualRange = getTxVisualRange(slider);
    const geometry = getTxSliderGeometry(canvasRect);
    const canvasX = clientX - canvasRect.left;
    let nextMin = currentMin;
    let nextMax = currentMax;

    if (handle === "left") {
      const nextBand = computeEdgeResizedBand({
        visibleMinHz: visualRange.min,
        visibleMaxHz: visualRange.max,
        startHz: currentMin,
        endHz: currentMax,
        pointerHz,
        activeHandle: "left",
        minSpanHz: minBandwidth,
      });
      nextMin = nextBand.startHz;
      nextMax = nextBand.endHz;
    } else if (handle === "right") {
      const nextBand = computeEdgeResizedBand({
        visibleMinHz: visualRange.min,
        visibleMaxHz: visualRange.max,
        startHz: currentMin,
        endHz: currentMax,
        pointerHz,
        activeHandle: "right",
        minSpanHz: minBandwidth,
      });
      nextMin = nextBand.startHz;
      nextMax = nextBand.endHz;
    } else {
      // Body drag: slide band across visible range, edge-pan at edges.
      const clampedPointerHz = getTxSliderFrequencyForX(
        clientX - canvasRect.left,
        canvasRect,
        true,
      );
      if (clampedPointerHz === null) return;

      const stepHz = getTxEdgePanStepHz(visualRange.max - visualRange.min);
      const nextBand = computeBandPanWithEdgePanning({
        visibleMinHz: visualRange.min,
        visibleMaxHz: visualRange.max,
        startHz: currentMin,
        endHz: currentMax,
        pointerHz: clampedPointerHz,
        pointerOffsetHz: txSliderBodyDragOffsetHzRef.current,
        hardwareMinHz: hardwareSpectrumBounds?.min,
        hardwareMaxHz: hardwareSpectrumBounds?.max,
        stepHz,
      });

      nextMin = nextBand.startHz;
      nextMax = nextBand.endHz;

      // If the visible range changed, pan the spectrum (i.e. notify the app)
      if (
        nextBand.visibleMinHz !== visualRange.min ||
        nextBand.visibleMaxHz !== visualRange.max
      ) {
        if (onFrequencyRangeChange) {
          const nextRange = {
            min: nextBand.visibleMinHz,
            max: nextBand.visibleMaxHz,
          };
          frequencyRangeRef.current = nextRange;
          onFrequencyRangeChange(nextRange);
        }
        // Recalculate drag offset so it doesn't jump on the next move
        txSliderBodyDragOffsetHzRef.current = clampedPointerHz - nextMin;
      }
    }

    let nextBandwidth = Math.max(
      minBandwidth,
      Math.min(maxBandwidth, nextMax - nextMin),
    );
    const nextCenter = (nextMin + nextMax) / 2;

    slider.txSampleRateHz = nextBandwidth;
    slider.txCenterHz = nextCenter;
    if (slider.onGeometryChange) {
      scheduleTxGeometryPublish(nextCenter, nextBandwidth);
    } else {
      slider.onCenterFrequencyChange?.(nextCenter, true);
      slider.onSampleRateChange?.(nextBandwidth);
    }
    onTxSliderRepaint?.();
    onDragRepaint?.();
  };

  const getTxEdgePanStepHz = (visualSpanHz: number) => {
    if (!Number.isFinite(visualSpanHz) || visualSpanHz <= 0) return 0;
    if (visualSpanHz >= 5_000_000) {
      return Math.min(1_000_000, Math.max(500_000, visualSpanHz * 0.1));
    }
    return Math.max(1, visualSpanHz * 0.1);
  };

  const panTxSliderByHz = (deltaHz: number) => {
    const slider = txSliderRef?.current;
    if (!isTxSliderReady(slider)) return;

    const visualRange = getTxVisualRange(slider);
    const bandwidth = Math.max(1, slider.txSampleRateHz);
    const currentMin = slider.txCenterHz - bandwidth / 2;
    const currentMax = slider.txCenterHz + bandwidth / 2;

    const stepHz = getTxEdgePanStepHz(visualRange.max - visualRange.min);
    const nextBand = computeBandPanWithEdgePanning({
      visibleMinHz: visualRange.min,
      visibleMaxHz: visualRange.max,
      startHz: currentMin + deltaHz,
      endHz: currentMax + deltaHz,
      pointerHz: currentMin + deltaHz,
      pointerOffsetHz: 0,
      hardwareMinHz: hardwareSpectrumBounds?.min,
      hardwareMaxHz: hardwareSpectrumBounds?.max,
      stepHz,
    });

    const nextCenter = nextBand.centerHz;

    // If the visible range changed, pan the spectrum
    if (
      nextBand.visibleMinHz !== visualRange.min ||
      nextBand.visibleMaxHz !== visualRange.max
    ) {
      if (onFrequencyRangeChange) {
        const nextRange = {
          min: nextBand.visibleMinHz,
          max: nextBand.visibleMaxHz,
        };
        frequencyRangeRef.current = nextRange;
        onFrequencyRangeChange(nextRange);
      }
    }

    slider.txCenterHz = nextCenter;
    slider.onCenterFrequencyChange?.(nextCenter, true);
    onTxSliderRepaint?.();
    onDragRepaint?.();
  };

  const zoomTxSliderBandwidth = (scale: number) => {
    const slider = txSliderRef?.current;
    if (!isTxSliderReady(slider) || !Number.isFinite(scale) || scale <= 0)
      return;
    const visibleSpan = slider.visibleMaxHz - slider.visibleMinHz;
    const nextBandwidth = Math.max(
      1,
      Math.min(visibleSpan, slider.txSampleRateHz * scale),
    );
    slider.txSampleRateHz = nextBandwidth;
    slider.onSampleRateChange?.(nextBandwidth);
    onTxSliderRepaint?.();
    onDragRepaint?.();
  };

  useEffect(() => {
    latestSelectionRangeRef.current = selectionRange;
  }, [selectionRange]);

  useEffect(() => {
    latestOnSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    if (disabled) return;

    const throttleDispatch = (range: FrequencyRange) => {
      const emitSelectionChange = latestOnSelectionChangeRef.current;
      if (!emitSelectionChange) return;

      const isTestEnv =
        typeof process !== "undefined" && process.env?.NODE_ENV === "test";
      if (isTestEnv) {
        emitSelectionChange(range);
        return;
      }

      const now = performance.now();
      const throttleLimit = 80; // 80ms throttle is perfect (~12.5 fps)

      pendingDispatchRef.current = range;

      if (now - lastDispatchTimeRef.current >= throttleLimit) {
        if (dispatchTimeoutRef.current) {
          clearTimeout(dispatchTimeoutRef.current);
          dispatchTimeoutRef.current = null;
        }
        emitSelectionChange(range);
        lastDispatchTimeRef.current = now;
        pendingDispatchRef.current = null;
      } else if (!dispatchTimeoutRef.current) {
        dispatchTimeoutRef.current = setTimeout(
          () => {
            const finalEmit = latestOnSelectionChangeRef.current;
            if (pendingDispatchRef.current && finalEmit) {
              finalEmit(pendingDispatchRef.current);
              lastDispatchTimeRef.current = performance.now();
              pendingDispatchRef.current = null;
            }
            dispatchTimeoutRef.current = null;
          },
          throttleLimit - (now - lastDispatchTimeRef.current),
        );
      }
    };

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

    const setPointerCaptureIfAvailable = (
      container: HTMLElement,
      pointerId: number,
    ) => {
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

    const removeClassIfAvailable = (
      container: HTMLElement,
      className: string,
    ) => {
      if (container.classList) {
        container.classList.remove(className);
      }
    };

    const getActiveSignalAreaBounds = (): FrequencyRange | null => {
      const bounds =
        signalAreaBounds?.[activeSignalArea] ??
        signalAreaBounds?.[activeSignalArea?.toLowerCase?.()] ??
        null;
      if (
        !bounds ||
        !Number.isFinite(bounds.min) ||
        !Number.isFinite(bounds.max) ||
        bounds.max <= bounds.min
      ) {
        return null;
      }
      return { min: bounds.min, max: bounds.max };
    };

    const stopSelectionEdgePan = () => {
      if (selectionEdgePanFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionEdgePanFrameRef.current);
        selectionEdgePanFrameRef.current = null;
      }
      selectionEdgePanTimestampRef.current = null;
      selectionEdgePanPointerRef.current = null;
    };

    const getSelectionEdgePanVelocity = (
      clientX: number,
      canvasRect: DOMRect,
    ): number => {
      if (
        selectionEdgePanMode !== "frequency-range" ||
        !fullPlotSelection ||
        !onFrequencyRangeChange
      ) {
        return 0;
      }

      const plot = getPlotBounds(canvasRect);
      const x = clientX - canvasRect.left;
      const edgeZonePx = Math.min(32, plot.width / 4);
      const visibleSpan =
        frequencyRangeRef.current.max - frequencyRangeRef.current.min;
      if (edgeZonePx <= 0 || visibleSpan <= 0) return 0;

      let direction = 0;
      let strength = 0;
      if (x <= plot.left + edgeZonePx) {
        direction = -1;
        strength = Math.min(1, (plot.left + edgeZonePx - x) / edgeZonePx);
      } else if (x >= plot.right - edgeZonePx) {
        direction = 1;
        strength = Math.min(1, (x - (plot.right - edgeZonePx)) / edgeZonePx);
      }

      const dragMode = selectionDragModeRef.current;
      if (
        direction === 0 ||
        (dragMode === "resize-left" && direction > 0) ||
        (dragMode === "resize-right" && direction < 0)
      ) {
        return 0;
      }

      return direction * visibleSpan * 0.6 * strength;
    };

    const applySelectionEdgePan = (timestamp: number) => {
      selectionEdgePanFrameRef.current = null;
      const pointer = selectionEdgePanPointerRef.current;
      const emitSelectionChange = latestOnSelectionChangeRef.current;
      if (
        !pointer ||
        !isSelectionDraggingRef.current ||
        !selectionDragModeRef.current ||
        !emitSelectionChange ||
        !onFrequencyRangeChange
      ) {
        stopSelectionEdgePan();
        return;
      }

      const velocity = getSelectionEdgePanVelocity(
        pointer.clientX,
        pointer.canvasRect,
      );
      if (velocity === 0) {
        stopSelectionEdgePan();
        return;
      }

      const previousTimestamp = selectionEdgePanTimestampRef.current;
      selectionEdgePanTimestampRef.current = timestamp;
      if (previousTimestamp !== null) {
        const elapsedSeconds = Math.min(
          0.1,
          Math.max(0, timestamp - previousTimestamp) / 1000,
        );
        const requestedShift = velocity * elapsedSeconds;
        const currentRange = frequencyRangeRef.current;
        const allowedBounds = getActiveSignalAreaBounds() ?? {
          min: 0,
          max: 10_000_000_000,
        };
        const rangeSpan = currentRange.max - currentRange.min;
        const nextMin = Math.max(
          allowedBounds.min,
          Math.min(
            allowedBounds.max - rangeSpan,
            currentRange.min + requestedShift,
          ),
        );
        const actualShift = nextMin - currentRange.min;

        if (actualShift !== 0) {
          const nextRange = { min: nextMin, max: nextMin + rangeSpan };
          frequencyRangeRef.current = nextRange;
          dragStartRangeRef.current = nextRange;
          onFrequencyRangeChange(nextRange);

          const currentSelection =
            selectionDraftRangeRef.current ?? latestSelectionRangeRef.current;
          if (currentSelection) {
            const dragMode = selectionDragModeRef.current;
            const shiftedSelection =
              dragMode === "move"
                ? {
                    min: currentSelection.min + actualShift,
                    max: currentSelection.max + actualShift,
                  }
                : dragMode === "resize-left"
                  ? {
                      min: currentSelection.min + actualShift,
                      max: currentSelection.max,
                    }
                  : dragMode === "resize-right"
                    ? {
                        min: currentSelection.min,
                        max: currentSelection.max + actualShift,
                      }
                    : actualShift < 0
                      ? {
                          min: currentSelection.min + actualShift,
                          max: currentSelection.max,
                        }
                      : {
                          min: currentSelection.min,
                          max: currentSelection.max + actualShift,
                        };
            const nextSelection = clampSelectionToFrequencyRange(
              shiftedSelection,
              allowedBounds,
            );
            selectionDraftRangeRef.current = nextSelection;
            if (liveDragSelectionRef) {
              liveDragSelectionRef.current = nextSelection;
            }
            throttleDispatch(nextSelection);
          }
          onDragRepaint?.();
        }
      }

      selectionEdgePanFrameRef.current = window.requestAnimationFrame(
        applySelectionEdgePan,
      );
    };

    const updateSelectionEdgePanPointer = (
      clientX: number,
      canvasRect: DOMRect,
    ) => {
      selectionEdgePanPointerRef.current = { clientX, canvasRect };
      if (getSelectionEdgePanVelocity(clientX, canvasRect) === 0) {
        stopSelectionEdgePan();
        return;
      }
      if (selectionEdgePanFrameRef.current === null) {
        selectionEdgePanTimestampRef.current = null;
        selectionEdgePanFrameRef.current = window.requestAnimationFrame(
          applySelectionEdgePan,
        );
      }
    };

    const clampRangeToTuningBounds = (
      range: FrequencyRange,
    ): FrequencyRange => {
      const channelBounds = getActiveSignalAreaBounds();
      const normalized = normalizeFrequencyRangeToHz(
        clampFrequencyRangeToBounds(
          clampFrequencyRangeToBounds(range, channelBounds),
          hardwareSpectrumBounds,
        ),
      );
      return normalized.min < 0
        ? {
            min: 0,
            max: Math.max(0, normalized.max - normalized.min),
          }
        : normalized;
    };

    const clampWheelRangeToHardwareBounds = (
      range: FrequencyRange,
    ): FrequencyRange => {
      const normalized = normalizeFrequencyRangeToHz(
        clampFrequencyRangeToBounds(range, hardwareSpectrumBounds),
      );
      return normalized.min < 0
        ? {
            min: 0,
            max: Math.max(0, normalized.max - normalized.min),
          }
        : normalized;
    };

    const getVizPanBounds = (
      sourceRange: FrequencyRange,
      zoom: number,
      constrainToActiveChannel = true,
    ): { min: number; max: number } => {
      const fullRange = sourceRange.max - sourceRange.min;
      if (!Number.isFinite(fullRange) || fullRange <= 0 || zoom <= 0) {
        return { min: 0, max: 0 };
      }

      const visualRange = fullRange / zoom;
      const center = (sourceRange.min + sourceRange.max) / 2;
      let minPan: number;
      let maxPan: number;

      if (allowNegativeFrequencies) {
        // Mirror pan is unbounded on the display axis. Frequencies the radio has
        // not acquired floor in the shader; pan itself must not stop at ±SR.
        minPan = Number.NEGATIVE_INFINITY;
        maxPan = Number.POSITIVE_INFINITY;
      } else {
        maxPan = Math.max(0, fullRange / 2 - visualRange / 2);
        const lowerDisplayBound = Math.max(0, sourceRange.min);
        minPan = lowerDisplayBound + visualRange / 2 - center;
      }

      const channelBounds = constrainToActiveChannel && !allowNegativeFrequencies
        ? getActiveSignalAreaBounds()
        : null;
      if (channelBounds) {
        const channelMinPan = channelBounds.min + visualRange / 2 - center;
        const channelMaxPan = channelBounds.max - visualRange / 2 - center;

        if (channelMinPan <= channelMaxPan) {
          minPan = Math.max(minPan, channelMinPan);
          maxPan = Math.min(maxPan, channelMaxPan);
        } else {
          const channelCenterPan =
            (channelBounds.min + channelBounds.max) / 2 - center;
          const pinnedPan = Math.max(
            minPan,
            Math.min(maxPan, channelCenterPan),
          );
          minPan = Math.max(minPan, pinnedPan);
          maxPan = pinnedPan;
        }
      }

      if (minPan > maxPan) {
        const pinnedPan = (minPan + maxPan) / 2;
        return { min: pinnedPan, max: pinnedPan };
      }

      return { min: minPan, max: maxPan };
    };

    const clampVizPan = (
      pan: number,
      sourceRange: FrequencyRange,
      zoom: number,
      panBounds: FrequencyRange | null | undefined = null,
    ): number => {
      if (allowNegativeFrequencies) {
        return pan;
      }
      const bounds = getVizPanBounds(
        panBounds ?? sourceRange,
        zoom,
        panBounds == null,
      );
      return Math.max(bounds.min, Math.min(bounds.max, pan));
    };

    const maybeRetuneHardwareWindow = ({
      nextPan,
      zoom,
    }: {
      nextPan: number;
      zoom: number;
    }) => {
      if (!onFrequencyRangeChange || !onVizPanChange) return false;

      const fullRange =
        frequencyRangeRef.current.max - frequencyRangeRef.current.min;
      if (!Number.isFinite(fullRange) || fullRange <= 0) return false;

      if (allowNegativeFrequencies) {
        const displayRange = resolveDisplayRangeForPanOffset({
          hardwareRange: frequencyRangeRef.current,
          zoom,
          panOffsetHz: nextPan,
        });
        // Single |f| below 0 Hz. Retune whenever the viewport needs RF the
        // acquisition does not cover — including wholly negative pans past
        // ±SR. Covered viewports stay presentation-only (no Channel A tiles).
        if (
          sourceCoversMirroredDisplay(
            frequencyRangeRef.current,
            displayRange,
          )
        ) {
          return false;
        }
        const tuningBounds =
          hardwareSpectrumBounds ??
          signalAreaBounds?.[activeSignalArea] ??
          null;
        const retune = resolveMirroredRetune({
          displayRange,
          sourceRange: frequencyRangeRef.current,
          hardwareBounds: tuningBounds,
        });
        if (!retune.needsRetune) {
          return false;
        }
        const appliedPan = retune.panOffsetHz;
        publishHardwareRange(retune.range);
        onVizPanChange(appliedPan);
        if (vizPanOffsetRef) {
          vizPanOffsetRef.current = appliedPan;
        }
        // Pointer-drag pan is measured from pointer-down. A mirror retune
        // moves the hardware center and replaces pan with displayCenter −
        // nextCenter (a large negative offset). Leave dragStartPan on the
        // old axis and the next pointermove treats that offset as a jump
        // back toward DC, then retunes again — the negative-direction stall.
        dragStartPanRef.current =
          appliedPan + (dragStartPanRef.current - nextPan);
        dragStartRangeRef.current = { ...retune.range };
        dragStartFreqRef.current = retune.range.min;
        if (
          autoZoomStabilityRef?.current &&
          (vizZoomFloorRef?.current ?? 1) > 1
        ) {
          onVizZoomFloorPanChange?.(appliedPan);
        }
        return true;
      }

      const panBounds = getVizPanBounds(
        frequencyRangeRef.current,
        zoom,
        false,
      );
      if (nextPan >= panBounds.min && nextPan <= panBounds.max) return false;

      const overflowPan =
        nextPan < panBounds.min
          ? nextPan - panBounds.min
          : nextPan - panBounds.max;

      const currentHardwareCenter =
        (frequencyRangeRef.current.min + frequencyRangeRef.current.max) / 2;
      const hardwareSpan = fullRange;
      const halfHardware = hardwareSpan / 2;

      const clampedHardwareRange = clampWheelRangeToHardwareBounds({
        min: currentHardwareCenter + overflowPan - halfHardware,
        max: currentHardwareCenter + overflowPan + halfHardware,
      });

      const newHardwareCenter =
        (clampedHardwareRange.min + clampedHardwareRange.max) / 2;
      publishHardwareRange({
        min: clampedHardwareRange.min,
        max: clampedHardwareRange.max,
      });

      const remainingPan = clampVizPan(
        nextPan - (newHardwareCenter - currentHardwareCenter),
        clampedHardwareRange,
        zoom,
        hardwareSpectrumBounds ?? signalAreaBounds?.[activeSignalArea],
      );
      onVizPanChange(remainingPan);
      if (vizPanOffsetRef) {
        vizPanOffsetRef.current = remainingPan;
      }

      if (
        autoZoomStabilityRef?.current &&
        (vizZoomFloorRef?.current ?? 1) > 1
      ) {
        onVizZoomFloorPanChange?.(remainingPan);
      }
      return true;
    };

    const displayNeedsMirror = (pan: number, zoom: number) =>
      allowNegativeFrequencies &&
      displayRangeNeedsBasebandMirror(
        resolveDisplayRangeForPanOffset({
          hardwareRange: frequencyRangeRef.current,
          zoom,
          panOffsetHz: pan,
        }),
      );

    // The setting must not put unzoomed positive pans on the visual-pan +
    // retune path. That retunes every tick and is why mirror-on scrolling
    // felt slower than mirror-off. Visual pan only when zoomed or f<0.
    const shouldUseVisualPan = (pan: number, zoom: number) =>
      zoom > 1 || displayNeedsMirror(pan, zoom);

    const updateContainerRect = () => {
      const container = getContainer();
      if (container) {
        containerRectRef.current = container.getBoundingClientRect();
      }
    };

    const ensureSelectionBox = (container: HTMLElement) => {
      const overlayHost = container.ownerDocument?.body ?? document.body;
      if (selectionBoxRef.current) {
        if (selectionBoxRef.current.parentNode !== overlayHost) {
          overlayHost.appendChild(selectionBoxRef.current);
        }
        return selectionBoxRef.current;
      }

      const div = document.createElement("div");
      // Keep the transient box outside the React-owned canvas subtree. React
      // may reconcile that subtree while frames are arriving and remove an
      // imperatively appended child, which makes the zoombox flash.
      div.style.position = "fixed";
      div.style.border = "2px solid rgba(56, 189, 248, 0.98)";
      div.style.backgroundColor = "rgba(56, 189, 248, 0.14)";
      div.style.boxShadow =
        "inset 0 0 0 1px rgba(255, 255, 255, 0.9), 0 0 0 2px rgba(8, 47, 73, 0.9)";
      div.style.pointerEvents = "none";
      div.style.zIndex = "2147483647";
      div.style.opacity = "1";
      div.style.visibility = "visible";
      div.style.transition = "none";
      div.style.animation = "none";
      div.style.willChange = "left, top, width, height";
      div.style.display = "none";

      const centerLine = document.createElement("div");
      if (centerLine !== div) {
        centerLine.style.position = "absolute";
        centerLine.style.top = "0";
        centerLine.style.bottom = "0";
        centerLine.style.left = "50%";
        centerLine.style.width = "2px";
        centerLine.style.background = "rgba(255, 255, 255, 0.95)";
        centerLine.style.boxShadow = "0 0 0 1px rgba(8, 47, 73, 0.9)";
        centerLine.style.transform = "translateX(-50%)";
        centerLine.style.pointerEvents = "none";
        div.appendChild(centerLine);
      }

      overlayHost.appendChild(div);
      selectionBoxRef.current = div;
      return div;
    };

    const clearZoomboxCanvas = () => {
      if (zoomboxStateRef) {
        zoomboxStateRef.current = null;
      }
      onDragRepaint?.();
    };

    const drawZoomboxCanvas = (
      rect: DOMRect,
      start: { x: number; y: number },
      current: { x: number; y: number },
    ) => {
      if (!zoomboxStateRef) return false;
      const startX = start.x - rect.left;
      const startY = start.y - rect.top;
      const currentX = current.x - rect.left;
      const currentY = current.y - rect.top;

      zoomboxStateRef.current = { startX, startY, currentX, currentY };
      onDragRepaint?.();
      return true;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isTxSliderDraggingRef.current) {
        updateTxSliderFromPointer(e.clientX);
        return;
      }

      const container = getContainer();
      if (!container) return;

      let rect = containerRectRef.current;
      if (!rect) {
        rect = container.getBoundingClientRect();
        containerRectRef.current = rect;
      }

      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });
      }

      if (
        isPowerDraggingRef.current &&
        onPowerLineDbChange &&
        vizDbMinRef &&
        vizDbMaxRef
      ) {
        const canvas = getActiveSpectrumCanvas();
        const canvasRect = (canvas ? canvasDragRectRef.current : null) || rect;
        const canvasY = e.clientY - canvasRect.top;
        const canvasX = e.clientX - canvasRect.left;
        const plot = getPlotBounds(canvasRect);
        const clampedY = Math.max(plot.top, Math.min(plot.bottom, canvasY));
        const isSpectrumSide = canvasX >= plot.left;
        const txPowerDbm = txSliderRef?.current?.powerDbm;
        const hasSnapDot =
          powerScale === "dBm" &&
          typeof txPowerDbm === "number" &&
          Number.isFinite(txPowerDbm);
        const fraction = (plot.bottom - clampedY) / (plot.bottom - plot.top);
        const db =
          vizDbMinRef.current +
          fraction * (vizDbMaxRef.current - vizDbMinRef.current);
        const snapY = (() => {
          if (!hasSnapDot || !vizDbMinRef || !vizDbMaxRef) return null;
          const snapFraction =
            (txPowerDbm - vizDbMinRef.current) /
            (vizDbMaxRef.current - vizDbMinRef.current);
          return plot.bottom - snapFraction * (plot.bottom - plot.top);
        })();
        const dotHit = Boolean(
          hasSnapDot && snapY !== null && Math.abs(clampedY - snapY) <= 5,
        );
        const heldNow = isSpectrumSide;
        if (heldNow !== isPowerHeldRef.current) {
          isPowerHeldRef.current = heldNow;
          onPowerLineHoldChange?.(heldNow);
        }
        onPowerLineDbChange(dotHit ? (txPowerDbm ?? null) : db);
        if (onDragRepaint) {
          onDragRepaint();
        }
        return;
      }

      // Handle multi-touch pinch-to-zoom (mobile)
      if (
        activePointersRef.current.size === 2 &&
        txPinchInitialDistRef.current
      ) {
        const pointers = Array.from(activePointersRef.current.values());
        const p1 = pointers[0];
        const p2 = pointers[1];
        const currentDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const scale = currentDist / txPinchInitialDistRef.current;
        const slider = txSliderRef?.current;
        if (isTxSliderReady(slider)) {
          const visibleSpan = slider.visibleMaxHz - slider.visibleMinHz;
          const newBandwidth = Math.max(
            1,
            Math.min(visibleSpan, txPinchInitialBandwidthRef.current * scale),
          );
          slider.txSampleRateHz = newBandwidth;
          slider.onSampleRateChange?.(newBandwidth);
          onTxSliderRepaint?.();
          onDragRepaint?.();
        }
        return;
      }

      if (
        activePointersRef.current.size === 2 &&
        initialPinchDistRef.current &&
        onVizZoomChange
      ) {
        const pointers = Array.from(activePointersRef.current.values());
        const p1 = pointers[0];
        const p2 = pointers[1];

        const currentDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const zoomScale = currentDist / initialPinchDistRef.current;
        const lastDist =
          lastPinchDistRef.current ?? initialPinchDistRef.current;
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
        const zoomFloor = vizZoomFloorRef?.current ?? 1;
        let newZoom = initialPinchZoomRef.current * easedZoomScale;
        newZoom = clampVizZoom(newZoom, zoomFloor, maxVizZoom);
        lastPinchDistRef.current = currentDist;

        if (newZoom !== vizZoomRef?.current) {
          const currentPan = vizPanOffsetRef?.current || 0;
          const nextPan = onVizPanChange
            ? getStableVizPanForZoomChange({
                currentZoom: vizZoomRef?.current || 1,
                currentPan,
                nextZoom: newZoom,
                rangeMin: frequencyRangeRef.current.min,
                rangeMax: frequencyRangeRef.current.max,
                allowNegativeFrequencies,
              })
            : currentPan;

          onVizZoomChange(newZoom);
          if (onVizPanChange && nextPan !== currentPan) {
            onVizPanChange(nextPan);
          }

          // Keep pinch zoom centered when the view is already near center,
          // but still respect deliberate off-center pans.
        }
        return;
      }

      if (isBoxDraggingRef.current) {
        boxCurrentRef.current = { x: e.clientX, y: e.clientY };

        if (
          drawZoomboxCanvas(rect, boxStartRef.current, boxCurrentRef.current)
        ) {
          return;
        }

        const div = ensureSelectionBox(container);
        div.style.display = "block";
        const startX = boxStartRef.current.x - rect.left;
        const startY = boxStartRef.current.y - rect.top;
        const currentX = boxCurrentRef.current.x - rect.left;
        const currentY = boxCurrentRef.current.y - rect.top;

        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        // Clamp to container bounds
        div.style.left = `${Math.min(boxStartRef.current.x, boxCurrentRef.current.x)}px`;
        div.style.top = `${Math.min(boxStartRef.current.y, boxCurrentRef.current.y)}px`;
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        return;
      }

      const emitSelectionChange = latestOnSelectionChangeRef.current;

      if (
        isSelectionDraggingRef.current &&
        selectionMode !== "range" &&
        emitSelectionChange
      ) {
        const canvas = getActiveSpectrumCanvas();
        if (!canvas) return;

        const canvasRect =
          canvasDragRectRef.current || canvas.getBoundingClientRect();
        const width = canvasRect.width;

        const deltaX = e.clientX - dragStartXRef.current;
        const zoom = vizZoomRef?.current || 1;
        const fullRange =
          frequencyRangeRef.current.max - frequencyRangeRef.current.min;
        const visualRange = fullRange / zoom;
        const freqChange = (deltaX / width) * visualRange;

        const newMin = dragStartSelectionRef.current.min + freqChange;
        const newMax = dragStartSelectionRef.current.max + freqChange;

        const channelBounds =
          signalAreaBounds?.[activeSignalArea] ||
          hardwareSpectrumBounds ||
          frequencyRangeRef.current;
        const clampedRange = clampSelectionToFrequencyRange(
          { min: newMin, max: newMax },
          channelBounds,
        );

        if (liveDragSelectionRef) {
          liveDragSelectionRef.current = clampedRange;
        }
        if (onDragRepaint) {
          onDragRepaint();
        }
        throttleDispatch(clampedRange);
        return;
      }

      if (
        selectionMode === "range" &&
        selectionDragModeRef.current &&
        emitSelectionChange
      ) {
        const canvas = getActiveSpectrumCanvas();
        if (!canvas) return;
        const canvasRect =
          canvasDragRectRef.current || canvas.getBoundingClientRect();
        const bounds =
          dragStartRangeRef.current.max > dragStartRangeRef.current.min
            ? dragStartRangeRef.current
            : frequencyRangeRef.current;

        const currentPan = vizPanOffsetRef?.current || 0;
        // Calculate the live frequency under the pointer (using current pan)
        const pointerFreq = frequencyFromClientX(
          e.clientX,
          canvasRect,
          bounds,
          vizZoomRef?.current,
          currentPan,
          false, // DO NOT clamp to canvas to enable out-of-bounds dragging
        );

        const current =
          selectionDraftRangeRef.current ?? latestSelectionRangeRef.current;
        const dragStartBase =
          dragStartSelectionRef.current.max > dragStartSelectionRef.current.min
            ? dragStartSelectionRef.current
            : null;
        const base =
          selectionDragModeRef.current === "create"
            ? current && current.max > current.min
              ? current
              : null
            : dragStartBase;

        // Allow selecting anywhere > 0Hz, regardless of hardware bounds,
        // but clamp to active signal area bounds (channel start/end) if available.
      const channelBounds = allowNegativeFrequencies
        ? null
        : getActiveSignalAreaBounds();
        const allowedBounds = channelBounds
          ? { min: Math.max(0, channelBounds.min), max: channelBounds.max }
          : { min: 0, max: 10_000_000_000 };

        let next: FrequencyRange;

        if (selectionDragModeRef.current === "create" || !base) {
          const origin = selectionDragOriginFreqRef.current ?? pointerFreq;
          let newMin = Math.min(origin, pointerFreq);
          let newMax = Math.max(origin, pointerFreq);
          if (maxBandwidthHz && newMax - newMin > maxBandwidthHz) {
            if (pointerFreq < origin) {
              newMin = origin - maxBandwidthHz;
            } else {
              newMax = origin + maxBandwidthHz;
            }
          }
          next = normalizeSelectionRange(newMin, newMax, allowedBounds);
        } else if (selectionDragModeRef.current === "move") {
          const origin = selectionDragOriginFreqRef.current ?? pointerFreq;
          const delta = pointerFreq - origin;
          next = clampSelectionToFrequencyRange(
            {
              min: base.min + delta,
              max: base.max + delta,
            },
            allowedBounds,
          );
        } else if (selectionDragModeRef.current === "resize-left") {
          let newMin = pointerFreq;
          if (maxBandwidthHz && base.max - newMin > maxBandwidthHz) {
            newMin = base.max - maxBandwidthHz;
          }
          next = clampEdgeToBounds(newMin, base.max, allowedBounds);
        } else {
          // resize-right
          let newMax = pointerFreq;
          if (maxBandwidthHz && newMax - base.min > maxBandwidthHz) {
            newMax = base.min + maxBandwidthHz;
          }
          next = clampEdgeToBounds(base.min, newMax, allowedBounds);
        }

        // --- Edge panning ---
        const zoom = vizZoomRef?.current || 1;
        const fullSpan = bounds.max - bounds.min;
        const visualSpan = fullSpan / zoom;
        const centerFreq = (bounds.min + bounds.max) / 2;
        const visualMin = centerFreq + currentPan - visualSpan / 2;
        const visualMax = centerFreq + currentPan + visualSpan / 2;

        if (
          selectionEdgePanMode === "frequency-range" &&
          onFrequencyRangeChange
        ) {
          const edgePan = computeBandPanWithEdgePanning({
            visibleMinHz: visualMin,
            visibleMaxHz: visualMax,
            startHz: next.min,
            endHz: next.max,
            pointerHz: pointerFreq,
            pointerOffsetHz: pointerFreq - next.min,
            hardwareMinHz: allowedBounds.min,
            hardwareMaxHz: allowedBounds.max,
          });
          if (
            edgePan.visibleMinHz !== visualMin ||
            edgePan.visibleMaxHz !== visualMax
          ) {
            const shiftedRange = {
              min: edgePan.visibleMinHz,
              max: edgePan.visibleMaxHz,
            };
            frequencyRangeRef.current = shiftedRange;
            dragStartRangeRef.current = shiftedRange;
            onFrequencyRangeChange(shiftedRange);
          }
        } else {
          const margin = visualSpan * 0.03; // 3% edge threshold
          let newPan = currentPan;
          let shouldPan = false;

          // Push the pan offset if pointer hits the edge
          if (pointerFreq > visualMax - margin) {
            newPan += pointerFreq - (visualMax - margin);
            shouldPan = true;
          } else if (pointerFreq < visualMin + margin) {
            newPan -= visualMin + margin - pointerFreq;
            shouldPan = true;
          }

          if (shouldPan) {
            if (maybeRetuneHardwareWindow({ nextPan: newPan, zoom })) {
              // Hardware window retuned and pan updated
            } else if (onVizPanChange) {
              // Limit panning bounds, but allow visual pan if full plot selection is active
              const clampedPan = allowNegativeFrequencies
                ? newPan
                : fullPlotSelection
                  ? Math.max(-centerFreq, newPan)
                  : clampVizPan(
                      newPan,
                      bounds,
                      zoom,
                      hardwareSpectrumBounds ??
                        signalAreaBounds?.[activeSignalArea],
                    );
              onVizPanChange(clampedPan);
              if (vizPanOffsetRef) {
                vizPanOffsetRef.current = clampedPan;
              }
            }
          }
        }

        updateSelectionEdgePanPointer(e.clientX, canvasRect);
        selectionDraftRangeRef.current = next;
        if (liveDragSelectionRef) {
          liveDragSelectionRef.current = next;
        }

        if (tooltipSpanRef?.current) {
          tooltipSpanRef.current.textContent = `Span: ${Math.round(next.max - next.min).toLocaleString()} Hz`;
        }

        if (onDragRepaint) {
          onDragRepaint();
        }

        throttleDispatch(next);
        return;
      }

      const canvas = getActiveSpectrumCanvas();
      if (!isDraggingRef.current || !canvas) return;

      const canvasRect =
        canvasDragRectRef.current || canvas.getBoundingClientRect();
      const width = canvasRect.width;

      const deltaX = e.clientX - dragStartXRef.current;
      const zoom = vizZoomRef?.current || 1;
      // Use the range captured at drag start to prevent feedback loops
      // where mid-drag range updates change sensitivity
      const fullRange =
        dragStartRangeRef.current.max - dragStartRangeRef.current.min;
      const visualRange = fullRange / zoom;
      const freqChange = (deltaX / width) * visualRange;

      const desiredPan = dragStartPanRef.current - freqChange;

      if (shouldUseVisualPan(desiredPan, zoom) && onVizPanChange) {
        // Visual panning when zoomed or when the viewport actually includes
        // f<0. Unzoomed positive pans stay on the hardware retune path so
        // the mirror setting cannot make ordinary scrolling slower.
        if (maybeRetuneHardwareWindow({ nextPan: desiredPan, zoom })) {
          return;
        }

        // With the mirror setting on, never trap pan in channel bounds — even
        // while the viewport is still positive. Overflow retunes via the
        // standard branch above; the mirror fold only arms below 0 Hz.
        const clampedPan = allowNegativeFrequencies
          ? clampVizPan(
              desiredPan,
              frequencyRangeRef.current,
              zoom,
              null,
            )
          : clampVizPan(
              desiredPan,
              frequencyRangeRef.current,
              zoom,
              hardwareSpectrumBounds ?? signalAreaBounds?.[activeSignalArea],
            );
        onVizPanChange(clampedPan);
        if (vizPanOffsetRef) {
          vizPanOffsetRef.current = clampedPan;
        }

        // Auto zoom stability: track floor pan so Refocus can restore this position
        if (
          autoZoomStabilityRef?.current &&
          (vizZoomFloorRef?.current ?? 1) > 1
        ) {
          onVizZoomFloorPanChange?.(clampedPan);
        }
      } else if (onFrequencyRangeChange) {
        // Hardware retune mode (unzoomed, live SDR only).
        // Dragging right (deltaX > 0) means frequency decreases.
        let newMinFreq = dragStartFreqRef.current - freqChange;
        const rangeWidth = fullRange;
        let newMaxFreq = newMinFreq + rangeWidth;

        const newRange = clampRangeToTuningBounds({
          min: newMinFreq,
          max: newMaxFreq,
        });
        frequencyRangeRef.current = newRange;
        publishHardwareRange(newRange);
      } else if (onVizPanChange) {
        const maxPan = fullRange / 2 - visualRange / 2;
        let newPan = dragStartPanRef.current - freqChange;
        newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
        onVizPanChange(newPan);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Allow buttons to handle their own clicks natively
      if (e.target instanceof Element && e.target.closest("button")) {
        return;
      }

      const container = getContainer();
      if (!container) return;

      // Stop React Flow from capturing this event
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      // Prevent default browser behavior (like scrolling or text selection)
      if (typeof e.preventDefault === "function") e.preventDefault();
      // Focus the container to ensure keyboard events are directed here
      container.focus();

      // Track all pointers for multi-touch
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });

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
          selectionBoxRef.current.style.display = "none";
        }
        setPointerCaptureIfAvailable(container, e.pointerId);
        return;
      }

      const rect = container.getBoundingClientRect();
      containerRectRef.current = rect;

      // Cache the active spectrum canvas rect for use during drag moves
      const canvas = getActiveSpectrumCanvas();
      if (canvas) {
        canvasDragRectRef.current = canvas.getBoundingClientRect();
      }

      const canvasRect = canvasDragRectRef.current || rect;
      if (activePointersRef.current.size === 2) {
        const pointers = Array.from(activePointersRef.current.values());
        const p1 = pointers[0];
        const p2 = pointers[1];
        if (
          !txSliderLocked &&
          (isPointInTxSlider(p1.x, p1.y, canvasRect) ||
            isPointInTxSlider(p2.x, p2.y, canvasRect))
        ) {
          txPinchInitialDistRef.current = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          txPinchInitialBandwidthRef.current =
            txSliderRef?.current?.txSampleRateHz ?? 1;
          initialPinchDistRef.current = null;
          setPointerCaptureIfAvailable(container, e.pointerId);
          return;
        }
      }
      const canvasX = e.clientX - canvasRect.left;
      const canvasY = e.clientY - canvasRect.top;
      const plot = getPlotBounds(canvasRect);

      const slider = txSliderRef?.current;
      if (
        !txSliderLocked &&
        slider?.visible &&
        slider.visibleMaxHz > slider.visibleMinHz &&
        Number.isFinite(slider.txCenterHz) &&
        Number.isFinite(slider.txSampleRateHz)
      ) {
        const geometry = getTxSliderGeometry(canvasRect);
        if (canvasY >= geometry.top && canvasY <= geometry.bottom) {
          const bandwidth = Math.max(1, slider.txSampleRateHz);
          const isCompactBandwidth = bandwidth < 200_000;
          const sliderMin = slider.txCenterHz - bandwidth / 2;
          const sliderMax = slider.txCenterHz + bandwidth / 2;
          const visualRange = getTxVisualRange(slider);
          const visibleSpan = visualRange.max - visualRange.min;
          const toX = (hz: number) =>
            geometry.trackLeft +
            ((hz - visualRange.min) / visibleSpan) * geometry.trackWidth;
          const rawLeft = toX(sliderMin);
          const rawRight = toX(sliderMax);
          const leftHandleX = Math.max(
            geometry.trackLeft,
            Math.min(geometry.trackRight, rawLeft),
          );
          const rightHandleX = Math.max(
            geometry.trackLeft,
            Math.min(geometry.trackRight, rawRight),
          );
          const hitRadius = 14;

          if (slider.isPreviewVfo || isCompactBandwidth) {
            txSliderHandleRef.current = "body";
          } else {
            const hitLeft = Math.abs(canvasX - leftHandleX) <= hitRadius;
            const hitRight = Math.abs(canvasX - rightHandleX) <= hitRadius;

            if (hitLeft && hitRight) {
              if (rawRight < geometry.trackLeft) {
                txSliderHandleRef.current = "right";
              } else {
                txSliderHandleRef.current = "left";
              }
            } else if (hitLeft) {
              txSliderHandleRef.current = "left";
            } else if (hitRight) {
              txSliderHandleRef.current = "right";
            } else if (
              canvasX >= Math.min(leftHandleX, rightHandleX) &&
              canvasX <= Math.max(leftHandleX, rightHandleX)
            ) {
              txSliderHandleRef.current = "body";
            } else if (
              canvasX >= geometry.trackLeft &&
              canvasX <= geometry.trackRight
            ) {
              txSliderHandleRef.current = "body";
            } else {
              txSliderHandleRef.current = null;
            }
          }

          if (txSliderHandleRef.current) {
            if (txSliderHandleRef.current === "body") {
              const pointerHz = getTxSliderFrequencyForX(
                canvasX,
                canvasRect,
                false,
              );
              txSliderBodyDragOffsetHzRef.current =
                pointerHz === null
                  ? 0
                  : slider.isPreviewVfo
                    ? pointerHz - slider.txCenterHz
                    : getPointerOffsetWithinBandHz(
                        pointerHz,
                        slider.txCenterHz -
                          Math.max(1, slider.txSampleRateHz) / 2,
                      );
            } else {
              txSliderBodyDragOffsetHzRef.current = 0;
            }
            isTxSliderDraggingRef.current = true;
            updateTxSliderFromPointer(e.clientX);
            setPointerCaptureIfAvailable(container, e.pointerId);
            addClassIfAvailable(container, "cursor-grabbing");
            return;
          }
        }
      }

      // Check if clicking inside the left margin (dB scale area)
      const isLeftMargin =
        canvasX < plot.left && canvasY >= plot.top && canvasY <= plot.bottom;
      if (isLeftMargin && onPowerLineDbChange && vizDbMinRef && vizDbMaxRef) {
        isPowerDraggingRef.current = true;
        isPowerHeldRef.current = false;
        onPowerLineHoldChange?.(false);
        const clampedY = Math.max(plot.top, Math.min(plot.bottom, canvasY));
        const fraction = (plot.bottom - clampedY) / (plot.bottom - plot.top);
        const db =
          vizDbMinRef.current +
          fraction * (vizDbMaxRef.current - vizDbMinRef.current);
        onPowerLineDbChange(db);
        setPointerCaptureIfAvailable(container, e.pointerId);
        return;
      }

      if (powerLineDbRef?.current != null && onPowerLineDbChange) {
        const isSpectrumSide =
          canvasX >= plot.left && canvasY >= plot.top && canvasY <= plot.bottom;
        if (!isSpectrumSide) return;
        isPowerHeldRef.current = true;
        onPowerLineHoldChange?.(true);
        setPointerCaptureIfAvailable(container, e.pointerId);
        onDragRepaint?.();
        return;
      }

      const height = rect.height;
      const y = e.clientY - rect.top;
      const vfoThreshold = getVfoInteractionHeight();
      const isRangeSelectionArea = fullPlotSelection
        ? y >= 0 && y <= height
        : y < height - vfoThreshold;

      if (
        selectionMode === "range" &&
        !disabled &&
        isRangeSelectionArea &&
        latestOnSelectionChangeRef.current
      ) {
        const canvas = getActiveSpectrumCanvas();
        if (canvas) {
          const canvasRect = canvas.getBoundingClientRect();
          const plot = getPlotBounds(canvasRect);
          const canvasY = e.clientY - canvasRect.top;
          if (canvasY < plot.top || canvasY > plot.bottom) return;
          const dragBounds = { ...frequencyRangeRef.current };
          dragStartRangeRef.current = dragBounds;
          const fullRange = dragBounds.max - dragBounds.min;
          const freqAtClick = frequencyFromClientX(
            e.clientX,
            canvasRect,
            dragBounds,
            vizZoomRef?.current,
            vizPanOffsetRef?.current,
          );
          const existing =
            latestSelectionRangeRef.current ?? selectionDraftRangeRef.current;
          if (existing) {
            const bandDragMode = getBandDragMode({
              pointerHz: freqAtClick,
              startHz: existing.min,
              endHz: existing.max,
              hzPerPixel: fullRange / plot.width,
            });
            const shouldEditExisting =
              (e.altKey || rangeSelectionInteraction === "edit-existing") &&
              bandDragMode !== null;

            if (shouldEditExisting) {
              selectionDragModeRef.current = bandDragMode;
              selectionDragOriginFreqRef.current = freqAtClick;
              selectionDraftRangeRef.current = existing;
              isSelectionDraggingRef.current = true;
              dragStartSelectionRef.current = { ...existing };
              dragStartPanRef.current = vizPanOffsetRef?.current || 0;
              setPointerCaptureIfAvailable(container, e.pointerId);
              addClassIfAvailable(container, "cursor-grabbing");
              removeClassIfAvailable(container, "cursor-crosshair");
              return;
            }

            // A pointer outside the editable band falls through to a fresh
            // A-to-B selection instead of moving the previous range.
          }

          selectionDragModeRef.current = "create";
          selectionDragOriginFreqRef.current = freqAtClick;
          selectionDraftRangeRef.current = null;
          isSelectionDraggingRef.current = true;
          dragStartXRef.current = e.clientX;
          dragStartSelectionRef.current = {
            min: freqAtClick,
            max: freqAtClick,
          };
          dragStartPanRef.current = vizPanOffsetRef?.current || 0;
          setPointerCaptureIfAvailable(container, e.pointerId);
          addClassIfAvailable(container, "cursor-grabbing");
          removeClassIfAvailable(container, "cursor-crosshair");
          return;
        }
        return;
      }

      // Full-plot range selectors, such as FFTNode, have no VFO or box-zoom
      // interaction beneath the selection layer. Do not let a disabled or
      // temporarily unbound selector fall through into those interactions.
      if (selectionMode === "range" && fullPlotSelection) return;

      // Check if clicking inside the demodulation selection box
      if (
        selectionMode !== "range" &&
        selectionRange &&
        !disabled &&
        y < height - vfoThreshold
      ) {
        const canvas = getActiveSpectrumCanvas();
        if (canvas) {
          const canvasRect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const zoom = vizZoomRef?.current || 1;
          const pan = vizPanOffsetRef?.current || 0;
          const fullMin = frequencyRangeRef.current.min;
          const fullMax = frequencyRangeRef.current.max;
          const fullSpan = fullMax - fullMin;
          const centerFreq = (fullMin + fullMax) / 2;
          const visualSpan = fullSpan / zoom;
          const visualMin = centerFreq + pan - visualSpan / 2;

          const freqAtClick = visualMin + (x / canvasRect.width) * visualSpan;

          if (
            freqAtClick >= selectionRange.min &&
            freqAtClick <= selectionRange.max
          ) {
            isSelectionDraggingRef.current = true;
            dragStartXRef.current = e.clientX;
            dragStartSelectionRef.current = { ...selectionRange };
            addClassIfAvailable(container, "cursor-grabbing");
            removeClassIfAvailable(container, "cursor-crosshair");
            setPointerCaptureIfAvailable(container, e.pointerId);
            return;
          }
        }
      }

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
        if (zoomboxStateRef) {
          zoomboxStateRef.current = null;
          onDragRepaint?.();
        } else {
          ensureSelectionBox(container);
        }
        setPointerCaptureIfAvailable(container, e.pointerId);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const container = getContainer();
      stopSelectionEdgePan();

      if (isTxSliderDraggingRef.current) {
        publishPendingTxGeometry(false);
        isTxSliderDraggingRef.current = false;
        txSliderHandleRef.current = null;
        txSliderBodyDragOffsetHzRef.current = 0;
        if (container) {
          releasePointerCaptureIfAvailable(container, e.pointerId);
          removeClassIfAvailable(container, "cursor-grabbing");
        }
        onDragRepaint?.();
        return;
      }

      if (isPowerDraggingRef.current) {
        isPowerDraggingRef.current = false;
        if (container) {
          releasePointerCaptureIfAvailable(container, e.pointerId);
        }
        const rect = container?.getBoundingClientRect();
        const canvasX = rect ? e.clientX - rect.left : e.clientX;
        const canvasY = rect ? e.clientY - rect.top : e.clientY;
        const plot = rect ? getPlotBounds(rect) : null;
        const isLeftMargin =
          plot &&
          canvasX < plot.left &&
          canvasY >= plot.top &&
          canvasY <= plot.bottom;
        if (isLeftMargin) {
          onPowerLineDbChange?.(null);
          isPowerHeldRef.current = false;
          onPowerLineHoldChange?.(false);
        } else if (isPowerHeldRef.current) {
          onPowerLineHoldChange?.(true);
        }
        if (onDragRepaint) {
          onDragRepaint();
        }
        return;
      }

      if (isPowerHeldRef.current) {
        const rect = container?.getBoundingClientRect();
        const canvasX = rect ? e.clientX - rect.left : e.clientX;
        const canvasY = rect ? e.clientY - rect.top : e.clientY;
        const plot = rect ? getPlotBounds(rect) : null;
        const isLeftMargin =
          plot &&
          canvasX < plot.left &&
          canvasY >= plot.top &&
          canvasY <= plot.bottom;
        if (isLeftMargin) {
          isPowerHeldRef.current = false;
          onPowerLineHoldChange?.(false);
          if (container)
            releasePointerCaptureIfAvailable(container, e.pointerId);
          onPowerLineDbChange?.(null);
          onDragRepaint?.();
          return;
        }
        if (container) {
          releasePointerCaptureIfAvailable(container, e.pointerId);
        }
        onDragRepaint?.();
        return;
      }

      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        txPinchInitialDistRef.current = null;
      }
      if (activePointersRef.current.size < 2) {
        initialPinchDistRef.current = null;
        lastPinchDistRef.current = null;
        initialPinchCenterRef.current = null;
      }

      if (isBoxDraggingRef.current && container) {
        isBoxDraggingRef.current = false;
        releasePointerCaptureIfAvailable(container, e.pointerId);

        // Use the pointerup coordinates as the authoritative endpoint. A fast
        // drag can reach pointerup before a pointermove creates the overlay,
        // and the zoom should still commit without waiting for another frame.
        boxCurrentRef.current = { x: e.clientX, y: e.clientY };
        clearZoomboxCanvas();
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
          //   Bottom: containerHeight - 40 CSS px - live status row
          const plotLeftCSS = 50;
          const plotRightCSS = rect.width - 40;
          const plotTopCSS = 20;
          const plotBottomCSS = rect.height - 40 - getReservedBottomHeight();
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
            if (selectionBoxRef.current) {
              selectionBoxRef.current.style.display = "none";
            }
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
          const zoomFloor = vizZoomFloorRef?.current ?? 1;
          const newZoom = clampVizZoom(newZoomRaw, zoomFloor, maxVizZoom);

          // Calculate new pan to center the selection
          const targetVisualCenter = (newFreqMin + newFreqMax) / 2;
          const trueCenter =
            (frequencyRangeRef.current.min + frequencyRangeRef.current.max) / 2;
          let newPan = targetVisualCenter - trueCenter;

          // The normal display is bounded by the acquired positive window.
          // With mirror enabled, this is a display-only negative axis: keeping
          // the old clamp here snaps a negative box zoom back across DC.
          if (!allowNegativeFrequencies) {
            const clampedVisualRange = fullRange / newZoom;
            const maxPan = fullRange / 2 - clampedVisualRange / 2;
            newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
          }

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
            // Hide the transient overlay before notifying React-driven
            // consumers so their rerender cannot flash the old rectangle.
            if (selectionBoxRef.current) {
              selectionBoxRef.current.style.display = "none";
            }
            onVizZoomFloorChange?.(newZoom);
            onVizZoomFloorPanChange?.(newPan);
            onVizZoomChange(newZoom);
            onVizPanChange(newPan);
            onFftDbLimitsChange(newDbMin, newDbMax);
          }
        }

        if (selectionBoxRef.current) {
          selectionBoxRef.current.style.display = "none";
        }
      }
      if (isDraggingRef.current && container) {
        container.releasePointerCapture(e.pointerId);
        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const vfoThreshold = getVfoInteractionHeight();
        if (y >= rect.height - vfoThreshold) {
          addClassIfAvailable(container, "cursor-grab");
          removeClassIfAvailable(container, "cursor-crosshair");
        } else {
          addClassIfAvailable(container, "cursor-crosshair");
          removeClassIfAvailable(container, "cursor-grab");
        }
        removeClassIfAvailable(container, "cursor-grabbing");
      }
      if (isSelectionDraggingRef.current) {
        if (dispatchTimeoutRef.current) {
          clearTimeout(dispatchTimeoutRef.current);
          dispatchTimeoutRef.current = null;
        }

        const finalEmit = latestOnSelectionChangeRef.current;
        if (selectionDraftRangeRef.current && finalEmit) {
          finalEmit(selectionDraftRangeRef.current);
        }

        if (liveDragSelectionRef) {
          liveDragSelectionRef.current = null;
        }
        if (onDragRepaint) {
          onDragRepaint();
        }
        pendingDispatchRef.current = null;
        lastDispatchTimeRef.current = 0;

        if (container) {
          releasePointerCaptureIfAvailable(container, e.pointerId);
          removeClassIfAvailable(container, "cursor-grabbing");
          addClassIfAvailable(container, "cursor-crosshair");
          if (selectionBoxRef.current) {
            selectionBoxRef.current.style.display = "none";
          }
        }
      }
      isDraggingRef.current = false;
      isSelectionDraggingRef.current = false;
      selectionDragModeRef.current = null;
      selectionDragOriginFreqRef.current = null;
      selectionDraftRangeRef.current = null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zoomboxStateRef?.current) {
        zoomboxStateRef.current = null;
        if (selectionBoxRef.current) {
          selectionBoxRef.current.style.display = "none";
        }
        onDragRepaint?.();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (zoomboxStateRef?.current) {
        const step = 10;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;
        if (dx || dy) {
          const container = getContainer();
          const bounds = container?.getBoundingClientRect();
          const width = bounds?.width ?? 0;
          const height = bounds?.height ?? 0;
          const box = zoomboxStateRef.current;
          const boxWidth = Math.abs(box.currentX - box.startX);
          const boxHeight = Math.abs(box.currentY - box.startY);
          const minX = Math.min(box.startX, box.currentX);
          const minY = Math.min(box.startY, box.currentY);
          const nextMinX = Math.max(0, Math.min(width - boxWidth, minX + dx));
          const nextMinY = Math.max(0, Math.min(height - boxHeight, minY + dy));
          const xOffset = nextMinX - minX;
          const yOffset = nextMinY - minY;
          zoomboxStateRef.current = {
            startX: box.startX + xOffset,
            startY: box.startY + yOffset,
            currentX: box.currentX + xOffset,
            currentY: box.currentY + yOffset,
          };
          onDragRepaint?.();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (selectionMode !== "range" || disabled || !onSelectionChange) return;
      if ((vizZoomRef?.current ?? 1) > 1) return;
      const emitSelectionChange = latestOnSelectionChangeRef.current;
      if (!emitSelectionChange) return;
      const current =
        selectionDraftRangeRef.current ?? latestSelectionRangeRef.current;
      if (!current || current.max <= current.min) return;

      const stepBase =
        (frequencyRangeRef.current.max - frequencyRangeRef.current.min) / 200;
      const step = Math.max(1, stepBase);
      let direction = 0;
      if (e.key === "ArrowLeft") {
        direction = -1;
      } else if (e.key === "ArrowRight") {
        direction = 1;
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const scaleDirection = e.key === "ArrowUp" ? 1 : -1;
        const currentWidth = current.max - current.min;
        const widthChange = step * 2 * scaleDirection;
        const nextWidth = Math.max(10, currentWidth + widthChange);
        const center = (current.min + current.max) / 2;
        const next = clampSelectionToFrequencyRange(
          {
            min: center - nextWidth / 2,
            max: center + nextWidth / 2,
          },
          frequencyRangeRef.current,
        );
        selectionDraftRangeRef.current = next;
        emitSelectionChange(next);
        e.preventDefault();
        return;
      }

      if (!direction) return;
      e.preventDefault();

      const next = clampSelectionToFrequencyRange(
        {
          min: current.min + direction * step,
          max: current.max + direction * step,
        },
        frequencyRangeRef.current,
      );
      selectionDraftRangeRef.current = next;

      // If we are currently dragging, update the origin to prevent jumping on next move
      if (selectionDragOriginFreqRef.current !== null) {
        selectionDragOriginFreqRef.current += direction * step;
      }

      emitSelectionChange(next);
    };

    const handlePointerMoveForCursor = (e: PointerEvent) => {
      const container = getContainer();
      if (!container || isDraggingRef.current) return;

      const rect =
        containerRectRef.current || container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const vfoThreshold = getVfoInteractionHeight();
      const slider = txSliderRef?.current;
      const isOverTxSlider =
        !!slider?.visible &&
        slider.visibleMaxHz > slider.visibleMinHz &&
        y >= getTxSliderGeometry(rect).top &&
        y <= getTxSliderGeometry(rect).bottom;

      const isOverVfo = !fullPlotSelection && y >= rect.height - vfoThreshold;

      if (isOverTxSlider || isOverVfo) {
        if (
          !container.classList ||
          !container.classList.contains("cursor-grab")
        ) {
          addClassIfAvailable(container, "cursor-grab");
          removeClassIfAvailable(container, "cursor-crosshair");
        }
      } else {
        if (
          !container.classList ||
          !container.classList.contains("cursor-crosshair")
        ) {
          addClassIfAvailable(container, "cursor-crosshair");
          removeClassIfAvailable(container, "cursor-grab");
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (fullPlotSelection) return;
      const container = getContainer();
      if (!container) return;

      const rect =
        containerRectRef.current || container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (isPointInTxSlider(e.clientX, e.clientY, rect)) {
        e.preventDefault();
        e.stopPropagation();
        if (txSliderLocked) return;
        const slider = txSliderRef?.current;
        if (!isTxSliderReady(slider)) return;
        if (e.ctrlKey) {
          const scale = Math.exp(-e.deltaY * 0.004);
          zoomTxSliderBandwidth(scale);
          return;
        }
        const visibleSpan = slider.visibleMaxHz - slider.visibleMinHz;
        const scrollDelta =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        panTxSliderByHz((scrollDelta / Math.max(1, rect.width)) * visibleSpan);
        return;
      }

      const plot = getPlotBounds(rect);
      if (x < 50 && y >= plot.top && y <= plot.bottom) {
        e.preventDefault();
        return;
      }

      // 1. Handle Pinch-to-Zoom (ctrlKey is true on trackpad pinches)
      if (e.ctrlKey) {
        e.preventDefault();
        if (txSliderLocked && isPointInTxSlider(e.clientX, e.clientY, rect)) {
          return;
        }
        if (!onVizZoomChange || !vizZoomRef) return;

        const zoom = vizZoomRef.current;
        // Use an exponential scale for a smoother, "premium" feel.
        // deltaY is negative for zooming in, positive for zooming out.
        // Sensitivity 0.003 provides a "stronger" response than the previous linear 1.05 factor.
        const sensitivity = 0.003;
        const zoomFloor = vizZoomFloorRef?.current ?? 1;
        let newZoom = zoom * Math.exp(-e.deltaY * sensitivity);

        newZoom = clampVizZoom(newZoom, zoomFloor, maxVizZoom);

        if (Math.abs(newZoom - zoom) > 0.001) {
          // Zoom relative to the gesture or mouse position so the content
          // stays anchored under the user's fingers/pointer.
          const canvas = getActiveSpectrumCanvas();
          if (canvas) {
            const canvasRect = canvas.getBoundingClientRect();
            const focusX =
              activePointersRef.current.size === 2 &&
              initialPinchCenterRef.current
                ? initialPinchCenterRef.current.x
                : e.clientX;
            const anchorX =
              activePointersRef.current.size === 2 &&
              initialPinchCenterRef.current
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
            const visualMin = centerFreq + currentPan - currentVisualRange / 2;

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

              if (!allowNegativeFrequencies) {
                const maxPan = fullRange / 2 - newVisualRange / 2;
                newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
              }
              onVizPanChange(newPan);
            }
          } else {
            onVizZoomChange(newZoom);
          }
        }
        return;
      }

      // 2. Lateral movement on scroll (panning/retuning)
      // The complete VFO row is a pan surface. Keep the same hit target as
      // pointer drag so scrolling over the frequency numbers cannot fall
      // through to page scrolling or a different canvas interaction.
      const isOverVfo =
        !fullPlotSelection && y >= rect.height - getVfoInteractionHeight();
      const isOverMargin =
        x < 50 ||
        x > rect.width - 40 ||
        y < 20 ||
        y > rect.height - 40 - getReservedBottomHeight() ||
        isOverVfo;

      if (isOverMargin) {
        // Move laterally on scroll
        e.preventDefault();
        if (txSliderLocked && isPointInTxSlider(e.clientX, e.clientY, rect)) {
          return;
        }

        // Use deltaY for vertical scroll wheels to move laterally
        // Use deltaX for horizontal scroll wheels/gestures
        const delta =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;

        const canvas = getActiveSpectrumCanvas();
        if (!canvas) return;
        const width =
          canvasDragRectRef.current?.width ||
          containerRectRef.current?.width ||
          canvas.clientWidth ||
          1;

        const zoom = vizZoomRef?.current || 1;
        const fullRange =
          frequencyRangeRef.current.max - frequencyRangeRef.current.min;
        const visualRange = fullRange / zoom;

        // Scroll sensitivity: roughly 1 pixel per unit of delta
        const deltaPx = delta;
        const freqChange = (deltaPx / width) * visualRange;
        const currentPan = vizPanOffsetRef?.current || 0;
        const proposedPan = currentPan + freqChange;

        if (
          shouldUseVisualPan(proposedPan, zoom) &&
          onVizPanChange &&
          vizPanOffsetRef
        ) {
          // Scrolling down/right (delta > 0) shows higher frequencies -> increase pan
          let newPan = proposedPan;

          // Retune when the viewport outruns the acquisition (including a
          // DC-crossing window the resident frame cannot fill). Start each
          // tick from the visible remaining pan so trackpad momentum cannot
          // queue a hidden ballistic target.
          if (maybeRetuneHardwareWindow({ nextPan: newPan, zoom })) {
            return;
          }

          newPan = allowNegativeFrequencies
            ? clampVizPan(
                newPan,
                frequencyRangeRef.current,
                zoom,
                null,
              )
            : clampVizPan(
                newPan,
                frequencyRangeRef.current,
                zoom,
                hardwareSpectrumBounds ?? signalAreaBounds?.[activeSignalArea],
              );
          onVizPanChange(newPan);
          vizPanOffsetRef.current = newPan;

          // Auto zoom stability: track floor pan so Refocus can restore this position
          if (
            autoZoomStabilityRef?.current &&
            (vizZoomFloorRef?.current ?? 1) > 1
          ) {
            onVizZoomFloorPanChange?.(newPan);
          }
        } else if (onFrequencyRangeChange) {
          // Hardware retune mode
          const currentRange = frequencyRangeRef.current;
          const currentMin = currentRange.min;
          const newMin = currentMin + freqChange;
          const newMax = newMin + fullRange;
          const nextRange = { min: newMin, max: newMax };
          const clampedRange = clampWheelRangeToHardwareBounds(nextRange);
          frequencyRangeRef.current = clampedRange;
          publishHardwareRange(clampedRange);
        }
      }
    };

    const handleDoubleClick = (e: MouseEvent) => {
      const container = getContainer();
      if (!container) return;
      const rect =
        containerRectRef.current || container.getBoundingClientRect();
      if (!isPointInTxSlider(e.clientX, e.clientY, rect)) return;
      e.preventDefault();
      e.stopPropagation();
      txSliderRef?.current?.onOptionsRequest?.();
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

    // Cache initial bounding rect to avoid layout thrashing
    containerRectRef.current = container.getBoundingClientRect();

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMoveForCursor);
    container.addEventListener("pointerleave", handlePointerLeave);
    container.addEventListener("wheel", handleWheel, { passive: false });
    if (txSliderEnabled) {
      container.addEventListener("dblclick", handleDoubleClick);
    }

    addClassIfAvailable(container, "cursor-crosshair");

    const resizeObserver = new ResizeObserver(updateContainerRect);
    resizeObserver.observe(container);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      stopSelectionEdgePan();
      if (dispatchTimeoutRef.current) {
        clearTimeout(dispatchTimeoutRef.current);
        dispatchTimeoutRef.current = null;
      }
      resizeObserver.disconnect();
      containerRefCacheRef.current = null;
      containerRectRef.current = null;
      if (selectionBoxRef.current) {
        selectionBoxRef.current.remove();
        selectionBoxRef.current = null;
      }
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMoveForCursor);
      container.removeEventListener("pointerleave", handlePointerLeave);
      container.removeEventListener("wheel", handleWheel);
      if (txSliderEnabled) {
        container.removeEventListener("dblclick", handleDoubleClick);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    disabled,
    onFrequencyRangeChange,
    activeSignalArea,
    spectrumWebgpuEnabled,
    spectrumGpuCanvasRef,
    spectrumContainerRef,
    zoomboxStateRef,
    spectrumGpuCanvasNode,
    frequencyRangeRef,
    vizZoomRef,
    vizPanOffsetRef,
    onVizPanChange,

    vizDbMinRef,
    vizDbMaxRef,
    onFftDbLimitsChange,
    onVizZoomChange,
    hardwareSpectrumBounds,
    signalAreaBounds,
    renderWaveformRef,
    selectionMode,
    selectionEdgePanMode,
    rangeSelectionInteraction,
    fullPlotSelection,
    txSliderEnabled,
    txSliderLocked,
  ]);
}

/** @deprecated Use useSpectrumInteraction. */
export const useFrequencyDrag = useSpectrumInteraction;

function normalizeSelectionRange(
  a: number,
  b: number,
  bounds: FrequencyRange,
): FrequencyRange {
  return clampSelectionToFrequencyRange(
    { min: Math.min(a, b), max: Math.max(a, b) },
    bounds,
  );
}

function clampEdgeToBounds(
  minVal: number,
  maxVal: number,
  bounds: FrequencyRange,
): FrequencyRange {
  // Directly clamps the edges so that the opposing stationary edge does not shift.
  const clampedMin = Math.max(bounds.min, Math.min(bounds.max, minVal));
  const clampedMax = Math.max(bounds.min, Math.min(bounds.max, maxVal));
  return {
    min: Math.min(clampedMin, clampedMax),
    max: Math.max(clampedMin, clampedMax),
  };
}

function clampSelectionToFrequencyRange(
  range: FrequencyRange,
  bounds: FrequencyRange,
): FrequencyRange {
  const width = Math.max(0, range.max - range.min);
  const fullWidth = bounds.max - bounds.min;
  if (!Number.isFinite(fullWidth) || fullWidth <= 0) return range;
  if (width >= fullWidth) return { min: bounds.min, max: bounds.max };

  let min = Math.max(bounds.min, Math.min(bounds.max - width, range.min));
  let max = min + width;
  if (max > bounds.max) {
    max = bounds.max;
    min = max - width;
  }
  return { min, max };
}
