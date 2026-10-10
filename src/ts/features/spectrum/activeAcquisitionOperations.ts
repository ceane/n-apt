type ActiveAcquisitionOperation = {
  kind: string;
  sourceId?: string | null;
};

type ActiveAcquisitionRegistry = {
  activeOperations: Map<symbol, ActiveAcquisitionOperation>;
  listeners: Set<() => void>;
  revision: number;
};

const registryKey = Symbol.for("n-apt.activeAcquisitionOperations");
type RegistryGlobal = typeof globalThis & {
  [registryKey]?: ActiveAcquisitionRegistry;
};
const registryGlobal = globalThis as RegistryGlobal;
const registry = (registryGlobal[registryKey] ??= {
  activeOperations: new Map(),
  listeners: new Set(),
  revision: 0,
});

const notifyListeners = () => {
  registry.revision += 1;
  for (const listener of registry.listeners) listener();
};

/** Mark receiver work that must not be interrupted by automatic pauses. */
export const registerActiveAcquisitionOperation = (
  kind: string,
  sourceId?: string | null,
): (() => void) => {
  const token = Symbol(kind);
  registry.activeOperations.set(token, { kind, sourceId });
  notifyListeners();

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    registry.activeOperations.delete(token);
    notifyListeners();
  };
};

export const hasActiveAcquisitionOperations = (
  sourceId?: string | null,
): boolean => {
  if (registry.activeOperations.size === 0) return false;
  if (!sourceId) return true;
  for (const operation of registry.activeOperations.values()) {
    if (!operation.sourceId || operation.sourceId === sourceId) return true;
  }
  return false;
};

export const getActiveAcquisitionOperationsRevision = (): number =>
  registry.revision;

export const subscribeToActiveAcquisitionOperations = (
  listener: () => void,
): (() => void) => {
  registry.listeners.add(listener);
  return () => registry.listeners.delete(listener);
};
