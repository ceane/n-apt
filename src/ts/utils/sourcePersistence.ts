import type { SourceInfo } from "@n-apt/consts/schemas/websocket";

export const SOURCE_VIEW_STORAGE_PREFIX = "napt-spectrum-view-v1";
export const SOURCE_SELECTION_STORAGE_KEY = "napt-spectrum-selected-source-v1";

const DEFAULT_SOURCE_SCOPE = "default";

const normalizeSourceScope = (sourceId?: string | null): string => {
  const trimmed = sourceId?.trim();
  return trimmed ? trimmed : DEFAULT_SOURCE_SCOPE;
};

export const getSourceViewStorageKey = (sourceId?: string | null): string => {
  return `${SOURCE_VIEW_STORAGE_PREFIX}:${normalizeSourceScope(sourceId)}`;
};

export const getSourceStorageIdentity = (
  source?: Pick<SourceInfo, "id" | "serial_number" | "stream_key"> | null,
): string | null => {
  const streamKey = source?.stream_key?.trim();
  if (streamKey) {
    return streamKey;
  }

  const serial = source?.serial_number?.trim();
  if (serial) {
    return serial;
  }

  const id = source?.id?.trim();
  return id || null;
};

export const getSourceViewStorageKeyForSource = (
  source?: Pick<SourceInfo, "id" | "serial_number" | "stream_key"> | null,
): string => {
  return getSourceViewStorageKey(getSourceStorageIdentity(source));
};

export const getSourceSelectionStorageKey = (): string => {
  return SOURCE_SELECTION_STORAGE_KEY;
};

const safeReadStorage = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeWriteStorage = (key: string, value: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode / quota exhaustion.
  }
};

export const loadStoredJson = <T>(key: string): T | null => {
  const raw = safeReadStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const saveStoredJson = (key: string, value: unknown): void => {
  safeWriteStorage(key, JSON.stringify(value));
};

export const loadSelectedSourceId = (): string | null => {
  const stored = safeReadStorage(SOURCE_SELECTION_STORAGE_KEY);
  return stored && stored.trim() ? stored : null;
};

export const saveSelectedSourceId = (sourceId: string | null): void => {
  if (!sourceId) return;
  safeWriteStorage(SOURCE_SELECTION_STORAGE_KEY, sourceId);
};
