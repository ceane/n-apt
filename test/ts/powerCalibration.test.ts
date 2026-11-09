import { computeApproximatePowerOffsetDb } from "@n-apt/spectrum/power/calibration";
import type { DevicePowerCalibration } from "@n-apt/consts/schemas/websocket";

describe("shared power calibration", () => {
  const profile: DevicePowerCalibration = {
    rx: {
      base_calibration_db: 30,
      chain_loss_db: 2,
      gain_correction_db_per_db: -1,
    },
    tx: { base_calibration_db: 15 },
  };

  it("uses the receive profile and compensates receiver gain", () => {
    expect(
      computeApproximatePowerOffsetDb(profile, "rx", { gainDb: 20 }),
    ).toBe(12);
  });

  it("keeps transmit calibration separate from receive gain", () => {
    expect(
      computeApproximatePowerOffsetDb(profile, "tx", { gainDb: 40 }),
    ).toBe(15);
  });

  it("uses no gain correction when the profile omits one", () => {
    expect(
      computeApproximatePowerOffsetDb(
        { rx: { base_calibration_db: 7 } },
        "rx",
        { gainDb: 12 },
      ),
    ).toBe(7);
  });

  it("returns zero for invalid offsets instead of contaminating the spectrum", () => {
    expect(
      computeApproximatePowerOffsetDb(
        { rx: { base_calibration_db: Number.NaN } },
        "rx",
        { gainDb: Number.POSITIVE_INFINITY },
      ),
    ).toBe(0);
  });
});
