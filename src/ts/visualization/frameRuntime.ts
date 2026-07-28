import {
  liveDataBySourceRef,
  liveDataRef,
  sourceVisualizationRuntime,
} from "@n-apt/redux/middleware/websocketMiddleware";
import { filePlaybackDataRef } from "@n-apt/utils/filePlaybackData";

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
export const fileFrameRuntime = createFrameRuntime(filePlaybackDataRef);
export const liveSourceFrameRuntime = createSourceFrameRuntime(
  liveDataRef,
  liveDataBySourceRef,
);

type LiveFrameRef = { current: any };
const sourceFrameProxyRefs: Record<string, LiveFrameRef> = {};

/** Return the presentation slot owned by a selected live source. */
export const getLiveFrameRefForSource = (sourceId?: string | null) => {
  if (!sourceId) return liveDataRef;

  const existingProxy = sourceFrameProxyRefs[sourceId];
  if (existingProxy) return existingProxy;

  let fallbackRef: LiveFrameRef = { current: null };
  const proxy = {} as LiveFrameRef;
  const resolveSourceRef = (): LiveFrameRef => {
    const mappedRef = liveDataBySourceRef.current[sourceId];
    if (mappedRef && mappedRef !== proxy) return mappedRef;

    const runtimeRef = sourceVisualizationRuntime?.getSourceRef?.(sourceId);
    if (runtimeRef) {
      liveDataBySourceRef.current[sourceId] = runtimeRef;
      fallbackRef = runtimeRef;
      return runtimeRef;
    }
    return fallbackRef;
  };

  Object.defineProperty(proxy, "current", {
    configurable: true,
    enumerable: true,
    get: () => resolveSourceRef().current,
    set: (value) => {
      resolveSourceRef().current = value;
    },
  });
  sourceFrameProxyRefs[sourceId] = proxy;
  resolveSourceRef();
  return proxy;
};
