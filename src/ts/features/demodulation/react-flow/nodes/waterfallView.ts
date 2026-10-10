/**
 * Pure view math behind the waterfall/phase viewport: zoom, pan, VFO drag and
 * pinch geometry. Kept free of React and DOM so both nodes share one source of
 * truth for how a gesture becomes a view.
 */
import { formatFrequency } from "@n-apt/math/frequency";
import type { FrequencyRange } from "@n-apt/consts/types";
import { VISUALIZER_MAX_ZOOM } from "@n-apt/consts/visualizerControls";

export const formatMiniVfoFrequency = (frequencyHz: number) =>
  formatFrequency(frequencyHz, {
    showUnits: true,
    // Preserve Hz-level VFO changes while keeping the compact unit display.
    precisionMHz: 6,
    precisionGHz: 6,
    precisionKHz: 3,
    trimTrailingZeros: true,
  }).replace(/(\d)(?=[A-Za-z])/g, "$1 ");

export const getCenteredWaterfallZoomView = (
  waveform: Float32Array,
  zoom: number,
): Float32Array => {
  if (zoom <= 1 || waveform.length <= 1) return waveform;
  const visibleLength = Math.max(1, Math.floor(waveform.length / zoom));
  const start = Math.max(0, Math.floor((waveform.length - visibleLength) / 2));
  return waveform.subarray(start, start + visibleLength);
};

export const getWaterfallZoomBoxView = ({
  hardwareRange,
  currentZoom,
  currentPanHz,
  selectionStartX,
  selectionEndX,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  currentZoom: number;
  currentPanHz: number;
  selectionStartX: number;
  selectionEndX: number;
  allowNegativeFrequencies?: boolean;
}): {
  zoom: number;
  panHz: number;
  visibleRange: FrequencyRange;
} => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const safeCurrentZoom = Math.max(1, currentZoom);
  const selectionSpan = Math.max(
    0.001,
    Math.abs(selectionEndX - selectionStartX),
  );
  const zoom = Math.min(
    VISUALIZER_MAX_ZOOM,
    Math.round((safeCurrentZoom / selectionSpan) * 1_000_000) / 1_000_000,
  );
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const currentVisibleSpan = fullSpan / safeCurrentZoom;
  const currentVisibleMin =
    hardwareCenter + currentPanHz - currentVisibleSpan / 2;
  const selectionCenterX = (selectionStartX + selectionEndX) / 2;
  const targetCenter =
    currentVisibleMin + selectionCenterX * currentVisibleSpan;
  const visibleSpan = fullSpan / zoom;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const panHz = Math.max(
    minPanHz,
    Math.min(maxPanHz, targetCenter - hardwareCenter),
  );
  const visibleCenter = hardwareCenter + panHz;

  return {
    zoom,
    panHz,
    visibleRange: {
      min: visibleCenter - visibleSpan / 2,
      max: visibleCenter + visibleSpan / 2,
    },
  };
};

export const getWaterfallVfoDisplayFrequency = ({
  hardwareCenterHz,
  visibleRange,
}: {
  hardwareCenterHz: number;
  visibleRange: FrequencyRange;
}): number =>
  Number.isFinite(visibleRange.min) &&
  Number.isFinite(visibleRange.max) &&
  visibleRange.max > visibleRange.min
    ? (visibleRange.min + visibleRange.max) / 2
    : hardwareCenterHz;

export const getWaterfallScrollPan = ({
  hardwareRange,
  zoom,
  currentPanHz,
  deltaY,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  zoom: number;
  currentPanHz: number;
  deltaY: number;
  allowNegativeFrequencies?: boolean;
}): number => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const safeZoom = Math.max(1, zoom);
  const visibleSpan = fullSpan / safeZoom;
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const nextPan = currentPanHz - (deltaY * visibleSpan) / 40;
  return Math.max(minPanHz, Math.min(maxPanHz, nextPan));
};

export const getWaterfallVfoDragPan = ({
  hardwareRange,
  zoom,
  startPanHz,
  dragDistancePx,
  viewportWidthPx,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  zoom: number;
  startPanHz: number;
  dragDistancePx: number;
  viewportWidthPx: number;
  allowNegativeFrequencies?: boolean;
}): number => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const visibleSpan = fullSpan / Math.max(1, zoom);
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const nextPan =
    startPanHz + (dragDistancePx / Math.max(1, viewportWidthPx)) * visibleSpan;
  return Math.max(minPanHz, Math.min(maxPanHz, nextPan));
};

export const getWaterfallPinchZoomView = ({
  hardwareRange,
  startZoom,
  centerFrequencyHz,
  startDistancePx,
  currentDistancePx,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  startZoom: number;
  centerFrequencyHz: number;
  startDistancePx: number;
  currentDistancePx: number;
  allowNegativeFrequencies?: boolean;
}): { zoom: number; panHz: number } => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const safeStartZoom = Math.max(1, startZoom);
  const zoom = Math.max(
    1,
    Math.min(
      VISUALIZER_MAX_ZOOM,
      safeStartZoom *
        (Math.max(1, currentDistancePx) / Math.max(1, startDistancePx)),
    ),
  );
  const visibleSpan = fullSpan / zoom;
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const panHz = Math.max(
    minPanHz,
    Math.min(maxPanHz, centerFrequencyHz - hardwareCenter),
  );
  return { zoom, panHz };
};
