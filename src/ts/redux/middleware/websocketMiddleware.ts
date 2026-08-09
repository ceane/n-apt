import { Middleware, Dispatch } from "@reduxjs/toolkit";
import {
  setConnecting,
  setConnected,
  softDisconnect,
  setDisconnected,
  setReconnecting,
  setError,
  setOperationalError,
  updateDeviceState,
  setCaptureStatus,
  queueMessage,
  clearQueuedMessages,
  setSpectrumFrames,
} from "../slices/websocketSlice";
import {
  setActiveSignalArea,
  setFrequencyRange,
  setTxSafetyResult,
} from "../slices/spectrumSlice";
import { setHardwareInfo } from "../slices/demodSlice";
import { decryptPayload } from "@n-apt/crypto/webcrypto";
import {
  type DeviceState,
  type SourceInfo,
  type IqRawFrame,
  type SpectrumFrame,
} from "@n-apt/consts/schemas/websocket";
import { scannerWorkerManager } from "@n-apt/workers/scannerWorkerManager";
import {
  processWebSocketMessageWithValidation,
  isValidChannelsMessageEnhanced,
  isValidSourceInfoMessage,
  isValidSourceStatusMessage,
  isValidSourceSdrSettingsMessage,
  isValidSignalsDefaultsMessage,
  isValidSourceErrorMessage,
  isValidActiveSourceMessage,
} from "@n-apt/validation";
import {
  SourceVisualizationRuntime,
  sourceSpectrumRuntime,
} from "@n-apt/app/infrastructure/visualization/sourceVisualizationRuntime";
import { isMockTxSource } from "@n-apt/app/infrastructure/services/deviceCapabilities";
import {
  isSourceStreamAvailable,
  resolveSourceModeManagement,
} from "@n-apt/app/infrastructure/streams/sourceModeManagement";
import { filterLiveFramesForSource } from "@n-apt/app/infrastructure/visualization/liveSourcePresentation";
import {
  createSourceModeStreamManager,
  type StreamSubscription,
  type StreamOptions,
} from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";
import { createMultiplexedStreamTransport } from "@n-apt/app/infrastructure/streams/multiplexedStreamTransport";
import {
  createSourcePresentationController,
  type SourcePresentationController,
} from "@n-apt/app/infrastructure/streams/sourcePresentationController";
import { resolveTxStandbyAnnouncement } from "@n-apt/app/infrastructure/streams/txStandbyAnnouncement";
import { demodFrameQueue } from "@n-apt/app/infrastructure/visualization/demodFrameQueue";

// Module-level ref for high-frequency live frame data.
// Written directly — never goes through Redux state — so no React rerenders per frame.
export const liveDataRef: { current: IqRawFrame[] | IqRawFrame | null } = {
  current: [],
};

/** Source-keyed frame queues used by multi-source flows such as Tx Suite. */
export const liveDataBySourceRef: {
  current: Record<string, { current: IqRawFrame[] | IqRawFrame | null }>;
} = { current: {} };

export const sourceVisualizationRuntime =
  new SourceVisualizationRuntime<IqRawFrame>();

/**
 * Central presentation controller — single source of truth for per-source,
 * per-mode frame acceptance, pause/freeze, standby, and canvas key decisions.
 * Shadowed in parallel with existing liveDataRef writes until canvas consumers
 * migrate in Phase 5.
 */
export let presentationController: SourcePresentationController =
  createSourcePresentationController();

const cachedRxFrameBySourceId = new Map<string, IqRawFrame>();

export const resolveRxFrameToRestore = (
  frame: IqRawFrame | null | undefined,
  sourceId: string | null | undefined,
): IqRawFrame | null =>
  frame && sourceId && frame.source_id === sourceId ? frame : null;

export const isBoundTxPreviewStandby = ({
  activeSourceId,
  boundTxSourceId,
  sourceStatus,
}: {
  activeSourceId: string | null | undefined;
  boundTxSourceId: string | null | undefined;
  sourceStatus: SourceInfo["status"];
}): boolean =>
  !!activeSourceId &&
  activeSourceId === boundTxSourceId &&
  sourceStatus === "standby";

export { decodeIqFrameEnvelope } from "@n-apt/app/infrastructure/io/iqStreamProtocol";
export { createIqFramePump } from "@n-apt/app/infrastructure/io/iqFramePump";

const isDemodEligibleLiveFrame = (frame: any): boolean =>
  !!frame?.source_id &&
  !!frame?.iq_data &&
  frame?.frame_status !== "standby" &&
  frame?.frame_status !== "transmitting" &&
  frame?.is_tx_preview !== true &&
  frame?.is_mock_tx_preview !== true;

// Tracks the requested/selected source during transition to filter out old frames
let requestedSourceId: string | null = null;

/** Keep the client frame gate aligned with the server's active-source mode. */
export const isSourceModePaused = (sourceMode: unknown): boolean =>
  sourceMode === "file";

const shallowEqualObject = (
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const equalArrayValues = (
  a: unknown[] | null | undefined,
  b: unknown[] | null | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!equalValue(left, right)) {
      return false;
    }
  }
  return true;
};

const equalValue = (current: unknown, next: unknown): boolean => {
  if (current === next) return true;
  if (Array.isArray(current) && Array.isArray(next)) {
    return equalArrayValues(current, next);
  }
  if (
    current &&
    next &&
    typeof current === "object" &&
    typeof next === "object"
  ) {
    return shallowEqualObject(
      current as Record<string, unknown>,
      next as Record<string, unknown>,
    );
  }
  return false;
};

const deriveLegacyStateFromSource = (source: SourceInfo) => {
  const sourceStatus = source.status ?? "disconnected";
  const sourceGain = source.sdr.settings.gain;
  const tunerGain =
    typeof sourceGain === "number" ? sourceGain : sourceGain?.tuner_gain;
  return {
    deviceState: sourceStatus,
    deviceLoadingReason:
      sourceStatus === "loading" || sourceStatus === "initializing"
        ? "connect"
        : null,
    backend: source.kind,
    deviceInfo: source.name,
    deviceName: source.name,
    deviceProfile: {
      // Kept for compatibility with older consumers; behavior is driven by
      // the generic source capabilities below.
      kind: source.kind,
      is_rtl_sdr: false,
      supports_approx_dbm: source.supports_approx_dbm,
      iq_format: source.iq_format,
    },
    maxSampleRateHz: source.sdr.max_sample_rate,
    sampleRateOptions: source.sdr.sample_rate_options,
    sampleRateHz: source.sdr.settings.sample_rate ?? null,
    sdrSettings: {
      fftSize: source.sdr.settings.fft_size,
      fftWindow: source.sdr.settings.fft_window,
      frameRate: source.sdr.settings.frame_rate,
      sampleRate: source.sdr.settings.sample_rate,
      gain: tunerGain,
      hackrfLnaGain: source.sdr.settings.hackrf_lna_gain,
      hackrfVgaGain: source.sdr.settings.hackrf_vga_gain,
      hackrfAmpEnabled: source.sdr.settings.hackrf_amp_enable,
      ppm: source.sdr.settings.ppm,
      tunerAGC: source.sdr.settings.tuner_agc,
      rtlAGC: source.sdr.settings.rtl_agc,
    },
    sdrLimitMarkers: source.sdr.fft_display.markers,
  };
};

const mapSourceStatusToDeviceState = (
  status: SourceInfo["status"],
): DeviceState => {
  return status;
};

const normalizeTxIdentity = (value: unknown): string =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "")
    : "";

const sourceMatchesTxRequest = (
  source: SourceInfo,
  data: Record<string, unknown>,
): boolean => {
  const serialNumber = normalizeTxIdentity(data.serialNumber);
  const txDevice = normalizeTxIdentity(data.txDevice);
  const sourceId = normalizeTxIdentity(source.id);
  const sourceSerial = normalizeTxIdentity(source.serial_number);
  const sourceName = normalizeTxIdentity(source.name);

  if (
    serialNumber &&
    (serialNumber === sourceId || serialNumber === sourceSerial)
  ) {
    return true;
  }

  if (txDevice && (txDevice === sourceName || txDevice === sourceId)) {
    return true;
  }

  return false;
};

/**
 * Source snapshots can briefly describe a transmitting source as connected
 * while another source is becoming active. Preserve the already-confirmed Tx
 * state for that source; an explicit source status message can still replace
 * it with the authoritative stopped state.
 */
export const preserveTransmittingSourceStatuses = (
  previousSources: SourceInfo[],
  incomingSources: SourceInfo[],
): SourceInfo[] => {
  const transmittingSourceIds = new Set(
    previousSources
      .filter((source) => source.status === "transmitting")
      .map((source) => source.id),
  );
  return incomingSources.map((source) =>
    transmittingSourceIds.has(source.id) && source.status !== "transmitting"
      ? { ...source, status: "transmitting" }
      : source,
  );
};

/** Resolve the immediate source status for an explicit Tx/Rx control action. */
export const resolveOptimisticTransmitStatus = ({
  enabled,
  source,
  txBindingSourceId,
}: {
  enabled: boolean;
  source: SourceInfo;
  txBindingSourceId?: string | null;
}): SourceInfo["status"] => {
  if (enabled) return "transmitting";

  // Stopping active Tx enters Tx standby so the final Tx frame remains
  // visible. A source that is already in standby, however, is leaving the
  // Tx view when its binding is cleared and must return to Rx immediately.
  if (source.status === "transmitting") {
    return resolveSourceModeManagement({ source }).isTxMode
      ? "standby"
      : "receiving";
  }
  if (source.status === "standby" && txBindingSourceId === source.id) {
    return "standby";
  }
  return "receiving";
};

const applyOptimisticTransmitStatus = (
  dispatch: Dispatch,
  getState: () => any,
  data: Record<string, unknown>,
) => {
  const enabled = data.status === "transmitting";
  const websocketState = getState().websocket;
  const currentSources: SourceInfo[] = websocketState.sources ?? [];
  if (currentSources.length === 0) {
    return;
  }

  const targetSource =
    currentSources.find((source) => sourceMatchesTxRequest(source, data)) ??
    currentSources.find(
      (source) => source.capability === "tx" || source.capability === "tx_rx",
    );
  if (!targetSource) {
    return;
  }

  const nextStatus = resolveOptimisticTransmitStatus({
    enabled,
    source: targetSource,
    txBindingSourceId:
      websocketState.sourceRouting?.bindings?.["tx-suite:tx"] ?? null,
  });
  const nextSources = currentSources.map((source) => {
    if (source.id === targetSource.id) {
      return { ...source, status: nextStatus };
    }
    if (enabled && source.status === "transmitting") {
      return { ...source, status: "receiving" as const };
    }
    return source;
  });
  const nextSourceStatuses = Object.fromEntries(
    nextSources.map((source) => [source.id, source.status]),
  );
  const activeSource =
    nextSources.find((source) => source.id === websocketState.activeSourceId) ??
    nextSources.find((source) => source.id === targetSource.id) ??
    nextSources[0] ??
    null;
  const derived = activeSource ? deriveLegacyStateFromSource(activeSource) : {};

  dispatch(
    updateDeviceState({
      sources: nextSources,
      sourceStatuses: nextSourceStatuses,
      ...derived,
    }),
  );
};

