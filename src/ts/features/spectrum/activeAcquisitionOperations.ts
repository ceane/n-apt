type ActiveAcquisitionOperation = {
  kind: string;
  sourceId?: string | null;
};

const activeOperations = new Map<symbol, ActiveAcquisitionOperation>();
const listeners = new Set<() => void>();
let revision = 0;

const notifyListeners = () => {
  revision += 1;
  for (const listener of listeners) listener();
};

/** Mark receiver work that must not be interrupted by automatic pauses. */
export const registerActiveAcquisitionOperation = (
  kind: string,
  sourceId?: string | null,
): (() => void) => {
  const token = Symbol(kind);
  activeOperations.set(token, { kind, sourceId });
  notifyListeners();

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    activeOperations.delete(token);
    notifyListeners();
  };
};

export const hasActiveAcquisitionOperations = (
  sourceId?: string | null,
): boolean => {
  if (activeOperations.size === 0) return false;
  if (!sourceId) return true;
  for (const operation of activeOperations.values()) {
    if (!operation.sourceId || operation.sourceId === sourceId) return true;
  }
  return false;
};

export const getActiveAcquisitionOperationsRevision = (): number => revision;

export const subscribeToActiveAcquisitionOperations = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
