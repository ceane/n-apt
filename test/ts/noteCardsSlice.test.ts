import {
  addExperimentLabel,
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

describe("persisted experiment note metadata", () => {
  it("persists a reusable label as soon as it is entered", () => {
    const state = noteCardsReducer(undefined, addExperimentLabel("  carrier   present "));
    const next = noteCardsReducer(state, addExperimentLabel("carrier present"));

    expect(next.experimentLabels).toEqual(["carrier present"]);
  });

  it("restores structured observations and normalized reusable labels", () => {
    const state = noteCardsReducer(
      undefined,
      hydrateNoteCards([
        {
          id: "experiment-1",
          title: "Carrier present",
          observation: "Spike appeared after enabling tone.",
          labels: ["  carrier   present ", "carrier present", "baseline"],
          experiment: { channel: "B", txPattern: "tone", txPowerDbm: -18 },
          stats: {},
          snapshot: null,
          position: { x: 120, y: 80 },
          size: { width: 320, height: 400 },
          zIndex: 1,
          isActive: true,
        } as never,
      ]),
    );

    expect(state.cards[0]).toEqual(
      expect.objectContaining({
        observation: "Spike appeared after enabling tone.",
        labels: ["carrier present", "baseline"],
        experiment: { channel: "B", txPattern: "tone", txPowerDbm: -18 },
      }),
    );
  });
});
