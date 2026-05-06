import { useRef, useCallback, useMemo, useState, useEffect } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";
import { FFT_MIN_DB, FFT_MAX_DB } from "@n-apt/consts";

const MIN_FFT_DB_SPAN = 5;

const DB_MAX_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: FFT_MAX_DB },
  dBm: { min: -100, max: 30 },
};

const DB_MIN_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: -10 },
  dBm: { min: -120, max: -10 },
};

const clampDbMaxValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MAX_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const clampDbMinValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MIN_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const ensureValidDbRange = (
  minVal: number,
  maxVal: number,
  scale: "dB" | "dBm",
) => {
  let nextMin = clampDbMinValue(minVal, scale);
  let nextMax = clampDbMaxValue(maxVal, scale);

  if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
    nextMax = clampDbMaxValue(nextMin + MIN_FFT_DB_SPAN, scale);
    if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
      nextMin = clampDbMinValue(nextMax - MIN_FFT_DB_SPAN, scale);
    }
  }

  return { min: nextMin, max: nextMax };
};

export interface VisualizationState {
  // Current visual parameters
  currentVizZoom: number;
  vizPanOffset: number;
  vizDbMin: number;
  vizDbMax: number;
  effectivePowerScale: "dB" | "dBm";

  // Refs for internal usage
  vizZoomRef: React.MutableRefObject<number>;
  vizPanOffsetRef: React.MutableRefObject<number>;
  vizDbMinRef: React.MutableRefObject<number>;
  vizDbMaxRef: React.MutableRefObject<number>;
  frequencyRangeRef: React.MutableRefObject<FrequencyRange>;
  centerFreqRef: React.MutableRefObject<number>;

  // State setters
  setVizZoom: (val: number | ((prev: number) => number)) => void;
  setVizPanOffset: (val: number | ((prev: number) => number)) => void;

  // Utility functions
  getZoomedData: (
    fullWaveform: Float32Array,
    fullRange: FrequencyRange,
    zoom: number,
    panOffset: number,
  ) => {
    slicedWaveform: Float32Array;
    visualRange: FrequencyRange;
    clampedPan: number;
  };
  applyDbLimits: (minValue: number, maxValue: number) => void;
}

export interface VisualizationStateProps {
  vizZoom?: number;
  vizPanOffset?: number;
  fftMin?: number;
  fftMax?: number;
  powerScale?: "dB" | "dBm";
  frequencyRange: FrequencyRange;
  centerFrequencyHz: number;
  onVizZoomChange?: (zoom: number) => void;
  onVizPanChange?: (pan: number) => void;
  onFftDbLimitsChange?: (min: number, max: number) => void;
}

