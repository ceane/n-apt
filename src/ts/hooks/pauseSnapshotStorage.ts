export const SNAPSHOT_WAVEFORM_KEY = "n-apt-fft-waveform-snapshot";
export const SNAPSHOT_WATERFALL_KEY = "n-apt-fft-waterfall-snapshot";
export const SNAPSHOT_WATERFALL_DIMS_KEY = "n-apt-fft-waterfall-dims";
export const SNAPSHOT_IQ_KEY = "n-apt-fft-iq-snapshot";

export interface PauseSnapshot {
  iqData: Uint8Array | null;
  waterfall: Uint8ClampedArray | null;
  waterfallDimensions: { width: number; height: number } | null;
}

export const getPauseSnapshotStorageKeys = (scope = "default") => ({
  waveform: `${SNAPSHOT_WAVEFORM_KEY}:${scope}`,
  waterfall: `${SNAPSHOT_WATERFALL_KEY}:${scope}`,
  waterfallDims: `${SNAPSHOT_WATERFALL_DIMS_KEY}:${scope}`,
  iq: `${SNAPSHOT_IQ_KEY}:${scope}`,
});

const encodeBytes = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const decodeBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export function writePauseSnapshot(scope: string, snapshot: PauseSnapshot): void {
  const keys = getPauseSnapshotStorageKeys(scope);
  if (snapshot.iqData) {
    sessionStorage.setItem(keys.iq, encodeBytes(snapshot.iqData));
  }
  if (snapshot.waterfall && snapshot.waterfallDimensions) {
    sessionStorage.setItem(
      keys.waterfall,
      encodeBytes(
        new Uint8Array(
          snapshot.waterfall.buffer,
          snapshot.waterfall.byteOffset,
          snapshot.waterfall.byteLength,
        ),
      ),
    );
    sessionStorage.setItem(
      keys.waterfallDims,
      JSON.stringify(snapshot.waterfallDimensions),
    );
  }
}

export function readPauseSnapshot(scope: string): PauseSnapshot {
  const emptySnapshot: PauseSnapshot = {
    iqData: null,
    waterfall: null,
    waterfallDimensions: null,
  };
  try {
    const keys = getPauseSnapshotStorageKeys(scope);
    const iqBase64 = sessionStorage.getItem(keys.iq);
    const waterfallBase64 = sessionStorage.getItem(keys.waterfall);
    const waterfallDimsJson = sessionStorage.getItem(keys.waterfallDims);
    const dimensions = waterfallDimsJson
      ? (JSON.parse(waterfallDimsJson) as { width: number; height: number })
      : null;
    return {
      iqData: iqBase64 ? decodeBytes(iqBase64) : null,
      waterfall: waterfallBase64
        ? new Uint8ClampedArray(decodeBytes(waterfallBase64))
        : null,
      waterfallDimensions: dimensions,
    };
  } catch {
    return emptySnapshot;
  }
}
