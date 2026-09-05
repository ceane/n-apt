import {
  createMultiplexedStreamTransport,
} from "@n-apt/app/infrastructure/streams/multiplexedStreamTransport";
import type { StreamKey } from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";

jest.mock("@n-apt/crypto/webcrypto", () => ({
  decryptPayloadBytes: jest.fn(),
}));

describe("multiplexed stream transport", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("uses one socket for independent source/mode subscriptions", () => {
    const sockets: Array<{
      readyState: number;
      send: jest.Mock;
      close: jest.Mock;
      onopen: (() => void) | null;
      onclose: (() => void) | null;
      onerror: (() => void) | null;
      onmessage: ((event: MessageEvent) => void) | null;
    }> = [];
    const webSocketFactory = jest.fn(() => {
      const socket = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      };
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: {} as CryptoKey,
      webSocketFactory: webSocketFactory as unknown as (
        url: string,
      ) => WebSocket,
    });
    const keyA: StreamKey = { sourceId: "source-a", mode: "rx" };
    const keyB: StreamKey = { sourceId: "source-b", mode: "rx" };
    const first = transport.transportFactory(keyA, () => undefined);
    const second = transport.transportFactory(keyB, () => undefined);

    first.send({
      type: "stream_subscribe",
      scope: "subscriber",
      subscriptionId: "a",
      stream: keyA,
      options: {
        mode: "rx",
        centerFrequencyHz: 1,
        sampleRateHz: 2,
        fftSize: 4,
      },
    });
    second.send({
      type: "stream_subscribe",
      scope: "subscriber",
      subscriptionId: "b",
      stream: keyB,
      options: {
        mode: "rx",
        centerFrequencyHz: 3,
        sampleRateHz: 4,
        fftSize: 8,
      },
    });

    expect(webSocketFactory).toHaveBeenCalledTimes(1);
    expect(sockets[0].send).toHaveBeenCalledTimes(2);
    first.close();
    expect(sockets[0].close).not.toHaveBeenCalled();
    transport.dispose();
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
  });

  it("waits for the server subscription acknowledgement before reporting ready", () => {
    const socket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
    };
    const events: any[] = [];
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: {} as CryptoKey,
      webSocketFactory: jest.fn(() => socket as unknown as WebSocket) as unknown as (
        url: string,
      ) => WebSocket,
    });
    const key: StreamKey = { sourceId: "mock-tx", mode: "tx" };
    const stream = transport.transportFactory(key, (event) => events.push(event));
    stream.send({
      type: "stream_subscribe",
      scope: "subscriber",
      subscriptionId: "mock-tx-subscription",
      stream: key,
      options: {
        mode: "tx",
        centerFrequencyHz: 137_100_000,
        sampleRateHz: 2_400_000,
        bandwidthHz: 2_000_000,
        ifftSize: 2048,
        signal: "wifi",
        powerDbm: -18,
      },
    });

    socket.onopen?.();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "stream_state",
        sourceId: "mock-tx",
        mode: "tx",
        streamEpoch: 0,
        state: "opening",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "stream_opened",
        streamEpoch: 0,
        state: "ready",
      }),
    );

    socket.onmessage?.({
      data: JSON.stringify({
        type: "stream_subscribed",
        sourceId: "mock-tx",
        mode: "tx",
        streamEpoch: 7,
        optionsRevision: 1,
        state: "ready",
        effectiveOptions: {
          mode: "tx",
          centerFrequencyHz: 137_100_000,
          sampleRateHz: 2_400_000,
          bandwidthHz: 2_000_000,
          ifftSize: 2048,
          signal: "wifi",
          powerDbm: -18,
        },
      }),
    } as MessageEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "stream_opened",
        sourceId: "mock-tx",
        mode: "tx",
        streamEpoch: 7,
        state: "ready",
      }),
    );
    transport.dispose();
  });

  it("restores desired subscriptions after reconnect", () => {
    jest.useFakeTimers();
    try {
      const sockets: any[] = [];
      const webSocketFactory = jest.fn(() => {
        const socket = {
          readyState: WebSocket.OPEN,
          send: jest.fn(),
          close: jest.fn(),
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
        };
        sockets.push(socket);
        return socket;
      });
      const transport = createMultiplexedStreamTransport({
        url: "ws://localhost/ws?token=test",
        aesKey: {} as CryptoKey,
        reconnectDelayMs: 10,
        webSocketFactory: webSocketFactory as unknown as (
          url: string,
        ) => WebSocket,
      });
      const key: StreamKey = { sourceId: "source-a", mode: "rx" };
      const stream = transport.transportFactory(key, () => undefined);
      stream.send({
        type: "stream_subscribe",
        scope: "subscriber",
        subscriptionId: "a",
        stream: key,
        options: {
          mode: "rx",
          centerFrequencyHz: 1,
          sampleRateHz: 2,
          fftSize: 4,
        },
      });
      sockets[0].onclose();
      jest.advanceTimersByTime(10);
      expect(webSocketFactory).toHaveBeenCalledTimes(2);
      sockets[1].onopen();
      expect(sockets[1].send).toHaveBeenCalledWith(
        expect.stringContaining('"subscriptionId":"a"'),
      );
      transport.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("restores the unanimous RX pause contract after reconnect", () => {
    jest.useFakeTimers();
    try {
    const sockets: any[] = [];
    const webSocketFactory = jest.fn(() => {
      const socket = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      };
      sockets.push(socket);
      return socket;
    });
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: {} as CryptoKey,
      webSocketFactory: webSocketFactory as unknown as (
        url: string,
      ) => WebSocket,
    });
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };
    const stream = transport.transportFactory(key, () => undefined);

    stream.send({
      type: "stream_subscribe",
      scope: "subscriber",
      subscriptionId: "a",
      stream: key,
      options: {
        mode: "rx",
        centerFrequencyHz: 1,
        sampleRateHz: 2,
        fftSize: 4,
      },
    });
    stream.send({
      type: "stream_set_paused",
      scope: "subscriber",
      subscriptionId: "a",
      stream: key,
      paused: true,
    });

    sockets[0].onclose();
    jest.advanceTimersByTime(250);
    sockets[1].onopen?.();

    expect(sockets[1].send).toHaveBeenLastCalledWith(
      expect.stringContaining('"paused":true'),
    );
    transport.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("forwards the device-owned effective options from subscribe hydration", () => {
    const socket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
    };
    const webSocketFactory = jest.fn(() => socket as unknown as WebSocket);
    const events: any[] = [];
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: {} as CryptoKey,
      webSocketFactory: webSocketFactory as unknown as (
        url: string,
      ) => WebSocket,
    });
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };
    transport.transportFactory(key, (event) => events.push(event));
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "stream_subscribed",
        sourceId: key.sourceId,
        mode: key.mode,
        streamEpoch: 7,
        optionsRevision: 4,
        state: "ready",
        streamId: "session-abc--source-def--rx",
        streamPath: "/ws/streams/session-abc--source-def--rx",
        streamUrl: "/ws/streams/session-abc--source-def--rx",
        effectiveOptions: {
          mode: "rx",
          centerFrequencyHz: 101_000_000,
          sampleRateHz: 2_400_000,
          fftSize: 4096,
        },
      }),
    } as MessageEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "stream_opened",
        optionsRevision: 4,
        options: expect.objectContaining({
          centerFrequencyHz: 101_000_000,
          fftSize: 4096,
        }),
        deliveryPolicy: "lossless",
        streamId: "session-abc--source-def--rx",
        streamPath: "/ws/streams/session-abc--source-def--rx",
        streamUrl: "/ws/streams/session-abc--source-def--rx",
      }),
    );
    transport.dispose();
  });

  it("coalesces slow latest-frame decryption to the newest pending frame", async () => {
    let releaseDecrypt: (() => void) | null = null;
    const decryptStarted = jest.fn();
    (decryptPayloadBytes as jest.Mock).mockImplementation(
      async (_key: CryptoKey, payload: string) => {
        decryptStarted(payload);
        if (payload === "1") {
          await new Promise<void>((resolve) => {
            releaseDecrypt = resolve;
          });
        }
        return new Uint8Array([Number(payload)]);
      },
    );

    const socket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
    };
    const webSocketFactory = jest.fn(() => socket as unknown as WebSocket);
    const events: any[] = [];
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: {} as CryptoKey,
      webSocketFactory: webSocketFactory as unknown as (
        url: string,
      ) => WebSocket,
    });
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };
    const stream = transport.transportFactory(key, (event) => events.push(event));
    stream.send({
      type: "stream_subscribe",
      scope: "subscriber",
      subscriptionId: "a",
      stream: key,
      options: {
        mode: "rx",
        centerFrequencyHz: 1,
        sampleRateHz: 2,
        fftSize: 4,
      },
      deliveryPolicy: "latest",
    });

    socket.onmessage?.({
      data: JSON.stringify({
        type: "stream_frame",
        sourceId: key.sourceId,
        mode: key.mode,
        streamEpoch: 1,
        optionsRevision: 1,
        sequence: 1,
        timestamp: 1,
        sampleRateHz: 2,
        iqData: "1",
      }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({
        type: "stream_frame",
        sourceId: key.sourceId,
        mode: key.mode,
        streamEpoch: 1,
        optionsRevision: 1,
        sequence: 2,
        timestamp: 2,
        sampleRateHz: 2,
        iqData: "2",
      }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({
        type: "stream_frame",
        sourceId: key.sourceId,
        mode: key.mode,
        streamEpoch: 1,
        optionsRevision: 1,
        sequence: 3,
        timestamp: 3,
        sampleRateHz: 2,
        iqData: "3",
      }),
    } as MessageEvent);

    expect(decryptStarted).toHaveBeenCalledTimes(1);
    const release = releaseDecrypt as (() => void) | null;
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(decryptStarted.mock.calls.map(([payload]) => payload)).toEqual([
      "1",
      "3",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 3]);
    transport.dispose();
  });

  it("keeps every frame on the lossless delivery path", async () => {
    (decryptPayloadBytes as jest.Mock).mockImplementation(
      async (_key: CryptoKey, payload: string) =>
        new Uint8Array([Number(payload)]),
    );

    const socket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
    };
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: {} as CryptoKey,
      webSocketFactory: (() => socket) as unknown as (
        url: string,
      ) => WebSocket,
    });
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };
    const events: any[] = [];
    const stream = transport.transportFactory(key, (event) => events.push(event));
    stream.send({
      type: "stream_subscribe",
      scope: "subscriber",
      subscriptionId: "a",
      stream: key,
      options: {
        mode: "rx",
        centerFrequencyHz: 1,
        sampleRateHz: 2,
        fftSize: 4,
      },
      deliveryPolicy: "lossless",
    });

    for (const sequence of [1, 2, 3]) {
      socket.onmessage?.({
        data: JSON.stringify({
          type: "stream_frame",
          sourceId: key.sourceId,
          mode: key.mode,
          streamEpoch: 1,
          optionsRevision: 1,
          sequence,
          timestamp: sequence,
          sampleRateHz: 2,
          iqData: String(sequence),
        }),
      } as MessageEvent);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    transport.dispose();
  });

  it("drops the previous lossless revision when a retune is requested", async () => {
    let releaseDecrypt: (() => void) | null = null;
    const decryptStarted = jest.fn();
    (decryptPayloadBytes as jest.Mock).mockImplementation(
      async (_key: CryptoKey, payload: string) => {
        decryptStarted(payload);
        if (payload === "1") {
          await new Promise<void>((resolve) => {
            releaseDecrypt = resolve;
          });
        }
        return new Uint8Array([Number(payload)]);
      },
    );

    const socket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
    };
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: {} as CryptoKey,
      webSocketFactory: (() => socket) as unknown as (
        url: string,
      ) => WebSocket,
    });
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };
    const events: any[] = [];
    const stream = transport.transportFactory(key, (event) => events.push(event));
    const options = {
      mode: "rx" as const,
      centerFrequencyHz: 1,
      sampleRateHz: 2,
      fftSize: 4,
    };
    stream.send({
      type: "stream_subscribe",
      scope: "subscriber",
      subscriptionId: "a",
      stream: key,
      options,
      deliveryPolicy: "lossless",
    });

    for (const sequence of [1, 2]) {
      socket.onmessage?.({
        data: JSON.stringify({
          type: "stream_frame",
          sourceId: key.sourceId,
          mode: key.mode,
          streamEpoch: 1,
          optionsRevision: 1,
          sequence,
          timestamp: sequence,
          sampleRateHz: 2,
          iqData: String(sequence),
        }),
      } as MessageEvent);
    }

    stream.send({
      type: "stream_update_options",
      scope: "device",
      subscriptionId: "a",
      stream: key,
      options: { ...options, centerFrequencyHz: 5 },
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "stream_frame",
        sourceId: key.sourceId,
        mode: key.mode,
        streamEpoch: 1,
        optionsRevision: 2,
        sequence: 3,
        timestamp: 3,
        centerFrequencyHz: 5,
        sampleRateHz: 2,
        iqData: "3",
      }),
    } as MessageEvent);

    const release = releaseDecrypt as (() => void) | null;
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Revision 1 was the resident DC window. Once the retune is requested,
    // neither its in-flight frame nor its queued frame may delay presentation
    // of the first frame for revision 2.
    expect(decryptStarted.mock.calls.map(([payload]) => payload)).toEqual([
      "1",
      "3",
    ]);
    expect(
      events
        .filter((event) => event.type === "stream_frame")
        .map((event) => [event.optionsRevision, event.sequence]),
    ).toEqual([[2, 3]]);
    transport.dispose();
  });
});
