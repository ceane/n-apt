import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RootState } from "@n-apt/redux/store";
import type { SourceInfo } from "@n-apt/consts/schemas/websocket";
import {
  importAesKey,
  base64ToBytes,
  computeHmac,
} from "@n-apt/crypto/webcrypto";
import { setFrequencyRange } from "@n-apt/redux";
import {
  setSelectedSourceId,
  setSelectionIntentSourceId,
} from "@n-apt/redux/slices/sourceSelectionSlice";
import { resolveInitialSourceSelection } from "@n-apt/spectrum/hooks/useSpectrumStore";
import {
  isControlPlaneUnavailable,
  isCurrentSourceFrameReady,
  resolveLiveSourceLifecycle,
  selectSourceFrameReadinessForMode,
  selectSourceTransportForMode,
  type LiveSourceLifecyclePhase,
} from "@n-apt/spectrum/hooks/liveSourceLifecycle";
import type { SourcePresentationPhase } from "@n-apt/app/infrastructure/streams/sourcePresentationController";

// The repository has the runtime `ws` dependency but intentionally does not
// require its optional type package for the browser build.
const wsModule: any = require(
  resolve(process.cwd(), "node_modules/ws/index.js"),
);
const NodeWebSocket: any = [
  wsModule,
  wsModule.default,
  wsModule.WebSocket,
].find((candidate) => typeof candidate === "function");

type AppStore = typeof import("@n-apt/redux/store").store;
type AppDispatch = AppStore["dispatch"];
type DebugSnapshot = ReturnType<
  typeof import("@n-apt/redux/middleware/websocketMiddleware").getManagedStreamDebugSnapshot
>;

export type LiveReduxStreamHarnessOptions = {
  backendUrl?: string;
  redisUrl?: string;
  password?: string;
  startBackend?: boolean;
  backendBinary?: string;
  pollIntervalMs?: number;
  hardwareSimulation?: "rtl-sdr";
  autoSelectInitialSource?: boolean;
};

export type LiveFrameSnapshot = {
  hasFrame: boolean;
  sourceId: string | null;
  streamEpoch: number | null;
  sequence: number | null;
  frameStatus: string | null;
  centerFrequencyHz: number | null;
};

export type LiveReduxStreamPresentationPhase = {
  sourceId: string;
  mode: "rx" | "tx";
  phase: SourcePresentationPhase;
};

export type LiveReduxStreamLifecycleSnapshot = {
  phase: LiveSourceLifecyclePhase;
  controlPlaneUnavailable: boolean;
  placeholderReason: string | null;
};

export type LiveReduxStreamSnapshot = {
  hasConnectedOnce: boolean;
  sourcePause: Record<string, boolean>;
  presentationPhase: LiveReduxStreamPresentationPhase | null;
  lifecycle: LiveReduxStreamLifecycleSnapshot;
  redux: Pick<
    RootState["websocket"],
    | "isConnected"
    | "connectionStatus"
    | "hasConnectedOnce"
    | "isPaused"
    | "activeSourceId"
    | "activeSourceMode"
    | "deviceState"
    | "sourceTransport"
    | "sourceFrameReadiness"
    | "sources"
    | "sourceStatuses"
    | "error"
  >;
  selectedSourceId: string | null;
  managed: DebugSnapshot;
  liveFrame: LiveFrameSnapshot;
  rxPresentation: LiveFrameSnapshot;
  txPresentation: LiveFrameSnapshot;
};

export type LiveReduxStreamHarness = {
  connect(): Promise<void>;
  selectSource(sourceId: string): Promise<void>;
  setPaused(paused: boolean, sourceId?: string): Promise<void>;
  requestNextStandbyFrame(): Promise<void>;
  setTransmit(enabled: boolean, sourceId?: string): Promise<void>;
  simulateHardwarePresence(present: boolean): Promise<void>;
  setFftSize(fftSize: number, timeoutMs?: number): Promise<void>;
  retuneCenterFrequency(centerHz: number): Promise<number>;
  waitFor<T>(
    read: () => T,
    predicate: (value: T) => boolean,
    timeoutMs?: number,
  ): Promise<T>;
  snapshot(): LiveReduxStreamSnapshot;
  close(): void;
};

