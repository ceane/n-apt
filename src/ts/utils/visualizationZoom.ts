const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export interface ZoomRetuneResult {
  frequencyRange: { min: number; max: number };
  pan: number;
  retuned: boolean;
}

export const clampVizZoom = (zoom: number, zoomFloor = 1) => {
  const safeFloor = Number.isFinite(zoomFloor) && zoomFloor > 0 ? zoomFloor : 1;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return clamp(safeZoom, safeFloor, 1000);
};

export const getStableVizPanForZoomChange = ({
  currentZoom: _currentZoom,
  currentPan,
  nextZoom,
  rangeMin,
  rangeMax,
}: {
  currentZoom: number;
  currentPan: number;
  nextZoom: number;
  rangeMin: number;
  rangeMax: number;
}) => {
  const fullSpan = rangeMax - rangeMin;
  if (!Number.isFinite(fullSpan) || fullSpan <= 0) {
    return currentPan;
  }

  const safeNextZoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : 1;

  if (safeNextZoom <= 1) {
    return 0;
  }

  const nextVisualSpan = fullSpan / safeNextZoom;
  const nextMaxPan = Math.max(0, fullSpan / 2 - nextVisualSpan / 2);
  return clamp(currentPan, -nextMaxPan, nextMaxPan);
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
