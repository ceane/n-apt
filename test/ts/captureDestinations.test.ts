import {
  CAPTURE_DESTINATION_STORAGE_KEY,
  CAPTURE_DESTINATION_PROVIDERS,
  resolveCaptureDestination,
} from "@n-apt/capture/destinations";
import {
  loadLastCaptureDirectory,
  saveCaptureToDirectory,
  saveLastCaptureDirectory,
} from "@n-apt/capture/browserDestinations";
import { ReadableStream, WritableStream } from "node:stream/web";

const response = (status: number, bytes: Uint8Array) => ({
  ok: status >= 200 && status < 300,
  status,
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      if (status < 400) controller.enqueue(bytes);
      controller.close();
    },
  }),
});

describe("capture destinations", () => {
  it("persists the last selected local directory handle", async () => {
    const values = new Map<string, unknown>();
    const database = {
      transaction: () => ({
        objectStore: () => ({
          put: (value: unknown, key: string) => {
            const request: { onsuccess?: () => void; onerror?: () => void } = {};
            values.set(key, value);
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          get: (key: string) => {
            const request: {
              onsuccess?: () => void;
              onerror?: () => void;
              result?: unknown;
            } = { result: values.get(key) };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
        }),
      }),
    };
    const originalIndexedDB = window.indexedDB;
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {
        open: () => {
          const request: {
            onsuccess?: () => void;
            onerror?: () => void;
            onupgradeneeded?: () => void;
            result?: typeof database;
          } = { result: database };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
      },
    });
    const handle = { name: "Field Captures" };

    await saveLastCaptureDirectory(handle as FileSystemDirectoryHandle);
    await expect(loadLastCaptureDirectory()).resolves.toBe(handle);

    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: originalIndexedDB,
    });
  });

  it("defaults missing or invalid app preferences to Local Downloads", () => {
    expect(resolveCaptureDestination(null)).toBe("local");
    expect(resolveCaptureDestination("not-a-provider")).toBe("local");
  });

  it("restores the Aspect destination from its versioned preference key", () => {
    expect(CAPTURE_DESTINATION_STORAGE_KEY).toBe(
      "napt.capture-destination.v1",
    );
    expect(resolveCaptureDestination("aspect")).toBe("aspect");
  });

  it("exposes local, folder, and Aspect providers through the shared registry", () => {
    expect(CAPTURE_DESTINATION_PROVIDERS.map(({ id }) => id)).toEqual([
      "local",
      "folder",
      "aspect",
    ]);
    expect(
      CAPTURE_DESTINATION_PROVIDERS.find(({ id }) => id === "aspect"),
    ).toMatchObject({ kind: "mounted-folder", cli: true });
  });

  it("streams capture data into a user-selected folder", async () => {
    const written: Uint8Array[] = [];
    const picker = async () => ({
      getFileHandle: async () => ({
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            write: (chunk) => {
              written.push(chunk);
            },
          }),
      }),
    });
    await saveCaptureToDirectory(
      "/capture-download",
      "capture.napt",
      picker,
      async () => response(200, new Uint8Array([1, 2, 3])) as Response,
    );
    expect(written).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it("does not write files when the artifact download fails", async () => {
    const picker = async () => ({
      getFileHandle: async () => ({
        createWritable: async () => new WritableStream<Uint8Array>(),
      }),
    });
    await expect(
      saveCaptureToDirectory(
        "/capture-download",
        "capture.napt",
        picker,
        async () => response(404, new Uint8Array()) as Response,
      ),
    ).rejects.toThrow(/HTTP 404/);
  });
});
