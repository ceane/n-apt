import {
  liveDataBySourceRef,
  liveDataRef,
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
    (sourceId ? sourceRefs.current[sourceId] : undefined) ?? fallbackRef,
});

export const liveFrameRuntime = createFrameRuntime(liveDataRef);
export const fileFrameRuntime = createFrameRuntime(filePlaybackDataRef);
export const liveSourceFrameRuntime = createSourceFrameRuntime(
  liveDataRef,
  liveDataBySourceRef,
);
