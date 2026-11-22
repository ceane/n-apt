export type IqPlanePoint = { i: number; q: number };
export type IqPlaneMetadata = {
  sampleRateHz: number | null;
  centerFrequencyHz: number | null;
};

export type IqPlaneZoomAction = "in" | "out" | "reset";

const MIN_IQ_PLANE_ZOOM = 0.5;
const MAX_IQ_PLANE_ZOOM = 8;
const IQ_PLANE_ZOOM_FACTOR = 1.2;

export const adjustIqPlaneZoom = (
  currentZoom: number,
  action: IqPlaneZoomAction,
): number => {
  if (action === "reset") return 1;
  const nextZoom =
    currentZoom *
    (action === "in" ? IQ_PLANE_ZOOM_FACTOR : 1 / IQ_PLANE_ZOOM_FACTOR);
  return Math.min(MAX_IQ_PLANE_ZOOM, Math.max(MIN_IQ_PLANE_ZOOM, nextZoom));
};

type IqFrameMetadata = {
  sample_rate?: number | null;
  center_frequency_hz?: number | null;
};

const IQ_BYTE_CENTER = 127.5;

/** Projects interleaved unsigned I/Q bytes into an auto-scaled unit plane. */
export const projectIqSamples = (
  iq: Uint8Array,
  maxPoints = 1200,
  radius = 0.82,
): IqPlanePoint[] => {
  const sampleCount = Math.floor(iq.length / 2);
  if (sampleCount === 0 || maxPoints < 1) return [];

  let maxMagnitude = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const i =
      ((iq[index * 2] ?? IQ_BYTE_CENTER) - IQ_BYTE_CENTER) / IQ_BYTE_CENTER;
    const q =
      ((iq[index * 2 + 1] ?? IQ_BYTE_CENTER) - IQ_BYTE_CENTER) / IQ_BYTE_CENTER;
    maxMagnitude = Math.max(maxMagnitude, Math.hypot(i, q));
  }

  const scale = maxMagnitude || 1;
  const stride = Math.max(1, Math.ceil(sampleCount / maxPoints));
  const points: IqPlanePoint[] = [];
  for (let index = 0; index < sampleCount; index += stride) {
    const i =
      ((iq[index * 2] ?? IQ_BYTE_CENTER) - IQ_BYTE_CENTER) / IQ_BYTE_CENTER;
    const q =
      ((iq[index * 2 + 1] ?? IQ_BYTE_CENTER) - IQ_BYTE_CENTER) / IQ_BYTE_CENTER;
    points.push({ i: (i / scale) * radius, q: (q / scale) * radius });
  }
  return points;
};

/** Sizes the backing bitmap for HiDPI while keeping drawing units in CSS px. */
export const configureCanvasForDpr = (
  canvas: { width: number; height: number },
  context: Pick<CanvasRenderingContext2D, "setTransform">,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): void => {
  const ratio = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  canvas.width = Math.max(1, Math.round(cssWidth * ratio));
  canvas.height = Math.max(1, Math.round(cssHeight * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const positiveFinite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

export const resolveIqPlaneMetadata = (
  frame: IqFrameMetadata | null,
  fallback: IqPlaneMetadata,
): IqPlaneMetadata => ({
  sampleRateHz:
    positiveFinite(frame?.sample_rate) ?? positiveFinite(fallback.sampleRateHz),
  centerFrequencyHz:
    positiveFinite(frame?.center_frequency_hz) ??
    positiveFinite(fallback.centerFrequencyHz),
});

export const formatSampleRate = (sampleRateHz: number | null): string => {
  const rate = positiveFinite(sampleRateHz);
  if (rate === null) return "—";
  if (rate >= 1_000_000) {
    return `${Number((rate / 1_000_000).toPrecision(3))} MS/s`;
  }
  if (rate >= 1_000) {
    return `${Number((rate / 1_000).toPrecision(3))} kS/s`;
  }
  return `${Math.round(rate).toLocaleString("en-US")} S/s`;
};
