import React from "react";

export type TimestampDisplayMode = "relative" | "raw";

const STORAGE_KEY = "napt.timestamp-display-mode.v1";
const listeners = new Set<() => void>();
let currentMode: TimestampDisplayMode | undefined;

const getSnapshot = (): TimestampDisplayMode => {
  if (currentMode) return currentMode;

  try {
    currentMode =
      window.sessionStorage.getItem(STORAGE_KEY) === "raw" ? "raw" : "relative";
  } catch {
    currentMode = "relative";
  }
  return currentMode;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setTimestampDisplayMode = (mode: TimestampDisplayMode) => {
  currentMode = mode;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Keep the setting for mounted views if session storage is unavailable.
  }
  listeners.forEach((listener) => listener());
};

const toggleTimestampDisplayMode = () => {
  setTimestampDisplayMode(getSnapshot() === "relative" ? "raw" : "relative");
};

export const useSessionTimestampDisplayMode = () => {
  const mode = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "relative",
  );

  return { mode, toggleTimestampDisplayMode };
};
