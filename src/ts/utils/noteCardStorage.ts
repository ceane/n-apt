import type { NoteCardModel } from "@n-apt/redux/slices/noteCardsSlice";

const DB_NAME = "napt-note-cards";
const DB_VERSION = 1;
const STORE_NAME = "note-cards";
const RECORD_KEY = "cards";

export interface PersistedNoteCardsPayload {
  cards: NoteCardModel[];
  isCollapsed: boolean;
}

const DEFAULT_PERSISTED_STATE: PersistedNoteCardsPayload = {
  cards: [],
  isCollapsed: false,
};

const isIndexedDbAvailable = () =>
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

const openDb = async (): Promise<IDBDatabase | null> => {
  if (!isIndexedDbAvailable()) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T | null> => {
  const db = await openDb();
  if (!db) {
    return null;
  }

  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const result = await callback(store);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
};

export const loadPersistedNoteCards = async (): Promise<PersistedNoteCardsPayload> => {
  const result = await withStore("readonly", (store) =>
    new Promise<PersistedNoteCardsPayload>((resolve, reject) => {
      const request = store.get(RECORD_KEY);
      request.onsuccess = () => {
        const rawValue = request.result?.value;
        if (Array.isArray(rawValue)) {
          resolve({ cards: rawValue, isCollapsed: false });
          return;
        }
        if (rawValue && Array.isArray(rawValue.cards)) {
          resolve({
            cards: rawValue.cards,
            isCollapsed: rawValue.isCollapsed ?? false,
          });
          return;
        }
        resolve(DEFAULT_PERSISTED_STATE);
      };
      request.onerror = () => reject(request.error);
    }),
  );

  return result ?? DEFAULT_PERSISTED_STATE;
};

export const persistNoteCards = async (payload: PersistedNoteCardsPayload): Promise<void> => {
  await withStore("readwrite", (store) =>
    new Promise<void>((resolve, reject) => {
      const request = store.put({ id: RECORD_KEY, value: payload, updatedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
  );
};

export const clearPersistedNoteCards = async (): Promise<void> => {
  await withStore("readwrite", (store) =>
    new Promise<void>((resolve, reject) => {
      const request = store.delete(RECORD_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
  );
};
