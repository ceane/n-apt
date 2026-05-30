import type { Middleware } from "@reduxjs/toolkit";
import { persistNoteCards } from "@n-apt/utils/noteCardStorage";

const PERSIST_DEBOUNCE_MS = 200;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

const schedulePersist = (store: any) => {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    const noteCardsState = store.getState().noteCards;
    const cards =
      typeof structuredClone === "function"
        ? structuredClone(noteCardsState.cards)
        : JSON.parse(JSON.stringify(noteCardsState.cards));

    void persistNoteCards({
      cards,
      isCollapsed: noteCardsState.isCollapsed,
    });
  }, PERSIST_DEBOUNCE_MS);
};

const noteCardsMiddleware: Middleware<{}, any> =
  (store) => (next) => (action) => {
    const result = next(action);

    const actionType =
      typeof action === "object" && action && "type" in action
        ? (action as { type?: unknown }).type
        : null;

    if (typeof actionType === "string" && actionType.startsWith("noteCards/")) {
      schedulePersist(store);
    }

    return result;
  };

export default noteCardsMiddleware;
