export interface WaterfallMetadata {
  width: number;
  height: number;
  writeRow: number;
}

export interface FFTVisualizerSnapshot {
  waveform: Float32Array | null;
  waterfallTextureSnapshot: Uint8Array | null;
  waterfallTextureMeta: WaterfallMetadata | null;
  waterfallBuffer: Uint8ClampedArray | null;
  waterfallDims: { width: number; height: number } | null;
}

export interface FFTVisualizerMachineState {
  status: "empty" | "ready";
  snapshot: FFTVisualizerSnapshot | null;
}

export interface FFTVisualizerMachine {
  getState: (sessionKey: string) => FFTVisualizerMachineState;
  persist: (sessionKey: string, snapshot: FFTVisualizerSnapshot | null) => void;
  restore: (sessionKey: string) => FFTVisualizerSnapshot | null;
  clear: (sessionKey: string) => void;
}

const cloneSnapshot = (
  snapshot: FFTVisualizerSnapshot | null,
): FFTVisualizerSnapshot | null => {
  if (!snapshot) {
    return null;
  }

  return {
    waveform: snapshot.waveform ? new Float32Array(snapshot.waveform) : null,
    waterfallTextureSnapshot: snapshot.waterfallTextureSnapshot
      ? new Uint8Array(snapshot.waterfallTextureSnapshot)
      : null,
    waterfallTextureMeta: snapshot.waterfallTextureMeta
      ? { ...snapshot.waterfallTextureMeta }
      : null,
    waterfallBuffer: snapshot.waterfallBuffer
      ? new Uint8ClampedArray(snapshot.waterfallBuffer)
      : null,
    waterfallDims: snapshot.waterfallDims ? { ...snapshot.waterfallDims } : null,
  };
};

export const createFFTVisualizerMachine = (
  initialSnapshot: FFTVisualizerSnapshot | null = null,
): FFTVisualizerMachine => {
  const sessions = new Map<string, FFTVisualizerSnapshot | null>();

  if (initialSnapshot) {
    sessions.set("default", cloneSnapshot(initialSnapshot));
  }

  return {
    getState: (sessionKey) => {
      const snapshot = sessions.get(sessionKey) ?? null;
      return {
        status: snapshot ? "ready" : "empty",
        snapshot: cloneSnapshot(snapshot),
      };
    },
    persist: (sessionKey, snapshot) => {
      if (!snapshot) {
        sessions.delete(sessionKey);
        return;
      }

      sessions.set(sessionKey, cloneSnapshot(snapshot));
    },
    restore: (sessionKey) => cloneSnapshot(sessions.get(sessionKey) ?? null),
    clear: (sessionKey) => {
      sessions.delete(sessionKey);
    },
  };
};
