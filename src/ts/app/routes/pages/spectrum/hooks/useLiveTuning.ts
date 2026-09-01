import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch } from "@reduxjs/toolkit";
import type {
  FrequencyRange,
  SourceInfo,
} from "@n-apt/consts/schemas/websocket";
import {
  buildCenteredFrequencyRange,
  clampFrequencyRangeToBounds,
  normalizeFrequencyRangeToHz,
} from "@n-apt/math/frequency";
import { resolveMirroredTuning } from "@n-apt/math/basebandMirror";
import {
  resolveMockTxTransmitSettings,
  shouldJumpTxMonitor,
} from "@n-apt/transmit/public/txSliderPlacement";
import {
  setFrequencyRange,
  setTuningPreviewActive,
  setTxCenterFrequencyHz,
  setVizZoomFloorPan,
} from "@n-apt/redux";
import {
  createLiveFrequencyRangePublisher,
  publishFrequencyRangeImmediately,
  resolveNavigationFrequencyBounds,
} from "../../SpectrumRoute";

export interface UseFrequencyTuningOptions {
  allowNegativeFrequencies: boolean;
  hardwareSpectrumBounds: { min: number; max: number } | null;
  activeSignalAreaBounds: { min: number; max: number } | null;
  sampleRateHzEffective: number | null | undefined;
  getAvailableSpectrumBounds: (
    hardwareBounds: { min: number; max: number } | null,
  ) => { min: number; max: number };
  frequencyRange: FrequencyRange | null;
  tuningPreviewActive?: boolean;
  vizZoom?: number;
  sourceMode?: "live" | "file";
  vizPanOffset?: number;
  autoZoomStability?: boolean;
  vizZoomFloor?: number;
  reduxDispatch: Dispatch;
  sendFrequencyRange: (range: FrequencyRange) => void;
  applyTxMonitorForRange: (
    range: FrequencyRange,
    source: "user-pan" | "mode-enter" | "typed" | "hardware-retune",
  ) => void;
  setVizPanOffset: (pan: number) => void;
}

/**
 * Frequency tuning: the coalesced live publisher, the mirrored/clamped tune
 * handler, and global arrow-key navigation. Extracted verbatim from
 * SpectrumRoute. The Tx monitor's range callback arrives via options so this
 * hook has no import cycle with useTxMonitor.
 */
