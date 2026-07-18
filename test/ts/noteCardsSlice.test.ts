import {
  hydrateNoteCards,
  updateNoteCardSize,
} from "@n-apt/redux/slices/noteCardsSlice";
import noteCardsReducer from "@n-apt/redux/slices/noteCardsSlice";

describe("noteCards size updates", () => {
  it("does not change state when the measured size is unchanged", () => {
    const state = noteCardsReducer(
      undefined,
      hydrateNoteCards([
        {
          id: "card-1",
          title: "",
          stats: {},
          snapshot: null,
          position: { x: 120, y: 80 },
          size: { width: 320, height: 400 },
          zIndex: 1,
          isActive: true,
        } as never,
      ]),
    );

    const unchanged = noteCardsReducer(
      state,
      updateNoteCardSize({
        id: "card-1",
        size: { width: 320, height: 400 },
      }),
    );

    expect(unchanged).toBe(state);
  });
});
