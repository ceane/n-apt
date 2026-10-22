const PAUSE_SNAPSHOT_KEY_PREFIXES = [
  "n-apt-fft-waveform-snapshot:",
  "n-apt-fft-waterfall-snapshot:",
  "n-apt-fft-waterfall-dims:",
  "n-apt-fft-iq-snapshot:",
];

/** Remove pause snapshots written by older app versions without touching other session state. */
export function clearPersistedPauseSnapshots(): void {
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (
        key &&
        PAUSE_SNAPSHOT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Storage may be unavailable in private browsing modes.
  }
}
