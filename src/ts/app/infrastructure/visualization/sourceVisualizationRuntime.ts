export type VisualizationSourceRole = "rx" | "tx";

export interface VisualizationFrameIdentity {
  source_id?: string;
  stream_epoch?: number;
  sequence?: number;
}

export interface VisualizationSourceBinding {
  sourceId: string;
  role: VisualizationSourceRole;
  streamKey: string;
  streamEpoch: number;
}

export interface VisualizationConfig {
  centerFrequencyHz: number;
  sampleRateHz: number;
  fftSize: number;
  fftWindow: string;
  temporalMode: string;
  targetFps: number;
}

export interface VisualizationSpectrumFrame extends VisualizationFrameIdentity {
  spectrum: Float32Array;
  centerFrequencyHz: number;
  sampleRateHz: number;
  fftSize: number;
}

export interface VisualizationRuntimeMetrics {
  accepted: number;
  dropped: number;
  stale: number;
  queueDepth: 0 | 1;
}

type SourceState<T> = {
  ref: { current: T | null };
  epoch: number | null;
  sequence: number | null;
  metrics: VisualizationRuntimeMetrics;
  listeners: Set<() => void>;
};

const EMPTY_METRICS: VisualizationRuntimeMetrics = {
  accepted: 0,
  dropped: 0,
  stale: 0,
  queueDepth: 0,
};

/**
 * High-frequency source data lives here instead of Redux. Each source owns a
 * single replaceable presentation slot, so a slow renderer can never build a
 * latency-producing frame backlog.
 */
export class SourceVisualizationRuntime<
  T extends VisualizationFrameIdentity,
> {
  private readonly sources = new Map<string, SourceState<T>>();

  private ensure(sourceId: string): SourceState<T> {
    let state = this.sources.get(sourceId);
    if (!state) {
      state = {
        ref: { current: null },
        epoch: null,
        sequence: null,
        metrics: { ...EMPTY_METRICS },
        listeners: new Set(),
      };
      this.sources.set(sourceId, state);
    }
    return state;
  }

  publish(frame: T): boolean {
    const sourceId = frame.source_id?.trim();
    if (!sourceId) return false;
    const state = this.ensure(sourceId);
    const epoch = Number.isFinite(frame.stream_epoch)
      ? Number(frame.stream_epoch)
      : null;
    const sequence = Number.isFinite(frame.sequence)
      ? Number(frame.sequence)
      : null;

    const staleEpoch =
      epoch !== null && state.epoch !== null && epoch < state.epoch;
    const staleSequence =
      epoch !== null &&
      state.epoch === epoch &&
      sequence !== null &&
      state.sequence !== null &&
      sequence <= state.sequence;
    if (staleEpoch || staleSequence) {
      state.metrics.stale += 1;
      return false;
    }

    if (state.ref.current !== null) state.metrics.dropped += 1;
    state.ref.current = frame;
    state.epoch = epoch ?? state.epoch;
    state.sequence = sequence ?? state.sequence;
    state.metrics.accepted += 1;
    state.metrics.queueDepth = 1;
    for (const listener of state.listeners) listener();
    return true;
  }

  getSourceRef(sourceId: string): { current: T | null } {
    return this.ensure(sourceId).ref;
  }

  getMetrics(sourceId: string): VisualizationRuntimeMetrics {
    return { ...this.ensure(sourceId).metrics };
  }

  /** Reset one source in place so mounted consumers keep their ref identity. */
  reset(sourceId: string): void {
    const state = this.sources.get(sourceId);
    if (!state) return;
    state.ref.current = null;
    state.epoch = null;
    state.sequence = null;
    state.metrics = { ...EMPTY_METRICS };
  }

  subscribe(sourceId: string, listener: () => void): () => void {
    const listeners = this.ensure(sourceId).listeners;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  clear(sourceId?: string): void {
    if (sourceId) {
      const state = this.sources.get(sourceId);
      if (!state) return;
      state.ref.current = null;
      state.epoch = null;
      state.sequence = null;
      state.metrics = { ...EMPTY_METRICS };
      this.sources.delete(sourceId);
      return;
    }
    // Invalidate existing refs before deleting their map entries. Consumers
    // can hold these objects across a source switch, so deleting the map alone
    // would leave a detached object containing the previous frame.
    for (const state of this.sources.values()) {
      state.ref.current = null;
    }
    this.sources.clear();
  }
}

export interface LiveVisualizationFeatures {
  webGpu: boolean;
  offscreenCanvas: boolean;
  worker: boolean;
}

export const getLiveVisualizationCapability = (
  features: LiveVisualizationFeatures,
): { supported: boolean; reason: string | null } => {
  if (!features.webGpu) {
    return { supported: false, reason: "Live visualization requires WebGPU" };
  }
  if (!features.offscreenCanvas) {
    return {
      supported: false,
      reason: "Live visualization requires OffscreenCanvas",
    };
  }
  if (!features.worker) {
    return { supported: false, reason: "Live visualization requires Workers" };
  }
  return { supported: true, reason: null };
};

export const detectLiveVisualizationCapability = () =>
  getLiveVisualizationCapability({
    webGpu:
      typeof navigator !== "undefined" && "gpu" in navigator,
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    worker: typeof Worker !== "undefined",
  });

/** Shared FFT output fan-out. FFT and waterfall targets for a source consume
 * the same immutable spectrum instead of running independent transforms. */
export const sourceSpectrumRuntime =
  new SourceVisualizationRuntime<VisualizationSpectrumFrame>();
