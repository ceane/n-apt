import type { DisplayTemporalResolution } from "@n-apt/redux/slices/spectrumSlice";

export const DEMOD_MIN_FFT_SIZE = 65_536;
export const DEMOD_REQUIRED_TEMPORAL_RESOLUTION: DisplayTemporalResolution =
  "high";

export interface DemodQualitySettings {
  fftSize: number;
  temporalResolution: DisplayTemporalResolution;
}

type DemodQualityNode = {
  id: string;
  data?: {
    radioOptions?: boolean;
    stimulusOptions?: boolean;
  } | null;
};

type DemodQualityEdge = {
  source: string;
  target: string;
};

const isConnectedQualityNode = (
  node: DemodQualityNode,
  edges: DemodQualityEdge[],
) => {
  return edges.some(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
};

export const hasConnectedDemodQualityNode = (
  nodes: DemodQualityNode[],
  edges: DemodQualityEdge[],
) => {
  return nodes.some(
    (node) =>
      (node.data?.radioOptions || node.data?.stimulusOptions) &&
      isConnectedQualityNode(node, edges),
  );
};

export const getDemodQualityLockedFftSizes = (
  fftSizeOptions: number[],
  minimumFftSize: number = DEMOD_MIN_FFT_SIZE,
  currentFftSize?: number,
) => {
  const filtered = fftSizeOptions
    .filter((size) => Number.isFinite(size) && size >= minimumFftSize)
    .sort((a, b) => a - b);

  if (
    typeof currentFftSize === "number" &&
    Number.isFinite(currentFftSize) &&
    currentFftSize >= minimumFftSize &&
    !filtered.includes(currentFftSize)
  ) {
    filtered.push(currentFftSize);
    filtered.sort((a, b) => a - b);
  }

  if (filtered.length > 0) {
    return filtered;
  }

  return [minimumFftSize];
};

export const beforeDemodEnforceQuality = (
  settings: DemodQualitySettings,
  isLocked: boolean,
  minimumFftSize: number = DEMOD_MIN_FFT_SIZE,
) => {
  if (!isLocked) {
    return settings;
  }

  return {
    fftSize: Math.max(settings.fftSize, minimumFftSize),
    temporalResolution: DEMOD_REQUIRED_TEMPORAL_RESOLUTION,
  };
};
