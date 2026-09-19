import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useAppDispatch } from "@n-apt/redux";
import { setFrequencyRange } from "@n-apt/redux/slices/spectrumSlice";
import { sendFrequencyRange } from "@n-apt/redux/thunks/websocketThunks";
import { clampCenteredFrequencyRange } from "@n-apt/math/frequency";
import { mapDisplayFrequencyToSource } from "@n-apt/math/basebandMirror";
import type { FrequencyRange } from "@n-apt/consts/types";
import {
  getWaterfallPinchZoomView,
  getWaterfallScrollPan,
  getWaterfallVfoDisplayFrequency,
  getWaterfallVfoDragPan,
} from "@n-apt/demodulation/react-flow/nodes/waterfallView";

export interface VfoTunerOptions {
  /** Acquisition / display range the viewport is anchored to. */
  frequencyRange: FrequencyRange;
  allowNegativeFrequencies: boolean;
  /**
   * Analysis-style view: the history is retained, so gestures zoom/pan a window
   * and tuning is pan-first. When false, gestures retune the receiver directly.
   */
  zoomPanEnabled: boolean;
  /** Changing this clears user tuning, so the VFO re-centres on the range. */
  sessionKey: string | number;
  /** testid of the VFO axis, used to decide whether a wheel intends to tune. */
  vfoTestId: string;
  /** Called when a two-pointer pinch begins, so the host can clear its gestures. */
  onPinchStart?: () => void;
  /** Override for the hardware retune. Defaults to the redux frequency dispatch. */
  tuneHardware?: (range: FrequencyRange) => void;
}

export interface VfoTuner {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  panHz: number;
  setPanHz: React.Dispatch<React.SetStateAction<number>>;
  vfoFrequency: number;
  setVfoFrequency: (frequencyHz: number) => void;
  /** Acquisition window clamped around the tuned centre. */
  vfoFrequencyRange: FrequencyRange;
  /** Window actually on screen: `vfoFrequencyRange` with zoom/pan applied. */
  visibleRange: FrequencyRange;
  /** Centre the axis should label for the visible window. */
  displayCenterFrequencyHz: number;
  isLocked: boolean;
  setIsLocked: React.Dispatch<React.SetStateAction<boolean>>;
  isEditorOpen: boolean;
  setIsEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openEditor: () => void;
  closeEditor: () => void;
  /** Clears the "user tuned" latch so the VFO re-centres on the next range change. */
  resetUserTuning: () => void;
  /** Live drag feedback for the VFO cursor line. */
  cursorOffsetPx: number;
  /**
   * Retunes the view. Not forced (wheel/typed entry) it only moves the view when
   * zoom/pan is enabled; forced (drag) it retunes the receiver unless the
   * clamped window is unchanged, in which case it also just pans.
   */
  tuneVfo: (frequency: number, forceHardwareTune?: boolean) => void;
  viewportHandlers: {
    onWheel: React.WheelEventHandler<HTMLDivElement>;
    onPointerDownCapture: React.PointerEventHandler<HTMLDivElement>;
    onPointerMoveCapture: React.PointerEventHandler<HTMLDivElement>;
    onPointerUpCapture: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancelCapture: React.PointerEventHandler<HTMLDivElement>;
  };
  vfoHandlers: {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
    onDoubleClick: React.MouseEventHandler<HTMLDivElement>;
    onMouseDown: React.MouseEventHandler<HTMLDivElement>;
    onWheel: React.WheelEventHandler<HTMLDivElement>;
  };
}

/**
 * Owns the waterfall-style tuning surface: VFO centre, view zoom/pan, drag and
 * pinch gestures, and the centre-frequency editor state. Shared by the waterfall
 * and phase waterfall nodes so both behave identically.
 */
