export type DeviceOptionPublishMode = "gesture" | "immediate";

export type DeviceOptionScheduler<T> = {
  submit(value: T, mode?: DeviceOptionPublishMode): void;
  flush(): void;
  cancel(): void;
  dispose(): void;
};

type DeviceOptionSchedulerOptions<T> = {
  publish: (value: T) => void;
  equals?: (left: T, right: T) => boolean;
  intervalMs?: number;
  idleFlushMs?: number;
  /** When false, the first gesture sample waits for the cadence timer. */
  leadingPublish?: boolean;
};

const defaultEquals = <T>(left: T, right: T): boolean => Object.is(left, right);

/**
 * Coalesces device-scoped writes while preserving responsive local rendering.
 * The first gesture value is sent immediately, subsequent values replace the
 * pending value, and the final value is flushed after gesture inactivity.
 */
export const createDeviceOptionScheduler = <T>({
  publish,
  equals = defaultEquals,
  intervalMs = 50,
  idleFlushMs = 80,
  leadingPublish = true,
}: DeviceOptionSchedulerOptions<T>): DeviceOptionScheduler<T> => {
  let lastPublished: T | undefined;
  let hasPublished = false;
  let lastPublishedAt = 0;
  let pending: T | undefined;
  let hasPending = false;
  let cadenceTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearCadenceTimer = () => {
    if (cadenceTimer !== null) {
      clearTimeout(cadenceTimer);
      cadenceTimer = null;
    }
  };

  const clearIdleTimer = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const publishIfChanged = (value: T) => {
    if (hasPublished && equals(lastPublished as T, value)) return false;
    publish(value);
    lastPublished = value;
    hasPublished = true;
    lastPublishedAt = Date.now();
    return true;
  };

  const flush = () => {
    if (disposed || !hasPending) return;
    const value = pending as T;
    pending = undefined;
    hasPending = false;
    clearCadenceTimer();
    publishIfChanged(value);
  };

  const scheduleCadenceFlush = (delayMs: number) => {
    clearCadenceTimer();
    cadenceTimer = setTimeout(() => {
      cadenceTimer = null;
      flush();
    }, Math.max(0, delayMs));
  };

  const scheduleIdleFlush = () => {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      flush();
    }, Math.max(0, idleFlushMs));
  };

  const cancel = () => {
    pending = undefined;
    hasPending = false;
    clearCadenceTimer();
    clearIdleTimer();
  };

  return {
    submit(value: T, mode: DeviceOptionPublishMode = "gesture") {
      if (disposed) return;

      if (mode === "immediate") {
        cancel();
        publishIfChanged(value);
        return;
      }

      pending = value;
      hasPending = true;
      scheduleIdleFlush();

      const elapsed = hasPublished ? Date.now() - lastPublishedAt : intervalMs;
      if (
        leadingPublish &&
        (!hasPublished || elapsed >= intervalMs)
      ) {
        const leadingValue = pending as T;
        pending = undefined;
        hasPending = false;
        clearCadenceTimer();
        publishIfChanged(leadingValue);
        return;
      }

      scheduleCadenceFlush(
        hasPublished ? intervalMs - elapsed : intervalMs,
      );
    },
    flush,
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
    },
  };
};