interface WebSocketInstance {
  ws: WebSocket | null;
  reconnectTimeout: number | null;
  disconnectTimeout: number | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  url: string;
  aesKey: CryptoKey | null;
  enabled: boolean;
  disposed: boolean;
}

// Store WebSocket instance reference in middleware closure
let wsInstance: WebSocketInstance = {
  ws: null,
  reconnectTimeout: null,
  disconnectTimeout: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  url: "",
  aesKey: null,
  enabled: false,
  disposed: false,
};

let multiplexedStreamTransport: ReturnType<
  typeof createMultiplexedStreamTransport
> | null = null;
let sourceModeStreamManager: ReturnType<
  typeof createSourceModeStreamManager
> | null = null;
let managedRxSubscription: StreamSubscription | null = null;
let managedTxSubscription: StreamSubscription | null = null;
let managedRxSourceId: string | null = null;
let managedTxSourceId: string | null = null;
let managedRxSubscribePending = false;
let managedTxSubscribePending = false;
let pendingManagedTxOptions: StreamOptions | null = null;

/**
 * Runtime-only stream ownership snapshot for integration diagnostics. This
 * deliberately exposes subscription identity and epoch, not frame payloads;
 * high-rate IQ remains in the source presentation refs.
 */
export const getManagedStreamDebugSnapshot = () => ({
  rx: {
    sourceId: managedRxSourceId,
    subscribePending: managedRxSubscribePending,
    streamEpoch: managedRxSubscription?.streamEpoch ?? null,
    hasSubscription: managedRxSubscription !== null,
  },
  tx: {
    sourceId: managedTxSourceId,
    subscribePending: managedTxSubscribePending,
    streamEpoch: managedTxSubscription?.streamEpoch ?? null,
    hasSubscription: managedTxSubscription !== null,
  },
});

// Batching for high-frequency data
let dataBatchFrame: number | null = null;
let pendingDataUpdate: any = null;
let statusBatchFrame: number | null = null;
let pendingStatusUpdates: any = null;
let pausedFrameRequestInFlight = false;
let lastPauseCommandTime = 0;
let lastExpectedPauseState: boolean | null = null;
const MAX_RETAINED_LIVE_FRAMES = 1;
const DISCONNECT_GRACE_MS = 150;
const DUPLICATE_FREQUENCY_RANGE_SUPPRESSION_MS = 500;
// RATIONALE for Auto FFT:
// 1. Screen widths are typically smaller than the FFT size (which is width-based).
// 2. Performance: Smaller FFTs save resources; higher resolution (larger FFT) should be reserved for zoom states.
let lastSettingsRequest: { fft_size?: number; timestamp: number } | null = null;
const RETUNE_CENTER_TOLERANCE_HZ = 10;
const RETUNE_WATCHDOG_GRACE_MS = 500;
const RETUNE_WATCHDOG_MIN_MISMATCH_FRAMES = 8;
const RETUNE_WATCHDOG_RESEND_MS = 1000;
let lastFrequencyRangeRequest: {
  data: any;
  centerHz: number;
  requestedAt: number;
  lastResendAt: number;
  mismatchFrames: number;
} | null = null;
let lastFrequencyRangeSendKey: string | null = null;
let lastFrequencyRangeSendAt = 0;

/**
 * Channel metadata describes the backend's default window, not the user's
 * current viewport. Keep an entered range while a source switch republishes
 * its channel list; the store's source-scoped restoration handles the target
 * source's saved view when the handoff completes.
 */
export const resolveIncomingChannelsFrequencyRange = (
  currentRange: { min: number; max: number } | null | undefined,
  incomingRange: { min: number; max: number },
): { min: number; max: number } => currentRange ?? incomingRange;

const roundHzField = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric);
};

export const normalizeFrequencyRangeMessageData = (
  type: string,
  data: any,
): any => {
  if (type !== "frequency_range" && type !== "set_frequency_range") {
    return data;
  }

  const normalized = { ...data };
  const integerFields = [
    "min_hz",
    "max_hz",
    "min_freq",
    "max_freq",
    "center_frequency",
    "bandwidth_center_frequency",
  ] as const;

  for (const field of integerFields) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      const rounded = roundHzField(normalized[field]);
      if (rounded === undefined) {
        delete normalized[field];
      } else {
        normalized[field] = rounded;
      }
    }
  }

  return normalized;
};

export const collapsePausedFrameBatch = <T>(data: T | T[]): T => {
  return Array.isArray(data) ? data[data.length - 1] : data;
};

export const trimLiveFrameQueue = <T>(frames: T[]): T[] => {
  return frames.length > MAX_RETAINED_LIVE_FRAMES
    ? frames.slice(-MAX_RETAINED_LIVE_FRAMES)
    : frames;
};

const trimPendingDataUpdate = () => {
  if (Array.isArray(pendingDataUpdate)) {
    pendingDataUpdate = trimLiveFrameQueue(pendingDataUpdate);
  }
};

export const shouldAcceptPausedFrameRequest = (): boolean => {
  if (pausedFrameRequestInFlight) {
    return false;
  }
  pausedFrameRequestInFlight = true;
  return true;
};

export const resetPausedFrameRequestGate = (): void => {
  pausedFrameRequestInFlight = false;
};

export const resetWebSocketMiddlewareState = (): void => {
  requestedSourceId = null;
  lastSettingsRequest = null;
  lastFrequencyRangeRequest = null;
  lastFrequencyRangeSendKey = null;
  lastFrequencyRangeSendAt = 0;
  pendingDataUpdate = null;
  pendingStatusUpdates = null;
  liveDataRef.current = null;
  demodFrameQueue.clear();
  liveDataBySourceRef.current = {};
  sourceVisualizationRuntime.clear();
  cachedRxFrameBySourceId.clear();
  presentationController.reset();
  managedRxSubscription?.unsubscribe();
  managedTxSubscription?.unsubscribe();
  managedRxSubscription = null;
  managedTxSubscription = null;
  managedRxSourceId = null;
  managedTxSourceId = null;
  managedRxSubscribePending = false;
  managedTxSubscribePending = false;
  pendingManagedTxOptions = null;
  sourceModeStreamManager?.dispose();
  sourceModeStreamManager = null;
  multiplexedStreamTransport?.dispose();
  multiplexedStreamTransport = null;
  resetPausedFrameRequestGate();
  if (dataBatchFrame !== null) {
    cancelAnimationFrame(dataBatchFrame);
    dataBatchFrame = null;
  }
  if (statusBatchFrame !== null) {
    cancelAnimationFrame(statusBatchFrame);
    statusBatchFrame = null;
  }
  if (wsInstance.ws) {
    wsInstance.ws.onclose = null;
    wsInstance.ws.onerror = null;
    wsInstance.ws.onmessage = null;
    wsInstance.ws.onopen = null;
    wsInstance.ws = null;
  }
  if (wsInstance.reconnectTimeout !== null) {
    clearTimeout(wsInstance.reconnectTimeout);
    wsInstance.reconnectTimeout = null;
  }
  if (wsInstance.disconnectTimeout !== null) {
    clearTimeout(wsInstance.disconnectTimeout);
    wsInstance.disconnectTimeout = null;
  }
  wsInstance.reconnectTimeout = null;
  wsInstance.disconnectTimeout = null;
  wsInstance.reconnectAttempts = 0;
  wsInstance.url = "";
  wsInstance.aesKey = null;
  wsInstance.enabled = false;
  wsInstance.disposed = false;
};

