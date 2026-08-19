import {
  createMultiplexedStreamTransport,
} from "@n-apt/app/infrastructure/streams/multiplexedStreamTransport";
import type { StreamKey } from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";

describe("multiplexed stream transport", () => {
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
      }),
    );
    transport.dispose();
  });
});