export const useVfoTuner = ({
  frequencyRange,
  allowNegativeFrequencies,
  zoomPanEnabled,
  sessionKey,
  vfoTestId,
  onPinchStart,
  tuneHardware,
}: VfoTunerOptions): VfoTuner => {
  const dispatch = useAppDispatch();

  const [zoom, setZoom] = useState(1);
  const [panHz, setPanHz] = useState(0);
  const [vfoFrequency, setVfoFrequency] = useState(0);
  const [cursorOffsetPx, setCursorOffsetPx] = useState(0);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const userTunedRef = useRef(false);
  const dragStartFrequencyRef = useRef<number | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartPanRef = useRef(0);
  const dragViewportWidthRef = useRef(1);
  const dragDistancePxRef = useRef(0);
  const pinchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{
    distancePx: number;
    zoom: number;
    centerFrequencyHz: number;
  } | null>(null);
  const onPinchStartRef = useRef(onPinchStart);
  onPinchStartRef.current = onPinchStart;

  // A new session drops any tuning the user did in the previous one.
  useEffect(() => {
    userTunedRef.current = false;
  }, [sessionKey]);

  // Track the range centre without letting a re-render clobber user tuning.
  useEffect(() => {
    if (!userTunedRef.current) {
      setVfoFrequency((frequencyRange.min + frequencyRange.max) / 2);
    }
  }, [frequencyRange.min, frequencyRange.max]);

  const rangeMin = frequencyRange.min;
  const rangeMax = frequencyRange.max;
  const rangeCenter = (rangeMin + rangeMax) / 2;

  const tuneVfo = useCallback(
    (frequency: number, forceHardwareTune = false) => {
      if (isLocked) return;
      if (!Number.isFinite(frequency)) return;

      const span = rangeMax - rangeMin;
      const clampPanForVisibleSpan = () => {
        const visibleSpan = span / Math.max(1, zoom);
        const minPan = allowNegativeFrequencies
          ? Number.NEGATIVE_INFINITY
          : rangeMin + visibleSpan / 2 - rangeCenter;
        const maxPan = allowNegativeFrequencies
          ? Number.POSITIVE_INFINITY
          : rangeMax - visibleSpan / 2 - rangeCenter;
        return Math.max(minPan, Math.min(maxPan, frequency - rangeCenter));
      };

      if (zoomPanEnabled && !forceHardwareTune) {
        setPanHz(clampPanForVisibleSpan());
        setVfoFrequency(frequency);
        return;
      }

      const sourceFrequency = mapDisplayFrequencyToSource(frequency);
      const range = clampCenteredFrequencyRange(sourceFrequency, span, 0);
      const hardwareRangeUnchanged =
        range.min === rangeMin && range.max === rangeMax;
      if (zoomPanEnabled && forceHardwareTune && hardwareRangeUnchanged) {
        setPanHz(clampPanForVisibleSpan());
        setVfoFrequency(frequency);
        return;
      }

      if (tuneHardware) {
        tuneHardware(range);
      } else {
        dispatch(setFrequencyRange(range));
        dispatch(sendFrequencyRange(range));
      }
      userTunedRef.current = true;
      setVfoFrequency(frequency);
    },
    [
      allowNegativeFrequencies,
      dispatch,
      isLocked,
      rangeCenter,
      rangeMax,
      rangeMin,
      tuneHardware,
      zoom,
      zoomPanEnabled,
    ],
  );

  const vfoFrequencyRange = useMemo(() => {
    if (!Number.isFinite(vfoFrequency) || vfoFrequency === 0) {
      return frequencyRange;
    }
    const span = rangeMax - rangeMin;
    return clampCenteredFrequencyRange(
      mapDisplayFrequencyToSource(vfoFrequency),
      span,
      0,
    );
  }, [frequencyRange, rangeMax, rangeMin, vfoFrequency]);

  const visibleRange = useMemo(() => {
    if (!zoomPanEnabled || zoom <= 1) return vfoFrequencyRange;
    const fullSpan = vfoFrequencyRange.max - vfoFrequencyRange.min;
    const halfSpan = fullSpan / zoom / 2;
    const sourceCenter = (vfoFrequencyRange.min + vfoFrequencyRange.max) / 2;
    const minPanHz = allowNegativeFrequencies
      ? Number.NEGATIVE_INFINITY
      : vfoFrequencyRange.min + halfSpan - sourceCenter;
    const maxPanHz = allowNegativeFrequencies
      ? Number.POSITIVE_INFINITY
      : vfoFrequencyRange.max - halfSpan - sourceCenter;
    const clampedPanHz = Math.max(minPanHz, Math.min(maxPanHz, panHz));
    const center = sourceCenter + clampedPanHz;
    return { min: center - halfSpan, max: center + halfSpan };
  }, [
    allowNegativeFrequencies,
    panHz,
    vfoFrequencyRange,
    zoom,
    zoomPanEnabled,
  ]);

  const displayCenterFrequencyHz = useMemo(
    () =>
      getWaterfallVfoDisplayFrequency({
        hardwareCenterHz: vfoFrequency,
        visibleRange,
      }),
    [vfoFrequency, visibleRange],
  );

  const onPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!zoomPanEnabled || isLocked || event.pointerType === "mouse") {
        return;
      }
      pinchPointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (pinchPointersRef.current.size !== 2) return;

      const [first, second] = Array.from(pinchPointersRef.current.values());
      pinchStartRef.current = {
        distancePx: Math.hypot(second.x - first.x, second.y - first.y),
        zoom,
        centerFrequencyHz:
          (vfoFrequencyRange.min + vfoFrequencyRange.max) / 2 + panHz,
      };
      dragStartFrequencyRef.current = null;
      dragDistancePxRef.current = 0;
      setCursorOffsetPx(0);
      onPinchStartRef.current?.();
      event.preventDefault();
      event.stopPropagation();
    },
    [isLocked, panHz, vfoFrequencyRange, zoom, zoomPanEnabled],
  );

  const onPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pinchPointersRef.current.has(event.pointerId)) return;
      pinchPointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const pinchStart = pinchStartRef.current;
      if (!pinchStart || pinchPointersRef.current.size < 2) return;

      const [first, second] = Array.from(pinchPointersRef.current.values());
      const nextView = getWaterfallPinchZoomView({
        hardwareRange: vfoFrequencyRange,
        startZoom: pinchStart.zoom,
        centerFrequencyHz: pinchStart.centerFrequencyHz,
        startDistancePx: pinchStart.distancePx,
        currentDistancePx: Math.hypot(second.x - first.x, second.y - first.y),
        allowNegativeFrequencies,
      });
      setZoom(nextView.zoom);
      setPanHz(nextView.panHz);
      event.preventDefault();
      event.stopPropagation();
    },
    [allowNegativeFrequencies, vfoFrequencyRange],
  );

  const onPointerEndCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const wasPinching = pinchStartRef.current !== null;
      pinchPointersRef.current.delete(event.pointerId);
      if (pinchPointersRef.current.size < 2) {
        pinchStartRef.current = null;
      }
      if (!wasPinching) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!zoomPanEnabled) return;
      event.preventDefault();
      event.stopPropagation();
      if (isLocked) return;

      if (event.ctrlKey) {
        const scale = Math.exp(-event.deltaY * 0.003);
        const nextView = getWaterfallPinchZoomView({
          hardwareRange: vfoFrequencyRange,
          startZoom: zoom,
          centerFrequencyHz: (visibleRange.min + visibleRange.max) / 2,
          startDistancePx: 100,
          currentDistancePx: 100 * scale,
          allowNegativeFrequencies,
        });
        setZoom(nextView.zoom);
        setPanHz(nextView.panHz);
        return;
      }

      const target = event.target as HTMLElement;
      if (!target.closest?.(`[data-testid="${vfoTestId}"]`)) return;

      if (zoom > 1) {
        setPanHz((current) =>
          getWaterfallScrollPan({
            hardwareRange: vfoFrequencyRange,
            zoom,
            currentPanHz: current,
            deltaY: event.deltaY,
            allowNegativeFrequencies,
          }),
        );
        return;
      }

      tuneVfo(vfoFrequency - event.deltaY * 1000);
    },
    [
      allowNegativeFrequencies,
      isLocked,
      tuneVfo,
      vfoFrequency,
      vfoFrequencyRange,
      vfoTestId,
      visibleRange,
      zoom,
      zoomPanEnabled,
    ],
  );

  const onVfoPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      setCursorOffsetPx(0);
      dragStartFrequencyRef.current = vfoFrequency;
      dragStartXRef.current = event.clientX;
      dragStartPanRef.current = panHz;
      dragViewportWidthRef.current =
        event.currentTarget.getBoundingClientRect().width || 1;
      dragDistancePxRef.current = 0;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [panHz, vfoFrequency],
  );

  const onVfoPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragStartFrequencyRef.current === null) return;
      dragDistancePxRef.current = dragStartXRef.current - event.clientX;
      setCursorOffsetPx(dragDistancePxRef.current);

      if (zoom > 1) {
        setPanHz(
          getWaterfallVfoDragPan({
            hardwareRange: vfoFrequencyRange,
            zoom,
            startPanHz: dragStartPanRef.current,
            dragDistancePx: dragDistancePxRef.current,
            viewportWidthPx: dragViewportWidthRef.current,
            allowNegativeFrequencies,
          }),
        );
        return;
      }

      const startFrequency = dragStartFrequencyRef.current ?? vfoFrequency;
      const fullSpan = vfoFrequencyRange.max - vfoFrequencyRange.min;
      tuneVfo(
        startFrequency +
          (dragDistancePxRef.current / dragViewportWidthRef.current) * fullSpan,
        true,
      );
    },
    [allowNegativeFrequencies, tuneVfo, vfoFrequency, vfoFrequencyRange, zoom],
  );

  const endVfoDrag = useCallback(() => {
    setCursorOffsetPx(0);
    dragStartFrequencyRef.current = null;
    dragDistancePxRef.current = 0;
  }, []);

  const onVfoWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (isLocked) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [isLocked],
  );

  const onVfoMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation(),
    [],
  );

  const openEditor = useCallback(() => setIsEditorOpen(true), []);
  const closeEditor = useCallback(() => setIsEditorOpen(false), []);
  const resetUserTuning = useCallback(() => {
    userTunedRef.current = false;
  }, []);

  const viewportHandlers = useMemo(
    () => ({
      onWheel,
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture: onPointerEndCapture,
      onPointerCancelCapture: onPointerEndCapture,
    }),
    [onPointerDownCapture, onPointerEndCapture, onPointerMoveCapture, onWheel],
  );

  const vfoHandlers = useMemo(
    () => ({
      onPointerDown: onVfoPointerDown,
      onPointerMove: onVfoPointerMove,
      onPointerUp: endVfoDrag,
      onPointerCancel: endVfoDrag,
      onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        openEditor();
      },
      onMouseDown: onVfoMouseDown,
      onWheel: onVfoWheel,
    }),
    [
      endVfoDrag,
      onVfoMouseDown,
      onVfoPointerDown,
      onVfoPointerMove,
      onVfoWheel,
      openEditor,
    ],
  );

  return {
    zoom,
    setZoom,
    panHz,
    setPanHz,
    vfoFrequency,
    setVfoFrequency,
    vfoFrequencyRange,
    visibleRange,
    displayCenterFrequencyHz,
    isLocked,
    setIsLocked,
    isEditorOpen,
    setIsEditorOpen,
    openEditor,
    closeEditor,
    resetUserTuning,
    cursorOffsetPx,
    tuneVfo,
    viewportHandlers,
    vfoHandlers,
  };
};
