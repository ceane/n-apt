import { configureStore } from "@reduxjs/toolkit";
import websocketSlice, {
  updateDeviceState,
} from "@n-apt/redux/slices/websocketSlice";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import websocketMiddleware, {
  resetWebSocketMiddlewareState,
  resolvePersistedPauseIntent,
  shouldRestorePersistedPauseIntent,
} from "@n-apt/redux/middleware/websocketMiddleware";

const STORAGE_KEY = "n-apt:subscriber-pause-intent";
const SOURCE_ID = "rtl-sdr-1";

describe("subscriber pause intent across documents", () => {
  const page = "1726632000000";

  it("re-asserts an intent written by the same document", () => {
    // Fast Refresh re-evaluates the middleware module in place; the client's
    // pause latch survives, so the subscriber pause must be restored to match.
    expect(
      resolvePersistedPauseIntent({
        raw: JSON.stringify({ page, paused: { "rtl-sdr-1": true } }),
        currentPage: page,
      }),
    ).toEqual({ "rtl-sdr-1": true });
  });

  it("does not pause a fresh document with a reloaded page's intent", () => {
    // A reloaded page starts a new live presentation that plays. Restoring the
    // previous document's pause opened the RX subscription paused, so no frames
    // arrived: the display stranded on the Loading placeholder and the user had
    // to click pause/resume twice before the stream returned.
    expect(
      resolvePersistedPauseIntent({
        raw: JSON.stringify({ page, paused: { "rtl-sdr-1": true } }),
        currentPage: "1726632099999",
      }),
    ).toBeNull();
  });

  it("ignores a record with no document stamp", () => {
    expect(
      resolvePersistedPauseIntent({
        raw: JSON.stringify({ "rtl-sdr-1": true }),
        currentPage: page,
      }),
    ).toBeNull();
    expect(
      shouldRestorePersistedPauseIntent({ storedPage: null, currentPage: page }),
    ).toBe(false);
    expect(
      shouldRestorePersistedPauseIntent({ storedPage: page, currentPage: null }),
    ).toBe(false);
  });

  it("keeps boolean entries and drops malformed ones", () => {
    expect(
      resolvePersistedPauseIntent({
        raw: JSON.stringify({
          page,
          paused: { "rtl-sdr-1": true, "hackrf-1": false, broken: "yes" },
        }),
        currentPage: page,
      }),
    ).toEqual({ "rtl-sdr-1": true, "hackrf-1": false });
  });

  it("returns null for missing or unparseable records", () => {
    expect(
      resolvePersistedPauseIntent({ raw: null, currentPage: page }),
    ).toBeNull();
    expect(
      resolvePersistedPauseIntent({ raw: "not json", currentPage: page }),
    ).toBeNull();
  });
});

const receivingSource = {
  id: SOURCE_ID,
  name: "RTL-SDR v4",
  kind: "rtl-sdr",
  capability: "rx",
  status: "receiving",
  supports_approx_dbm: true,
  stream_key: "00000001",
  stream_key_kind: "serial",
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
      sample_rate: 3_200_000,
      center_frequency: 137_100_000,
      gain: 0,
    },
  },
};

/**
 * Runs the real connect path and returns the commands the middleware put on
 * the multiplexed stream socket. A subscription seeded paused sends a
 * `stream_set_paused` after its `stream_subscribe`.
 */
const openStreamSocketMessages = async (): Promise<string[]> => {
  const sockets: any[] = [];
  (global.WebSocket as unknown as jest.Mock).mockImplementation((url: string) => {
    const socket = {
      url,
      readyState: WebSocket.OPEN,
      binaryType: "",
      close: jest.fn(),
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
      onopen: null as (() => void) | null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };
    sockets.push(socket);
    return socket;
  });

  const store = configureStore({
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
  sockets[0]?.onopen?.();

  store.dispatch(
    updateDeviceState({
      isConnected: true,
      connectionStatus: "connected",
      activeSourceId: SOURCE_ID,
      sources: [receivingSource],
      sourceStatuses: { [SOURCE_ID]: "receiving" },
    } as any),
  );
  await Promise.resolve();
  await Promise.resolve();

  const streamSocket = sockets.find((socket) =>
    socket.url.includes("/ws/streams"),
  );
  if (!streamSocket) throw new Error("the stream socket was never opened");
  streamSocket.onopen?.();
  await Promise.resolve();

  return streamSocket.send.mock.calls.map(([message]: [string]) => message);
};

describe("subscriber pause intent at the stream boundary", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetWebSocketMiddlewareState();
  });

  afterEach(() => {
    resetWebSocketMiddlewareState();
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  const pausedCommands = (messages: string[]) =>
    messages.filter((message) => message.includes('"type":"stream_set_paused"'));

  it("does not seed a fresh subscription paused from another document", async () => {
    // The reload regression: the record was re-applied regardless of which
    // document wrote it, opening the RX subscription paused. The backend then
    // published nothing, so the canvas sat on the Loading placeholder until the
    // user toggled pause/resume twice.
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ page: "1", paused: { [SOURCE_ID]: true } }),
    );

    const messages = await openStreamSocketMessages();

    expect(
      messages.some((message) => message.includes('"type":"stream_subscribe"')),
    ).toBe(true);
    expect(pausedCommands(messages)).toEqual([]);
  });

  it("still re-asserts the pause for a Fast Refresh of the same document", async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        page: String(performance.timeOrigin),
        paused: { [SOURCE_ID]: true },
      }),
    );

    const messages = await openStreamSocketMessages();

    const paused = pausedCommands(messages);
    expect(paused.length).toBeGreaterThan(0);
    expect(paused.every((message) => message.includes('"paused":true'))).toBe(
      true,
    );
  });
});

