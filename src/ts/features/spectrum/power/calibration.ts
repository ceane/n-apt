import type { DevicePowerCalibration } from "@n-apt/consts/schemas/websocket";

export const computeApproximatePowerOffsetDb = (
  profile: DevicePowerCalibration | null | undefined,
  direction: "rx" | "tx",
  { gainDb = 0 }: { gainDb?: number } = {},
): number => {
  const path = profile?.[direction];
  if (!path || !Number.isFinite(path.base_calibration_db)) return 0;

  const chainLossDb = path.chain_loss_db ?? 0;
  const gainCorrectionDbPerDb = path.gain_correction_db_per_db ?? 0;
  if (
    !Number.isFinite(chainLossDb) ||
    !Number.isFinite(gainCorrectionDbPerDb) ||
    !Number.isFinite(gainDb)
  ) {
    return 0;
  }

  return (
    path.base_calibration_db +
    chainLossDb +
    gainCorrectionDbPerDb * gainDb
  );
};
