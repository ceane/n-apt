import {
  requestNextPausedFrame,
  sendFrequencyRange,
  sendSettings,
} from "@n-apt/redux/thunks/websocketThunks";
import { CLIENT_ORIGIN_ID } from "@n-apt/redux/clientOrigin";

const dispatchThunk = async (thunk: any, state: any) => {
  const dispatch = jest.fn();
  await thunk(dispatch, () => state, undefined);
  return dispatch;
};

describe("managed stream control actions", () => {
  it("sends a tuning range as source-scoped RX stream options", async () => {
    const dispatch = await dispatchThunk(
      sendFrequencyRange({ min: 130_000_000, max: 140_000_000 }),
      {
        websocket: { isConnected: true },
        spectrum: { activeSignalArea: "APT" },
      },
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/updateRxStreamOptions",
      payload: {
        options: {
          centerFrequencyHz: 135_000_000,
          minFrequencyHz: 130_000_000,
          maxFrequencyHz: 140_000_000,
          signalArea: "APT",
          originId: CLIENT_ORIGIN_ID,
        },
        publishMode: "gesture",
      },
    });
  });

  it("sends device settings through managed RX options", async () => {
    const dispatch = await dispatchThunk(
      sendSettings({
        sampleRate: 3_200_000,
        fftSize: 4096,
        frameRate: 120,
        maxFrameRate: 120,
        hackrfAmpEnabled: false,
      }),
      { websocket: { isConnected: true } },
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/updateRxStreamOptions",
      payload: {
        options: {
          sampleRateHz: 3_200_000,
          fftSize: 4096,
          frameRate: 100,
          maxFrameRate: 100,
          hackrfAmpEnable: false,
        },
        publishMode: "immediate",
      },
    });
  });

  it("requests a paused preview through the managed stream action", async () => {
    const dispatch = await dispatchThunk(
      requestNextPausedFrame({
        sourceId: "mock-apt",
        frequencyRange: { min: 130_000_000, max: 140_000_000 },
      }),
      { websocket: { isConnected: true } },
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/requestManagedStreamFrame",
      payload: {
        sourceId: "mock-apt",
        mode: "rx",
        options: {
          centerFrequencyHz: 135_000_000,
          minFrequencyHz: 130_000_000,
          maxFrequencyHz: 140_000_000,
          originId: CLIENT_ORIGIN_ID,
        },
      },
    });
  });

  it("routes a Tx standby preview through the managed Tx stream action", async () => {
    const dispatch = await dispatchThunk(
      requestNextPausedFrame({
        sourceId: "mock-tx",
        txSettings: {
          centerFrequencyHz: 137_100_000,
          bandwidthHz: 1_400_000,
          powerDbm: -18,
          txSignal: "wifi",
          txIfftSize: 8192,
        },
      }),
      { websocket: { isConnected: true } },
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/requestManagedStreamFrame",
      payload: {
        sourceId: "mock-tx",
        mode: "tx",
        options: {
          centerFrequencyHz: 137_100_000,
          bandwidthHz: 1_400_000,
          powerDbm: -18,
          signal: "wifi",
          ifftSize: 8192,
        },
      },
    });
  });
});
