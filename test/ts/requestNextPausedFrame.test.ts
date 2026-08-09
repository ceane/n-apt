import { requestNextPausedFrame } from "@n-apt/redux/thunks/websocketThunks";

function createMockStore(isConnected: boolean) {
  const actions: any[] = [];
  return {
    dispatch: (action: any) => {
      actions.push(action);
      return action;
    },
    getState: () => ({
      websocket: { isConnected },
    }),
    getActions: () => actions,
  };
}

describe("requestNextPausedFrame thunk", () => {
  it("requests one standby preview frame when connected", async () => {
    const store = createMockStore(true);

    await requestNextPausedFrame()(
      store.dispatch as any,
      store.getState as any,
      undefined,
    );

    expect(store.getActions()).toContainEqual({
      type: "websocket/sendMessage",
      payload: { type: "request_next_frame", data: {} },
    });
  });

  it("includes Tx preview settings in the one-shot request without opening a live Tx stream", async () => {
    const store = createMockStore(true);

    await requestNextPausedFrame({
      sourceId: "mock-tx",
      txSettings: {
        centerFrequencyHz: 137_100_000,
        bandwidthHz: 1_400_000,
        powerDbm: -18,
        txSignal: "wifi",
        txIfftSize: 8192,
      },
    })(store.dispatch as any, store.getState as any, undefined);

    expect(store.getActions()).toContainEqual({
      type: "websocket/sendMessage",
      payload: {
        type: "request_next_frame",
        data: {
          source_id: "mock-tx",
          centerFrequencyHz: 137_100_000,
          bandwidthHz: 1_400_000,
          powerDbm: -18,
          txSignal: "wifi",
          txIfftSize: 8192,
        },
      },
    });
    expect(
      store
        .getActions()
        .some((action) => action?.type === "websocket/refreshStream"),
    ).toBe(false);
  });

  it("does not dispatch when disconnected", async () => {
    const store = createMockStore(false);

    await requestNextPausedFrame()(
      store.dispatch as any,
      store.getState as any,
      undefined,
    );

    expect(store.getActions()).toEqual([
      expect.objectContaining({
        type: "websocket/requestNextPausedFrame/pending",
      }),
      expect.objectContaining({
        type: "websocket/requestNextPausedFrame/fulfilled",
      }),
    ]);
  });
});
