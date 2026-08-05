import {
  liveDataBySourceRef,
  liveDataRef,
  presentationController,
  sourceVisualizationRuntime,
} from "@n-apt/redux/middleware/websocketMiddleware";
import { filePlaybackDataRef } from "@n-apt/utils/filePlaybackData";
import type { StreamMode } from "@n-apt/streams/sourceModeStreamManager";
import { demodFrameQueue } from "./demodFrameQueue";

export interface FrameRuntime<T> {
  readonly ref: { current: T | null };
  read: () => T | null;
  clear: () => void;
}

export interface SourceFrameRuntime<T> {
  getRef: (sourceId?: string | null) => { current: T | null };
}

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
const sourceFrameProxyRefs: Record<string, LiveFrameRef> = {};

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
  const existingProxy = sourceFrameProxyRefs[proxyKey];
  if (existingProxy) return existingProxy;

  let fallbackRef: LiveFrameRef = { current: null };
  const proxy = {} as LiveFrameRef;
  const resolveSourceRef = (): LiveFrameRef => {
    const effectiveMode =
      mode ?? presentationController.getSnapshot().active.mode;
    // 1. Check presentationController active target first
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
          return ctrlRef;
        }
      }
    }

    // 2. Check only the requested source/mode slot. A source can retain both
    // RX and TX presentation state, but a consumer must never cross that mode
    // boundary while switching back to the source.
    const slot = presentationController.getSlot(sourceId, effectiveMode);
    if (slot) {
      if (slot.frozenFrame) {
        return { current: slot.frozenFrame.frame };
      }
      return slot.liveFrameRef;
    }

    // The legacy source-scoped fallback predates RX/TX slots. It is safe only
    // when no mode was requested; otherwise it can hand an RX canvas a TX
    // preview from the same physical source during a mode switch.
    if (mode) return fallbackRef;

    const mappedRef = liveDataBySourceRef.current[sourceId];
    if (mappedRef && mappedRef !== proxy && mappedRef.current) return mappedRef;

    const runtimeRef = sourceVisualizationRuntime?.getSourceRef?.(sourceId);
    if (runtimeRef && runtimeRef.current) {
      liveDataBySourceRef.current[sourceId] = runtimeRef;
      fallbackRef = runtimeRef;
      return runtimeRef;
    }
    return mappedRef ?? runtimeRef ?? fallbackRef;
  };

  Object.defineProperty(proxy, "current", {
    configurable: true,
    enumerable: true,
    get: () => resolveSourceRef().current,
    set: (value) => {
      resolveSourceRef().current = value;
    },
  });
  sourceFrameProxyRefs[proxyKey] = proxy;
  resolveSourceRef();
  return proxy;
};
