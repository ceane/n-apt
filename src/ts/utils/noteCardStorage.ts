import Dexie, { type Table } from "dexie";
import type { NoteCardModel } from "@n-apt/redux/slices/noteCardsSlice";

const DB_NAME = "napt-note-cards";
const DB_VERSION = 1;
const STORE_NAME = "persistedNoteCards";
const RECORD_KEY = "cards";

export interface PersistedNoteCardsPayload {
  cards: NoteCardModel[];
  isCollapsed: boolean;
}

const DEFAULT_PERSISTED_STATE: PersistedNoteCardsPayload = {
  cards: [],
  isCollapsed: false,
};

interface NoteCardsPersistenceRecord {
  id: string;
  payload: PersistedNoteCardsPayload;
  updatedAt: number;
}

class NoteCardsDatabase extends Dexie {
  persistedNoteCards!: Table<NoteCardsPersistenceRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      [STORE_NAME]: "id, updatedAt",
    });
    this.persistedNoteCards = this.table(STORE_NAME);
  }
}

const db = typeof window !== "undefined" ? new NoteCardsDatabase() : null;

const normalizePayload = (
  payload: Partial<PersistedNoteCardsPayload> | null | undefined,
): PersistedNoteCardsPayload => ({
  cards: Array.isArray(payload?.cards) ? payload.cards : [],
  isCollapsed: payload?.isCollapsed ?? false,
});

export const loadPersistedNoteCards =
  async (): Promise<PersistedNoteCardsPayload> => {
    if (!db) {
      return DEFAULT_PERSISTED_STATE;
    }

    try {
      const record = await db.persistedNoteCards.get(RECORD_KEY);
      return normalizePayload(record?.payload ?? null);
    } catch (error) {
      console.warn("Failed to load persisted note cards:", error);
      return DEFAULT_PERSISTED_STATE;
    }
  };

export const persistNoteCards = async (
  payload: PersistedNoteCardsPayload,
): Promise<void> => {
  if (!db) {
    return;
  }

  try {
    await db.persistedNoteCards.put({
      id: RECORD_KEY,
      payload: normalizePayload(payload),
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.warn("Failed to persist note cards:", error);
  }
};

export const clearPersistedNoteCards = async (): Promise<void> => {
  if (!db) {
    return;
  }

  try {
    await db.persistedNoteCards.delete(RECORD_KEY);
  } catch (error) {
    console.warn("Failed to clear persisted note cards:", error);
  }
};
