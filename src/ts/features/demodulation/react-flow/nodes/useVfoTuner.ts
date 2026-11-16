import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useAppDispatch } from "@n-apt/redux";
import { setFrequencyRange } from "@n-apt/redux/slices/spectrumSlice";
import { sendFrequencyRange } from "@n-apt/redux/thunks/websocketThunks";
import { clampCenteredFrequencyRange } from "@n-apt/math/frequency";
import { mapDisplayFrequencyToSource } from "@n-apt/math/basebandMirror";
import type { FrequencyRange } from "@n-apt/consts/types";
import { getZoomedViewForCenterFrequency } from "@n-apt/spectrum/public/visualizationZoom";
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
  /** Share the absolute center and frequency span with views of this source. */
  viewSyncKey?: string | number;
  /** testid of the VFO axis, used to decide whether a wheel intends to tune. */
  vfoTestId: string;
  /** Called when a two-pointer pinch begins, so the host can clear its gestures. */
  onPinchStart?: () => void;
  /** Override for the hardware retune. Defaults to the redux frequency dispatch. */
  tuneHardware?: (range: FrequencyRange) => void;
  /**
   * What an unzoomed gesture does. At 1x there is no window to pan, so the host
   * decides: the phase view has nothing to pan and must retune the receiver to
   * move the band, while the waterfall keeps its pan-first behavior so its row
   * feed keeps flowing smoothly.
   */
  retuneWhenUnzoomed?: boolean;
  /** View state saved with the React Flow node so it survives remounts/HMR. */
  initialView?: Partial<VfoTunerPersistedView>;
  onViewChange?: (view: VfoTunerPersistedView) => void;
}

export interface VfoTunerPersistedView {
  zoom: number;
  panHz: number;
  vfoFrequencyHz: number;
  isLocked: boolean;
}

interface SharedVfoView {
  centerFrequencyHz: number;
  spanHz: number;
}

const sharedVfoViews = new Map<string | number, SharedVfoView>();
const sharedVfoSubscribers = new Map<
  string | number,
  Set<(view: SharedVfoView) => void>
>();

const frequencyValuesEqual = (left: number, right: number): boolean => {
  const toleranceHz = Math.max(
    0.01,
    Math.max(Math.abs(left), Math.abs(right)) * 1e-12,
  );
  return Math.abs(left - right) <= toleranceHz;
};

const sharedVfoViewsEqual = (
  left: SharedVfoView,
  right: SharedVfoView,
): boolean => {
  return frequencyValuesEqual(left.centerFrequencyHz, right.centerFrequencyHz);
};

