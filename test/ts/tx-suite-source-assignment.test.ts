import sourceRoutingReducer, {
  setSourceBinding,
} from "@n-apt/redux/slices/sourceRoutingSlice";

describe("Tx Suite source assignment", () => {
  it("stores independent Rx and Tx source IDs", () => {
    const state = sourceRoutingReducer(
      undefined,
      setSourceBinding({ group: "tx-suite", role: "rx", sourceId: "mock-apt" }),
    );

    expect(state.bindings["tx-suite:rx"]).toBe("mock-apt");
  });

  it("uses the same binding model for another route group", () => {
    const state = sourceRoutingReducer(
      undefined,
      setSourceBinding({ group: "visualizer", role: "primary", sourceId: "rtl-sdr-1" }),
    );

    expect(state.bindings["visualizer:primary"]).toBe("rtl-sdr-1");
  });
});