export const useFrequencyTuning = (options: UseFrequencyTuningOptions) => {
  const {
    allowNegativeFrequencies,
    hardwareSpectrumBounds,
    activeSignalAreaBounds,
    sampleRateHzEffective,
    getAvailableSpectrumBounds,
    frequencyRange,
    tuningPreviewActive = false,
    vizZoom,
    sourceMode,
    vizPanOffset,
    autoZoomStability,
    vizZoomFloor,
    reduxDispatch,
    sendFrequencyRange,
    applyTxMonitorForRange,
    setVizPanOffset,
  } = options;

  const setLiveFrequencyRangeRef = useRef<(range: FrequencyRange) => void>(
    () => {},
  );
  const sendLiveFrequencyRangeRef = useRef<(range: FrequencyRange) => void>(
    () => {},
  );
  const liveFrequencyRangePublisherRef = useRef<
    ReturnType<typeof createLiveFrequencyRangePublisher> | null
  >(null);
  if (!liveFrequencyRangePublisherRef.current) {
    liveFrequencyRangePublisherRef.current = createLiveFrequencyRangePublisher(
      (range) => setLiveFrequencyRangeRef.current(range),
      (range) => sendLiveFrequencyRangeRef.current(range),
    );
  }
  setLiveFrequencyRangeRef.current = (nextRange) => {
    reduxDispatch(setFrequencyRange(nextRange));
  };
  sendLiveFrequencyRangeRef.current = sendFrequencyRange;
  useEffect(
    () => () => {
      liveFrequencyRangePublisherRef.current?.cancel();
    },
    [],
  );
  const publishFrequencyRange = useCallback(
    (
      range: FrequencyRange,
      source:
        | "user-pan"
        | "mode-enter"
        | "typed"
        | "hardware-retune" = "user-pan",
    ) => {
      if (
        tuningPreviewActive &&
        (source === "user-pan" || source === "hardware-retune")
      ) {
        // Direct wheel tuning owns the VFO as soon as the gesture begins.
        // Stop a channel-selection trajectory before its next animation frame
        // can overwrite the wheel range in the opposite direction.
        reduxDispatch(setTuningPreviewActive(false));
      }
      if (source === "user-pan" || source === "hardware-retune") {
        // The interaction hook updates its live refs synchronously. Keep the
        // route/device fan-out bounded so a trackpad burst cannot cause one
        // React render and socket command per native wheel event.
        liveFrequencyRangePublisherRef.current?.publish(range);
        return;
      }

      // Typed/mode changes are discrete commands. Flush a pending pan first,
      // then preserve their immediate ordering with the device request.
      liveFrequencyRangePublisherRef.current?.flush();
      publishFrequencyRangeImmediately(
        range,
        setLiveFrequencyRangeRef.current,
        sendLiveFrequencyRangeRef.current,
      );
    },
    [reduxDispatch, tuningPreviewActive],
  );

  const handleFrequencyRangeChange = useCallback(
    (
      range: FrequencyRange,
      source:
        | "user-pan"
        | "mode-enter"
        | "typed"
        | "hardware-retune" = "user-pan",
    ) => {
      // The mirror is presentational: an explicit tune still asks the radio for
      // a positive window, and a below-zero request is restored with pan rather
      // than by letting the shifted window become the view. Already-positive
      // requests (including auto-retunes) must not touch pan — the caller owns
      // re-anchoring, otherwise a retune briefly snaps the viewport to DC.
      if (allowNegativeFrequencies && range.min < 0) {
        // Cap every mirrored tune at the live sample-rate window. Whole-channel
        // thumbs (positive or DC-crossing) must not widen Redux past what the
        // radio actually acquires — that is the channel-island flatline.
        const acquisitionSpanHz =
          frequencyRange &&
          Number.isFinite(frequencyRange.max) &&
          Number.isFinite(frequencyRange.min) &&
          frequencyRange.max > frequencyRange.min
            ? frequencyRange.max - frequencyRange.min
            : sampleRateHzEffective;
        const { hardwareRange, panOffsetHz } = resolveMirroredTuning(
          range,
          null,
          { maxAcquisitionSpanHz: acquisitionSpanHz },
        );
        // The |f| fold of an unbounded negative display pan can resolve to a
        // positive window far outside the spectrum. Clamp the resolved window
        // against the available spectrum at the publish boundary.
        const nextRange = normalizeFrequencyRangeToHz(
          clampFrequencyRangeToBounds(
            hardwareRange,
            getAvailableSpectrumBounds(hardwareSpectrumBounds),
          ),
        );
        // Only re-anchor pan for below-zero / clamped-crossing requests.
        // Auto-retunes that are already positive own their own pan.
        if (range.min < 0) {
          setVizPanOffset(panOffsetHz);
        }
        publishFrequencyRange(nextRange, source);
        applyTxMonitorForRange(nextRange, source);
        return;
      }

      const primaryBounds = resolveNavigationFrequencyBounds({
        channelBounds: activeSignalAreaBounds,
        hardwareBounds: hardwareSpectrumBounds,
      });
      const clampedRange = normalizeFrequencyRangeToHz(
        primaryBounds
          ? clampFrequencyRangeToBounds(range, primaryBounds)
          : range,
      );
      publishFrequencyRange(clampedRange, source);
      applyTxMonitorForRange(clampedRange, source);
    },
    [
      allowNegativeFrequencies,
      applyTxMonitorForRange,
      hardwareSpectrumBounds,
      activeSignalAreaBounds,
      publishFrequencyRange,
      sampleRateHzEffective,
      setVizPanOffset,
      frequencyRange,
      vizZoom,
      getAvailableSpectrumBounds,
    ],
  );

  // Global keyboard listener: ArrowLeft/Right for frequency shift / visual pan
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle events when not in an input field
      const isInputFocused =
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        ) || (document.activeElement as HTMLElement)?.isContentEditable;

      if (isInputFocused) return;

      if (
        (event.code === "ArrowLeft" || event.code === "ArrowRight") &&
        frequencyRange
      ) {
        event.preventDefault();
        event.stopPropagation();

        const shiftHz = event.code === "ArrowRight" ? 33000 : -33000;

        if (sourceMode === "live") {
          if ((vizZoom ?? 1) > 1) {
            // Zoomed-in live mode: pan the visual display instead of changing hardware VFO
            const currentPan = vizPanOffset ?? 0;
            const zoom = vizZoom ?? 1;
            const fullRange = frequencyRange.max - frequencyRange.min;
            const visualRange = fullRange / zoom;
            const maxPan = fullRange / 2 - visualRange / 2;

            let newPan = currentPan + shiftHz;
            newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
            setVizPanOffset(newPan);

            // Auto zoom stability: track floor pan so Refocus can restore this position
            if (autoZoomStability && (vizZoomFloor ?? 1) > 1) {
              reduxDispatch(setVizZoomFloorPan(newPan));
            }
          } else {
            // Unzoomed live mode: change hardware VFO
            const fullRange = frequencyRange.max - frequencyRange.min;
            const newMin = frequencyRange.min + shiftHz;
            const newMax = newMin + fullRange;

            handleFrequencyRangeChange({ min: newMin, max: newMax });
          }
        } else if (sourceMode === "file") {
          // In file mode, move the visual pan offset
          const currentPan = vizPanOffset ?? 0;
          const zoom = vizZoom ?? 1;
          const fullRange = frequencyRange.max - frequencyRange.min;
          const visualRange = fullRange / zoom;
          const maxPan = fullRange / 2 - visualRange / 2;

          let newPan = currentPan + shiftHz;
          newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
          setVizPanOffset(newPan);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    sourceMode,
    frequencyRange,
    vizPanOffset,
    vizZoom,
    autoZoomStability,
    vizZoomFloor,
    handleFrequencyRangeChange,
    setVizPanOffset,
  ]);

  return { publishFrequencyRange, handleFrequencyRangeChange };
};