export const useVisualizationState = ({
  vizZoom = 1,
  vizPanOffset = 0,
  fftMin,
  fftMax,
  powerScale = "dB",
  frequencyRange,
  centerFrequencyHz,
  onVizZoomChange,
  onVizPanChange,
  onFftDbLimitsChange,
}: VisualizationStateProps): VisualizationState => {
  const effectivePowerScale = powerScale;
  const baseDbMin = Number.isFinite(fftMin) ? (fftMin as number) : FFT_MIN_DB;
  const baseDbMax = Number.isFinite(fftMax) ? (fftMax as number) : FFT_MAX_DB;
  
  const validatedDbRange = useMemo(
    () => ensureValidDbRange(baseDbMin, baseDbMax, effectivePowerScale),
    [baseDbMin, baseDbMax, effectivePowerScale],
  );

  const [currentVizZoom, setCurrentVizZoom] = useState(vizZoom);
  const [currentVizPanOffset, setCurrentVizPanOffset] = useState(vizPanOffset);
  const vizDbMin = validatedDbRange.min;
  const vizDbMax = validatedDbRange.max;

  // Refs for internal usage
  const vizZoomRef = useRef(currentVizZoom);
  const vizPanOffsetRef = useRef(currentVizPanOffset);
  const vizDbMinRef = useRef(vizDbMin);
  const vizDbMaxRef = useRef(vizDbMax);
  const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
  const centerFreqRef = useRef(centerFrequencyHz);
  const lastEmittedDbLimitsRef = useRef<{ min: number; max: number } | null>(null);

  // Update refs when values change
  vizZoomRef.current = currentVizZoom;
  vizPanOffsetRef.current = currentVizPanOffset;
  vizDbMinRef.current = vizDbMin;
  vizDbMaxRef.current = vizDbMax;
  centerFreqRef.current = centerFrequencyHz;

  const setVizZoom = useCallback(
    (val: number | ((prev: number) => number)) => {
      const newZoom = typeof val === "function" ? val(currentVizZoom) : val;
      setCurrentVizZoom(newZoom);
      if (onVizZoomChange) {
        onVizZoomChange(newZoom);
      }
    },
    [onVizZoomChange, currentVizZoom],
  );

  const setVizPanOffset = useCallback(
    (val: number | ((prev: number) => number)) => {
      const newPan = typeof val === "function" ? val(currentVizPanOffset) : val;
      setCurrentVizPanOffset(newPan);
      if (onVizPanChange) {
        onVizPanChange(newPan);
      }
    },
    [onVizPanChange, currentVizPanOffset],
  );

  const applyDbLimits = useCallback(
    (minValue: number, maxValue: number) => {
      if (!onFftDbLimitsChange) return;
      const next = ensureValidDbRange(minValue, maxValue, effectivePowerScale);
      onFftDbLimitsChange(next.min, next.max);
    },
    [onFftDbLimitsChange, effectivePowerScale],
  );

  // Emit db limits when they change
  useEffect(() => {
    if (!onFftDbLimitsChange) return;
    const normalized = { min: vizDbMin, max: vizDbMax };
    const lastEmitted = lastEmittedDbLimitsRef.current;
    const shouldEmit =
      baseDbMin !== normalized.min ||
      baseDbMax !== normalized.max;

    if (
      shouldEmit &&
      (!lastEmitted ||
        lastEmitted.min !== normalized.min ||
        lastEmitted.max !== normalized.max)
    ) {
      lastEmittedDbLimitsRef.current = normalized;
      onFftDbLimitsChange(vizDbMin, vizDbMax);
    }
  }, [baseDbMin, baseDbMax, vizDbMin, vizDbMax, onFftDbLimitsChange]);

  // Compute zoomed visual frequency range and waveform slice
  const getZoomedData = useCallback(
    (
      fullWaveform: Float32Array,
      fullRange: FrequencyRange,
      zoom: number,
      panOffset: number,
    ): {
      slicedWaveform: Float32Array;
      visualRange: FrequencyRange;
      clampedPan: number;
    } => {
      if (zoom === 1) {
        return {
          slicedWaveform: fullWaveform,
          visualRange: fullRange,
          clampedPan: 0,
        };
      }

      const totalBins = fullWaveform.length;
      const visibleBins = Math.max(1, Math.floor(totalBins / zoom));

      const fullSpan = fullRange.max - fullRange.min;
      const halfSpan = fullSpan / (2 * zoom);

      // Calculate max allowed pan so visual window doesn't exceed hardware window
      const maxPan = fullSpan / 2 - halfSpan;
      let clampedPan = panOffset;
      if (maxPan >= 0) {
        clampedPan = Math.max(-maxPan, Math.min(maxPan, panOffset));
      } else {
        const outPan = -maxPan;
        clampedPan = Math.max(-outPan, Math.min(outPan, panOffset));
      }

      const centerFreq = (fullRange.min + fullRange.max) / 2;
      const visualCenter = centerFreq + clampedPan;

      // Convert visual center to bin index
      const visualCenterBin = Math.round(
        ((visualCenter - fullRange.min) / fullSpan) * totalBins,
      );

      let startBin = Math.round(visualCenterBin - visibleBins / 2);

      const visualRange = {
        min: visualCenter - halfSpan,
        max: visualCenter + halfSpan,
      };

      if (zoom < 1) {
        const paddedWaveform = new Float32Array(visibleBins).fill(FFT_MIN_DB);
        const destOffset = Math.max(0, -startBin);
        const dataToCopy = Math.min(totalBins, visibleBins - destOffset);
        const srcOffset = Math.max(0, startBin);

        if (dataToCopy > 0) {
          paddedWaveform.set(
            fullWaveform.subarray(srcOffset, srcOffset + dataToCopy),
            destOffset,
          );
        }
        return { slicedWaveform: paddedWaveform, visualRange, clampedPan };
      }

      // Clamp startBin to valid array bounds for zoom > 1
      startBin = Math.max(0, Math.min(totalBins - visibleBins, startBin));

      const slicedWaveform = fullWaveform.subarray(
        startBin,
        startBin + visibleBins,
      );

      return { slicedWaveform, visualRange, clampedPan };
    },
    [],
  );

  // Update frequency range ref when prop changes
  useEffect(() => {
    frequencyRangeRef.current = frequencyRange;
  }, [frequencyRange]);

  return {
    // Current visual parameters
    currentVizZoom,
    vizPanOffset: currentVizPanOffset,
    vizDbMin,
    vizDbMax,
    effectivePowerScale,

    // Refs
    vizZoomRef,
    vizPanOffsetRef,
    vizDbMinRef,
    vizDbMaxRef,
    frequencyRangeRef,
    centerFreqRef,

    // State setters
    setVizZoom,
    setVizPanOffset,

    // Utility functions
    getZoomedData,
    applyDbLimits,
  };
};
