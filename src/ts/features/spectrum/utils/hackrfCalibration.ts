export interface HackrfGainInputs {
  ampEnabled?: boolean;
  lnaGainDb?: number;
  vgaGainDb?: number;
  totalGainDb?: number;
}

export interface HackrfCalibrationInputs extends HackrfGainInputs {
  baseCalibrationDb?: number;
  chainLossDb?: number;
}

const HACKRF_AMP_GAIN_DB = 11;
const HACKRF_LNA_STEP_DB = 8;
const HACKRF_LNA_MAX_DB = 40;
const HACKRF_VGA_STEP_DB = 2;
const HACKRF_VGA_MAX_DB = 62;
const HACKRF_DEFAULT_BASE_CALIBRATION_DB = 30;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const quantizeDownToStep = (value: number, step: number, max: number) => {
  const clamped = clamp(Number.isFinite(value) ? value : 0, 0, max);
  return Math.floor(clamped / step) * step;
};

export const quantizeHackrfLnaGainDb = (gainDb: number): number =>
  quantizeDownToStep(gainDb, HACKRF_LNA_STEP_DB, HACKRF_LNA_MAX_DB);

export const quantizeHackrfVgaGainDb = (gainDb: number): number =>
  quantizeDownToStep(gainDb, HACKRF_VGA_STEP_DB, HACKRF_VGA_MAX_DB);

export const estimateHackrfTotalGainDb = ({
  ampEnabled = false,
  lnaGainDb = 0,
  vgaGainDb = 0,
  totalGainDb,
}: HackrfGainInputs): number => {
  if (typeof totalGainDb === "number" && Number.isFinite(totalGainDb)) {
    return Math.max(0, totalGainDb);
  }

  return (
    (ampEnabled ? HACKRF_AMP_GAIN_DB : 0) +
    quantizeHackrfLnaGainDb(lnaGainDb) +
    quantizeHackrfVgaGainDb(vgaGainDb)
  );
};

export const computeHackrfApproxDbmOffsetDb = ({
  ampEnabled = false,
  lnaGainDb = 0,
  vgaGainDb = 0,
  totalGainDb,
  baseCalibrationDb = HACKRF_DEFAULT_BASE_CALIBRATION_DB,
  chainLossDb = 0,
}: HackrfCalibrationInputs): number => {
  const effectiveGainDb = estimateHackrfTotalGainDb({
    ampEnabled,
    lnaGainDb,
    vgaGainDb,
    totalGainDb,
  });

  return baseCalibrationDb + chainLossDb - effectiveGainDb;
};
