import { sendSettings } from "@n-apt/redux/thunks/websocketThunks";

describe("sendSettings frame-rate protocol boundary", () => {
  it("clamps frameRate and maxFrameRate before dispatching a settings message", async () => {
    const dispatch = jest.fn();
    const getState = () => ({ websocket: { isConnected: true } });

    await (sendSettings({
      frameRate: 133,
      maxFrameRate: 133,
    }) as any)(dispatch, getState, undefined);

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/sendMessage",
      payload: {
        type: "settings",
        data: {
          scope: "device",
          frameRate: 100,
          maxFrameRate: 100,
        },
      },
    });
  });

  it("sends the mirror-axis choice as device-scoped presentation state", async () => {
    const dispatch = jest.fn();
    const getState = () => ({ websocket: { isConnected: true } });

    await (sendSettings({ mirrorSpectrumBelowZero: true }) as any)(
      dispatch,
      getState,
      undefined,
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/sendMessage",
      payload: {
        type: "settings",
        data: {
          scope: "device",
          mirror_spectrum_below_zero: true,
        },
      },
    });
  });
});