// Process batched data updates — writes directly to liveDataRef, no Redux dispatch.
// The presentation controller shadows all frame acceptance decisions; the legacy
// liveDataRef path is preserved until canvas consumers migrate in Phase 5.
const processBatchedData = (dispatch: Dispatch, getState: () => any) => {
  if (pendingDataUpdate !== null) {
    const state = getState();
    const isPaused = state.websocket.isPaused;
    const sourceMode = state.waterfall?.sourceMode;
    const isFileSource = sourceMode === "file";
    const activeSourceId = state.websocket.activeSourceId;
    const activeSource = (state.websocket.sources ?? []).find(
      (source: SourceInfo) => source.id === activeSourceId,
    );
    const boundTxSourceId =
      state.sourceRouting?.bindings?.["tx-suite:tx"] ?? null;
    const selectedSourceId = state.sourceSelection?.selectedSourceId || null;
    const selectedSource = (state.websocket.sources ?? []).find(
      (source: SourceInfo) => source.id === selectedSourceId,
    );
    const selectedSourceMode = selectedSource
      ? resolveSourceModeManagement({
          source: selectedSource,
          txBindingSourceId: boundTxSourceId,
        })
      : null;
    // A source can be selected for presentation before the backend commits it
    // as active. Tx is the important case here: a duplex/secondary Tx stream
    // may continue producing standby frames while the active source remains
    // the RX source. Those frames must feed the selected Tx canvas, but must
    // not leak into an unrelated RX presentation.
    const selectedTxPresentationSourceId =
      selectedSourceMode?.isTxMode === true ? selectedSourceId : null;
    const activeSourceStatus =
      state.websocket.sourceStatuses?.[activeSourceId] ?? activeSource?.status;
    const selectedTxPresentationStatus = selectedTxPresentationSourceId
      ? (state.websocket.sourceStatuses?.[selectedTxPresentationSourceId] ??
        selectedSource?.status)
      : null;
    const isSelectedTxPresentationTransmitting =
      selectedTxPresentationStatus === "transmitting";
    const isSelectedTxPresentationStandby =
      selectedTxPresentationSourceId !== null &&
      !isSelectedTxPresentationTransmitting;
    const isActiveMockTxMonitor = isMockTxSource({
      id: activeSource?.id ?? activeSourceId,
      kind: activeSource?.kind,
    });
    const isActiveTxMonitorTransmitting =
      (activeSource?.capabilities?.supports_tx_monitor === true ||
        isActiveMockTxMonitor) &&
      activeSourceStatus === "transmitting";
    const isActiveTxMonitorStandby =
      (activeSource?.capabilities?.supports_tx_monitor === true ||
        isActiveMockTxMonitor) &&
      !isActiveTxMonitorTransmitting;
    const isActiveBoundTxPreviewStandby = isBoundTxPreviewStandby({
      activeSourceId,
      boundTxSourceId: state.sourceRouting?.bindings?.["tx-suite:tx"],
      sourceStatus: activeSourceStatus ?? null,
    });
    const isActiveTxPreviewBinding =
      !!activeSourceId && boundTxSourceId === activeSourceId;
    const isTxPresentationFrame = (frame: any): boolean =>
      frame?.frame_status === "standby" ||
      frame?.frame_status === "transmitting" ||
      frame?.is_tx_preview === true ||
      frame?.is_mock_tx_preview === true;
    const isActiveTxPresentation =
      activeSourceStatus === "standby" ||
      activeSourceStatus === "transmitting" ||
      isActiveTxPreviewBinding ||
      (selectedTxPresentationSourceId !== null &&
        (requestedSourceId === null ||
          requestedSourceId === selectedTxPresentationSourceId)) ||
      (isActiveMockTxMonitor &&
        activeSourceStatus !== "paused" &&
        activeSourceStatus !== "receiving");
    const frames = Array.isArray(pendingDataUpdate)
      ? pendingDataUpdate
      : [pendingDataUpdate];
    for (const frame of frames) {
      const sourceId = frame?.source_id;
      if (typeof sourceId === "string" && sourceId.length > 0) {
        if (
          sourceId === activeSourceId &&
          !isTxPresentationFrame(frame) &&
          !isBoundTxPreviewStandby({
            activeSourceId,
            boundTxSourceId: state.sourceRouting?.bindings?.["tx-suite:tx"],
            sourceStatus: activeSourceStatus ?? null,
          }) &&
          activeSourceStatus !== "transmitting"
        ) {
          cachedRxFrameBySourceId.set(sourceId, frame);
        }
        if (sourceVisualizationRuntime.publish(frame)) {
          liveDataBySourceRef.current[sourceId] =
            sourceVisualizationRuntime.getSourceRef(sourceId);
        }
        // Feed the unified presentation controller — per-source, per-mode
        presentationController.acceptFrame(frame);
      }
    }
    // Per-source refs retain their own latest frames for secondary previews,
    // but only the source currently being presented may enter the shared
    // FFT/Waterfall ref. During a handoff, requestedSourceId closes the gap
    // before the backend commits activeSourceId.
    const presentationSourceId =
      requestedSourceId ?? selectedTxPresentationSourceId ?? activeSourceId;
    const presentationFrames = filterLiveFramesForSource(
      frames,
      presentationSourceId,
      // Mock Tx preview frames can still arrive through the legacy control
      // path without a source tag; hardware handoffs must remain strict.
      isActiveMockTxMonitor && requestedSourceId === null,
    ).filter(
      (frame: any) => !isTxPresentationFrame(frame) || isActiveTxPresentation,
    );
    const readinessFrame = presentationFrames.find(
      (frame: any) =>
        frame?.source_id === activeSourceId &&
        typeof frame?.sequence === "number",
    );
    const currentReadiness = state.websocket.sourceFrameReadiness;
    if (
      readinessFrame &&
      !isFileSource &&
      (!currentReadiness ||
        currentReadiness.sourceId !== readinessFrame.source_id ||
        currentReadiness.streamEpoch !==
          (typeof readinessFrame.stream_epoch === "number"
            ? readinessFrame.stream_epoch
            : null))
    ) {
      dispatch(
        updateDeviceState({
          sourceFrameReadiness: {
            sourceId: readinessFrame.source_id,
            streamEpoch:
              typeof readinessFrame.stream_epoch === "number"
                ? readinessFrame.stream_epoch
                : null,
            sequence: readinessFrame.sequence,
          },
        }),
      );
    }
    const hasTxPreviewFrame = presentationFrames.some(
      (f: any) =>
        f?.frame_status === "standby" ||
        f?.is_tx_preview === true ||
        f?.is_mock_tx_preview === true,
    );
    const shouldAcceptPausedFrame = hasTxPreviewFrame || false;

    if (
      presentationFrames.length > 0 &&
      ((!isPaused &&
        !isActiveTxMonitorStandby &&
        !isActiveBoundTxPreviewStandby &&
        !isSelectedTxPresentationStandby) ||
        shouldAcceptPausedFrame ||
        isActiveTxMonitorTransmitting) &&
      !isFileSource
    ) {
      if (
        (isPaused ||
          isActiveTxMonitorStandby ||
          isActiveBoundTxPreviewStandby ||
          isSelectedTxPresentationStandby) &&
        (shouldAcceptPausedFrame || hasTxPreviewFrame) &&
        !isActiveTxMonitorTransmitting &&
        !isSelectedTxPresentationTransmitting
      ) {
        const framesToUse = hasTxPreviewFrame
          ? presentationFrames.filter(
              (f: any) =>
                f?.frame_status === "standby" ||
                f?.is_tx_preview === true ||
                f?.is_mock_tx_preview === true,
            )
          : presentationFrames;
        liveDataRef.current = collapsePausedFrameBatch(framesToUse);
        // A requested untagged standby frame is still a one-frame response.
        // Consume the request regardless of whether the backend tagged it as
        // a Tx preview; otherwise the next frame can replace the preview.
        resetPausedFrameRequestGate();
      } else {
        if (Array.isArray(liveDataRef.current)) {
          liveDataRef.current.push(...presentationFrames);
        } else if (liveDataRef.current) {
          liveDataRef.current = [liveDataRef.current, ...presentationFrames];
        } else {
          liveDataRef.current = [...presentationFrames];
        }
        resetPausedFrameRequestGate();
      }
      if (Array.isArray(liveDataRef.current)) {
        liveDataRef.current = trimLiveFrameQueue(liveDataRef.current);
      }
    }
    pendingDataUpdate = null;
  }
  dataBatchFrame = null;
};

const processBatchedStatus = (dispatch: Dispatch, getState: () => any) => {
  if (pendingStatusUpdates !== null) {
    const websocketState = getState().websocket;
    const hasChanges = Object.entries(pendingStatusUpdates).some(
      ([key, value]) => {
        return !equalValue(websocketState[key], value);
      },
    );
    if (hasChanges) {
      dispatch(updateDeviceState(pendingStatusUpdates));
    }
    pendingStatusUpdates = null;
  }
  syncManagedStreamSubscriptions(dispatch, getState);
  statusBatchFrame = null;
};

const applyStatusUpdates = (
  dispatch: Dispatch,
  getState: () => any,
  updates: Record<string, unknown>,
) => {
  const websocketState = getState().websocket;
  const hasChanges = Object.entries(updates).some(([key, value]) => {
    return !equalValue(websocketState[key], value);
  });
  if (hasChanges) {
    dispatch(updateDeviceState(updates));
  }
  syncManagedStreamSubscriptions(dispatch, getState);
};

const getPausedValue = (payload: unknown): boolean | null => {
  if (typeof payload === "boolean") {
    return payload;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "isPaused" in payload &&
    typeof (payload as { isPaused?: unknown }).isPaused === "boolean"
  ) {
    return (payload as { isPaused: boolean }).isPaused;
  }

  return null;
};

const getPauseDuplexMode = (payload: unknown): string | null => {
  if (
    payload &&
    typeof payload === "object" &&
    "duplexMode" in payload &&
    typeof (payload as { duplexMode?: unknown }).duplexMode === "string" &&
    (payload as { duplexMode: string }).duplexMode.trim().length > 0
  ) {
    return (payload as { duplexMode: string }).duplexMode;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "duplex_mode" in payload &&
    typeof (payload as { duplex_mode?: unknown }).duplex_mode === "string" &&
    (payload as { duplex_mode: string }).duplex_mode.trim().length > 0
  ) {
    return (payload as { duplex_mode: string }).duplex_mode;
  }

  return null;
};

const getPauseSourceId = (payload: unknown): string | null => {
  if (
    payload &&
    typeof payload === "object" &&
    "sourceId" in payload &&
    typeof (payload as { sourceId?: unknown }).sourceId === "string" &&
    (payload as { sourceId: string }).sourceId.trim().length > 0
  ) {
    return (payload as { sourceId: string }).sourceId;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "source_id" in payload &&
    typeof (payload as { source_id?: unknown }).source_id === "string" &&
    (payload as { source_id: string }).source_id.trim().length > 0
  ) {
    return (payload as { source_id: string }).source_id;
  }

  return null;
};

export const isFrameStale = (_centerFrequencyHz: number): boolean => false;

export const getFrequencyRequestCenterHz = (
  type: string,
  data: any,
): number | null => {
  if (type !== "frequency_range" && type !== "set_frequency_range") {
    return null;
  }

  const explicitCenter = Number(data?.center_frequency);
  if (Number.isFinite(explicitCenter) && explicitCenter > 0) {
    return explicitCenter;
  }

  const minHz = Number(data?.min_hz ?? data?.min_freq);
  const maxHz = Number(data?.max_hz ?? data?.max_freq);
  if (Number.isFinite(minHz) && Number.isFinite(maxHz) && maxHz >= minHz) {
    return (minHz + maxHz) / 2;
  }

  return null;
};

export const shouldResendRetuneRequest = ({
  expectedCenterHz,
  frameCenterHz,
  requestedAt,
  lastResendAt,
  mismatchFrames,
  now,
}: {
  expectedCenterHz: number;
  frameCenterHz: number;
  requestedAt: number;
  lastResendAt: number;
  mismatchFrames: number;
  now: number;
}): boolean => {
  if (
    Math.abs(frameCenterHz - expectedCenterHz) <= RETUNE_CENTER_TOLERANCE_HZ
  ) {
    return false;
  }
  if (now - requestedAt < RETUNE_WATCHDOG_GRACE_MS) {
    return false;
  }
  if (mismatchFrames < RETUNE_WATCHDOG_MIN_MISMATCH_FRAMES) {
    return false;
  }
  return now - lastResendAt >= RETUNE_WATCHDOG_RESEND_MS;
};

const trackFrequencyRangeRequest = (type: string, data: any) => {
  const centerHz = getFrequencyRequestCenterHz(type, data);
  if (centerHz === null) return;

  const requestKey = JSON.stringify({
    type,
    centerHz,
    min_hz: Number(data?.min_hz ?? data?.min_freq ?? null),
    max_hz: Number(data?.max_hz ?? data?.max_freq ?? null),
    bandwidth_center_frequency: Number(
      data?.bandwidth_center_frequency ?? null,
    ),
  });

  const now = Date.now();
  if (
    lastFrequencyRangeSendKey === requestKey &&
    now - lastFrequencyRangeSendAt < DUPLICATE_FREQUENCY_RANGE_SUPPRESSION_MS
  ) {
    return;
  }
  lastFrequencyRangeSendKey = requestKey;
  lastFrequencyRangeSendAt = now;

  lastFrequencyRangeRequest = {
    data,
    centerHz,
    requestedAt: Date.now(),
    lastResendAt: 0,
    mismatchFrames: 0,
  };
};

const getPersistedActiveSignalArea = (sourceId: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const trimmed = sourceId?.trim();
    const scope = trimmed ? trimmed : "default";
    const key = `napt-spectrum-view-v1:${scope}`;
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed?.activeSignalArea ?? null;
    }
  } catch (e) {
    // Ignore
  }
  return null;
};

