export interface StitchSessionData {
  hasStitchedData: boolean;
  frequencyRange: { min: number; max: number };
  channelCount: number;
  activeChannel: number;
  hardwareSampleRateHz?: number;
  workerFileDataCache: [string, Uint8Array | number[]][];
  workerFreqMap: [string, number][];
  workerMetadataMap: [string, any][];
  precomputedFrames: any[];
  maxFrames: number;
  allChannels: any[];
  stitchStatus: string;
}

const stitchSessionCache = new Map<string, StitchSessionData>();

export const createStitchSessionKey = ({
  selectedFiles,
  settings,
  fftSize,
  sampleRateOptions,
}: {
  selectedFiles: { id: string; name: string }[];
  settings: { gain: number; ppm: number };
  fftSize: number;
  sampleRateOptions?: { maxSampleRateHz: number; currentSampleRateHz: number };
}) => {
  const fileKey = selectedFiles
    .map((file) => `${file.id}:${file.name}`)
    .sort()
    .join("|");

  return JSON.stringify({
    files: fileKey,
    gain: settings.gain,
    ppm: settings.ppm,
    fftSize,
    sampleRateOptions: sampleRateOptions ?? null,
    cache_version: 2, // Force cache invalidation to apply worker updates
  });
};

export const getStitchSession = (key: string) => stitchSessionCache.get(key) ?? null;

export const setStitchSession = (key: string, data: StitchSessionData) => {
  stitchSessionCache.set(key, data);
};

export const clearStitchSession = (key: string) => {
  stitchSessionCache.delete(key);
};
