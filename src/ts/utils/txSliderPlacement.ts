export interface TxSliderCenterInput {
  centerHz: number;
  fallbackCenterHz: number;
  visibleMinHz: number;
  visibleMaxHz: number;
  sampleRateHz: number;
}

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
  const centerToUse = Number.isFinite(preferredCenterHz)
    ? preferredCenterHz
    : fallbackCenter;

  return Math.min(maxCenterHz, Math.max(minCenterHz, fallbackCenter));
};
