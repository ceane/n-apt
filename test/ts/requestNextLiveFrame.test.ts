import { configureStore } from "@reduxjs/toolkit";
import websocketSlice from "../../src/ts/redux/slices/websocketSlice";
import spectrumSlice from "../../src/ts/redux/slices/spectrumSlice";
import {
  requestNextLiveFrame,
  sendSelectSource,
} from "../../src/ts/redux/thunks/websocketThunks";

describe("requestNextLiveFrame thunk", () => {
  it("dispatches websocket/sendMessage with request_next_frame when connected", async () => {
    const seen: any[] = [];
    const captureMiddleware = () => (next: any) => (action: any) => {
      seen.push(action);
      return next(action);
    };

    const store = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }).concat(
          captureMiddleware,
        ),
    });

    store.dispatch({ type: "websocket/setConnected" });
    await store.dispatch(requestNextLiveFrame() as any);

    expect(
      seen.some(
        (action) =>
          action?.type === "websocket/sendMessage" &&
          action?.payload?.type === "request_next_frame",
      ),
    ).toBe(true);
  });

  it("sends Tx bandwidth without overriding the preview sample rate", async () => {
    const seen: any[] = [];
    const captureMiddleware = () => (next: any) => (action: any) => {
      seen.push(action);
      return next(action);
    };

    const store = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }).concat(
          captureMiddleware,
        ),
    });

    store.dispatch({ type: "websocket/setConnected" });
    await store.dispatch(
      requestNextLiveFrame({
        txSettings: {
          centerFrequencyHz: 137_100_000,
          bandwidthHz: 2_400_000,
          powerDbm: -18,
          txSignal: "wifi",
          txIfftSize: 8192,
        },
      }) as any,
    );

    const data = seen.find(
      (action) =>
        action?.type === "websocket/sendMessage" &&
        action?.payload?.type === "request_next_frame",
    )?.payload?.data;

    expect(data).toMatchObject({
      centerFrequencyHz: 137_100_000,
      bandwidthHz: 2_400_000,
      powerDbm: -18,
      txSignal: "wifi",
      txIfftSize: 8192,
    });
    expect(data).not.toHaveProperty("sampleRateHz");
  });

  it("sends the target HackRF Whole Channel rate instead of the frontend floor", async () => {
    const seen: any[] = [];
    const captureMiddleware = () => (next: any) => (action: any) => {
      seen.push(action);
      return next(action);
    };

    const store = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }).concat(
          captureMiddleware,
        ),
    });

    store.dispatch({ type: "websocket/setConnected" });
    store.dispatch({ type: "spectrum/setSampleRate", payload: 3_200_000 });
    store.dispatch({
      type: "websocket/updateDeviceState",
      payload: {
        sources: [
          {
            id: "hackrf-1",
            kind: "hackrf_one",
            name: "HackRF One",
            sdr: { max_sample_rate: 20_000_000 },
          },
        ],
        channels: [
          {
            id: "channel-a",
            label: "A",
            min_hz: 137_100_000,
            max_hz: 155_350_000,
            description: "Whole channel",
          },
        ],
      },
    });
    await store.dispatch(sendSelectSource("hackrf-1") as any);

    const selectAction = seen.find(
      (action) =>
        action?.type === "websocket/sendMessage" &&
        action?.payload?.type === "select_source",
    );
    expect(selectAction?.payload?.data).toMatchObject({
      source_id: "hackrf-1",
      sample_rate: 18_250_000,
    });
  });
});
