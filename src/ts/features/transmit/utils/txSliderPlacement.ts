import { MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ } from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";

export interface TxSliderCenterInput {
  centerHz: number;
  fallbackCenterHz: number;
  visibleMinHz: number;
  visibleMaxHz: number;
  sampleRateHz: number;
}

/** What triggered a Tx / monitor geometry update. */
export type TxMonitorUpdateSource =
  | "slider"
  | "typed"
  | "mode-enter"
  | "user-pan";

export const resolveTxPreviewGeometry = ({
  centerFrequencyHz,
  sampleRateHz,
  fixedSampleRateHz,
}: {
  centerFrequencyHz: number;
  sampleRateHz: number;
  fixedSampleRateHz: number;
}): { centerFrequencyHz: number; sampleRateHz: number } => ({
  centerFrequencyHz,
  sampleRateHz: Number.isFinite(fixedSampleRateHz)
    ? fixedSampleRateHz
    : sampleRateHz,
});

export const resolveTxPreviewCenterHz = ({
  previewCenterHz,
  txCenterHz,
  isPreview,
}: {
  previewCenterHz: number | null | undefined;
  txCenterHz: number;
  isPreview: boolean;
}): number =>
  isPreview &&
  typeof previewCenterHz === "number" &&
  Number.isFinite(previewCenterHz)
    ? previewCenterHz
    : txCenterHz;

/**
 * Edge-pan while the user is actively dragging the spectrum can update the
 * monitor center. Slider-driven Tx updates must never use this path.
 */
export const shouldSyncMockMonitorCenterFromRange = ({
  isMockTxMonitorActive,
  isDragging,
  isFixedTxPreview: _isFixedTxPreview,
}: {
  isMockTxMonitorActive: boolean;
  isDragging: boolean;
  isFixedTxPreview: boolean;
}): boolean => isMockTxMonitorActive && isDragging;

export const resolveTxMonitorViewportCenterHz = ({
  vfoCenterHz,
  txCenterHz,
}: {
  vfoCenterHz: number | null | undefined;
  txCenterHz: number | null | undefined;
}): number | null => {
  if (typeof vfoCenterHz === "number" && Number.isFinite(vfoCenterHz)) {
    return vfoCenterHz;
  }
  if (typeof txCenterHz === "number" && Number.isFinite(txCenterHz)) {
    return txCenterHz;
  }
  return null;
};

