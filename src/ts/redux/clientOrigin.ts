/**
 * Identity for this loaded browser client on the shared control socket.
 *
 * It must be unique per client instance: a process-wide constant makes one
 * browser misclassify another browser's channels echo as its own.
 */
const createClientOriginId = (): string => {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return `n-apt-${randomUUID.call(globalThis.crypto)}`;
  }

  return `n-apt-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

export const CLIENT_ORIGIN_ID = createClientOriginId();
