import {
  computeHackrfApproxDbmOffsetDb,
  estimateHackrfTotalGainDb,
  quantizeHackrfLnaGainDb,
  quantizeHackrfVgaGainDb,
} from "@n-apt/spectrum/utils/hackrfCalibration";

describe("HackRF calibration helpers", () => {
  it("quantizes HackRF gain controls to the hardware step sizes", () => {
    expect(quantizeHackrfLnaGainDb(17.9)).toBe(16);
    expect(quantizeHackrfLnaGainDb(40.0)).toBe(40);
    expect(quantizeHackrfVgaGainDb(27.9)).toBe(26);
    expect(quantizeHackrfVgaGainDb(62.0)).toBe(62);
  });

  it("computes HackRF total gain from amp, LNA, and VGA", () => {
    expect(
      estimateHackrfTotalGainDb({
        ampEnabled: true,
        lnaGainDb: 17.9,
        vgaGainDb: 27.9,
      }),
    ).toBe(53);
  });

  it("subtracts HackRF gain from the approximate dBm offset", () => {
    expect(
      computeHackrfApproxDbmOffsetDb({
        baseCalibrationDb: 30,
        chainLossDb: 2.5,
        ampEnabled: true,
        lnaGainDb: 17.9,
        vgaGainDb: 27.9,
      }),
    ).toBeCloseTo(-20.5);
  });
});