const resolvePausePresentationMode = (
  source: SourceInfo | null | undefined,
): "rx" | "tx" =>
  source?.status === "transmitting" || source?.status === "standby"
    ? "tx"
    : "rx";

const buildPauseDispatchPayload = (
  state: RootState["websocket"],
  paused: boolean,
  sourceId?: string,
) => {
  const pauseSourceId = sourceId ?? state.activeSourceId;
  if (!pauseSourceId) {
    throw new Error("setPaused() requires an active or explicit source id");
  }
  const pauseTargetSource = state.sources.find(
    (source) => source.id === pauseSourceId,
  );
  const duplexMode =
    pauseTargetSource?.duplex_mode?.toLowerCase?.() === "half-duplex"
      ? "half_duplex"
      : undefined;
  const activeMode = resolvePausePresentationMode(pauseTargetSource);
  return {
    type: "websocket/setPaused" as const,
    payload: {
      isPaused: paused,
      sourceId: pauseSourceId,
      duplexMode,
      activeMode,
    },
  };
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const findFreePort = async (): Promise<number> =>
  new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("Failed to allocate a free TCP port"));
        return;
      }
      server.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(address.port);
      });
    });
  });

const waitForTcpPort = async (
  port: number,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolveConnect, rejectConnect) => {
        const socket = createConnection({ host: "127.0.0.1", port }, () => {
          socket.destroy();
          resolveConnect();
        });
        socket.once("error", rejectConnect);
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(25);
    }
  }
  throw new Error(
    `Timed out waiting for Redis on port ${port}: ${String(lastError)}`,
  );
};

const requestJson = async (
  url: string,
  method = "GET",
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: any }> => {
  const parsedUrl = new URL(url);
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  const request = parsedUrl.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolveRequest, rejectRequest) => {
    const requestHandle = request(
      parsedUrl,
      {
        method,
        headers: {
          ...extraHeaders,
          ...(serializedBody
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(serializedBody),
              }
            : {}),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let json: any = null;
          try {
            json = responseBody ? JSON.parse(responseBody) : null;
          } catch {
            json = null;
          }
          resolveRequest({ status: response.statusCode ?? 0, json });
        });
      },
    );
    requestHandle.on("error", rejectRequest);
    if (serializedBody) requestHandle.write(serializedBody);
    requestHandle.end();
  });
};

const latestFrame = (value: unknown): any => {
  if (Array.isArray(value)) return value[value.length - 1] ?? null;
  return value ?? null;
};

const frameSnapshot = (value: unknown): LiveFrameSnapshot => {
  const frame = latestFrame(value);
  return {
    hasFrame: !!frame,
    sourceId: typeof frame?.source_id === "string" ? frame.source_id : null,
    streamEpoch:
      typeof frame?.stream_epoch === "number" ? frame.stream_epoch : null,
    sequence: typeof frame?.sequence === "number" ? frame.sequence : null,
    frameStatus:
      typeof frame?.frame_status === "string" ? frame.frame_status : null,
    centerFrequencyHz:
      typeof frame?.center_frequency_hz === "number"
        ? frame.center_frequency_hz
        : null,
  };
};

