import { useMemo, useSyncExternalStore } from "react";
import { presentationController } from "@n-apt/app/infrastructure/streams/sourcePresentationController";
import { getLiveFrameRefForSource } from "./frameRuntime";
import type { StreamMode } from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";

const subscribeToActivePresentation = (listener: () => void) =>
  presentationController.subscribe(listener);

const getActivePresentationKey = (): string => {
  const { sourceId, mode } = presentationController.getActivePresentation();
  return JSON.stringify([sourceId, mode]);
};

/** Read the active canvas through its explicit source and RX/TX stream slot. */
export const useActivePresentationFrameRef = () => {
  const activeKey = useSyncExternalStore(
    subscribeToActivePresentation,
    getActivePresentationKey,
    getActivePresentationKey,
  );
  const [sourceId, mode] = JSON.parse(activeKey) as [string, StreamMode];

  return useMemo(
    () => getLiveFrameRefForSource(sourceId || null, mode),
    [mode, sourceId],
  );
};