const shouldSuppressDuplicateFrequencyRangeSend = (
  type: string,
  data: any,
): boolean => {
  if (type !== "frequency_range" && type !== "set_frequency_range") {
    return false;
  }

  const requestKey = JSON.stringify({
    type,
    centerHz: getFrequencyRequestCenterHz(type, data),
    min_hz: Number(data?.min_hz ?? data?.min_freq ?? null),
    max_hz: Number(data?.max_hz ?? data?.max_freq ?? null),
    bandwidth_center_frequency: Number(
      data?.bandwidth_center_frequency ?? null,
    ),
  });

  const now = Date.now();
  if (
    lastFrequencyRangeSendKey === requestKey &&
    now - lastFrequencyRangeSendAt < DUPLICATE_FREQUENCY_RANGE_SUPPRESSION_MS
  ) {
    return true;
  }

  lastFrequencyRangeSendKey = requestKey;
  lastFrequencyRangeSendAt = now;
  return false;
};

const shouldClearStaleSpectrumFrames = (
  deviceState: DeviceState | null | undefined,
): boolean => deviceState === "disconnected";

const clearLiveSpectrumFrames = (dispatch: Dispatch) => {
  liveDataRef.current = null;
  demodFrameQueue.clear();
  dispatch(setSpectrumFrames([]));
};

const checkRetuneWatchdog = (frameCenterHz: number) => {
  const request = lastFrequencyRangeRequest;
  if (!request || !Number.isFinite(frameCenterHz)) return;

  if (
    Math.abs(frameCenterHz - request.centerHz) <= RETUNE_CENTER_TOLERANCE_HZ
  ) {
    lastFrequencyRangeRequest = null;
    return;
  }

  request.mismatchFrames += 1;
  const now = Date.now();
  if (
    shouldResendRetuneRequest({
      expectedCenterHz: request.centerHz,
      frameCenterHz,
      requestedAt: request.requestedAt,
      lastResendAt: request.lastResendAt,
      mismatchFrames: request.mismatchFrames,
      now,
    }) &&
    wsInstance.ws &&
    wsInstance.ws.readyState === WebSocket.OPEN
  ) {
    wsInstance.ws.send(
      JSON.stringify({ type: "frequency_range", ...request.data }),
    );
    request.lastResendAt = now;
  }
};

const queueLiveData = (data: any, dispatch: Dispatch, getState: () => any) => {
  const centerFrequencyHz = data?.center_frequency_hz;
  if (typeof centerFrequencyHz === "number") {
    checkRetuneWatchdog(centerFrequencyHz);
  }
  if (
    typeof centerFrequencyHz === "number" &&
    isFrameStale(centerFrequencyHz)
  ) {
    return;
  }

  // Keep demodulation independent from the one-frame visualizer retention
  // policy below. Audio processing may poll less often than requestAnimationFrame,
  // so dropping frames here creates audible gaps even when the visualizer is smooth.
  if (isDemodEligibleLiveFrame(data)) {
    demodFrameQueue.push([data]);
  }

  if (pendingDataUpdate === null) {
    pendingDataUpdate = [data];
  } else {
    pendingDataUpdate.push(data);
    trimPendingDataUpdate();
  }

  if (dataBatchFrame === null) {
    dataBatchFrame = window.requestAnimationFrame(() =>
      processBatchedData(dispatch, getState),
    );
  }
};

export const __testQueueLiveDataForMiddleware = (
  data: any,
  dispatch: Dispatch,
  getState: () => any,
) => {
  queueLiveData(data, dispatch, getState);
};

const sourceCenterFrequencyHz = (state: any): number => {
  const range = state.spectrum?.frequencyRange;
  if (
    range &&
    typeof range.min === "number" &&
    typeof range.max === "number" &&
    range.max > range.min
  ) {
    return (range.min + range.max) / 2;
  }
  return Number(state.spectrum?.frequency ?? 0);
};

const buildManagedRxOptions = (
  state: any,
  source: SourceInfo,
): StreamOptions => {
  const settings = source.sdr?.settings ?? {};
  return {
    mode: "rx",
    centerFrequencyHz: sourceCenterFrequencyHz(state),
    sampleRateHz: Number(
      settings.sample_rate ?? state.spectrum?.sampleRateHz ?? 1,
    ),
    fftSize: Number(settings.fft_size ?? state.spectrum?.fftSize ?? 1024),
    fftWindow: settings.fft_window ?? state.spectrum?.fftWindow,
    frameRate: settings.frame_rate ?? state.spectrum?.fftFrameRate,
    gain:
      typeof settings.gain === "number"
        ? settings.gain
        : settings.gain?.tuner_gain,
  };
};

const buildManagedTxOptions = (
  state: any,
  overrides: Record<string, unknown> = {},
): StreamOptions => ({
  mode: "tx",
  centerFrequencyHz: Number(
    overrides.centerFrequencyHz ?? state.spectrum?.txCenterFrequencyHz ?? 0,
  ),
  sampleRateHz: Number(
    overrides.sampleRateHz ??
      overrides.sample_rate ??
      state.spectrum?.txSampleRateHz ??
      1,
  ),
  bandwidthHz: Number(
    overrides.bandwidthHz ?? state.spectrum?.txSampleRateHz ?? 1,
  ),
  signal: String(overrides.txSignal ?? state.spectrum?.txSignal ?? "wifi"),
  powerDbm: Number(overrides.powerDbm ?? state.spectrum?.txPowerDbm ?? 0),
  ifftSize: Number(overrides.txIfftSize ?? state.spectrum?.txIfftSize ?? 1024),
});

/**
 * The manager's tx stream carries the generated waveform in both standby and
 * transmitting states. Legacy frame gating uses the explicit preview marker
 * to admit a standby frame, so derive that presentation metadata from the
 * current source state without generating or copying a second IQ payload.
 */
export const normalizeManagedStreamFrame = ({
  frame,
  mode,
  sourceStatus,
}: {
  frame: IqRawFrame;
  mode: "rx" | "tx";
  sourceStatus: SourceInfo["status"];
}): IqRawFrame => {
  if (mode !== "tx" || sourceStatus === "transmitting") return frame;
  return {
    ...frame,
    frame_status: "standby",
    is_tx_preview: true,
    is_mock_tx_preview: true,
  };
};

/**
 * Managed Tx subscriptions deliver both continuous transmit frames and
 * request-driven Mock Tx standby previews. Continuous monitor playback stays
 * gated on the backend; standby only publishes when request_next_frame fires.
 */
export const resolveManagedTxSourceId = (state: any): string | null => {
  const sources: SourceInfo[] = state.sources ?? [];
  const sourceStatuses = state.sourceStatuses ?? {};
  const selectedSourceId =
    (typeof state.sourceSelection?.selectedSourceId === "string" &&
      state.sourceSelection.selectedSourceId) ||
    null;
  const isTxCapable = (source: SourceInfo | undefined): boolean =>
    !!source &&
    (source.capability === "tx" ||
      source.capability === "tx_rx" ||
      source.kind === "mock_tx" ||
      source.id === "mock-tx");
  const isTransmittingTxSource = (source: SourceInfo | undefined): boolean => {
    if (!isTxCapable(source)) return false;
    const status = sourceStatuses[source!.id] ?? source!.status;
    return status === "transmitting";
  };
  const isStandbyPreviewTxSource = (
    source: SourceInfo | undefined,
  ): boolean => {
    if (!isTxCapable(source)) return false;
    const status = sourceStatuses[source!.id] ?? source!.status;
    return (
      status !== "transmitting" &&
      isSourceStreamAvailable(status) &&
      (source!.id === "mock-tx" || source!.kind === "mock_tx")
    );
  };

  const boundSourceId = state.sourceRouting?.bindings?.["tx-suite:tx"];
  if (typeof boundSourceId === "string" && boundSourceId.length > 0) {
    const boundSource = sources.find((source) => source.id === boundSourceId);
    if (isTransmittingTxSource(boundSource)) {
      return boundSourceId;
    }
  }

  const selectedSource = sources.find(
    (source: SourceInfo) => source.id === selectedSourceId,
  );
  if (isStandbyPreviewTxSource(selectedSource)) {
    return selectedSource!.id;
  }

  const activeSource = sources.find(
    (source: SourceInfo) => source.id === state.activeSourceId,
  );
  if (isTransmittingTxSource(activeSource)) {
    return activeSource!.id;
  }
  if (isStandbyPreviewTxSource(activeSource)) {
    return activeSource!.id;
  }
  return null;
};

const handleManagedStreamEvent = (
  sourceId: string,
  mode: "rx" | "tx",
  event: import("@n-apt/app/infrastructure/streams/sourceModeStreamManager").StreamEvent,
  dispatch: Dispatch,
  getState: () => any,
): void => {
  if (event.type === "stream_frame") {
    const state = getState().websocket;
    const source = (state.sources ?? []).find(
      (candidate: SourceInfo) => candidate.id === sourceId,
    );
    const sourceStatus =
      state.sourceStatuses?.[sourceId] ?? source?.status ?? null;
    queueLiveData(
      normalizeManagedStreamFrame({
        frame: event.frame,
        mode,
        sourceStatus,
      }),
      dispatch,
      getState,
    );
  } else if (event.type === "stream_error") {
    dispatch(setOperationalError(event.message));
  } else if (
    mode === "rx" &&
    (event.type === "stream_opened" || event.type === "stream_state") &&
    getState().websocket.activeSourceId === sourceId
  ) {
    const phase =
      event.state === "unavailable"
        ? "failed"
        : event.state === "opening"
          ? "warming"
          : "ready";
    publishSourceTransport(
      dispatch,
      getState,
      sourceId,
      phase,
      event.reason ?? null,
      phase === "failed",
    );
  }
};

const isCurrentManagedRxTarget = (
  rootState: any,
  sourceId: string,
): boolean => {
  const state = rootState.websocket ?? rootState;
  const source = (state.sources ?? []).find(
    (candidate: SourceInfo) => candidate.id === sourceId,
  );
  return (
    state.activeSourceId === sourceId &&
    source.capabilities?.can_receive !== false &&
    !!source?.iq_format &&
    isSourceStreamAvailable(source.status)
  );
};

const isCurrentManagedTxTarget = (
  rootState: any,
  sourceId: string,
): boolean => {
  const state = rootState.websocket ?? rootState;
  const source = (state.sources ?? []).find(
    (candidate: SourceInfo) => candidate.id === sourceId,
  );
  const resolvedSourceId = resolveManagedTxSourceId({
    ...state,
    sourceRouting: rootState.sourceRouting ?? state.sourceRouting,
    sourceSelection: rootState.sourceSelection ?? state.sourceSelection,
  });
  const status = state.sourceStatuses?.[sourceId] ?? source?.status;
  return (
    resolvedSourceId === sourceId &&
    !!source &&
    (source.capability === "tx" ||
      source.capability === "tx_rx" ||
      source.kind === "mock_tx" ||
      source.id === "mock-tx") &&
    isSourceStreamAvailable(status)
  );
};

