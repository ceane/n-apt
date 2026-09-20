import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useAppDispatch } from "@n-apt/redux";
import { setFrequencyRange } from "@n-apt/redux/slices/spectrumSlice";
import { sendFrequencyRange } from "@n-apt/redux/thunks/websocketThunks";
import { clampCenteredFrequencyRange } from "@n-apt/math/frequency";
import { mapDisplayFrequencyToSource } from "@n-apt/math/basebandMirror";
import type { FrequencyRange } from "@n-apt/consts/types";
import {
  createDeviceOptionScheduler,
  type DeviceOptionScheduler,
} from "@n-apt/app/infrastructure/streams/deviceOptionScheduler";
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
  /** Changing this clears user tuning, so the VFO re-centers on the range. */
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
  /** Acquisition window clamped around the tuned center. */
  vfoFrequencyRange: FrequencyRange;
  /** Window actually on screen: `vfoFrequencyRange` with zoom/pan applied. */
  visibleRange: FrequencyRange;
  /** Center the axis should label for the visible window. */
  displayCenterFrequencyHz: number;
  isLocked: boolean;
  setIsLocked: React.Dispatch<React.SetStateAction<boolean>>;
  isEditorOpen: boolean;
  setIsEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openEditor: () => void;
  closeEditor: () => void;
  /** Clears the "user tuned" latch so the VFO re-centers on the next range change. */
  resetUserTuning: () => void;
  /** Live drag feedback for the VFO cursor line. */
  cursorOffsetPx: number;
  /**
   * Retunes the view. Not forced (wheel/typed entry) it only moves the view when
   * zoom/pan is enabled; forced (drag) it retunes the receiver unless the
   * clamped window is unchanged, in which case it also just pans.
   */
  tuneVfo: (frequency: number, forceHardwareTune?: boolean) => void;
  /**
   * Attach to the element that owns the tuning surface. Wheel is bound natively
   * here (React's `onWheel` is passive, which makes `preventDefault` a no-op).
   */
  viewportRef: React.RefObject<HTMLDivElement | null>;
  viewportHandlers: {
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
  };
}

/**
 * Owns the waterfall-style tuning surface: VFO center, view zoom/pan, drag and
 * pinch gestures, and the center-frequency editor state. Shared by the waterfall
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

  const viewportRef = useRef<HTMLDivElement | null>(null);
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

  // A scroll or drag burst emits far more events than the receiver can usefully
  // retune on. Publish the first value immediately (so a gesture stays
  // responsive), coalesce the rest to a bounded cadence, and flush the final
  // value once the gesture goes idle — the same contract the spectrum pan uses.
  const publishRangeRef = useRef<(range: FrequencyRange) => void>(() => {});
  publishRangeRef.current = (range) => {
    if (tuneHardware) {
      tuneHardware(range);
      return;
    }
    dispatch(setFrequencyRange(range));
    dispatch(sendFrequencyRange(range));
  };
  const rangePublisherRef =
    useRef<DeviceOptionScheduler<FrequencyRange> | null>(null);
  if (!rangePublisherRef.current) {
    rangePublisherRef.current = createDeviceOptionScheduler<FrequencyRange>({
      publish: (range) => publishRangeRef.current(range),
      equals: (left, right) => left.min === right.min && left.max === right.max,
    });
  }
  useEffect(
    () => () => {
      rangePublisherRef.current?.dispose();
    },
    [],
  );

  // A new session drops any tuning the user did in the previous one.
  useEffect(() => {
    userTunedRef.current = false;
  }, [sessionKey]);

  // Track the range center without letting a re-render clobber user tuning.
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
      // Only a zoomed-in view has a window to pan; at 1x a gesture must retune
      // the receiver, otherwise scrolling would relabel the axis while the
      // rendered history stayed exactly where it was.
      const pansView = zoomPanEnabled && zoom > 1;
      const panView = () => {
        const visibleSpan = span / Math.max(1, zoom);
        const minPan = allowNegativeFrequencies
          ? Number.NEGATIVE_INFINITY
          : rangeMin + visibleSpan / 2 - rangeCenter;
        const maxPan = allowNegativeFrequencies
          ? Number.POSITIVE_INFINITY
          : rangeMax - visibleSpan / 2 - rangeCenter;
        setPanHz(Math.max(minPan, Math.min(maxPan, frequency - rangeCenter)));
        setVfoFrequency(frequency);
        // An explicit gesture: don't let a later range change recenter it.
        userTunedRef.current = true;
      };

      if (pansView && !forceHardwareTune) {
        panView();
        return;
      }

      const sourceFrequency = mapDisplayFrequencyToSource(frequency);
      const range = clampCenteredFrequencyRange(sourceFrequency, span, 0);
      const hardwareRangeUnchanged =
        range.min === rangeMin && range.max === rangeMax;
      if (zoomPanEnabled && forceHardwareTune && hardwareRangeUnchanged) {
        panView();
        return;
      }

      rangePublisherRef.current?.submit(range);
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

  // Bound natively with `passive: false`: React registers wheel listeners on the
  // root as passive, so a `preventDefault` inside `onWheel` is ignored (and logs
  // "Unable to preventDefault inside passive event listener"), letting the page
  // scroll instead of the view tuning.
  const handleViewportWheel = useCallback(
    (event: WheelEvent) => {
      const overVfoAxis = Boolean(
        (event.target as Element | null)?.closest?.(
          `[data-testid="${vfoTestId}"]`,
        ),
      );

      // Live view: only the axis itself swallows the wheel, and only while locked.
      if (!zoomPanEnabled) {
        if (isLocked && overVfoAxis) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

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

      if (!overVfoAxis) return;

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

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    node.addEventListener("wheel", handleViewportWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleViewportWheel);
  }, [handleViewportWheel]);

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
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture: onPointerEndCapture,
      onPointerCancelCapture: onPointerEndCapture,
    }),
    [onPointerDownCapture, onPointerEndCapture, onPointerMoveCapture],
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
    }),
    [
      endVfoDrag,
      onVfoMouseDown,
      onVfoPointerDown,
      onVfoPointerMove,
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
    viewportRef,
    viewportHandlers,
    vfoHandlers,
  };
};
