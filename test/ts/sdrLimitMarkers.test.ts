import { buildSdrLimitMarkers } from "@n-apt/math/sdrLimitMarkers";

jest.mock("@n-apt/math/frequency", () => ({
  formatFrequency: jest.fn((freq: number) => `${freq} MHz`),
}));

import { formatFrequency } from "@n-apt/math/frequency";

describe("SDR Limit Markers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("buildSdrLimitMarkers", () => {
    test("returns empty array when no device markers are provided", () => {
      expect(buildSdrLimitMarkers(null)).toEqual([]);
      expect(buildSdrLimitMarkers(undefined)).toEqual([]);
    });

    test("uses device markers directly", () => {
      const result = buildSdrLimitMarkers([
        { kind: "lower_limit", freq_hz: 100 },
        { kind: "upper_limit", freq_hz: 200, label: "Custom Upper" },
      ]);

      expect(result).toEqual([
        {
          freq: 100,
          kind: "lower_limit",
          label: "100 MHz / lower limit",
        },
        {
          freq: 200,
          kind: "upper_limit",
          label: "Custom Upper",
        },
      ]);
      expect(formatFrequency).toHaveBeenCalledWith(100);
      expect(formatFrequency).not.toHaveBeenCalledWith(200);
    });

    test("skips invalid marker frequencies", () => {
      expect(
        buildSdrLimitMarkers([
          { kind: "lower_limit", freq_hz: -1 },
          { kind: "upper_limit", freq_hz: Number.NaN },
        ]),
      ).toEqual([]);
    });
  });
});