export interface UseTxMonitorOptions {
  isMockTxMonitorActive: boolean;
  isConnected: boolean;
  isSwitchingLiveSource: boolean;
  isSelectedMockTxTransmitting: boolean;
  selectedSourceId: string | null;
  selectedSource: SourceInfo | null;
  sendTransmitStatus?:
    | ((transmitting: boolean, name: string, settings: any) => void)
    | null;
  frequencyRange: FrequencyRange | null;
  txSampleRateHz: number;
  txPowerDbm: number;
  txSignal: string;
  txIfftSize: number;
  txCenterFrequencyHz: number;
  /** Route-level memo of the shared spectrum window's center. */
  centerFrequencyHz: number | null;
  transmittingTxSource: SourceInfo | null;
  reduxDispatch: Dispatch;
  /**
   * Late-wired handleFrequencyRangeChange: the monitor hook runs before
   * tuning (the tuner needs applyTxMonitorForRange), so the changer arrives
   * through this ref once the tuner exists.
   */
  frequencyRangeChangerRef: {
    current: (
      range: FrequencyRange,
      source?: "user-pan" | "mode-enter" | "typed",
    ) => void;
  };
}

/**
 * Mock Tx / Tx-suite monitor VFO: attach/detach semantics, slider-driven
 * carrier moves, transmit-settings sync. Extracted verbatim from
 * SpectrumRoute.
 */