const syncManagedStreamSubscriptions = (
  dispatch: Dispatch,
  getState: () => any,
): void => {
  if (!sourceModeStreamManager) return;
  if (wsInstance.ws?.readyState !== WebSocket.OPEN) return;
  const state = getState().websocket;
  const activeSource = (state.sources ?? []).find(
    (source: SourceInfo) => source.id === state.activeSourceId,
  );
  const wantsRx =
    !!activeSource?.iq_format &&
    activeSource.capabilities?.can_receive !== false &&
    isSourceStreamAvailable(activeSource.status);
  const rxSourceId = wantsRx ? activeSource.id : null;
  if (managedRxSourceId !== rxSourceId) {
    managedRxSubscription?.unsubscribe();
    managedRxSubscription = null;
    managedRxSourceId = null;
  }
  if (
    rxSourceId &&
    activeSource &&
    !managedRxSubscription &&
    !managedRxSubscribePending
  ) {
    managedRxSubscribePending = true;
    const key = { sourceId: rxSourceId, mode: "rx" as const };
    void sourceModeStreamManager
      .subscribe(
        key,
        buildManagedRxOptions(getState(), activeSource),
        (event) =>
          handleManagedStreamEvent(rxSourceId, "rx", event, dispatch, getState),
      )
      .then((subscription) => {
        managedRxSubscribePending = false;
        if (!isCurrentManagedRxTarget(getState(), rxSourceId)) {
          subscription.unsubscribe();
          return;
        }
        managedRxSubscription = subscription;
        managedRxSourceId = rxSourceId;
        syncManagedStreamSubscriptions(dispatch, getState);
      })
      .catch((error: unknown) => {
        managedRxSubscribePending = false;
        dispatch(
          setOperationalError(
            error instanceof Error ? error.message : String(error),
          ),
        );
      });
  } else if (managedRxSubscription && activeSource) {
    void managedRxSubscription.updateOptions(
      buildManagedRxOptions(getState(), activeSource),
    );
  }
  // A source handoff can commit after the stream acknowledgement. In that
  // ordering the stream_opened event was intentionally ignored while the old
  // source was still active, leaving the transport stuck at warming even
  // though the manager has a real epoch and is delivering frames.
  if (
    managedRxSubscription &&
    activeSource?.id === rxSourceId &&
    managedRxSubscription.streamEpoch > 0 &&
    (getState().websocket.sourceTransport?.sourceId !== rxSourceId ||
      getState().websocket.sourceTransport?.phase !== "ready")
  ) {
    publishSourceTransport(dispatch, getState, rxSourceId, "ready");
  }

  const txSourceId = resolveManagedTxSourceId({
    ...state,
    sourceRouting: getState().sourceRouting,
    sourceSelection: getState().sourceSelection,
  });
  const txSource = (state.sources ?? []).find(
    (source: SourceInfo) => source.id === txSourceId,
  );
  const txStatus =
    (txSourceId && state.sourceStatuses?.[txSourceId]) || txSource?.status;
  const wantsTx =
    !!txSource &&
    (txSource.capability === "tx" ||
      txSource.capability === "tx_rx" ||
      txSource.kind === "mock_tx" ||
      txSource.id === "mock-tx") &&
    isSourceStreamAvailable(txStatus);
  if (!wantsTx || !txSourceId) {
    managedTxSubscription?.unsubscribe();
    managedTxSubscription = null;
    managedTxSourceId = null;
  } else if (managedTxSourceId !== txSourceId) {
    managedTxSubscription?.unsubscribe();
    managedTxSubscription = null;
    managedTxSourceId = null;
  }
  if (
    wantsTx &&
    txSourceId &&
    !managedTxSubscription &&
    !managedTxSubscribePending
  ) {
    managedTxSubscribePending = true;
    const key = { sourceId: txSourceId, mode: "tx" as const };
    const txOptions =
      pendingManagedTxOptions ?? buildManagedTxOptions(getState());
    void sourceModeStreamManager
      .subscribe(key, txOptions, (event) =>
        handleManagedStreamEvent(txSourceId, "tx", event, dispatch, getState),
      )
      .then((subscription) => {
        managedTxSubscribePending = false;
        if (!isCurrentManagedTxTarget(getState(), txSourceId)) {
          subscription.unsubscribe();
          return;
        }
        managedTxSubscription = subscription;
        managedTxSourceId = txSourceId;
        pendingManagedTxOptions = null;
        syncManagedStreamSubscriptions(dispatch, getState);
      })
      .catch((error: unknown) => {
        managedTxSubscribePending = false;
        dispatch(
          setOperationalError(
            error instanceof Error ? error.message : String(error),
          ),
        );
      });
  } else if (managedTxSubscription) {
    void managedTxSubscription.updateOptions(
      pendingManagedTxOptions ?? buildManagedTxOptions(getState()),
    );
    pendingManagedTxOptions = null;
  }
  if (
    managedTxSubscription &&
    activeSource?.id === txSourceId &&
    managedTxSubscription.streamEpoch > 0 &&
    (getState().websocket.sourceTransport?.sourceId !== txSourceId ||
      getState().websocket.sourceTransport?.phase !== "ready")
  ) {
    publishSourceTransport(dispatch, getState, txSourceId!, "ready");
  }
};

const MANAGED_STREAM_OPTION_ACTIONS = new Set([
  "spectrum/setTxGeometry",
  "spectrum/setTxCenterFrequencyHz",
  "spectrum/setTxSampleRateHz",
  "spectrum/setTxSignal",
  "spectrum/setTxPowerDbm",
  "spectrum/setTxIfftSize",
  "spectrum/setTxViewerSampleRateHz",
  "sourceRouting/setSourceBinding",
  "sourceRouting/setSourceBindings",
]);

export const shouldSyncManagedStreamOptions = (type: string): boolean =>
  MANAGED_STREAM_OPTION_ACTIONS.has(type);

const sameAesKeyReference = (
  current: CryptoKey | null,
  next: CryptoKey | null,
): boolean => current === next;

const resetManagedStreamPipeline = (recreate: boolean): void => {
  managedRxSubscription?.unsubscribe();
  managedTxSubscription?.unsubscribe();
  managedRxSubscription = null;
  managedTxSubscription = null;
  managedRxSourceId = null;
  managedTxSourceId = null;
  managedRxSubscribePending = false;
  managedTxSubscribePending = false;
  sourceModeStreamManager?.dispose();
  sourceModeStreamManager = null;
  multiplexedStreamTransport?.dispose();
  multiplexedStreamTransport = null;
  presentationController.reset();

  if (recreate && wsInstance.enabled && wsInstance.url && wsInstance.aesKey) {
    multiplexedStreamTransport = createMultiplexedStreamTransport({
      url: wsInstance.url,
      aesKey: wsInstance.aesKey,
    });
    sourceModeStreamManager = createSourceModeStreamManager({
      transportFactory: multiplexedStreamTransport.transportFactory,
    });
  }
};

const cleanupSocket = () => {
  requestedSourceId = null;
  if (wsInstance.reconnectTimeout) {
    clearTimeout(wsInstance.reconnectTimeout);
    wsInstance.reconnectTimeout = null;
  }

  if (wsInstance.ws) {
    wsInstance.ws.onclose = null;
    wsInstance.ws.onerror = null;
    wsInstance.ws.onmessage = null;
    wsInstance.ws.onopen = null;
    wsInstance.ws.close();
    wsInstance.ws = null;
  }
  resetManagedStreamPipeline(false);

  lastFrequencyRangeSendKey = null;
  lastFrequencyRangeSendAt = 0;
  lastFrequencyRangeRequest = null;
  pendingDataUpdate = null;
  pendingStatusUpdates = null;
  liveDataRef.current = null;
  demodFrameQueue.clear();
  wsInstance.disposed = true;
};

export const resolveTxPreviewSourceId = (state: any): string | null => {
  const boundSourceId = state.sourceRouting?.bindings?.["tx-suite:tx"];
  if (typeof boundSourceId === "string" && boundSourceId.length > 0) {
    return boundSourceId;
  }
  const activeSource = (state.sources ?? []).find(
    (source: SourceInfo) => source.id === state.activeSourceId,
  );
  if (!activeSource) return null;
  const mode = resolveSourceModeManagement({ source: activeSource });
  return mode.shouldRequestTxPreview ? activeSource.id : null;
};

/** Apply the local Tx-preview state before the backend status round trip. */
export const applyOptimisticTxPreviewState = (
  sources: SourceInfo[],
  sourceId: string | null,
): SourceInfo[] => {
  if (!sourceId) return sources;
  return sources.map((source) =>
    source.id === sourceId
      ? { ...source, status: "standby", paused: true }
      : source,
  );
};

const clearTxPreviewFrames = (
  getState: () => any,
  sourceIdOverride?: string | null,
) => {
  const state = getState().websocket;
  const txSourceId =
    sourceIdOverride ??
    resolveTxPreviewSourceId({
      ...state,
      sourceRouting: getState().sourceRouting,
    });
  if (!txSourceId) return;

  sourceVisualizationRuntime.reset(txSourceId);
  sourceSpectrumRuntime.reset(txSourceId);
  const sourceRef = sourceVisualizationRuntime.getSourceRef(txSourceId);
  const cachedRxFrame = resolveRxFrameToRestore(
    cachedRxFrameBySourceId.get(txSourceId),
    txSourceId,
  );
  sourceRef.current = cachedRxFrame;
  liveDataBySourceRef.current[txSourceId] = sourceRef;
  cachedRxFrameBySourceId.delete(txSourceId);
  if (txSourceId === state.activeSourceId) {
    liveDataRef.current = cachedRxFrame;
  }
};

/**
 * Do not create a new raw-I/Q transport while the device is recovering.
 *
 * The control socket remains the lifecycle owner and continues to report
 * hotplug status. During USB recovery the raw stream may close, but opening a
 * replacement every retry interval only creates a socket storm and can make
 * the first post-reconnect payload miss the renderer. An already-open socket
 * is intentionally allowed to remain warm; this gate only applies to new
 * sockets.
 */
/** Publishes only transport boundary changes; raw frame traffic never enters Redux. */
const publishSourceTransport = (
  dispatch: Dispatch,
  getState: () => any,
  sourceId: string,
  phase: "warming" | "ready" | "failed",
  error: string | null = null,
  replaceFailure = false,
) => {
  const current = getState().websocket.sourceTransport;
  if (
    !replaceFailure &&
    current?.phase === "failed" &&
    current.sourceId !== sourceId
  ) {
    return;
  }
  const nextTransport = { sourceId, phase, error };
  if (!equalValue(current, nextTransport)) {
    dispatch(updateDeviceState({ sourceTransport: nextTransport }));
  }
};

/** Announce the Tx mode boundary without enabling RF transmission. */
const announceTxStandbyForSource = (
  sourceId: string | null | undefined,
  getState: () => any,
): void => {
  if (!sourceId || wsInstance.ws?.readyState !== WebSocket.OPEN) return;
  const source = (getState().websocket.sources ?? []).find(
    (candidate: SourceInfo) => candidate.id === sourceId,
  );
  if (!source) return;
  const mode = resolveSourceModeManagement({ source });
  if (!mode.canTransmit) return;
  wsInstance.ws.send(
    JSON.stringify({
      type: "status",
      ...resolveTxStandbyAnnouncement(source),
    }),
  );
};

