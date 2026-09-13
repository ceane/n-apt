import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch } from "@reduxjs/toolkit";
import type { FrequencyRange } from "@n-apt/consts/schemas/websocket";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";
import {
  setSdrSettingsBundle,
} from "@n-apt/redux";
import type { NoteCardStatsSnapshot } from "@n-apt/redux/slices/noteCardsSlice";

export type SpectrumViewSnapshot = Partial<{
  activeSignalArea: string;
  frequencyRange: FrequencyRange;
  displayTemporalResolution: TemporalResolution;
  powerScale: "dB" | "dBm";
  vizZoom: number;
  vizZoomFloor: number;
  vizZoomFloorPan: number;
  vizPanOffset: number;
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftWindow: string;
  gain: number;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
}>;

export interface UseNoteViewHistoryOptions {
  state: {
    activeSignalArea?: string | null;
    frequencyRange?: FrequencyRange | null;
    displayTemporalResolution?: TemporalResolution;
    powerScale?: "dB" | "dBm";
    vizZoom?: number;
    vizZoomFloor?: number;
    vizZoomFloorPan?: number;
    vizPanOffset?: number;
    fftMinDb?: number;
    fftMaxDb?: number;
    fftSize?: number;
    fftWindow?: string;
    gain?: number;
    ppm?: number;
    tunerAGC?: boolean;
    rtlAGC?: boolean;
  };
  reduxDispatch: Dispatch;
  handleFrequencyRangeChange: (
    range: FrequencyRange,
    source?: "user-pan" | "mode-enter" | "typed",
  ) => void;
}

/**
 * Note-card view history: captures the current spectrum view before applying
 * a note card's snapshot and restores it on back. Extracted verbatim from
 * SpectrumRoute.
 */
export const useNoteViewHistory = (options: UseNoteViewHistoryOptions) => {
  const { state, reduxDispatch, handleFrequencyRangeChange } = options;
  const fftHistoryRef = useRef<SpectrumViewSnapshot[]>([]);
  const [fftHistoryVersion, setFftHistoryVersion] = useState(0);

  const captureSpectrumViewSnapshot = useCallback((): SpectrumViewSnapshot => {
    const range = state.frequencyRange;
    return {
      activeSignalArea: state.activeSignalArea ?? undefined,
      frequencyRange: range ? { ...range } : undefined,
      displayTemporalResolution: state.displayTemporalResolution,
      powerScale: state.powerScale,
      vizZoom: state.vizZoom,
      vizZoomFloor: state.vizZoomFloor,
      vizZoomFloorPan: state.vizZoomFloorPan,
      vizPanOffset: state.vizPanOffset,
      fftMinDb: state.fftMinDb,
      fftMaxDb: state.fftMaxDb,
      fftSize: state.fftSize,
      fftWindow: state.fftWindow,
      gain: state.gain,
      ppm: state.ppm,
      tunerAGC: state.tunerAGC,
      rtlAGC: state.rtlAGC,
    };
  }, [
    state.activeSignalArea,
    state.frequencyRange,
    state.displayTemporalResolution,
    state.powerScale,
    state.vizZoom,
    state.vizZoomFloor,
    state.vizZoomFloorPan,
    state.vizPanOffset,
    state.fftMinDb,
    state.fftMaxDb,
    state.fftSize,
    state.fftWindow,
    state.gain,
    state.ppm,
    state.tunerAGC,
    state.rtlAGC,
  ]);

  const applySpectrumViewSnapshot = useCallback(
    (snapshot: SpectrumViewSnapshot) => {
      reduxDispatch(
        setSdrSettingsBundle({
          activeSignalArea:
            snapshot.activeSignalArea ??
            (state.activeSignalArea ?? undefined),
          displayTemporalResolution:
            snapshot.displayTemporalResolution ??
            state.displayTemporalResolution,
          powerScale: snapshot.powerScale ?? state.powerScale,
          vizZoom: snapshot.vizZoom ?? state.vizZoom,
          vizZoomFloor: snapshot.vizZoomFloor ?? state.vizZoomFloor,
          vizZoomFloorPan: snapshot.vizZoomFloorPan ?? state.vizZoomFloorPan,
          vizPanOffset: snapshot.vizPanOffset ?? state.vizPanOffset,
          fftMinDb: snapshot.fftMinDb ?? state.fftMinDb,
          fftMaxDb: snapshot.fftMaxDb ?? state.fftMaxDb,
          fftSize: snapshot.fftSize ?? state.fftSize,
          fftWindow: snapshot.fftWindow ?? state.fftWindow,
          gain: snapshot.gain ?? state.gain,
          ppm: snapshot.ppm ?? state.ppm,
          tunerAGC: snapshot.tunerAGC ?? state.tunerAGC,
          rtlAGC: snapshot.rtlAGC ?? state.rtlAGC,
          frequencyRange: snapshot.frequencyRange ?? state.frequencyRange ?? undefined,
        }),
      );

      if (snapshot.frequencyRange) {
        handleFrequencyRangeChange(snapshot.frequencyRange);
      }
    },
    [
      reduxDispatch,
      handleFrequencyRangeChange,
      state.activeSignalArea,
      state.frequencyRange,
      state.displayTemporalResolution,
      state.powerScale,
      state.vizZoom,
      state.vizZoomFloor,
      state.vizZoomFloorPan,
      state.vizPanOffset,
      state.fftMinDb,
      state.fftMaxDb,
      state.fftSize,
      state.fftWindow,
      state.gain,
      state.ppm,
      state.tunerAGC,
      state.rtlAGC,
    ],
  );

  const handleViewNoteCard = useCallback(
    (card: NoteCardStatsSnapshot) => {
      if (state.frequencyRange) {
        fftHistoryRef.current.push(captureSpectrumViewSnapshot());
        setFftHistoryVersion((version) => version + 1);
      }

      applySpectrumViewSnapshot({
        activeSignalArea: state.activeSignalArea ?? undefined,
        frequencyRange:
          card.frequencyRange ?? state.frequencyRange ?? undefined,
        displayTemporalResolution: card.temporalResolution,
        powerScale: card.powerScale,
        vizZoom: card.vizZoom,
        vizZoomFloor: state.vizZoomFloor,
        vizZoomFloorPan: state.vizZoomFloorPan,
        vizPanOffset: card.vizPanOffset,
        fftMinDb: card.fftDbMin,
        fftMaxDb: card.fftDbMax,
        fftSize: card.fftSize,
        fftWindow: card.fftWindow,
        gain: card.gain,
        ppm: card.ppm,
        tunerAGC: card.tunerAGC,
        rtlAGC: card.rtlAGC,
      });
    },
    [
      applySpectrumViewSnapshot,
      captureSpectrumViewSnapshot,
      state.activeSignalArea,
      state.frequencyRange,
      state.vizZoomFloor,
      state.vizZoomFloorPan,
    ],
  );

  const handleBackFromNoteView = useCallback(() => {
    const previous = fftHistoryRef.current.pop();
    if (!previous) return;
    setFftHistoryVersion((version) => version + 1);
    applySpectrumViewSnapshot(previous);
  }, [applySpectrumViewSnapshot]);

  const hasNoteViewHistory = useMemo(
    () => fftHistoryVersion > 0 && fftHistoryRef.current.length > 0,
    [fftHistoryVersion],
  );

  return {
    fftHistoryRef,
    fftHistoryVersion,
    handleViewNoteCard,
    handleBackFromNoteView,
    /** Reactive depth signal for rendering the back button. */
    hasNoteViewHistory,
  };
};
