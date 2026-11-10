import { configureStore } from "@reduxjs/toolkit";
import websocketSlice, { updateDeviceState } from "@n-apt/redux/slices/websocketSlice";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import websocketMiddleware, {
  buildManagedRxOptions,
  getManagedStreamDebugSnapshot,
  resetWebSocketMiddlewareState,
  shouldResetManagedRxStartupFrameRequest,
} from "@n-apt/redux/middleware/websocketMiddleware";
import { waitFor } from "@testing-library/react";
import { CenterFrequencyHzSchema, RxCenterFrequencyHzSchema } from "@n-apt/validation/schemas";

type TestSocket = {
  readyState: number;
  close: jest.Mock;
  send: jest.Mock;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
};

const makeSocket = (): TestSocket => ({
  readyState: WebSocket.CONNECTING,
  close: jest.fn(),
  send: jest.fn(),
  onopen: null,
  onclose: null,
  onerror: null,
  onmessage: null,
});

describe("managed stream message routing", () => {
  it("validates center frequency as a safe, nonnegative whole number of hertz", () => {
    expect(CenterFrequencyHzSchema.safeParse(1_618_001).success).toBe(true);
    expect(CenterFrequencyHzSchema.safeParse(1_618_000.5).success).toBe(false);
    expect(CenterFrequencyHzSchema.safeParse(-1).success).toBe(false);
    expect(CenterFrequencyHzSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(RxCenterFrequencyHzSchema.safeParse(4_294_967_295).success).toBe(true);
    expect(RxCenterFrequencyHzSchema.safeParse(4_294_967_296).success).toBe(false);
    expect(RxCenterFrequencyHzSchema.safeParse(0).success).toBe(false);
  });
  it("rearms the RX startup frame request when its source becomes stale", () => {
    expect(
      shouldResetManagedRxStartupFrameRequest({
        sourceId: "rtl-sdr-1",
        status: "stale",
        startupFrameRequestSourceId: "rtl-sdr-1",
      }),
    ).toBe(true);
  });

  let sockets: TestSocket[];
  let store: ReturnType<typeof configureStore>;

  beforeEach(() => {
    resetWebSocketMiddlewareState();
    sockets = [];
    (global.WebSocket as unknown as jest.Mock).mockImplementation(() => {
      const socket = makeSocket();
      sockets.push(socket);
      return socket;
    });
    store = configureStore({
      reducer: { websocket: websocketSlice, spectrum: spectrumSlice },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }).concat(
          websocketMiddleware,
        ),
    });
    store.dispatch({
      type: "websocket/connect",
      payload: {
        url: "ws://localhost/ws",
        aesKey: {} as CryptoKey,
        enabled: true,
      },
    });
    sockets[0].readyState = WebSocket.OPEN;
    sockets[0].onopen?.();
    store.dispatch(
      updateDeviceState({
        activeSourceId: "mock-apt",
        sources: [
          {
            id: "mock-apt",
            name: "Mock APT SDR",
            kind: "mock_apt",
            capability: "rx",
            status: "receiving",
            iq_format: {
              element_type: "u8",
              layout: "interleaved_iq",
              typed_array: "Uint8Array",
            },
            sdr: {
              max_sample_rate: 20_000_000,
              sample_rate_options: [2_400_000, 5_200_000],
              fft_display: { markers: [] },
              settings: {
                center_frequency: 137_100_000,
                sample_rate: 2_400_000,
                fft_size: 1024,
                fft_window: "Rectangular",
                frame_rate: 30,
                gain: 10,
              },
            },
          },
        ],
        sourceStatuses: { "mock-apt": "receiving" },
      } as any),
    );
  });

  afterEach(() => {
    resetWebSocketMiddlewareState();
    jest.clearAllMocks();
  });

  const openManagedRxStream = async (): Promise<TestSocket> => {
    await waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2));
    const streamSocket = sockets[1];
    streamSocket.readyState = WebSocket.OPEN;
    streamSocket.onopen?.();
    let subscribe: any;
    await waitFor(() => {
      const serialized = streamSocket.send.mock.calls
        .map(([message]) => message as string)
        .find((message) => message.includes('"type":"stream_subscribe"'));
      expect(serialized).toBeDefined();
      subscribe = JSON.parse(serialized!);
    });
    expect(streamSocket.onmessage).toEqual(expect.any(Function));
    streamSocket.onmessage?.({
      data: JSON.stringify({
        type: "stream_subscribed",
        subscriptionId: subscribe.subscriptionId,
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 1,
        optionsRevision: 1,
        state: "ready",
        deliveryPolicy: "latest",
        streamId: "session-test--mock-apt--rx",
        streamPath: "/ws/streams/session-test--mock-apt--rx",
        streamUrl: "/ws/streams/session-test--mock-apt--rx",
        effectiveOptions: subscribe.options,
      }),
    } as MessageEvent);
    await waitFor(() =>
      expect(getManagedStreamDebugSnapshot().rx.streamEpoch).toBe(1),
    );
    streamSocket.send.mockClear();
    sockets[0].send.mockClear();
    return streamSocket;
  };


  it("builds initial RTL-SDR options at Channel A's displayed center", () => {
    const rtlSource = {
      id: "rtl-sdr-0",
      name: "RTL-SDR",
      kind: "rtl_sdr",
      capability: "rx",
      status: "receiving",
      iq_format: {
        element_type: "u8",
        layout: "interleaved_iq",
        typed_array: "Uint8Array",
      },
      sdr: {
        max_sample_rate: 3_200_000,
        sample_rate_options: [3_200_000],
        fft_display: { markers: [] },
        settings: {
          center_frequency: 1_600_000,
          sample_rate: 3_200_000,
          fft_size: 1024,
          fft_window: "Rectangular",
          frame_rate: 30,
          gain: 46.9,
        },
      },
    };
    const state = {
      spectrum: {
        frequencyRange: { min: 18_000, max: 3_218_000 },
        sampleRateHz: 3_200_000,
        fftSize: 1024,
        fftFrameRate: 30,
        activeSignalArea: "A",
        vizZoom: 1,
        vizPanOffset: 0,
      },
      settings: { mirrorIqBasebandBelowZero: false },
    };
    const options = buildManagedRxOptions(state, rtlSource as any);
    const zeroCenterOptions = buildManagedRxOptions(
      state,
      {
        ...rtlSource,
        sdr: {
          ...rtlSource.sdr,
          settings: { ...rtlSource.sdr.settings, center_frequency: 0 },
        },
      } as any,
    );

    for (const initialOptions of [options, zeroCenterOptions]) {
      expect(initialOptions).toEqual(
        expect.objectContaining({
          centerFrequencyHz: 1_618_000,
          sampleRateHz: 3_200_000,
          fftSize: 1024,
        }),
      );
    }

    const scrolledOptions = buildManagedRxOptions(
      {
        ...state,
        spectrum: { ...state.spectrum, vizZoom: 4, vizPanOffset: 400_000 },
      },
      rtlSource as any,
    );
    expect(scrolledOptions.centerFrequencyHz).toBe(2_018_000);

    const mirrorOffClampedOptions = buildManagedRxOptions(
      {
        ...state,
        spectrum: { ...state.spectrum, vizZoom: 4, vizPanOffset: -2_000_000 },
      },
      rtlSource as any,
    );
    expect(mirrorOffClampedOptions.centerFrequencyHz).toBe(418_000);

    const mirroredNegativeOptions = buildManagedRxOptions(
      {
        ...state,
        spectrum: { ...state.spectrum, vizZoom: 4, vizPanOffset: -2_000_000 },
        settings: { mirrorIqBasebandBelowZero: true },
      },
      rtlSource as any,
    );
    expect(mirroredNegativeOptions.centerFrequencyHz).toBe(382_000);
  });

  it("sends whole hertz when the displayed center is fractional", () => {
    const source = {
      id: "rtl-sdr-1",
      kind: "rtl_sdr",
      capability: "rx",
      sdr: { settings: { sample_rate: 3_200_000, fft_size: 2048 } },
    } as any;
    const options = buildManagedRxOptions({
      spectrum: { frequencyRange: { min: 18_000, max: 3_218_001 }, vizZoom: 1 },
      settings: {},
    }, source);
    expect(options.centerFrequencyHz).toBe(1_618_001);
  });

  it("sends RX option changes on the managed stream socket", async () => {
    const streamSocket = await openManagedRxStream();

    store.dispatch({
      type: "websocket/updateRxStreamOptions",
      payload: {
        options: {
          centerFrequencyHz: 137_500_000,
          sampleRateHz: 3_200_000,
          fftSize: 4096,
        },
        publishMode: "immediate",
      },
    });

    await waitFor(() =>
      expect(streamSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream_update_options"'),
      ),
    );
    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"settings"'),
    );
    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"frequency_range"'),
    );
  });

  it("requests a paused frame with the managed subscriber identity", async () => {
    const streamSocket = await openManagedRxStream();

    store.dispatch({
      type: "websocket/requestManagedStreamFrame",
      payload: {
        sourceId: "mock-apt",
        mode: "rx",
        options: {},
      },
    });

    await waitFor(() =>
      expect(streamSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream_request_frame"'),
      ),
    );
    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"request_next_frame"'),
    );
  });

  it("waits for settled viewport options before requesting the paused frame", async () => {
    const streamSocket = await openManagedRxStream();

    store.dispatch({
      type: "websocket/updateRxStreamOptions",
      payload: {
        options: { centerFrequencyHz: 137_400_000 },
        publishMode: "immediate",
      },
    });

    let firstUpdate: any;
    await waitFor(() => {
      const serialized = streamSocket.send.mock.calls
        .map(([message]) => message as string)
        .find((message) => message.includes('"type":"stream_update_options"'));
      expect(serialized).toBeDefined();
      firstUpdate = JSON.parse(serialized!);
    });

    store.dispatch({
      type: "websocket/requestManagedStreamFrame",
      payload: {
        sourceId: "mock-apt",
        mode: "rx",
        options: {
          centerFrequencyHz: 137_500_000,
          sampleRateHz: 2_400_000,
          fftSize: 4096,
          minFrequencyHz: 136_300_000,
          maxFrequencyHz: 138_700_000,
        },
      },
    });

    expect(streamSocket.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"stream_request_frame"'),
    );

    streamSocket.onmessage?.({
      data: JSON.stringify({
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 2,
        optionsRevision: 2,
        options: firstUpdate.options,
      }),
    } as MessageEvent);

    let settledUpdate: any;
    await waitFor(() => {
      const updates = streamSocket.send.mock.calls
        .map(([message]) => message as string)
        .filter((message) => message.includes('"type":"stream_update_options"'));
      expect(updates).toHaveLength(2);
      settledUpdate = JSON.parse(updates[1]!);
    });
    expect(settledUpdate.options).toMatchObject({
      centerFrequencyHz: 137_500_000,
      minFrequencyHz: 136_300_000,
      maxFrequencyHz: 138_700_000,
    });

    expect(streamSocket.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"stream_request_frame"'),
    );

    streamSocket.onmessage?.({
      data: JSON.stringify({
        type: "stream_options_applied",
        sourceId: "mock-apt",
        mode: "rx",
        streamEpoch: 3,
        optionsRevision: 3,
        options: settledUpdate.options,
      }),
    } as MessageEvent);

    await waitFor(() =>
      expect(streamSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream_request_frame"'),
      ),
    );
    const updateCalls = streamSocket.send.mock.calls
      .map(([message], index) =>
        (message as string).includes('"type":"stream_update_options"')
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    const requestCall = streamSocket.send.mock.calls.findIndex(([message]) =>
      (message as string).includes('"type":"stream_request_frame"'),
    );
    expect(updateCalls).toHaveLength(2);
    expect(requestCall).toBeGreaterThan(updateCalls[1]!);
  });

  it("drops legacy control-socket option and one-shot messages", () => {
    store.dispatch({
      type: "websocket/sendMessage",
      payload: { type: "settings", data: { fftSize: 4096 } },
    });
    store.dispatch({
      type: "websocket/sendMessage",
      payload: {
        type: "frequency_range",
        data: { min_hz: 136_000_000, max_hz: 139_000_000 },
      },
    });
    store.dispatch({
      type: "websocket/sendMessage",
      payload: { type: "request_next_frame", data: { source_id: "mock-apt" } },
    });

    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"settings"'),
    );
    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"frequency_range"'),
    );
    expect(sockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"request_next_frame"'),
    );
    expect((store.getState() as any).websocket.queuedMessages).toEqual([]);
  });
});