// WebSocket message processing
const processMessage = (
  dispatch: Dispatch,
  getState: () => any,
  parsedData: any,
) => {
  // Validate the message first (skip binary data for performance)
  if (!processWebSocketMessageWithValidation(dispatch, getState, parsedData)) {
    console.warn("WebSocket message failed validation:", parsedData);
    return;
  }

  // Promote reconnect TCP opens only after real control-plane traffic arrives.
  // Also clear sticky control-plane "error" left by older stream/source races
  // once healthy control messages prove the socket is still live.
  const connectionStatus = getState().websocket.connectionStatus;
  if (
    !getState().websocket.isConnected &&
    getState().websocket.hasConnectedOnce &&
    (connectionStatus === "connecting" || connectionStatus === "reconnecting")
  ) {
    dispatch(setConnected());
  } else if (getState().websocket.isConnected && connectionStatus === "error") {
    dispatch(setConnected());
  }

  if (parsedData?.type === "tx_safety") {
    dispatch(
      setTxSafetyResult({
        sourceId: parsedData.source_id,
        effectivePowerDbm: parsedData.effective_power_dbm,
        maximumSafePowerDbm: parsedData.maximum_safe_power_dbm,
        minimumIqPowerFloorDbm: parsedData.minimum_iq_power_floor_dbm,
        recommendedIfftSize: parsedData.recommended_ifft_size,
        effectiveIfftSize: parsedData.effective_ifft_size,
        vgaGainDb: parsedData.vga_gain_db,
        ampEnabled: parsedData.amp_enabled,
        safetyClamped: parsedData.safety_clamped,
        validationErrors: parsedData.validation_errors,
      }),
    );
    return;
  }

  if (parsedData?.type === "signals_defaults") {
    if (!isValidSignalsDefaultsMessage(parsedData)) {
      console.error("Signals defaults message validation failed:", parsedData);
      return;
    }

    // Keep YAML defaults as a distinct, atomic snapshot. Mutable source
    // settings and user preferences remain separate from this read-only data.
    dispatch(
      updateDeviceState({
        signalsDefaults: parsedData.sdr,
      }),
    );
    return;
  }

  // Status messages (backend-driven device state)
  if (parsedData?.type === "source_info") {
    if (!isValidSourceInfoMessage(parsedData)) {
      console.error("Source info message validation failed:", parsedData);
      return;
    }

    try {
      const previousActiveSourceId = getState().websocket.activeSourceId;
      const previousSources = getState().websocket.sources ?? [];
      if (parsedData.active_source !== previousActiveSourceId) {
        pendingDataUpdate = null;
        // The backend commonly confirms a source handoff with source_info
        // rather than a separate active_source event. Commit the presentation
        // target here so the first managed frame is not rejected as stale
        // while its slot is still in the switching phase.
        presentationController.commitActiveSource(parsedData.active_source);
      }
      const sources =
        parsedData.active_source !== previousActiveSourceId
          ? preserveTransmittingSourceStatuses(
              previousSources,
              parsedData.sources,
            )
          : parsedData.sources;
      const activeSource =
        sources.find(
          (source: SourceInfo) => source.id === parsedData.active_source,
        ) ??
        sources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      if (
        "deviceState" in derived &&
        shouldClearStaleSpectrumFrames(derived.deviceState as any)
      ) {
        clearLiveSpectrumFrames(dispatch);
      }
      const sourceStatuses = Object.fromEntries(
        sources.map((source: SourceInfo) => [source.id, source.status]),
      );
      if (parsedData.active_source === requestedSourceId) {
        requestedSourceId = null;
      }
      const serverIsPaused = isSourceModePaused(parsedData.active_source_mode);
      let targetIsPaused = serverIsPaused;
      if (
        lastExpectedPauseState !== null &&
        Date.now() - lastPauseCommandTime < 1000
      ) {
        targetIsPaused = lastExpectedPauseState;
      } else {
        lastExpectedPauseState = null;
      }
      const updates: any = {
        activeSourceId: parsedData.active_source,
        activeSourceMode: parsedData.active_source_mode,
        isPaused: targetIsPaused,
        sources,
        sourceStatuses,
        ...(parsedData.active_source !== previousActiveSourceId
          ? { sourceFrameReadiness: null }
          : {}),
        ...derived,
      };
      applyStatusUpdates(dispatch, getState, updates);
    } catch (e) {
      console.error("Failed to parse source_info message:", e);
    }
    return;
  }

  if (parsedData?.type === "active_source") {
    if (!isValidActiveSourceMessage(parsedData)) {
      console.error("Active source message validation failed:", parsedData);
      return;
    }

    try {
      const previousActiveSourceId = getState().websocket.activeSourceId;
      if (parsedData.source_id !== previousActiveSourceId) {
        pendingDataUpdate = null;
      }
      if (parsedData.source_id === requestedSourceId) {
        requestedSourceId = null;
      }
      const serverIsPaused = isSourceModePaused(parsedData.source_mode);
      let targetIsPaused = serverIsPaused;
      if (
        lastExpectedPauseState !== null &&
        Date.now() - lastPauseCommandTime < 1000
      ) {
        targetIsPaused = lastExpectedPauseState;
      } else {
        lastExpectedPauseState = null;
      }
      const updates: any = {
        activeSourceId: parsedData.source_id,
        activeSourceMode: parsedData.source_mode,
        isPaused: targetIsPaused,
        sources: (getState().websocket.sources ?? []).map(
          (source: SourceInfo) =>
            source.id === parsedData.source_id &&
            typeof parsedData.stream_epoch === "number"
              ? { ...source, stream_epoch: parsedData.stream_epoch }
              : source,
        ),
        ...(parsedData.source_id !== previousActiveSourceId
          ? { sourceFrameReadiness: null }
          : {}),
      };

      presentationController.commitActiveSource(parsedData.source_id);

      const currentSources: SourceInfo[] = getState().websocket.sources ?? [];
      const activeSource =
        currentSources.find(
          (source: SourceInfo) => source.id === parsedData.source_id,
        ) ??
        currentSources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      if (
        "deviceState" in derived &&
        shouldClearStaleSpectrumFrames(derived.deviceState as any)
      ) {
        clearLiveSpectrumFrames(dispatch);
      }

      const combinedUpdates = {
        ...updates,
        ...derived,
      };

      applyStatusUpdates(dispatch, getState, combinedUpdates);
    } catch (e) {
      console.error("Failed to parse active_source message:", e);
    }
    return;
  }

  if (parsedData?.type === "channels") {
    if (!isValidChannelsMessageEnhanced(parsedData)) {
      console.error("Channels message validation failed:", parsedData);
      dispatch(setOperationalError("Error: Bad JSON"));
      return;
    }

    try {
      const channels = parsedData.channels as SpectrumFrame[];
      const firstChannel = channels[0];
      if (!firstChannel) {
        dispatch(setOperationalError("Error: Bad JSON"));
        return;
      }

      const nextRange = {
        min: firstChannel.min_hz,
        max: firstChannel.max_hz,
      };
      const currentRange = getState().spectrum?.frequencyRange;
      const currentSignalArea = getState().spectrum?.activeSignalArea;
      const targetSourceId =
        parsedData.source_id || getState().websocket.activeSourceId;
      const persistedArea = targetSourceId
        ? getPersistedActiveSignalArea(targetSourceId)
        : null;
      const inManualMode =
        currentSignalArea === "manual" || persistedArea === "manual";

      if (!inManualMode) {
        dispatch(
          setActiveSignalArea(
            parsedData.active_signal_area ?? firstChannel.label ?? "A",
          ),
        );
        dispatch(
          setFrequencyRange(
            resolveIncomingChannelsFrequencyRange(currentRange, nextRange),
          ),
        );
      }
      dispatch(
        updateDeviceState({
          channels,
        }),
      );
      if (parsedData.error) {
        dispatch(setOperationalError(`Error: ${parsedData.error}`));
      }
    } catch (e) {
      console.error("Failed to parse channels message:", e);
      dispatch(setOperationalError("Error: Bad JSON"));
    }
    return;
  }

  if (parsedData?.type === "status" && "source_id" in parsedData) {
    if (!isValidSourceStatusMessage(parsedData)) {
      console.error("Source status message validation failed:", parsedData);
      return;
    }

    try {
      const currentSources: SourceInfo[] = getState().websocket.sources ?? [];
      const txPreviewSourceId =
        getState().sourceRouting?.bindings?.["tx-suite:tx"] ?? null;
      const nextSources = currentSources.map((source) =>
        source.id === parsedData.source_id
          ? {
              ...source,
              // Pause broadcasts describe the transport, not the selected
              // Tx viewer mode. Keep an explicitly bound preview in standby
              // until the binding is cleared or transmission starts.
              status:
                txPreviewSourceId === parsedData.source_id &&
                source.status === "standby" &&
                parsedData.status !== "transmitting"
                  ? "standby"
                  : parsedData.status,
              loading_attempt:
                parsedData.loading_attempt ?? source.loading_attempt,
              loading_attempt_max:
                parsedData.loading_attempt_max ?? source.loading_attempt_max,
              stream_epoch: parsedData.stream_epoch ?? source.stream_epoch,
            }
          : source,
      );
      const activeSource =
        nextSources.find(
          (source) => source.id === getState().websocket.activeSourceId,
        ) ??
        nextSources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      const sourceStatuses = {
        ...getState().websocket.sourceStatuses,
      };
      sourceStatuses[parsedData.source_id] =
        nextSources.find((source) => source.id === parsedData.source_id)
          ?.status ?? parsedData.status;
      presentationController.setSourceStatus(
        parsedData.source_id,
        sourceStatuses[parsedData.source_id],
      );
      const updates: any = {
        sourceStatuses,
        sources: nextSources,
        ...derived,
      };
      if (parsedData.source_id === getState().websocket.activeSourceId) {
        updates.deviceState = mapSourceStatusToDeviceState(parsedData.status);
        updates.deviceLoadingReason =
          parsedData.status === "loading" ||
          parsedData.status === "initializing"
            ? "connect"
            : null;
        if (
          parsedData.status === "loading" ||
          parsedData.status === "initializing" ||
          parsedData.status === "stale" ||
          parsedData.status === "disconnected"
        ) {
          clearLiveSpectrumFrames(dispatch);
        }
      }
      applyStatusUpdates(dispatch, getState, updates);
    } catch (e) {
      console.error("Failed to parse source status message:", e);
    }
    return;
  }

  if (parsedData?.type === "sdr_settings" && "source_id" in parsedData) {
    if (!isValidSourceSdrSettingsMessage(parsedData)) {
      console.error(
        "Source sdr settings message validation failed:",
        parsedData,
      );
      return;
    }

    try {
      const currentSources: SourceInfo[] = getState().websocket.sources ?? [];
      const nextSources = currentSources.map((source) =>
        source.id === parsedData.source_id
          ? {
              ...source,
              sdr: {
                ...source.sdr,
                settings: {
                  ...source.sdr.settings,
                  ...parsedData.sdr,
                },
              },
            }
          : source,
      );
      const activeSource =
        nextSources.find(
          (source) => source.id === getState().websocket.activeSourceId,
        ) ??
        nextSources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      const updates: any = {
        sources: nextSources,
        ...derived,
      };
      if (pendingStatusUpdates === null) {
        pendingStatusUpdates = updates;
      } else {
        pendingStatusUpdates = { ...pendingStatusUpdates, ...updates };
      }
      if (statusBatchFrame === null) {
        statusBatchFrame = window.requestAnimationFrame(() =>
          processBatchedStatus(dispatch, getState),
        );
      }
    } catch (e) {
      console.error("Failed to parse source sdr settings message:", e);
    }
    return;
  }

  if (parsedData?.type === "error" && "source_id" in parsedData) {
    if (!isValidSourceErrorMessage(parsedData)) {
      console.error("Source error message validation failed:", parsedData);
      return;
    }

    if (
      parsedData.code === "source_switch_failed" &&
      parsedData.source_id === requestedSourceId
    ) {
      // The backend kept the previous source active. Drop the speculative
      // target transport and immediately restore that active source instead
      // of leaving the presentation state waiting on a socket that can never
      // publish a valid frame.
      publishSourceTransport(
        dispatch,
        getState,
        parsedData.source_id,
        "failed",
        parsedData.message,
        true,
      );
      requestedSourceId = null;
      syncManagedStreamSubscriptions(dispatch, getState);
    }
    dispatch(setOperationalError(parsedData.message));
    return;
  }

  if (false && parsedData?.type === "status") {
    return;
  }

  // Capture status messages
  if (parsedData?.type === "capture_status") {
    // Temporarily skip strict validation to allow I/Q capture to work
    // TODO: Fix schema validation issue and re-enable proper validation

    // const statusData = parsedData.status || parsedData;
    // if (!validateCaptureStatus(statusData)) {
    //   console.error('Capture status validation failed:', statusData);
    //   return;
    // }

    try {
      const statusObj = parsedData.status || {};

      if (
        typeof statusObj.jobId === "string" &&
        (statusObj.status === "started" ||
          statusObj.status === "progress" ||
          statusObj.status === "done" ||
          statusObj.status === "failed")
      ) {
        const newStatus = {
          jobId: statusObj.jobId,
          status: statusObj.status,
          message: statusObj.message,
          progress: statusObj.progress,
          downloadUrl: statusObj.downloadUrl,
          filename: statusObj.filename,
          fileCount:
            typeof statusObj.fileCount === "number"
              ? statusObj.fileCount
              : undefined,
          ephemeral:
            typeof statusObj.ephemeral === "boolean"
              ? statusObj.ephemeral
              : undefined,
          timestamp:
            typeof statusObj.timestamp === "number"
              ? statusObj.timestamp
              : undefined,
          fileSize:
            typeof statusObj.fileSize === "number"
              ? statusObj.fileSize
              : undefined,
          duration:
            typeof statusObj.duration === "number"
              ? statusObj.duration
              : undefined,
        };
        if (statusObj.error) {
          (newStatus as any).error = statusObj.error;
        }
        const currentStatus = getState().websocket.captureStatus;
        if (!equalValue(currentStatus, newStatus)) {
          dispatch(setCaptureStatus(newStatus));
        }
      }
    } catch (e) {
      console.error("Failed to parse capture status:", e);
    }
    return;
  }

  // Scan and Demodulation result messages
  if (
    parsedData?.type === "scan_result" ||
    parsedData?.type === "scan_progress" ||
    parsedData?.type === "demod_result"
  ) {
    scannerWorkerManager.handleWSResponse(parsedData);
    return;
  }

  // Hardware info messages
  if (parsedData?.type === "hardware_info") {
    try {
      if (
        parsedData.hardwareFreqRange &&
        typeof parsedData.sampleRate === "number"
      ) {
        dispatch(
          setHardwareInfo({
            range: {
              min: parsedData.hardwareFreqRange.min,
              max: parsedData.hardwareFreqRange.max,
            },
            sampleRate: parsedData.sampleRate,
          }),
        );
      }
    } catch (e) {
      console.error("Failed to parse hardware info:", e);
    }
    return;
  }

  // APT Analysis result messages
  if (parsedData?.type === "apt_analysis_result") {
    try {
      // Dispatch custom event for APT analysis results
      // This will be handled by the DemodContext
      const event = new CustomEvent("aptAnalysisResult", {
        detail: parsedData,
      });
      window.dispatchEvent(event);
    } catch (e) {
      console.error("Failed to process APT analysis result:", e);
    }
    return;
  }
};