const waitForHttp = async (url: string, timeoutMs = 20_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(`${url}/status`);
      if (response.status >= 200 && response.status < 300) return;
      lastError = new Error(`backend status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
};

const authenticate = async (
  backendUrl: string,
  password: string,
): Promise<{ token: string; aesKey: CryptoKey }> => {
  const challengeResponse = await requestJson(
    `${backendUrl}/auth/challenge`,
    "POST",
    {},
  );
  if (challengeResponse.status < 200 || challengeResponse.status >= 300) {
    throw new Error(`auth challenge failed: ${challengeResponse.status}`);
  }
  const challenge = challengeResponse.json as {
    challenge_id: string;
    nonce: string;
  };
  const hmac = await computeHmac(password, challenge.nonce);
  const verifyResponse = await requestJson(
    `${backendUrl}/auth/verify`,
    "POST",
    {
      challenge_id: challenge.challenge_id,
      hmac,
    },
  );
  if (verifyResponse.status < 200 || verifyResponse.status >= 300) {
    throw new Error(`auth verify failed: ${verifyResponse.status}`);
  }
  const { token } = verifyResponse.json as { token: string };
  const vaultResponse = await requestJson(
    `${backendUrl}/auth/vault-key`,
    "GET",
    undefined,
    { Authorization: `Bearer ${token}` },
  );
  if (vaultResponse.status < 200 || vaultResponse.status >= 300) {
    throw new Error(`vault key failed: ${vaultResponse.status}`);
  }
  const { vault_key: vaultKey } = vaultResponse.json as {
    vault_key: string;
  };
  const aesKey = await importAesKey(
    base64ToBytes(vaultKey).buffer as ArrayBuffer,
  );
  return { token, aesKey };
};

export const createLiveReduxStreamHarness = async (
  options: LiveReduxStreamHarnessOptions = {},
): Promise<LiveReduxStreamHarness> => {
  const explicitBackendUrl =
    options.backendUrl ?? process.env.LIVE_BACKEND_URL ?? null;
  const password =
    options.password ??
    process.env.LIVE_STREAM_PASSWORD ??
    process.env.UNSAFE_LOCAL_USER_PASSWORD ??
    "test-password-123";
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const shouldStartBackend = options.startBackend ?? true;
  const backendBinary =
    options.backendBinary ??
    resolve(process.cwd(), "target/debug/n-apt-backend");
  let backendProcess: ChildProcess | null = null;
  let redisProcess: ChildProcess | null = null;
  let sessionToken: string | null = null;

  const spawnBackend = async (backendUrl: string) => {
    const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
    const effectiveRedisUrl =
      redisUrl ?? `redis://127.0.0.1:${await findFreePort()}`;
    if (!redisUrl) {
      const redisPort = Number(new URL(effectiveRedisUrl).port);
      redisProcess = spawn(
        "redis-server",
        [
          "--port",
          String(redisPort),
          "--save",
          "",
          "--appendonly",
          "no",
          "--loglevel",
          "warning",
        ],
        { stdio: "ignore" },
      );
      await waitForTcpPort(redisPort);
    }
    backendProcess = spawn(backendBinary, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WEBSOCKETS_URL: backendUrl,
        REDIS_URL: effectiveRedisUrl,
        UNSAFE_LOCAL_USER_PASSWORD: password,
        ...(options.hardwareSimulation
          ? { N_APT_TEST_HARDWARE_SIMULATION: options.hardwareSimulation }
          : {}),
      },
      stdio: "ignore",
    });
    await waitForHttp(backendUrl);
  };

  const backendUrl = (
    explicitBackendUrl ?? `http://127.0.0.1:${await findFreePort()}`
  ).replace(/\/$/, "");

  if (!explicitBackendUrl && shouldStartBackend) {
    if (!existsSync(backendBinary)) {
      throw new Error(`Backend binary not found at ${backendBinary}`);
    }
    await spawnBackend(backendUrl);
  } else {
    try {
      await waitForHttp(backendUrl, 1_000);
    } catch (error) {
      if (!shouldStartBackend || !existsSync(backendBinary)) throw error;
      await spawnBackend(backendUrl);
    }
  }

  const originalWebSocket = (globalThis as any).WebSocket;
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: NodeWebSocket,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: NodeWebSocket,
    });
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(Date.now()), 0);
    }
  }

  const [
    { store },
    {
      connectWebSocket,
      disconnectWebSocket,
      sendSelectSource,
      sendFrequencyRange,
      sendSettings,
      requestNextPausedFrame,
    },
    middleware,
  ] = await Promise.all([
    import("@n-apt/redux/store"),
    import("@n-apt/redux/thunks/websocketThunks"),
    import("@n-apt/redux/middleware/websocketMiddleware"),
  ]);
  const { getManagedStreamDebugSnapshot, liveDataRef, presentationController } =
    middleware;
  const dispatch = store.dispatch as AppDispatch;
  let connected = false;

  const autoSelectCurrentSource = async () => {
    const state = store.getState();
    const initialSelection = resolveInitialSourceSelection({
      activeSourceId: state.websocket.activeSourceId ?? "",
      storedSourceId: null,
      sources: state.websocket.sources,
    });
    if (!initialSelection.selectedSourceId) return;
    dispatch(setSelectedSourceId(initialSelection.selectedSourceId));
    dispatch(
      setSelectionIntentSourceId(initialSelection.selectionIntentSourceId),
    );
    if (initialSelection.selectedSourceId !== state.websocket.activeSourceId) {
      await dispatch(sendSelectSource(initialSelection.selectedSourceId));
    }
  };

  const harness: LiveReduxStreamHarness = {
    async connect() {
      const { token, aesKey } = await authenticate(backendUrl, password);
      sessionToken = token;
      const wsUrl = `${backendUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
      await dispatch(connectWebSocket({ url: wsUrl, aesKey }));
      await harness.waitFor(
        () => store.getState().websocket,
        (state) =>
          state.isConnected &&
          state.sources.length > 0 &&
          (!options.hardwareSimulation ||
            state.sources.some((source) => source.id === "rtl-sdr-00000001")),
      );
      if (options.autoSelectInitialSource !== false) {
        await autoSelectCurrentSource();
      }
      connected = true;
    },

    async selectSource(sourceId) {
      if (!connected)
        throw new Error("connect() must run before selectSource()");
      await dispatch(sendSelectSource(sourceId));
      await harness.waitFor(
        () => store.getState().websocket,
        (state) =>
          state.activeSourceId === sourceId &&
          (state.sourceStatuses[sourceId] === "standby" ||
            state.sourceTransport?.sourceId === sourceId),
      );
    },

    async setPaused(paused, sourceId) {
      if (!connected) throw new Error("connect() must run before setPaused()");
      const websocketState = store.getState().websocket;
      const pauseAction = buildPauseDispatchPayload(
        websocketState,
        paused,
        sourceId,
      );
      const effectiveSourceId = pauseAction.payload.sourceId;
      dispatch(pauseAction);
      await harness.waitFor(
        () => harness.snapshot(),
        (snapshot) =>
          snapshot.redux.isPaused === paused &&
          snapshot.sourcePause[effectiveSourceId] === paused &&
          (paused ? snapshot.presentationPhase?.phase === "paused" : true),
      );
    },

    async requestNextStandbyFrame() {
      if (!connected) {
        throw new Error("connect() must run before requestNextStandbyFrame()");
      }
      const state = store.getState();
      await dispatch(
        requestNextPausedFrame({
          sourceId: "mock-tx",
          txSettings: {
            centerFrequencyHz: state.spectrum?.txCenterFrequencyHz ?? null,
            bandwidthHz: state.spectrum?.txSampleRateHz ?? null,
            sampleRateHz: state.spectrum?.txSampleRateHz ?? null,
            powerDbm: state.spectrum?.txPowerDbm ?? null,
            txSignal: state.spectrum?.txSignal ?? null,
            txIfftSize: state.spectrum?.txIfftSize ?? null,
          },
        }),
      );
    },

    async setTransmit(enabled, sourceId = "mock-tx") {
      if (!connected)
        throw new Error("connect() must run before setTransmit()");
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "status",
          data: {
            status: enabled ? "transmitting" : "standby",
            txDevice: sourceId,
            serialNumber: sourceId,
            txSignal: "wifi",
            txSafetyEnabled: false,
            txIfftSize: 1024,
          },
        },
      });
      await harness.waitFor(
        () => store.getState().websocket,
        (state) =>
          enabled
            ? state.sourceStatuses[sourceId] === "transmitting"
            : state.sourceStatuses[sourceId] === "standby" ||
              state.sourceStatuses[sourceId] === "receiving",
      );
    },

    async simulateHardwarePresence(present) {
      if (!options.hardwareSimulation) {
        throw new Error("hardware simulation is not enabled for this harness");
      }
      const response = await requestJson(
        `${backendUrl}/api/debug/hardware-simulation?token=${encodeURIComponent(sessionToken ?? "")}`,
        "POST",
        { present },
      );
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `hardware simulation request failed: ${response.status}`,
        );
      }
      await harness.waitFor(
        () => store.getState().websocket,
        (state) =>
          state.activeSourceId === (present ? "rtl-sdr-00000001" : "mock-apt"),
        30_000,
      );
      if (options.autoSelectInitialSource !== false) {
        await autoSelectCurrentSource();
      }
    },

    async setFftSize(fftSize, timeoutMs = 15_000) {
      await dispatch(sendSettings({ fftSize }));
      await harness.waitFor(
        () => store.getState(),
        (state) =>
          state.spectrum?.fftSize === fftSize ||
          state.websocket.sdrSettings?.fft?.default_size === fftSize ||
          state.websocket.sources.some(
            (source) =>
              source.id === state.websocket.activeSourceId &&
              source.sdr.settings.fft_size === fftSize,
          ),
        timeoutMs,
      );
    },

    async retuneCenterFrequency(centerHz) {
      const state = store.getState();
      const activeSource = state.websocket.sources.find(
        (source) => source.id === state.websocket.activeSourceId,
      );
      const sampleRateHz = activeSource?.sdr.settings.sample_rate ?? 3_200_000;
      const range = {
        min: Math.round(centerHz - sampleRateHz / 2),
        max: Math.round(centerHz + sampleRateHz / 2),
      };
      const previousSequence = harness.snapshot().rxPresentation.sequence ?? 0;
      const startedAt = performance.now();

      // This is the same UI -> Redux -> transport boundary used by the VFO
      // route: update the local view immediately, then send the tuned range.
      dispatch(setFrequencyRange(range));
      await dispatch(sendFrequencyRange(range));
      await harness.waitFor(
        () => harness.snapshot(),
        (snapshot) =>
          snapshot.rxPresentation.sourceId === state.websocket.activeSourceId &&
          snapshot.rxPresentation.sequence !== null &&
          snapshot.rxPresentation.sequence > previousSequence &&
          snapshot.rxPresentation.frameStatus !== "stale" &&
          snapshot.rxPresentation.hasFrame &&
          snapshot.rxPresentation.centerFrequencyHz !== null &&
          Math.abs(snapshot.rxPresentation.centerFrequencyHz - centerHz) <= 10,
      );

      return performance.now() - startedAt;
    },

    async waitFor(read, predicate, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      let value = read();
      while (!predicate(value) && Date.now() < deadline) {
        await sleep(pollIntervalMs);
        value = read();
      }
      if (!predicate(value)) {
        throw new Error(
          `Timed out waiting for live Redux state: ${JSON.stringify(value)}`,
        );
      }
      return value;
    },

    snapshot() {
      const state = store.getState().websocket;
      const managed = getManagedStreamDebugSnapshot();
      const slotFrameSnapshot = (
        sourceId: string | null,
        mode: "rx" | "tx",
      ): LiveFrameSnapshot => {
        const slot = sourceId
          ? presentationController.getSlot(sourceId, mode)
          : null;
        return frameSnapshot(
          slot?.liveFrameRef.current ?? slot?.frozenFrame?.frame ?? null,
        );
      };
      const lastPresentedTxSourceId =
        managed.tx.sourceId ??
        Array.from(presentationController.getAllSlots().values())
          .reverse()
          .find(
            (slot) =>
              slot.key.mode === "tx" &&
              (slot.liveFrameRef.current !== null || slot.frozenFrame !== null),
          )?.key.sourceId ??
        null;

      const activeSourceId = state.activeSourceId;
      const activeSource = state.sources.find(
        (source) => source.id === activeSourceId,
      );
      const presentationMode = resolvePausePresentationMode(activeSource);
      const activeSlot = activeSourceId
        ? presentationController.getSlot(activeSourceId, presentationMode)
        : null;
      const trackedSourceIds = [
        ...new Set(
          [activeSourceId, managed.rx.sourceId, managed.tx.sourceId].filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
        ),
      ];
      const sourcePause = Object.fromEntries(
        trackedSourceIds.map((sourceKey) => {
          const source = state.sources.find(
            (candidate) => candidate.id === sourceKey,
          );
          return [
            sourceKey,
            source?.paused === true ||
              (state.isPaused && activeSourceId === sourceKey),
          ];
        }),
      );
      const hasTargetFrozenFrame =
        !!activeSourceId &&
        (presentationController.getFrozenFrame(activeSourceId, "rx") !== null ||
          presentationController.getFrozenFrame(activeSourceId, "tx") !==
            null ||
          presentationController.getSlot(activeSourceId, "rx")?.phase ===
            "paused" ||
          presentationController.getSlot(activeSourceId, "tx")?.phase ===
            "paused");
      const deviceStatus = activeSourceId
        ? (state.sourceStatuses[activeSourceId] ?? activeSource?.status ?? null)
        : null;
      const liveFrameSnapshot = frameSnapshot(liveDataRef.current);
      const sourceTransport = selectSourceTransportForMode(
        presentationMode,
        state.sourceTransportByMode,
        state.sourceTransport,
      );
      const sourceReadiness = selectSourceFrameReadinessForMode(
        presentationMode,
        state.sourceFrameReadinessByMode,
        state.sourceFrameReadiness,
      );
      const lifecycleResult = resolveLiveSourceLifecycle({
        selectedSourceId: activeSourceId,
        activeSourceId,
        transportSourceId: sourceTransport.sourceId ?? null,
        transportPhase: sourceTransport.phase ?? "idle",
        transportError: sourceTransport.error ?? null,
        hasValidFrame:
          hasTargetFrozenFrame ||
          isCurrentSourceFrameReady({
            selectedSourceId: activeSourceId,
            activeSourceId,
            readiness: sourceReadiness,
          }) ||
          liveFrameSnapshot.hasFrame,
        deviceStatus,
        isLive: true,
        isConnected: state.isConnected,
        connectionStatus: state.connectionStatus,
        hasConnectedOnce: state.hasConnectedOnce,
        isStandby: deviceStatus === "standby",
        readinessSequence: sourceReadiness?.sequence ?? null,
        readiness: sourceReadiness,
        presentedSourceId: liveFrameSnapshot.sourceId,
      });
      const controlPlaneUnavailable = isControlPlaneUnavailable({
        isConnected: state.isConnected,
        connectionStatus: state.connectionStatus,
        hasConnectedOnce: state.hasConnectedOnce,
      });

      return {
        hasConnectedOnce: state.hasConnectedOnce,
        sourcePause,
        presentationPhase:
          activeSourceId && activeSlot
            ? {
                sourceId: activeSourceId,
                mode: presentationMode,
                phase: activeSlot.phase,
              }
            : null,
        lifecycle: {
          phase: lifecycleResult.phase,
          controlPlaneUnavailable,
          placeholderReason:
            lifecycleResult.placeholder?.kind === "error"
              ? lifecycleResult.placeholder.reason
              : null,
        },
        redux: {
          isConnected: state.isConnected,
          connectionStatus: state.connectionStatus,
          hasConnectedOnce: state.hasConnectedOnce,
          isPaused: state.isPaused,
          activeSourceId: state.activeSourceId,
          activeSourceMode: state.activeSourceMode,
          deviceState: state.deviceState,
          sourceTransport: state.sourceTransport,
          sourceFrameReadiness: state.sourceFrameReadiness,
          sources: state.sources,
          sourceStatuses: state.sourceStatuses,
          error: state.error,
        },
        selectedSourceId:
          store.getState().sourceSelection.selectedSourceId || null,
        managed,
        liveFrame: liveFrameSnapshot,
        rxPresentation: slotFrameSnapshot(
          managed.rx.sourceId ?? state.activeSourceId,
          "rx",
        ),
        txPresentation: slotFrameSnapshot(lastPresentedTxSourceId, "tx"),
      };
    },

    close() {
      // Graceful disconnect first: routes through the middleware's cleanup
      // path (control socket close + multiplexed-transport dispose) instead
      // of leaving sockets open that keep the jest event loop alive after
      // the suite finishes.
      try {
        store.dispatch(disconnectWebSocket());
        // Block past the middleware's DISCONNECT_GRACE_MS (150 ms) so
        // cleanupSocket() has run before we tear down child processes.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      } catch {
        // Store may already be torn down in double-invoked test lifecycles.
      }
      middleware.resetWebSocketMiddlewareState();
      (globalThis as any).WebSocket = originalWebSocket;
      if (typeof window !== "undefined") {
        (window as any).WebSocket = originalWebSocket;
      }
      // These are throwaway per-test processes: terminate deterministically
      // so a slow SIGTERM shutdown can never strand a backend holding real
      // USB handles (which stalls the next run's device enumeration).
      backendProcess?.kill("SIGKILL");
      redisProcess?.kill("SIGKILL");
    },
  };

  return harness;
};
