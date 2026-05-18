const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const ZOOM_OUT_PAN_RESISTANCE = 0.35;

export const clampVizZoom = (zoom: number, zoomFloor = 1) => {
  const safeFloor = Number.isFinite(zoomFloor) && zoomFloor > 0 ? zoomFloor : 1;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return clamp(safeZoom, safeFloor, 1000);
};

export const getStableVizPanForZoomChange = ({
  currentZoom,
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