// Create WebSocket middleware
const createWebSocketMiddleware =
  (): Middleware<{}, any> => (store) => (next) => (action: any) => {
    const { dispatch, getState } = store;

    // Handle WebSocket connection management actions
    switch (action.type) {
      case "websocket/connect": {
        const { url, aesKey, enabled = true } = action.payload;

        if (wsInstance.disconnectTimeout) {
          clearTimeout(wsInstance.disconnectTimeout);
          wsInstance.disconnectTimeout = null;
        }

        const existingSocket = wsInstance.ws;
        const hasReusableSocket =
          !!existingSocket &&
          !wsInstance.disposed &&
          wsInstance.enabled === enabled &&
          wsInstance.url === url &&
          sameAesKeyReference(wsInstance.aesKey, aesKey) &&
          (existingSocket.readyState === WebSocket.CONNECTING ||
            existingSocket.readyState === WebSocket.OPEN);

        if (hasReusableSocket) {
          if (existingSocket?.readyState === WebSocket.OPEN) {
            dispatch(setConnected());
            syncManagedStreamSubscriptions(dispatch, getState);
          } else {
            dispatch(setConnecting());
          }
          return next(action);
        }

        // Cleanup existing connection
        cleanupSocket();
        liveDataRef.current = [];
        liveDataBySourceRef.current = {};
        sourceVisualizationRuntime.clear();
        pendingDataUpdate = null;

        if (!enabled || !url) {
          dispatch(setDisconnected());
          return next(action);
        }

        wsInstance.url = url;
        wsInstance.aesKey = aesKey;
        wsInstance.enabled = enabled;
        wsInstance.reconnectAttempts = 0;
        wsInstance.disposed = false;
        multiplexedStreamTransport = createMultiplexedStreamTransport({
          url,
          aesKey,
        });
        sourceModeStreamManager = createSourceModeStreamManager({
          transportFactory: multiplexedStreamTransport.transportFactory,
        });

        const connect = () => {
          if (wsInstance.disposed) return;

          try {
            dispatch(setConnecting());
            const ws = new WebSocket(url);
            wsInstance.ws = ws;

            ws.onopen = () => {
              if (wsInstance.disposed) {
                ws.close();
                return;
              }
              // After a live session, TCP open alone must not clear Server Down.
              // Wait for the first control-plane status/source_info before
              // marking connected — reconnect polling against a crashed backend
              // otherwise flashes Loading between abort loops.
              const hadSession = getState().websocket.hasConnectedOnce === true;
              if (hadSession) {
                dispatch(setConnecting());
              } else {
                dispatch(setConnected());
              }
              wsInstance.reconnectAttempts = 0;
              syncManagedStreamSubscriptions(dispatch, getState);

              // Send queued messages
              const state = getState();
              const queuedMessages = state.websocket.queuedMessages;
              if (queuedMessages.length > 0) {
                queuedMessages.forEach(
                  ({ type, data }: { type: string; data: any }) => {
                    ws.send(JSON.stringify({ type, ...data }));
                  },
                );
                dispatch(clearQueuedMessages());
              }

              // Re-sync current settings and frequency range to the newly established connection
              const currentRange = state.spectrum?.frequencyRange;
              if (currentRange) {
                ws.send(
                  JSON.stringify({
                    type: "frequency_range",
                    min_hz: currentRange.min,
                    max_hz: currentRange.max,
                    center_frequency: (currentRange.min + currentRange.max) / 2,
                  }),
                );
              }

              const spectrumSettings = state.spectrum;
              if (spectrumSettings) {
                const sdrSettingsPayload: Record<string, any> = {
                  type: "settings",
                };
                if (
                  typeof spectrumSettings.fftSize === "number" &&
                  spectrumSettings.fftSize > 0
                ) {
                  sdrSettingsPayload.fftSize = spectrumSettings.fftSize;
                }
                if (
                  typeof spectrumSettings.fftWindow === "string" &&
                  spectrumSettings.fftWindow.length > 0
                ) {
                  sdrSettingsPayload.fftWindow = spectrumSettings.fftWindow;
                }
                if (
                  typeof spectrumSettings.fftFrameRate === "number" &&
                  spectrumSettings.fftFrameRate > 0
                ) {
                  sdrSettingsPayload.frameRate = spectrumSettings.fftFrameRate;
                }
                if (
                  typeof spectrumSettings.sampleRateHz === "number" &&
                  spectrumSettings.sampleRateHz > 0
                ) {
                  sdrSettingsPayload.sampleRate = spectrumSettings.sampleRateHz;
                }
                if (
                  typeof spectrumSettings.gain === "number" &&
                  spectrumSettings.gain >= 0
                ) {
                  sdrSettingsPayload.gain = spectrumSettings.gain;
                }
                if (typeof spectrumSettings.ppm === "number") {
                  sdrSettingsPayload.ppm = spectrumSettings.ppm;
                }
                if (typeof spectrumSettings.tunerAGC === "boolean") {
                  sdrSettingsPayload.tunerAGC = spectrumSettings.tunerAGC;
                }
                if (typeof spectrumSettings.rtlAGC === "boolean") {
                  sdrSettingsPayload.rtlAGC = spectrumSettings.rtlAGC;
                }
                if (Object.keys(sdrSettingsPayload).length > 1) {
                  ws.send(JSON.stringify(sdrSettingsPayload));
                }
              }
            };

            ws.onmessage = async (event) => {
              if (wsInstance.disposed) return;

              const raw = event.data as string;
              let parsed: any;
              try {
                parsed = JSON.parse(raw);
              } catch (e) {
                console.error("Failed to parse websocket message:", e);
                return;
              }

              // Priority: Handle critical control messages immediately before any other processing
              if (
                parsed?.type === "status" ||
                parsed?.type === "capture_status"
              ) {
                processMessage(dispatch, getState, parsed);
                return;
              }

              if (parsed?.type === "spectrum") {
                queueLiveData(parsed, dispatch, getState);
                return;
              }

              if (parsed?.type === "encrypted_spectrum") {
                if (wsInstance.aesKey && typeof parsed.payload === "string") {
                  try {
                    const plaintext = await decryptPayload(
                      wsInstance.aesKey,
                      parsed.payload,
                    );
                    const decrypted = JSON.parse(plaintext);
                    if (
                      decrypted?.type === "batch" &&
                      Array.isArray(decrypted.messages) &&
                      decrypted.messages.length > 0
                    ) {
                      queueLiveData(
                        JSON.parse(decrypted.messages[0]),
                        dispatch,
                        getState,
                      );
                    } else {
                      if (pendingDataUpdate === null) {
                        pendingDataUpdate = [decrypted];
                      } else {
                        pendingDataUpdate.push(decrypted);
                        trimPendingDataUpdate();
                      }
                    }
                  } catch (e) {
                    console.error("Failed to decrypt spectrum data:", e);
                  }
                }
                return;
              }

              // Process status and control messages
              processMessage(dispatch, getState, parsed);
            };

            ws.onclose = () => {
              if (wsInstance.disposed) return;
              // Drop stale multiplexed stream sockets pinned to the previous
              // backend before the control plane reconnects after a hot-reload
              // swap. Recreate so Mock APT / live sources can subscribe cleanly.
              resetManagedStreamPipeline(true);
              dispatch(softDisconnect());

              // Exponential backoff reconnection
              if (
                wsInstance.reconnectAttempts < wsInstance.maxReconnectAttempts
              ) {
                const delay = Math.min(
                  1000 * Math.pow(2, wsInstance.reconnectAttempts),
                  30000,
                );
                wsInstance.reconnectTimeout = window.setTimeout(() => {
                  wsInstance.reconnectAttempts++;
                  dispatch(setReconnecting(wsInstance.reconnectAttempts));
                  connect();
                }, delay);
              }
            };

            ws.onerror = (error) => {
              console.error("WebSocket error:", error);
              dispatch(setError("WebSocket connection error"));
            };
          } catch (error) {
            console.error("Failed to create WebSocket:", error);
            dispatch(setError("Failed to create WebSocket connection"));
          }
        };

        connect();
        return next(action);
      }

      case "websocket/disconnect": {
        if (wsInstance.disconnectTimeout) {
          clearTimeout(wsInstance.disconnectTimeout);
        }

        wsInstance.disposed = true;
        wsInstance.enabled = false;
        if (wsInstance.reconnectTimeout) {
          clearTimeout(wsInstance.reconnectTimeout);
          wsInstance.reconnectTimeout = null;
        }

        liveDataRef.current = null;
        demodFrameQueue.clear();
        pendingDataUpdate = null;
        pendingStatusUpdates = null;
        if (statusBatchFrame !== null) {
          cancelAnimationFrame(statusBatchFrame);
          statusBatchFrame = null;
        }

        wsInstance.disconnectTimeout = window.setTimeout(() => {
          wsInstance.disconnectTimeout = null;
          cleanupSocket();
        }, DISCONNECT_GRACE_MS);

        if (dataBatchFrame !== null) {
          cancelAnimationFrame(dataBatchFrame);
          dataBatchFrame = null;
        }
        resetPausedFrameRequestGate();

        dispatch(setDisconnected());
        return next(action);
      }

      case "websocket/refreshStream": {
        const result = next(action);
        if (action.payload?.mode === "tx") {
          pendingManagedTxOptions = buildManagedTxOptions(
            getState(),
            action.payload.options ?? {},
          );
        }
        syncManagedStreamSubscriptions(dispatch, getState);
        return result;
      }

      case "websocket/sendMessage": {
        const { type, data }: { type: string; data: any } = action.payload;
        let normalizedData = normalizeFrequencyRangeMessageData(type, data);
        if (shouldSuppressDuplicateFrequencyRangeSend(type, normalizedData)) {
          return next(action);
        }
        trackFrequencyRangeRequest(type, normalizedData);

        // Track intended FFT size to prevent clobbering from status broadcasts
        const requestedFftSize =
          normalizedData?.fft_size ??
          normalizedData?.fftSize ??
          normalizedData?.fft_size_hz;
        if (type === "settings" && requestedFftSize) {
          lastSettingsRequest = {
            fft_size: requestedFftSize,
            timestamp: Date.now(),
          };
        }

        if (
          type === "status" &&
          wsInstance.ws &&
          wsInstance.ws.readyState === WebSocket.OPEN
        ) {
          applyOptimisticTransmitStatus(
            dispatch,
            getState,
            normalizedData ?? {},
          );
        }

        if (type === "select_source") {
          const previousActiveSourceId = getState().websocket.activeSourceId;
          const previousActiveSource = (
            getState().websocket.sources ?? []
          ).find((source: SourceInfo) => source.id === previousActiveSourceId);
          const previousSourceIsTransmitting =
            previousActiveSource?.status === "transmitting" ||
            getState().websocket.sourceStatuses?.[previousActiveSourceId] ===
              "transmitting";
          // Fence the old receiver immediately. The backend also enforces this
          // during the device swap, but sending the per-source pause first
          // keeps the source card and any already-open stream consistent while
          // that blocking handoff is in flight.
          if (
            previousActiveSourceId &&
            previousActiveSourceId !== normalizedData?.source_id &&
            !previousSourceIsTransmitting &&
            wsInstance.ws?.readyState === WebSocket.OPEN
          ) {
            wsInstance.ws.send(
              JSON.stringify({
                type: "pause",
                paused: true,
                source_id: previousActiveSourceId,
              }),
            );
          }
          requestedSourceId =
            (normalizedData?.source_id as string | null) ?? null;
          if (requestedSourceId) {
            const isTx =
              requestedSourceId === "mock-tx" ||
              (getState().websocket.sources ?? []).find(
                (source: SourceInfo) => source.id === requestedSourceId,
              )?.capability === "tx";
            presentationController.selectSource(
              requestedSourceId,
              isTx ? "tx" : "rx",
            );
            pendingDataUpdate = null;
            // Keep the last live frame in the mutable ref across selection.
            // Nulling here forced a black FFT before the target preview/stream
            // frame arrived; the canvas rejects foreign source_ids instead.
            dispatch(updateDeviceState({ sourceFrameReadiness: null }));
            publishSourceTransport(
              dispatch,
              getState,
              requestedSourceId,
              "warming",
              null,
              true,
            );
          }
          // Start the target transport during backend device swap so the
          // first committed frame does not wait on a second WebSocket
          // handshake. Frames remain gated by the active source identity.
          syncManagedStreamSubscriptions(dispatch, getState);
        }

        if (wsInstance.ws && wsInstance.ws.readyState === WebSocket.OPEN) {
          wsInstance.ws.send(JSON.stringify({ type, ...normalizedData }));
          const selectedSource = (getState().websocket.sources ?? []).find(
            (source: SourceInfo) => source.id === normalizedData?.source_id,
          );
          const selectedMode = selectedSource
            ? resolveSourceModeManagement({ source: selectedSource })
            : null;
          if (selectedMode?.canTransmit && !selectedMode.canReceive) {
            announceTxStandbyForSource(selectedSource.id, getState);
            // Do not request_next_frame here. SpectrumRoute owns the one-shot
            // with Tx settings; a bare middleware request plus the route
            // request produced multiple advancing standby frames.
          }
        } else if (type === "status") {
          resetPausedFrameRequestGate();
        } else {
          // Queue the message for when connection is restored
          dispatch(queueMessage({ type, data: normalizedData }));
        }
        return next(action);
      }

      case "websocket/setPaused": {
        const isPaused = getPausedValue(action.payload);
        const sourceId =
          getPauseSourceId(action.payload) ??
          (getState().websocket.activeSourceId as string | null);

        if (isPaused === null) {
          return next(action);
        }

        lastPauseCommandTime = Date.now();
        lastExpectedPauseState = isPaused;

        if (isPaused) {
          resetPausedFrameRequestGate();
          pendingDataUpdate = null;
        }

        if (sourceId) {
          const duplexMode = getPauseDuplexMode(action.payload);
          const mode = duplexMode === "tx" ? "tx" : "rx";
          presentationController.setPaused(sourceId, mode, isPaused);
        }

        if (
          sourceId &&
          wsInstance.ws &&
          wsInstance.ws.readyState === WebSocket.OPEN
        ) {
          const pausePayload: Record<string, unknown> = {
            type: "pause",
            paused: isPaused,
            source_id: sourceId,
          };
          const duplexMode = getPauseDuplexMode(action.payload);
          if (duplexMode) {
            pausePayload.duplex_mode = duplexMode;
          }
          wsInstance.ws.send(JSON.stringify(pausePayload));
        }

        return next({
          ...action,
          payload: isPaused,
        });
      }

      case "websocket/updateDeviceState": {
        const previousState = getState().websocket;
        const previousActiveSourceId = previousState.activeSourceId;
        const result = next(action);
        const nextState = getState().websocket;
        const activeSourceChanged =
          typeof nextState.activeSourceId === "string" &&
          nextState.activeSourceId !== previousActiveSourceId;
        if (
          activeSourceChanged ||
          shouldClearStaleSpectrumFrames(nextState.deviceState)
        ) {
          clearLiveSpectrumFrames(dispatch);
        }
        if (activeSourceChanged) {
          syncManagedStreamSubscriptions(dispatch, getState);
        }
        if (sourceModeStreamManager) {
          syncManagedStreamSubscriptions(dispatch, getState);
        }
        return result;
      }

      case "txSuite/requestPreview": {
        const result = next(action);
        const state = getState();
        const sourceId = resolveTxPreviewSourceId({
          ...state.websocket,
          sourceRouting: state.sourceRouting,
        });
        if (sourceId && !cachedRxFrameBySourceId.has(sourceId)) {
          const currentFrame =
            sourceVisualizationRuntime.getSourceRef(sourceId).current;
          const rxFrame = resolveRxFrameToRestore(currentFrame, sourceId);
          if (rxFrame) cachedRxFrameBySourceId.set(sourceId, rxFrame);
        }
        const sources = applyOptimisticTxPreviewState(
          state.websocket.sources ?? [],
          sourceId,
        );
        if (sourceId && sources !== state.websocket.sources) {
          dispatch(
            updateDeviceState({
              sources,
              sourceStatuses: Object.fromEntries(
                sources.map((source) => [source.id, source.status]),
              ),
            }),
          );
        }
        if (sourceModeStreamManager) {
          syncManagedStreamSubscriptions(dispatch, getState);
        }
        return result;
      }

      default: {
        const isSourceBindingAction =
          action.type === "sourceRouting/setSourceBinding" ||
          action.type === "sourceRouting/setSourceBindings";
        const previousTxBinding = isSourceBindingAction
          ? (getState().sourceRouting?.bindings?.["tx-suite:tx"] ?? null)
          : null;
        const result = next(action);
        const nextTxBinding = isSourceBindingAction
          ? (getState().sourceRouting?.bindings?.["tx-suite:tx"] ?? null)
          : null;
        if (previousTxBinding && !nextTxBinding) {
          clearTxPreviewFrames(getState, previousTxBinding);
        }
        if (
          sourceModeStreamManager &&
          (shouldSyncManagedStreamOptions(action.type) || isSourceBindingAction)
        ) {
          syncManagedStreamSubscriptions(dispatch, getState);
        }
        if (
          isSourceBindingAction &&
          nextTxBinding &&
          nextTxBinding !== previousTxBinding
        ) {
          announceTxStandbyForSource(nextTxBinding, getState);
        }
        return result;
      }
    }
  };

// Export the middleware factory
const websocketMiddleware = createWebSocketMiddleware();
export default websocketMiddleware;
