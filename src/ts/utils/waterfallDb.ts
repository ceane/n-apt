/**
 * waterfallDb.ts
 * Utility to store large waterfall texture snapshots in IndexedDB.
 * Bypasses the 5MB limit of sessionStorage.
 */

const DB_NAME = "napt-waterfall-db";
const STORE_NAME = "waterfall-store";
const DB_VERSION = 1;

export interface WaterfallMetadata {
  width: number;
  height: number;
  writeRow: number;
}

export interface WaterfallSnapshot {
  data: Uint8Array;
  meta: WaterfallMetadata;
}

let dbInstance: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Saves the waterfall snapshot to IndexedDB.
 */
export async function saveWaterfallSnapshot(snapshot: Uint8Array, meta: WaterfallMetadata): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      store.put(snapshot, "texture-snapshot");
      store.put(meta, "texture-meta");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.error("Failed to save waterfall snapshot to IndexedDB:", err);
  }
}

/**
 * Loads the waterfall snapshot from IndexedDB.
 */
export async function loadWaterfallSnapshot(): Promise<WaterfallSnapshot | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);

      const dataRequest = store.get("texture-snapshot");
      const metaRequest = store.get("texture-meta");

      let snapshot: Uint8Array | null = null;
      let meta: WaterfallMetadata | null = null;

      dataRequest.onsuccess = () => {
        snapshot = dataRequest.result;
      };

      metaRequest.onsuccess = () => {
        meta = metaRequest.result;
      };

      transaction.oncomplete = () => {
        if (snapshot && meta) {
          resolve({ data: snapshot, meta });
        } else {
          resolve(null);
        }
      };

      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.error("Failed to load waterfall snapshot from IndexedDB:", err);
    return null;
  }
}

/**
 * Clears the waterfall snapshot from IndexedDB.
 */
export async function clearWaterfallSnapshot(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.error("Failed to clear waterfall snapshot from IndexedDB:", err);
  }
}