/** Typed entry and mode-enter jump the monitor; slider and user-pan do not. */
export const shouldJumpTxMonitor = ({
  source,
}: {
  source: TxMonitorUpdateSource;
}): boolean => {
  switch (source) {
    case "typed":
    case "mode-enter":
      return true;
    case "slider":
    case "user-pan":
      return false;
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
};

/**
 * Cold-load / attached monitor must preview at the planned Tx center. A stale
 * frequencyRange must not become the synthesizer view or the first frame is a
 * flat noise floor until a later settings pass arrives.
 */
export const resolveMockTxPreviewViewCenterHz = ({
  txCenterHz,
  monitorCenterHz,
  detached,
}: {
  txCenterHz: number;
  monitorCenterHz: number | null | undefined;
  detached: boolean;
}): number => {
  if (
    detached &&
    typeof monitorCenterHz === "number" &&
    Number.isFinite(monitorCenterHz)
  ) {
    return monitorCenterHz;
  }
  return txCenterHz;
};

/**
 * Geometry for Mock Tx transmit / preview sync.
 *
 * `alignMonitor: true` (mode-enter, typed jump, Start Tx default) recenters the
 * monitor on the carrier. `alignMonitor: false` (slider / user-panned view)
 * keeps the current monitor center so the carrier can sit off-center.
 */
export const resolveMockTxTransmitSettings = ({
  txCenterHz,
  viewCenterHz,
  viewSampleRateHz,
  txBandwidthHz,
  alignMonitor = true,
}: {
  txCenterHz: number;
  viewCenterHz?: number | null | undefined;
  viewSampleRateHz: number | null | undefined;
  txBandwidthHz: number;
  alignMonitor?: boolean;
}): {
  centerFrequencyHz: number;
  viewCenterHz: number;
  sampleRateHz: number;
  bandwidthHz: number;
} => {
  const resolvedViewSampleRateHz =
    typeof viewSampleRateHz === "number" &&
    Number.isFinite(viewSampleRateHz) &&
    viewSampleRateHz > 0
      ? viewSampleRateHz
      : txBandwidthHz;
  const resolvedViewCenterHz = alignMonitor
    ? txCenterHz
    : typeof viewCenterHz === "number" && Number.isFinite(viewCenterHz)
      ? viewCenterHz
      : txCenterHz;
  return {
    centerFrequencyHz: txCenterHz,
    viewCenterHz: resolvedViewCenterHz,
    sampleRateHz: resolvedViewSampleRateHz,
    bandwidthHz: txBandwidthHz,
  };
};

/** Keep the Mock Tx monitor span independent from the occupied Tx bandwidth. */
export const resolveMockTxTransmitViewSampleRateHz = ({
  isMockTx,
  viewerSampleRateHz,
  fallbackSampleRateHz,
}: {
  isMockTx: boolean;
  viewerSampleRateHz?: number | null;
  fallbackSampleRateHz?: number | null;
}): number | null => {
  if (!isMockTx) {
    return fallbackSampleRateHz ?? null;
  }
  const candidate =
    typeof viewerSampleRateHz === "number" &&
    Number.isFinite(viewerSampleRateHz) &&
    viewerSampleRateHz > 0
      ? viewerSampleRateHz
      : typeof fallbackSampleRateHz === "number" &&
          Number.isFinite(fallbackSampleRateHz) &&
          fallbackSampleRateHz > 0
        ? fallbackSampleRateHz
        : MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ;
  return Math.max(candidate, MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ);
};

/** Keep a global Mock Tx stream from inheriting another source's local VFO. */
export const resolveMockTxTransmitViewCenterHz = ({
  isMockTx,
  isSelectedSource,
  monitorCenterHz,
  txCenterHz,
  fallbackCenterHz,
}: {
  isMockTx: boolean;
  isSelectedSource: boolean;
  monitorCenterHz?: number | null;
  txCenterHz?: number | null;
  fallbackCenterHz?: number | null;
}): number | null => {
  if (
    isMockTx &&
    isSelectedSource &&
    typeof monitorCenterHz === "number" &&
    Number.isFinite(monitorCenterHz)
  ) {
    return monitorCenterHz;
  }
  if (typeof txCenterHz === "number" && Number.isFinite(txCenterHz)) {
    return txCenterHz;
  }
  return typeof fallbackCenterHz === "number" &&
    Number.isFinite(fallbackCenterHz)
    ? fallbackCenterHz
    : null;
};

/**
 * Select the monitor center for a transmit-settings synchronization pass.
 * Mock Tx owns a subscriber-local monitor window, so a missing local window
 * must stay missing and let the start path align it to the Tx carrier. It must
 * never fall back to the currently selected RX source's viewport.
 */
export const resolveMockTxMonitorCenterForSync = ({
  isMockTx,
  sourceViewCenterHz,
  sharedViewCenterHz,
}: {
  isMockTx: boolean;
  sourceViewCenterHz?: number | null;
  sharedViewCenterHz?: number | null;
}): number | null => {
  const candidate = isMockTx ? sourceViewCenterHz : sharedViewCenterHz;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
};

export const resolveTxSliderCenterHz = ({
  centerHz,
  fallbackCenterHz,
  visibleMinHz,
  visibleMaxHz,
  sampleRateHz,
}: TxSliderCenterInput): number => {
  const minHz = Number.isFinite(visibleMinHz) ? visibleMinHz : 0;
  const maxHz =
    Number.isFinite(visibleMaxHz) && visibleMaxHz > minHz
      ? visibleMaxHz
      : minHz + 1;
  const spanHz = maxHz - minHz;
  const safeSampleRateHz = Number.isFinite(sampleRateHz)
    ? Math.max(1, sampleRateHz)
    : spanHz;
  const viewportCenterHz = minHz + spanHz / 2;
  const preferredCenterHz = Number.isFinite(centerHz)
    ? centerHz
    : fallbackCenterHz;

  // Tx center and VFO center are independent. Even when the Tx baseband is
  // wider than the VFO viewport, a valid Tx center remains authoritative.
  if (Number.isFinite(preferredCenterHz)) return preferredCenterHz;

  if (safeSampleRateHz >= spanHz) return viewportCenterHz;

  const minCenterHz = minHz + safeSampleRateHz / 2;
  const maxCenterHz = maxHz - safeSampleRateHz / 2;
  const fallbackCenter = Number.isFinite(fallbackCenterHz)
    ? fallbackCenterHz
    : viewportCenterHz;
  const _centerToUse = Number.isFinite(preferredCenterHz)
    ? preferredCenterHz
    : fallbackCenter;

  return Math.min(maxCenterHz, Math.max(minCenterHz, fallbackCenter));
};
export const canShowTxSliderForSource = ({
  canTransmit,
  status,
}: {
  canTransmit: boolean;
  status?: string | null;
}): boolean =>
  canTransmit && (status === "standby" || status === "transmitting");
