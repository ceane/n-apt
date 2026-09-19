import type { Range } from "@n-apt/layout/rendering/CoordinateMapper";

export function getTxBandGeometry(
  trackLeft: number,
  trackRight: number,
  visibleRange: Range,
  centerHz: number,
  bandwidthHz: number,
) {
  const trackWidth = Math.max(1, trackRight - trackLeft);
  const visibleSpan = visibleRange.max - visibleRange.min;
  const toX = (hz: number) =>
    trackLeft + ((hz - visibleRange.min) / visibleSpan) * trackWidth;
  const rawBandLeft = toX(centerHz - bandwidthHz / 2);
  const rawBandRight = toX(centerHz + bandwidthHz / 2);
  return {
    rawBandLeft,
    rawBandRight,
    bandLeft: Math.max(trackLeft, Math.min(trackRight, rawBandLeft)),
    bandRight: Math.max(trackLeft, Math.min(trackRight, rawBandRight)),
    centerX: Math.max(trackLeft, Math.min(trackRight, toX(centerHz))),
  };
}
