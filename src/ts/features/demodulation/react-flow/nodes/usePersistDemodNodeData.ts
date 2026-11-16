import { useCallback, useEffect, useRef, useState } from "react";

export type DemodNodeDataPatch = Record<string, unknown>;

const readLocalOptions = (
  storageKey: string,
  nodeData: DemodNodeDataPatch,
): DemodNodeDataPatch => {
  if (typeof window === "undefined") return nodeData;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return nodeData;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return nodeData;
    }
    return { ...nodeData, ...(parsed as DemodNodeDataPatch) };
  } catch {
    return nodeData;
  }
};

/** Persist node options in local storage and mirror them into the flow graph. */
export const usePersistDemodNodeData = (
  nodeId: string | undefined,
  nodeKind: string,
  nodeData: DemodNodeDataPatch = {},
) => {
  const storageKey = nodeId
    ? `n-apt:demod-node-options:${nodeKind}:${nodeId}`
    : null;
  const [persistedNodeData] = useState(() =>
    storageKey ? readLocalOptions(storageKey, nodeData) : nodeData,
  );
  const persistedNodeDataRef = useRef(persistedNodeData);
  const pendingPatchRef = useRef<DemodNodeDataPatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistNodeData = useCallback(
    (patch: DemodNodeDataPatch) => {
      const nextData = { ...persistedNodeDataRef.current, ...patch };
      persistedNodeDataRef.current = nextData;
      if (storageKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(nextData));
        } catch {
          // Keep the in-memory options usable if storage is unavailable.
        }
      }
    },
    [storageKey],
  );

  const flushPendingPatch = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pendingPatch = pendingPatchRef.current;
    pendingPatchRef.current = null;
    if (pendingPatch) persistNodeData(pendingPatch);
  }, [persistNodeData]);

  const persistNodeDataDebounced = useCallback(
    (patch: DemodNodeDataPatch) => {
      pendingPatchRef.current = {
        ...pendingPatchRef.current,
        ...patch,
      };
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flushPendingPatch, 150);
    },
    [flushPendingPatch],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", flushPendingPatch);
    window.addEventListener("beforeunload", flushPendingPatch);
    return () => {
      window.removeEventListener("pagehide", flushPendingPatch);
      window.removeEventListener("beforeunload", flushPendingPatch);
      flushPendingPatch();
    };
  }, [flushPendingPatch]);

  return { persistedNodeData, persistNodeData, persistNodeDataDebounced };
};
