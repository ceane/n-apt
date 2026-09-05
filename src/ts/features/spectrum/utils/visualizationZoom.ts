import { VISUALIZER_MAX_ZOOM } from "@n-apt/consts/visualizerControls";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export interface ZoomRetuneResult {
  frequencyRange: { min: number; max: number };
  pan: number;
  retuned: boolean;
}

export const clampVizZoom = (
  zoom: number,
  zoomFloor = 1,
  maxZoom: number = VISUALIZER_MAX_ZOOM,
) => {
  const safeFloor = Number.isFinite(zoomFloor) && zoomFloor > 0 ? zoomFloor : 1;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return clamp(safeZoom, safeFloor, Math.max(safeFloor, maxZoom));
};

export const getZoomedViewForCenterFrequency = ({
  hardwareRange,
  currentZoom,
  currentPan,
  requestedCenterHz,
  maxZoom = VISUALIZER_MAX_ZOOM,
}: {
  hardwareRange: { min: number; max: number };
  currentZoom: number;
  currentPan: number;
  requestedCenterHz: number;
  maxZoom?: number;
}): { zoom: number; pan: number } => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  if (
    !Number.isFinite(fullSpan) ||
    fullSpan <= 0 ||
    !Number.isFinite(requestedCenterHz)
  ) {
    return { zoom: currentZoom, pan: currentPan };
  }

  const targetCenter = clamp(
    requestedCenterHz,
    hardwareRange.min,
    hardwareRange.max,
  );
  const distanceToEdge = Math.min(
    targetCenter - hardwareRange.min,
    hardwareRange.max - targetCenter,
  );
  const maxCenteredSpan = Math.max(0, distanceToEdge * 2);
  const requiredZoom =
    maxCenteredSpan > 0 ? fullSpan / maxCenteredSpan : maxZoom;
  const zoom = Math.min(
    maxZoom,
    Math.max(1, currentZoom, requiredZoom),
  );
  const visibleSpan = fullSpan / zoom;
  const maxPan = Math.max(0, fullSpan / 2 - visibleSpan / 2);
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  return {
    zoom,
    pan: clamp(targetCenter - hardwareCenter, -maxPan, maxPan),
  };
};

export const getStableVizPanForZoomChange = ({
  currentZoom: _currentZoom,
  currentPan,
  nextZoom,
  rangeMin,
  rangeMax,
  allowNegativeFrequencies = false,
}: {
  currentZoom: number;
  currentPan: number;
  nextZoom: number;
  rangeMin: number;
  rangeMax: number;
  allowNegativeFrequencies?: boolean;
}) => {
  const fullSpan = rangeMax - rangeMin;
  if (!Number.isFinite(fullSpan) || fullSpan <= 0) {
    return currentPan;
  }

  const safeNextZoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : 1;

  const nextVisualSpan = fullSpan / safeNextZoom;
  const center = (rangeMin + rangeMax) / 2;
  const lowerDisplayBound = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : rangeMin;
  const minPan = Number.isFinite(lowerDisplayBound)
    ? lowerDisplayBound + nextVisualSpan / 2 - center
    : Number.NEGATIVE_INFINITY;
  const maxPan = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : rangeMax - nextVisualSpan / 2 - center;
  return clamp(currentPan, minPan, maxPan);
};

export const getRetunedVizPanForZoomChange = ({
  currentPan,
  nextZoom,
  rangeMin,
  rangeMax,
  bounds,
}: {
  currentPan: number;
  nextZoom: number;
  rangeMin: number;
  rangeMax: number;
  bounds?: { min: number; max: number } | null;
}): ZoomRetuneResult => {
  const fullSpan = rangeMax - rangeMin;
  if (!Number.isFinite(fullSpan) || fullSpan <= 0) {
    return {
      frequencyRange: { min: rangeMin, max: rangeMax },
      pan: currentPan,
      retuned: false,
    };
  }

  const safeNextZoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : 1;
  if (safeNextZoom <= 1) {
    return {
      frequencyRange: { min: rangeMin, max: rangeMax },
      pan: 0,
      retuned: false,
    };
  }

  const visualSpan = fullSpan / safeNextZoom;
  const maxPan = Math.max(0, fullSpan / 2 - visualSpan / 2);
  if (Math.abs(currentPan) <= maxPan) {
    return {
      frequencyRange: { min: rangeMin, max: rangeMax },
      pan: currentPan,
      retuned: false,
    };
  }

  const oldCenter = (rangeMin + rangeMax) / 2;
  const visualCenter = oldCenter + currentPan;
  const targetPan = clamp(currentPan, -maxPan, maxPan);
  let nextCenter = visualCenter - targetPan;
  let nextMin = nextCenter - fullSpan / 2;
  let nextMax = nextCenter + fullSpan / 2;

  if (
    bounds &&
    Number.isFinite(bounds.min) &&
    Number.isFinite(bounds.max) &&
    bounds.max > bounds.min
  ) {
    if (fullSpan >= bounds.max - bounds.min) {
      nextMin = bounds.min;
      nextMax = bounds.max;
    } else {
      if (nextMin < bounds.min) {
        nextMin = bounds.min;
        nextMax = nextMin + fullSpan;
      }
      if (nextMax > bounds.max) {
        nextMax = bounds.max;
        nextMin = nextMax - fullSpan;
      }
    }
    nextCenter = (nextMin + nextMax) / 2;
  }

  return {
    frequencyRange: { min: nextMin, max: nextMax },
    pan: clamp(visualCenter - nextCenter, -maxPan, maxPan),
    retuned: nextMin !== rangeMin || nextMax !== rangeMax,
  };
};
