import type { StreamDeliveryPolicy } from "./streamContract";

export type StreamDeliveryDemandKey = {
  sourceId: string;
  mode: "rx" | "tx";
};

type DemandListener = (
  key: StreamDeliveryDemandKey,
  policy: StreamDeliveryPolicy,
) => void;

const keyFor = ({ sourceId, mode }: StreamDeliveryDemandKey): string =>
  `${sourceId}\u0000${mode}`;

const demands = new Map<string, Map<number, StreamDeliveryPolicy>>();
const listeners = new Set<DemandListener>();
let nextDemandId = 1;

const effectivePolicy = (
  policies: Map<number, StreamDeliveryPolicy> | undefined,
): StreamDeliveryPolicy =>
  [...(policies?.values() ?? [])].some((policy) => policy === "lossless")
    ? "lossless"
    : "latest";

const notify = (key: StreamDeliveryDemandKey): void => {
  const policy = effectivePolicy(demands.get(keyFor(key)));
  for (const listener of listeners) listener(key, policy);
};

export const acquireStreamDeliveryDemand = (
  key: StreamDeliveryDemandKey,
  policy: StreamDeliveryPolicy,
): (() => void) => {
  const encodedKey = keyFor(key);
  const current = demands.get(encodedKey) ?? new Map();
  const demandId = nextDemandId++;
  current.set(demandId, policy);
  demands.set(encodedKey, current);
  notify(key);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const policies = demands.get(encodedKey);
    policies?.delete(demandId);
    if (policies && policies.size === 0) demands.delete(encodedKey);
    notify(key);
  };
};

export const subscribeStreamDeliveryDemand = (
  listener: DemandListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getStreamDeliveryDemandPolicy = (
  key: StreamDeliveryDemandKey,
): StreamDeliveryPolicy => effectivePolicy(demands.get(keyFor(key)));

export const resetStreamDeliveryDemands = (): void => {
  demands.clear();
  nextDemandId = 1;
};
