import {
  liveDataBySourceRef,
  liveDataRef,
  presentationController,
  sourceVisualizationRuntime,
} from "@n-apt/redux/middleware/websocketMiddleware";
import { filePlaybackDataRef } from "@n-apt/app/infrastructure/io/filePlaybackData";
import type { StreamMode } from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";
import { sameMultiplexStreamLifecycle } from "@n-apt/spectrum/model/multiplexStream";
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

export interface SourceFrameRuntime<T> {
  getRef: (sourceId?: string | null) => { current: T | null };
}

type FrameRuntimeListener = () => void;
type FrameRuntimeSubscription = {
  listener: FrameRuntimeListener;
  intervalMs: number;
  lastNotifiedAt: number;
};

const frameRuntimeSubscribers = new Set<FrameRuntimeSubscription>();
let frameRuntimeClock: number | null = null;

/**
 * Shared low-frequency clock for consumers that only need to observe the
 * latest imperative frame slot. Raw frames remain outside React state and a
 * single timer services all FFT/table/source-metadata observers.
 */
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

/** Imperative frame slot; raw frames never enter Redux or React state. */
export const createFrameRuntime = <T>(ref: {
  current: T | null;
}): FrameRuntime<T> => ({
  ref,
  read: () => ref.current,
  clear: () => {
    ref.current = null;
  },
});

export const createSourceFrameRuntime = <T>(
  fallbackRef: { current: T | null },
  sourceRefs: { current: Record<string, { current: T | null }> },
): SourceFrameRuntime<T> => ({
  getRef: (sourceId) =>
    (sourceId ? sourceRefs?.current?.[sourceId] : undefined) ?? fallbackRef,
});

export const liveFrameRuntime = createFrameRuntime(liveDataRef);
export const demodFrameRuntime = {
  drain: () => demodFrameQueue.drain(),
  clear: () => demodFrameQueue.clear(),
};
export const fileFrameRuntime = createFrameRuntime(filePlaybackDataRef);
export const liveSourceFrameRuntime = createSourceFrameRuntime(
  liveDataRef,
  liveDataBySourceRef,
);

type LiveFrameRef = { current: any };

/** Which tier of the resolution ladder served a read/write. */
export type FrameSlotResolutionKind =
  | "active-presentation" // controller active/pending target's presentation ref
  | "slot-frozen" // mode slot, frozen frame still lifecycle-current
  | "slot-live" // mode slot live frame ref
  | "source-map" // legacy per-source map (mode-less lookups only)
  | "runtime" // source visualization runtime ref (mode-less lookups only)
  | "fallback"; // private per-proxy fallback

/**
 * The single decision ladder behind every source-scoped frame ref lookup.
 *
 * Tier rules (characterized by test/ts/frameRuntime.test.ts):
 * 1. Active presentation target first — but only when no explicit mode is
 *    requested or the modes agree, and only when the presentation ref holds
 *    content or the slot exists.
 * 2. The requested source/mode slot exclusively. A source can retain both RX
 *    and TX state, but a consumer must never cross that mode boundary while
 *    switching back to a source. A lifecycle-current frozen frame outranks
 *    the live ref.
 * 3. Legacy source-scoped fallbacks — safe only without an explicit mode,
 *    otherwise an RX canvas could be handed a TX preview from the same
 *    physical device during a mode switch.
 */
export const resolveFrameSlot = (
  sourceId: string,
  mode: StreamMode | null | undefined,
  fallbackRef: LiveFrameRef,
  /** The calling proxy — excluded from legacy-map resolution as self-reference. */
  selfRef?: LiveFrameRef,
): { ref: LiveFrameRef; kind: FrameSlotResolutionKind } => {
  const effectiveMode =
    mode ?? presentationController.getSnapshot().active.mode;

  // 1. Check the presentationController active target first.
  const activeSnap = presentationController.getSnapshot();
  if (
    activeSnap.active.sourceId === sourceId ||
    activeSnap.active.pendingSourceId === sourceId
  ) {
    if (!mode || activeSnap.active.mode === effectiveMode) {
      const ctrlRef =
        presentationController.getPresentationRef(effectiveMode);
      if (
        ctrlRef.current ||
        presentationController.getSlot(sourceId, effectiveMode)
      ) {
        return { ref: ctrlRef, kind: "active-presentation" };
      }
    }
  }

  // 2. Check only the requested source/mode slot.
  const slot = presentationController.getSlot(sourceId, effectiveMode);
  if (slot) {
    const frozenIsCurrent =
      slot.frozenFrame !== null &&
      sameMultiplexStreamLifecycle(
        {
          sourceId: slot.frozenFrame.sourceId,
          streamEpoch: slot.frozenFrame.streamEpoch,
        },
        { sourceId, streamEpoch: slot.streamEpoch },
      );
    if (frozenIsCurrent) {
      return { ref: { current: slot.frozenFrame!.frame }, kind: "slot-frozen" };
    }
    return { ref: slot.liveFrameRef, kind: "slot-live" };
  }

  // 3. Legacy fallbacks.
  if (mode) return { ref: fallbackRef, kind: "fallback" };

  const mappedRef = liveDataBySourceRef.current[sourceId];
  if (mappedRef && mappedRef !== selfRef && mappedRef.current) {
    return { ref: mappedRef, kind: "source-map" };
  }

  const runtimeRef = sourceVisualizationRuntime?.getSourceRef?.(sourceId);
  if (runtimeRef && runtimeRef.current) {
    liveDataBySourceRef.current[sourceId] = runtimeRef;
    return { ref: runtimeRef, kind: "runtime" };
  }
  return {
    ref: mappedRef ?? runtimeRef ?? fallbackRef,
    kind: mappedRef ? "source-map" : runtimeRef ? "runtime" : "fallback",
  };
};

// Bounded proxy cache: proxies are closures over (sourceId, mode), so
// eviction is always safe — a still-held proxy keeps resolving through live
// state, and a fresh lookup simply builds a new one. The bound exists because
// mock/hotplug churn previously grew this map without limit.
const MAX_SOURCE_FRAME_PROXIES = 64;
const sourceFrameProxyRefs = new Map<string, LiveFrameRef>();

/** Return the presentation slot owned by a selected live source. */
export const getLiveFrameRefForSource = (
  sourceId?: string | null,
  mode?: StreamMode,
) => {
  if (!sourceId) {
    const ctrlRef = presentationController.getPresentationRef();
    if (ctrlRef.current) return ctrlRef;
    return liveDataRef;
  }

  const proxyKey = `${sourceId}\0${mode ?? "active"}`;
  const existingProxy = sourceFrameProxyRefs.get(proxyKey);
  if (existingProxy) return existingProxy;

  const fallbackRef: LiveFrameRef = { current: null };
  const proxy = {} as LiveFrameRef;
  Object.defineProperty(proxy, "current", {
    configurable: true,
    enumerable: true,
    get: () =>
      resolveFrameSlot(sourceId, mode, fallbackRef, proxy).ref.current,
    set: (value) => {
      resolveFrameSlot(sourceId, mode, fallbackRef, proxy).ref.current = value;
    },
  });

  if (sourceFrameProxyRefs.size >= MAX_SOURCE_FRAME_PROXIES) {
    const oldestKey = sourceFrameProxyRefs.keys().next().value;
    if (oldestKey !== undefined) sourceFrameProxyRefs.delete(oldestKey);
  }
  sourceFrameProxyRefs.set(proxyKey, proxy);
  return proxy;
};

/** Diagnostic seam: current source-frame proxy cache population. */
export const __getSourceFrameProxyCacheSize = (): number =>
  sourceFrameProxyRefs.size;
