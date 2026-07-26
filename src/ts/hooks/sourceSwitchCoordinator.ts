export interface SourceSwitchCoordinator {
  request: (sourceId: string) => boolean;
  confirm: (sourceId: string) => boolean;
  dispose: () => void;
}

export interface SourceSwitchCoordinatorOptions {
  onRequest: (sourceId: string) => void;
  onTimeout: (sourceId: string) => void;
  timeoutMs?: number;
}

/** Imperative timer/deduplication boundary for backend source switches. */
export const createSourceSwitchCoordinator = ({
  onRequest,
  onTimeout,
  timeoutMs = 3_000,
}: SourceSwitchCoordinatorOptions): SourceSwitchCoordinator => {
  let pendingSourceId: string | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  return {
    request: (sourceId) => {
      if (pendingSourceId === sourceId) return false;

      clearTimer();
      pendingSourceId = sourceId;
      onRequest(sourceId);
      timeoutHandle = setTimeout(() => {
        if (pendingSourceId !== sourceId) return;
        pendingSourceId = null;
        timeoutHandle = null;
        onTimeout(sourceId);
      }, timeoutMs);
      return true;
    },
    confirm: (sourceId) => {
      if (pendingSourceId !== sourceId) return false;
      pendingSourceId = null;
      clearTimer();
      return true;
    },
    dispose: () => {
      pendingSourceId = null;
      clearTimer();
    },
  };
};
