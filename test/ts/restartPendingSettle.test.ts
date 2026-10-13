import websocketSlice, {
  restartRequested,
  restartSettled,
} from "@n-apt/redux/slices/websocketSlice";

const SOURCE_ID = "rtl-sdr-1";

describe("pending per-source restart flags", () => {
  it("records a restart request once per source", () => {
    let state = websocketSlice(undefined, restartRequested(SOURCE_ID));
    state = websocketSlice(state, restartRequested(SOURCE_ID));

    expect(state.restartPendingSourceIds).toEqual([SOURCE_ID]);
  });

  it("keeps the flag while the source is genuinely loading", () => {
    const state = websocketSlice(
      websocketSlice(undefined, restartRequested(SOURCE_ID)),
      restartSettled({ [SOURCE_ID]: "loading" }),
    );

    expect(state.restartPendingSourceIds).toEqual([SOURCE_ID]);
  });

  it("releases the flag once the source is stale so Restart is usable again", () => {
    // A restart that resolves to `stale` cannot make further progress on its
    // own. Holding the flag would keep the Restart button disabled, which is
    // what left the device stuck in "Restarting…" with no way to retry.
    const state = websocketSlice(
      websocketSlice(undefined, restartRequested(SOURCE_ID)),
      restartSettled({ [SOURCE_ID]: "stale" }),
    );

    expect(state.restartPendingSourceIds).toEqual([]);
  });

  it("releases the flag once the source is live again", () => {
    const state = websocketSlice(
      websocketSlice(undefined, restartRequested(SOURCE_ID)),
      restartSettled({ [SOURCE_ID]: "receiving" }),
    );

    expect(state.restartPendingSourceIds).toEqual([]);
  });
});