export const useTxMonitor = (options: UseTxMonitorOptions) => {
  const {
    isMockTxMonitorActive,
    isConnected,
    isSwitchingLiveSource,
    isSelectedMockTxTransmitting,
    selectedSourceId,
    selectedSource,
    sendTransmitStatus,
    frequencyRange,
    txSampleRateHz,
    txPowerDbm,
    txSignal,
    txIfftSize,
    txCenterFrequencyHz,
    centerFrequencyHz,
    transmittingTxSource,
    reduxDispatch,
    frequencyRangeChangerRef,
  } = options;

  const [mockMonitorCenterHz, setMockMonitorCenterHz] = useState<number | null>(
    () => {
      if (Number.isFinite(txCenterFrequencyHz)) {
        return txCenterFrequencyHz;
      }
      const range = frequencyRange;
      if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
        return Math.round((range.min + range.max) / 2);
      }
      return null;
    },
  );
  const isDraggingTxRef = useRef(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Attached (false): monitor stays on planned Tx — required for cold load so a
   * stale frequencyRange cannot synthesize an off-window noise-floor preview.
   * Detached (true): user pan or slider moved the carrier without jumping view.
   */
  const [txMonitorDetached, setTxMonitorDetached] = useState(false);
  const wasMockTxMonitorActiveRef = useRef(false);

  const applyTxMonitorForRange = useCallback(
    (
      range: FrequencyRange,
      source: "user-pan" | "mode-enter" | "typed" | "hardware-retune",
    ) => {
      if (
        !isMockTxMonitorActive ||
        !Number.isFinite(range.min) ||
        !Number.isFinite(range.max)
      ) {
        return;
      }
      const nextCenter = (range.min + range.max) / 2;
      if (source === "user-pan") {
        setTxMonitorDetached(true);
        setMockMonitorCenterHz(nextCenter);
      } else if (
        source !== "hardware-retune" &&
        shouldJumpTxMonitor({ source })
      ) {
        setTxMonitorDetached(false);
        setMockMonitorCenterHz(nextCenter);
      }
    },
    [isMockTxMonitorActive],
  );

  const jumpMonitorToTx = useCallback(
    (centerHz: number, source: "mode-enter" | "typed" = "typed") => {
      if (!Number.isFinite(centerHz) || !shouldJumpTxMonitor({ source })) {
        return;
      }
      setTxMonitorDetached(false);
      setMockMonitorCenterHz(centerHz);
      const spanHz = frequencyRange
        ? frequencyRange.max - frequencyRange.min
        : txSampleRateHz;
      if (Number.isFinite(spanHz) && spanHz > 0) {
        frequencyRangeChangerRef.current(
          buildCenteredFrequencyRange(centerHz, spanHz, 0),
          source,
        );
      }
    },
    [frequencyRange, txSampleRateHz, frequencyRangeChangerRef],
  );

  const syncMockTxSettingsFromSlider = useCallback(
    (centerFrequencyHzArg: number, sampleRateHzOverride?: number) => {
      if (
        !Number.isFinite(centerFrequencyHzArg) ||
        !isMockTxMonitorActive ||
        !isConnected ||
        isSwitchingLiveSource ||
        !isSelectedMockTxTransmitting
      ) {
        return;
      }

      const effectiveTxSampleRateHz =
        typeof sampleRateHzOverride === "number" &&
        Number.isFinite(sampleRateHzOverride)
          ? sampleRateHzOverride
          : txSampleRateHz;
      const rangeViewSampleRateHz = frequencyRange
        ? frequencyRange.max - frequencyRange.min
        : undefined;
      const rangeViewCenterHz =
        frequencyRange &&
        Number.isFinite(frequencyRange.min) &&
        Number.isFinite(frequencyRange.max)
          ? (frequencyRange.min + frequencyRange.max) / 2
          : null;
      // Slider is passive: never force the monitor onto the carrier.
      const txSettings = {
        ...resolveMockTxTransmitSettings({
          txCenterHz: centerFrequencyHzArg,
          viewCenterHz: mockMonitorCenterHz ?? rangeViewCenterHz,
          viewSampleRateHz: rangeViewSampleRateHz,
          txBandwidthHz: effectiveTxSampleRateHz,
          alignMonitor: false,
        }),
        powerDbm: txPowerDbm,
        txSignal,
        txIfftSize,
      };

      const fallbackId = selectedSourceId || selectedSource?.id;
      if (!fallbackId) return;
      sendTransmitStatus?.(true, selectedSource?.name ?? fallbackId, {
        serialNumber: selectedSource?.serial_number?.trim() || fallbackId,
        ...txSettings,
      });
    },
    [
      isConnected,
      isMockTxMonitorActive,
      isSelectedMockTxTransmitting,
      isSwitchingLiveSource,
      mockMonitorCenterHz,
      selectedSource,
      selectedSourceId,
      sendTransmitStatus,
      frequencyRange,
      txIfftSize,
      txPowerDbm,
      txSampleRateHz,
      txSignal,
    ],
  );

  const handleCenterFrequencyChangeFromSlider = useCallback(
    (value: number, isDragging?: boolean) => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
      isDraggingTxRef.current = !!isDragging;
      if (!isDragging) {
        dragTimeoutRef.current = setTimeout(() => {
          isDraggingTxRef.current = false;
        }, 0);
      }

      // Standby and transmitting: slider updates planned Tx only and detaches
      // so a later attached-sync cannot yank the monitor onto the new carrier.
      setTxMonitorDetached(true);
      reduxDispatch(setTxCenterFrequencyHz(value));
      syncMockTxSettingsFromSlider(value);
    },
    [reduxDispatch, syncMockTxSettingsFromSlider],
  );

  // Entering Mock Tx / Tx mode aligns the monitor to the planned carrier once.
  useEffect(() => {
    const enteredMockTx =
      isMockTxMonitorActive && !wasMockTxMonitorActiveRef.current;
    wasMockTxMonitorActiveRef.current = isMockTxMonitorActive;
    if (!enteredMockTx || !Number.isFinite(txCenterFrequencyHz)) {
      return;
    }
    jumpMonitorToTx(txCenterFrequencyHz, "mode-enter");
  }, [isMockTxMonitorActive, jumpMonitorToTx, txCenterFrequencyHz]);

  // While attached, ignore stale frequencyRange centers (cold-load race).
  // While detached, follow range updates from user pan / typed sidebar jumps
  // that already recentered onto Tx (range center ≈ tx center → re-attach).
  useEffect(() => {
    if (!isMockTxMonitorActive || !frequencyRange) {
      return;
    }
    if (isDraggingTxRef.current) {
      return;
    }
    const rangeCenter = (frequencyRange.min + frequencyRange.max) / 2;
    if (!Number.isFinite(rangeCenter)) {
      return;
    }
    const alignedWithTx =
      Number.isFinite(txCenterFrequencyHz) &&
      Math.abs(rangeCenter - txCenterFrequencyHz) <= 1;
    if (alignedWithTx) {
      setTxMonitorDetached(false);
      setMockMonitorCenterHz(txCenterFrequencyHz);
      return;
    }
    if (txMonitorDetached) {
      setMockMonitorCenterHz((previous) =>
        previous != null && Math.abs(previous - rangeCenter) <= 1
          ? previous
          : rangeCenter,
      );
    }
  }, [
    isMockTxMonitorActive,
    frequencyRange,
    txCenterFrequencyHz,
    txMonitorDetached,
  ]);

  const txSettingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastTxSettingsSyncKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!transmittingTxSource) {
      lastTxSettingsSyncKeyRef.current = null;
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
      return;
    }

    const rangeViewSampleRateHz = frequencyRange
      ? frequencyRange.max - frequencyRange.min
      : undefined;
    const rangeViewCenterHz =
      frequencyRange &&
      Number.isFinite(frequencyRange.min) &&
      Number.isFinite(frequencyRange.max)
        ? (frequencyRange.min + frequencyRange.max) / 2
        : null;
    // First Start Tx aligns when still attached; later slider/pan syncs stay
    // on the current monitor view.
    const alignMonitor =
      lastTxSettingsSyncKeyRef.current === null && !txMonitorDetached;
    if (alignMonitor) {
      setMockMonitorCenterHz(txCenterFrequencyHz);
      setTxMonitorDetached(false);
    }
    const transmitSettings = resolveMockTxTransmitSettings({
      txCenterHz: txCenterFrequencyHz,
      viewCenterHz: alignMonitor
        ? txCenterFrequencyHz
        : (mockMonitorCenterHz ?? rangeViewCenterHz),
      viewSampleRateHz: rangeViewSampleRateHz,
      txBandwidthHz: txSampleRateHz,
      alignMonitor,
    });
    const syncKey = JSON.stringify({
      sourceId: transmittingTxSource.id,
      txSignal,
      ...transmitSettings,
      txPowerDbm,
    });
    if (lastTxSettingsSyncKeyRef.current === syncKey) {
      return;
    }

    const sendTxSettings = () => {
      lastTxSettingsSyncKeyRef.current = syncKey;
      sendTransmitStatus?.(
        true,
        transmittingTxSource.name ?? transmittingTxSource.id,
        {
          serialNumber:
            transmittingTxSource.serial_number?.trim() ||
            transmittingTxSource.id,
          ...transmitSettings,
          powerDbm: txPowerDbm,
          txSignal,
        },
      );
    };

    if (lastTxSettingsSyncKeyRef.current === null) {
      sendTxSettings();
      return;
    }

    if (txSettingsSyncTimerRef.current) {
      clearTimeout(txSettingsSyncTimerRef.current);
    }
    txSettingsSyncTimerRef.current = setTimeout(() => {
      txSettingsSyncTimerRef.current = null;
      sendTxSettings();
    }, 16);

    return () => {
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
    };
  }, [
    sendTransmitStatus,
    frequencyRange,
    transmittingTxSource,
    centerFrequencyHz,
    mockMonitorCenterHz,
    txCenterFrequencyHz,
    txMonitorDetached,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
  ]);

  return {
    mockMonitorCenterHz,
    setMockMonitorCenterHz,
    setTxMonitorDetached,
    isDraggingTxRef,
    txMonitorDetached,
    applyTxMonitorForRange,
    jumpMonitorToTx,
    syncMockTxSettingsFromSlider,
    handleCenterFrequencyChangeFromSlider,
  };
};