const getSharedViewFromState = ({
  frequencyRange,
  allowNegativeFrequencies,
  zoom,
  panHz,
  vfoFrequency,
}: {
  frequencyRange: FrequencyRange;
  allowNegativeFrequencies: boolean;
  zoom: number;
  panHz: number;
  vfoFrequency: number;
}): SharedVfoView => {
  const fullSpan = Math.max(1, frequencyRange.max - frequencyRange.min);
  const baseRange =
    Number.isFinite(vfoFrequency) && vfoFrequency !== 0
      ? clampCenteredFrequencyRange(
          mapDisplayFrequencyToSource(vfoFrequency),
          fullSpan,
          0,
        )
      : frequencyRange;
  const baseCenter = (baseRange.min + baseRange.max) / 2;
  const viewSpan = fullSpan / Math.max(1, zoom);
  const halfViewSpan = viewSpan / 2;
  const minPan = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : baseRange.min + halfViewSpan - baseCenter;
  const maxPan = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : baseRange.max - halfViewSpan - baseCenter;
  const clampedPan = Math.max(minPan, Math.min(maxPan, panHz));
  return {
    centerFrequencyHz: baseCenter + clampedPan,
    spanHz: viewSpan,
  };
};

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
  /** Explicit editor entry: center the requested frequency and zoom as needed. */
  tuneCenterFrequency: (frequency: number) => void;
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
  viewSyncKey,
  vfoTestId,
  onPinchStart,
  tuneHardware,
  retuneWhenUnzoomed = false,
  initialView,
  onViewChange,
}: VfoTunerOptions): VfoTuner => {
  const dispatch = useAppDispatch();

  const [zoom, setZoom] = useState(() =>
    Number.isFinite(initialView?.zoom) ? Math.max(1, initialView!.zoom!) : 1,
  );
  const [panHz, setPanHz] = useState(() =>
    Number.isFinite(initialView?.panHz) ? initialView!.panHz! : 0,
  );
  const [vfoFrequency, setVfoFrequency] = useState(() =>
    Number.isFinite(initialView?.vfoFrequencyHz)
      ? initialView!.vfoFrequencyHz!
      : 0,
  );
  const [cursorOffsetPx, setCursorOffsetPx] = useState(0);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(
    () => initialView?.isLocked ?? false,
  );
  const frequencyRangeRef = useRef(frequencyRange);
  frequencyRangeRef.current = frequencyRange;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const previousRangeCenterRef = useRef(
    (frequencyRange.min + frequencyRange.max) / 2,
  );
  const allowNegativeFrequenciesRef = useRef(allowNegativeFrequencies);
  allowNegativeFrequenciesRef.current = allowNegativeFrequencies;
  const currentViewRef = useRef<SharedVfoView>(
    getSharedViewFromState({
      frequencyRange,
      allowNegativeFrequencies,
      zoom,
      panHz,
      vfoFrequency,
    }),
  );
  currentViewRef.current = getSharedViewFromState({
    frequencyRange,
    allowNegativeFrequencies,
    zoom,
    panHz,
    vfoFrequency,
  });
  const localSharedViewListenerRef = useRef<
    ((view: SharedVfoView) => void) | null
  >(null);
  const skipSharedViewPublishRef = useRef(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const userTunedRef = useRef(
    Number.isFinite(initialView?.vfoFrequencyHz) &&
      initialView?.vfoFrequencyHz !== 0,
  );
  const previousSessionKeyRef = useRef(sessionKey);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const hasPublishedViewRef = useRef(false);
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

  useEffect(() => {
    if (viewSyncKey === undefined) return;
    skipSharedViewPublishRef.current = false;
    let subscribers = sharedVfoSubscribers.get(viewSyncKey);
    if (!subscribers) {
      subscribers = new Set();
      sharedVfoSubscribers.set(viewSyncKey, subscribers);
    }
    const listener = (view: SharedVfoView) => {
      const range = frequencyRangeRef.current;
      const fullSpan = Math.max(1, range.max - range.min);
      const boundedViewSpan = fullSpan / Math.max(1, zoomRef.current);
      const targetRange = clampCenteredFrequencyRange(
        mapDisplayFrequencyToSource(view.centerFrequencyHz),
        fullSpan,
        0,
      );
      const targetRangeCenter = (targetRange.min + targetRange.max) / 2;
      const halfViewSpan = boundedViewSpan / 2;
      const minPan = allowNegativeFrequenciesRef.current
        ? Number.NEGATIVE_INFINITY
        : targetRange.min + halfViewSpan - targetRangeCenter;
      const maxPan = allowNegativeFrequenciesRef.current
        ? Number.POSITIVE_INFINITY
        : targetRange.max - halfViewSpan - targetRangeCenter;
      const nextPanHz = Math.max(
        minPan,
        Math.min(maxPan, view.centerFrequencyHz - targetRangeCenter),
      );
      setPanHz(nextPanHz);
      setVfoFrequency(view.centerFrequencyHz);
      userTunedRef.current =
        Number.isFinite(view.centerFrequencyHz) && view.centerFrequencyHz !== 0;
    };
    localSharedViewListenerRef.current = listener;
    subscribers.add(listener);
    const sharedView = sharedVfoViews.get(viewSyncKey);
    if (sharedView) {
      skipSharedViewPublishRef.current = true;
      listener(sharedView);
    } else {
      sharedVfoViews.set(viewSyncKey, currentViewRef.current);
    }
    return () => {
      subscribers?.delete(listener);
      if (subscribers?.size === 0) sharedVfoSubscribers.delete(viewSyncKey);
      if (localSharedViewListenerRef.current === listener) {
        localSharedViewListenerRef.current = null;
      }
    };
  }, [viewSyncKey]);

  useEffect(() => {
    if (viewSyncKey === undefined) return;
    if (skipSharedViewPublishRef.current) {
      skipSharedViewPublishRef.current = false;
      return;
    }
    const view = currentViewRef.current;
    const lastSharedView = sharedVfoViews.get(viewSyncKey);
    // Receivers can reconstruct the same absolute view with tiny floating-point
    // differences. Treat those as the same view so nodes do not echo a shared
    // VFO update back and forth indefinitely.
    if (lastSharedView && sharedVfoViewsEqual(lastSharedView, view)) return;
    sharedVfoViews.set(viewSyncKey, view);
    for (const listener of sharedVfoSubscribers.get(viewSyncKey) ?? []) {
      if (listener !== localSharedViewListenerRef.current) listener(view);
    }
  }, [
    allowNegativeFrequencies,
    frequencyRange.max,
    frequencyRange.min,
    panHz,
    vfoFrequency,
    viewSyncKey,
    zoom,
  ]);

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
      intervalMs: 150,
      idleFlushMs: 180,
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
    if (previousSessionKeyRef.current === sessionKey) return;
    previousSessionKeyRef.current = sessionKey;
    userTunedRef.current = false;
  }, [sessionKey]);

  useEffect(() => {
    if (!hasPublishedViewRef.current) {
      hasPublishedViewRef.current = true;
      return;
    }
    onViewChangeRef.current?.({
      zoom,
      panHz,
      vfoFrequencyHz: vfoFrequency,
      isLocked,
    });
  }, [isLocked, panHz, vfoFrequency, zoom]);

  // Track the range center without letting a re-render clobber user tuning.
  useEffect(() => {
    const nextRangeCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const previousRangeCenter = previousRangeCenterRef.current;
    previousRangeCenterRef.current = nextRangeCenter;
    if (frequencyValuesEqual(previousRangeCenter, nextRangeCenter)) return;

    // A changed acquisition center means the radio (or source) actually
    // retuned. Follow it while retaining each node's zoom. Pan-only gestures
    // leave the acquisition center unchanged and remain view-local/shared.
    setVfoFrequency(nextRangeCenter);
    setPanHz(0);
    userTunedRef.current = true;
  }, [frequencyRange.max, frequencyRange.min]);

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
      // Only a zoomed-in view has a window to pan; at 1x the host decides
      // whether the gesture retunes instead (see retuneWhenUnzoomed).
      const pansView = zoomPanEnabled && (zoom > 1 || !retuneWhenUnzoomed);
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
      retuneWhenUnzoomed,
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

  const tuneCenterFrequency = useCallback(
    (frequency: number) => {
      if (isLocked || !Number.isFinite(frequency)) return;

      // Negative display frequencies use the mirrored pan path already owned
      // by tuneVfo. Positive typed centers should use the live route's
      // corrective zoom so a center near either edge remains visible.
      if (!zoomPanEnabled || (allowNegativeFrequencies && frequency < 0)) {
        tuneVfo(frequency, !zoomPanEnabled);
        return;
      }

      const sourceFrequency = mapDisplayFrequencyToSource(frequency);
      const currentRange = vfoFrequencyRange;
      const isInsideCurrentRange =
        sourceFrequency >= currentRange.min &&
        sourceFrequency <= currentRange.max;
      const span = rangeMax - rangeMin;
      const targetRange = isInsideCurrentRange
        ? currentRange
        : clampCenteredFrequencyRange(sourceFrequency, span, 0);
      const view = getZoomedViewForCenterFrequency({
        hardwareRange: targetRange,
        currentZoom: zoom,
        currentPan: isInsideCurrentRange ? panHz : 0,
        requestedCenterHz: sourceFrequency,
      });

      const requestedRange = clampCenteredFrequencyRange(
        sourceFrequency,
        span,
        0,
      );
      if (requestedRange.min !== rangeMin || requestedRange.max !== rangeMax) {
        // Move the acquisition window when the requested center changes.
        tuneVfo(frequency, true);
        setPanHz(0);
        return;
      } else {
        // The acquisition already contains the requested frequency, so keep
        // its origin fixed and make the correction local to this node.
        userTunedRef.current = true;
      }
      setZoom(view.zoom);
      setPanHz(view.pan);
    },
    [
      allowNegativeFrequencies,
      isLocked,
      panHz,
      rangeMax,
      rangeMin,
      tuneVfo,
      vfoFrequencyRange,
      zoom,
      zoomPanEnabled,
    ],
  );

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
    rangePublisherRef.current?.flush();
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
    tuneCenterFrequency,
    viewportRef,
    viewportHandlers,
    vfoHandlers,
  };
};
