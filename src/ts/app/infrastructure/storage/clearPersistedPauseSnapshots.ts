const PAUSE_SNAPSHOT_KEY_PREFIXES = [
  "n-apt-fft-waveform-snapshot:",
  "n-apt-fft-waterfall-snapshot:",
  "n-apt-fft-waterfall-dims:",
  "n-apt-fft-iq-snapshot:",
];
const MANUAL_VISUALIZER_PAUSE_KEY = "napt-visualizer-manual-paused";
const SUBSCRIBER_PAUSE_INTENT_KEY = "n-apt:subscriber-pause-intent";

/** Remove retained pause data and its session-scoped pause intent. */
export function clearPersistedPauseSnapshots(): void {
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (
        key &&
        (key === MANUAL_VISUALIZER_PAUSE_KEY ||
          key === SUBSCRIBER_PAUSE_INTENT_KEY ||
          PAUSE_SNAPSHOT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      ) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Storage may be unavailable in private browsing modes.
  }
}
