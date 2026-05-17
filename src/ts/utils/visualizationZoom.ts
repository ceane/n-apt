const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const ZOOM_OUT_PAN_RESISTANCE = 0.35;

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

  const safeCurrentZoom =
    Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 1;
  const safeNextZoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : 1;

  const currentVisualSpan = fullSpan / safeCurrentZoom;
  const nextVisualSpan = fullSpan / safeNextZoom;

  const currentMaxPan = Math.max(0, fullSpan / 2 - currentVisualSpan / 2);
  const nextMaxPan = Math.max(0, fullSpan / 2 - nextVisualSpan / 2);

  if (safeNextZoom <= 1) {
    return 0;
  }

  if (currentMaxPan <= Number.EPSILON) {
    return clamp(currentPan, -nextMaxPan, nextMaxPan);
  }

  const panRatio = currentPan / currentMaxPan;
  const targetPan = clamp(panRatio * nextMaxPan, -nextMaxPan, nextMaxPan);

  if (safeNextZoom < safeCurrentZoom) {
    return clamp(
      currentPan + (targetPan - currentPan) * ZOOM_OUT_PAN_RESISTANCE,
      -nextMaxPan,
      nextMaxPan,
    );
  }

  return targetPan;
};
