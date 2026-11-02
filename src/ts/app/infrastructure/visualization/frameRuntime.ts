import { presentationController } from "@n-apt/app/infrastructure/streams/sourcePresentationController";
import type { IqRawFrameV2 } from "@n-apt/consts/schemas/websocket";
import { filePlaybackDataRef } from "@n-apt/app/infrastructure/io/filePlaybackData";
import type { StreamMode } from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";
import { demodFrameQueue } from "./demodFrameQueue";
export {
  notifyFrameArrival,
  subscribeFrameArrivals,
} from "./frameArrivalRuntime";

export interface FrameRuntime<T> {
  readonly ref: { current: T | null };
  read: () => T | null;
  clear: () => void;
}

type FrameRuntimeListener = () => void;
type FrameRuntimeSubscription = {
  listener: FrameRuntimeListener;
  intervalMs: number;
  lastNotifiedAt: number;
};

const frameRuntimeSubscribers = new Set<FrameRuntimeSubscription>();
let frameRuntimeClock: number | null = null;

/** Shared low-frequency clock for consumers that read imperative frame slots. */
export const subscribeFrameRuntime = (
  listener: FrameRuntimeListener,
  intervalMs = 50,
) => {
  const subscription: FrameRuntimeSubscription = {
    listener,
    intervalMs: Math.max(1, intervalMs),
    lastNotifiedAt: 0,
  };
  frameRuntimeSubscribers.add(subscription);

  if (frameRuntimeClock === null && typeof window !== "undefined") {
    frameRuntimeClock = window.setInterval(() => {
      const now = performance.now();
      for (const current of frameRuntimeSubscribers) {
        if (now - current.lastNotifiedAt < current.intervalMs) continue;
        current.lastNotifiedAt = now;
        current.listener();
      }
    }, 50);
  }

  return () => {
    frameRuntimeSubscribers.delete(subscription);
    if (frameRuntimeSubscribers.size === 0 && frameRuntimeClock !== null) {
      window.clearInterval(frameRuntimeClock);
      frameRuntimeClock = null;
    }
  };
};

/** Imperative frame slot; file playback remains independent of live streams. */
export const createFrameRuntime = <T>(ref: {
  current: T | null;
}): FrameRuntime<T> => ({
  ref,
  read: () => ref.current,
  clear: () => {
    ref.current = null;
  },
});

const MAX_SOURCE_FRAME_PROXIES = 64;
type LiveFrameRef = { readonly current: IqRawFrameV2 | null };
const sourceFrameProxyRefs = new Map<string, LiveFrameRef>();

const readSourceFrame = (
  sourceId: string,
  mode: StreamMode,
): IqRawFrameV2 | null => {
  const slot = presentationController.getSlot(sourceId, mode);
  if (!slot) return null;

  const active = presentationController.getActivePresentation();
  if (active.sourceId === sourceId && active.mode === mode) {
    return presentationController.getPresentationRef(mode).current;
  }

  const frozen = slot.frozenFrame;
  if (
    frozen &&
    frozen.sourceId === sourceId &&
    (frozen.streamEpoch === null ||
      slot.streamEpoch === null ||
      frozen.streamEpoch === slot.streamEpoch)
  ) {
    return frozen.frame;
  }
  return slot.liveFrameRef.current;
};

const EMPTY_SOURCE_FRAME_REF: { current: IqRawFrameV2 | null } = {
  current: null,
};

const createSourceFrameRef = (
  sourceId: string,
  mode: StreamMode,
): LiveFrameRef => ({
  get current() {
    return readSourceFrame(sourceId, mode);
  },
});

/** Read one source's RX or TX frame directly from its presentation slot. */
export const getLiveFrameRefForSource = (
  sourceId: string | null | undefined,
  mode: StreamMode,
): LiveFrameRef => {
  if (!sourceId) return EMPTY_SOURCE_FRAME_REF;
  const key = `${sourceId}\0${mode}`;
  const existing = sourceFrameProxyRefs.get(key);
  if (existing) return existing;

  const proxy = createSourceFrameRef(sourceId, mode);
  if (sourceFrameProxyRefs.size >= MAX_SOURCE_FRAME_PROXIES) {
    const oldestKey = sourceFrameProxyRefs.keys().next().value;
    if (oldestKey !== undefined) sourceFrameProxyRefs.delete(oldestKey);
  }
  sourceFrameProxyRefs.set(key, proxy);
  return proxy;
};

export const demodFrameRuntime = {
  drain: () => demodFrameQueue.drain(),
  clear: () => demodFrameQueue.clear(),
};

export const fileFrameRuntime = createFrameRuntime(filePlaybackDataRef);
