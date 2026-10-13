export type CaptureDirectoryPicker = (
  options?: { mode: "readwrite" },
) => Promise<CaptureDirectoryHandle>;

export type CaptureDirectoryHandle = {
  name?: string;
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  getFileHandle: (
    filename: string,
    options: { create: boolean },
  ) => Promise<{
    createWritable: () => Promise<WritableStream<Uint8Array>>;
  }>;
};

const DIRECTORY_DATABASE = "napt.capture-destinations.v1";
const DIRECTORY_STORE = "directories";
const LAST_DIRECTORY_KEY = "last-local-folder";

const openDirectoryDatabase = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DIRECTORY_DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DIRECTORY_STORE)) {
          request.result.createObjectStore(DIRECTORY_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

export async function saveLastCaptureDirectory(
  directory: CaptureDirectoryHandle,
): Promise<void> {
  const database = await openDirectoryDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const request = database
        .transaction(DIRECTORY_STORE, "readwrite")
        .objectStore(DIRECTORY_STORE)
        .put(directory, LAST_DIRECTORY_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadLastCaptureDirectory(): Promise<CaptureDirectoryHandle | null> {
  const database = await openDirectoryDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const request = database
        .transaction(DIRECTORY_STORE, "readonly")
        .objectStore(DIRECTORY_STORE)
        .get(LAST_DIRECTORY_KEY);
      request.onsuccess = () => resolve((request.result as CaptureDirectoryHandle) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveCaptureToDirectory(
  downloadUrl: string,
  filename: string,
  pickDirectory: CaptureDirectoryPicker,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const directory = await pickDirectory();
  let permission = await directory.queryPermission?.({ mode: "readwrite" });
  if (permission === "prompt") {
    permission = await directory.requestPermission?.({ mode: "readwrite" });
  }
  if (permission === "denied") {
    throw new Error("Permission to write to the selected folder was denied.");
  }
  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  try {
    const response = await fetcher(downloadUrl);
    if (!response.ok) {
      throw new Error(`Capture download failed: HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("Capture download did not provide a readable stream");
    }
    await response.body.pipeTo(writable);
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
}

export function getCaptureDirectoryPicker(): CaptureDirectoryPicker | null {
  if (typeof window === "undefined") return null;
  const picker = (
    window as Window & {
      showDirectoryPicker?: CaptureDirectoryPicker;
    }
  ).showDirectoryPicker;
  return picker
    ? () => picker.call(window, { mode: "readwrite" })
    : null;
}
