/**
 * The single source of truth for source duplex capabilities and the mode the
 * visualizer is currently presenting. A device can be Tx-capable without the
 * current view being Tx; that distinction is essential for half-duplex Rx
 * pause/resume transitions.
 */
export type SourceDuplexMode = "simplex" | "half_duplex" | "duplex";
export type ActiveDuplexMode = "rx" | "tx" | "rx_tx";
export type SourceViewMode = "rx" | "tx";

export type SourceModeAction =
  | "clear_tx_binding"
  | "pause_rx"
  | "resume_rx"
  | "bind_tx"
  | "enter_tx_standby"
  | "request_rx_frame"
  | "request_tx_frame"
  | "request_tx_preview";

export interface SourceModeSource {
  id?: string | null;
  capability?: string | null;
  kind?: string | null;
  duplex_mode?: string | null;
  active_duplex_mode?: string | null;
  active_duplex_modes?: string | string[] | null;
  status?: string | null;
  paused?: boolean | null;
}

export interface SourceModeManagementInput {
  source?: SourceModeSource | null;
  txBindingSourceId?: string | null;
  txPreviewSourceId?: string | null;
}

export interface SourceModeManagement {
  sourceId: string | null;
  duplexMode: SourceDuplexMode;
  activeDuplexMode: ActiveDuplexMode;
  viewMode: SourceViewMode;
  isRxMode: boolean;
  isTxMode: boolean;
  isRxPaused: boolean;
  isTxStandby: boolean;
  canReceive: boolean;
  canTransmit: boolean;
  shouldShowTxControls: boolean;
  shouldRequestRxFrame: boolean;
  shouldRequestTxPreview: boolean;
}

const normalizeToken = (value: unknown): string =>
  typeof value === "string"
    ? value.trim().toLowerCase().replace(/-/g, "_")
    : "";

export const normalizeSourceDuplexMode = (
  value: unknown,
): SourceDuplexMode => {
  const normalized = normalizeToken(value);
  if (normalized === "half_duplex" || normalized === "half") {
    return "half_duplex";
  }
  if (
    normalized === "duplex" ||
    normalized === "full_duplex" ||
    normalized === "full"
  ) {
    return "duplex";
  }
  return "simplex";
};

const normalizeActiveDuplexMode = (
  value: unknown,
): ActiveDuplexMode | null => {
  const normalized = normalizeToken(value).replace(/\s*\+\s*/g, "_");
  if (normalized === "rx" || normalized === "receive") return "rx";
  if (normalized === "tx" || normalized === "transmit") return "tx";
  if (
    normalized === "rx_tx" ||
    normalized === "tx_rx" ||
    normalized === "receive_transmit" ||
    normalized === "transmit_receive"
  ) {
    return "rx_tx";
  }
  return null;
};

const resolveExplicitActiveDuplexMode = (
  source: SourceModeSource,
): ActiveDuplexMode | null => {
  const explicit = normalizeActiveDuplexMode(source.active_duplex_mode);
  if (explicit) return explicit;

  const modes = Array.isArray(source.active_duplex_modes)
    ? source.active_duplex_modes
    : typeof source.active_duplex_modes === "string"
      ? source.active_duplex_modes.split(/[\s,]+/)
      : [];
  const normalizedModes = new Set(
    modes
      .map((mode) => normalizeActiveDuplexMode(mode))
      .filter((mode): mode is ActiveDuplexMode => mode !== null),
  );
  if (normalizedModes.has("rx_tx")) return "rx_tx";
  if (normalizedModes.has("rx") && normalizedModes.has("tx")) return "rx_tx";
  if (normalizedModes.has("tx")) return "tx";
  if (normalizedModes.has("rx")) return "rx";
  return null;
};

const isTxOnlySource = (source: SourceModeSource): boolean => {
  const capability = normalizeToken(source.capability);
  const kind = normalizeToken(source.kind);
  return (
    capability === "tx" ||
    kind === "mock_tx" ||
    (capability === "mock" && kind.includes("tx"))
  );
};

