import sourceSelectionReducer, {
  setPendingSourceSwitchId,
  setSelectedSourceId,
  setSelectionIntentSourceId,
} from "@n-apt/redux/slices/sourceSelectionSlice";

describe("source selection state", () => {
  test("stores selected source intent independently from backend state", () => {
    const initial = sourceSelectionReducer(undefined, { type: "init" });
    expect(initial).toEqual({
      selectedSourceId: "",
      selectionIntentSourceId: null,
      pendingSourceSwitchId: null,
    });

    const next = sourceSelectionReducer(
      initial,
      setSelectedSourceId("hackrf-1"),
    );

    const withIntent = sourceSelectionReducer(
      next,
      setSelectionIntentSourceId("hackrf-1"),
    );
    const withPending = sourceSelectionReducer(
      withIntent,
      setPendingSourceSwitchId("hackrf-1"),
    );

    expect(withPending).toEqual({
      selectedSourceId: "hackrf-1",
      selectionIntentSourceId: "hackrf-1",
      pendingSourceSwitchId: "hackrf-1",
    });
  });
});