const sourceCanReceive = (source: SourceModeSource): boolean => {
  const capability = normalizeToken(source.capability);
  return capability === "rx" || capability === "tx_rx" || capability === "mock";
};

const sourceCanTransmit = (source: SourceModeSource): boolean => {
  const capability = normalizeToken(source.capability);
  return capability === "tx" || capability === "tx_rx" || isTxOnlySource(source);
};

export const resolveSourceModeManagement = ({
  source,
  txBindingSourceId,
  txPreviewSourceId,
}: SourceModeManagementInput): SourceModeManagement => {
  const resolvedSource = source ?? {};
  const duplexMode = normalizeSourceDuplexMode(resolvedSource.duplex_mode);
  const canReceive = sourceCanReceive(resolvedSource);
  const canTransmit = sourceCanTransmit(resolvedSource);
  const explicitActiveMode = resolveExplicitActiveDuplexMode(resolvedSource);
  const isBoundToTx =
    !!resolvedSource.id &&
    (resolvedSource.id === txBindingSourceId ||
      resolvedSource.id === txPreviewSourceId);
  const status = normalizeToken(resolvedSource.status);
  const isTransmitting = status === "transmitting";
  const viewMode: SourceViewMode =
    isTxOnlySource(resolvedSource) ||
    isBoundToTx ||
    explicitActiveMode === "tx" ||
    status === "tx_preview" ||
    isTransmitting
      ? "tx"
      : "rx";

  const activeDuplexMode =
    explicitActiveMode ??
    (duplexMode === "duplex" && canReceive && canTransmit
      ? "rx_tx"
      : viewMode);
  const isRxMode = viewMode === "rx";
  const isTxMode = viewMode === "tx";
  const isRxPaused =
    isRxMode &&
    (resolvedSource.paused === true ||
      (duplexMode === "half_duplex" && status === "standby"));
  const isTxStandby = isTxMode && !isTransmitting;

  return {
    sourceId: resolvedSource.id ?? null,
    duplexMode,
    activeDuplexMode,
    viewMode,
    isRxMode,
    isTxMode,
    isRxPaused,
    isTxStandby,
    canReceive,
    canTransmit,
    shouldShowTxControls: isTxMode && canTransmit,
    shouldRequestRxFrame: isRxMode && canReceive,
    shouldRequestTxPreview: isTxMode && canTransmit && !isTransmitting,
  };
};

export const resolveSourceModeTransition = ({
  sourceId,
  duplexMode,
  fromMode,
  toMode,
}: {
  sourceId: string;
  duplexMode: SourceDuplexMode;
  fromMode: SourceViewMode;
  toMode: SourceViewMode;
}): {
  sourceId: string;
  fromMode: SourceViewMode;
  toMode: SourceViewMode;
  actions: SourceModeAction[];
} => {
  if (fromMode === toMode) {
    return { sourceId, fromMode, toMode, actions: [] };
  }

  if (toMode === "rx") {
    return {
      sourceId,
      fromMode,
      toMode,
      actions: [
        "clear_tx_binding",
        ...(duplexMode === "half_duplex" ? ["resume_rx" as const] : []),
        "request_rx_frame",
      ],
    };
  }

  return {
    sourceId,
    fromMode,
    toMode,
    actions: [
      ...(duplexMode === "half_duplex" ? ["pause_rx" as const] : []),
      "bind_tx",
      "enter_tx_standby",
      "request_tx_preview",
    ],
  };
};

export const resolveTxStopTransition = ({
  sourceId,
  duplexMode,
}: {
  sourceId: string;
  duplexMode: SourceDuplexMode;
}): {
  sourceId: string;
  fromMode: "tx";
  toMode: "tx";
  actions: ["enter_tx_standby"];
} => {
  // Stopping transmission changes the Tx activity state, not the selected
  // source view. Keep the mode bound to Tx so its final I/Q frame remains
  // visible until the user explicitly switches back to Rx.
  void duplexMode;
  return {
    sourceId,
    fromMode: "tx",
    toMode: "tx",
    actions: ["enter_tx_standby"],
  };
};
