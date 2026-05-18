import { buildSdrLimitMarkers } from "../../src/ts/utils/sdrLimitMarkers";

// Mock the formatFrequency function
jest.mock("../../src/ts/utils/frequency", () => ({
  formatFrequency: jest.fn((freq: number) => `${freq} MHz`),
}));

import { formatFrequency } from "../../src/ts/utils/frequency";

// Mock SdrSettingsConfig type
interface MockSdrSettingsConfig {
  sample_rate: number;
  center_frequency: number;
  limits?: {
    lower_limit_hz?: number;
    upper_limit_hz?: number;
    lower_limit_label?: string;
    upper_limit_label?: string;
  };
}

describe("SDR Limit Markers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("buildSdrLimitMarkers", () => {
    test("should return empty array when sdrSettings is null", () => {
      const result = buildSdrLimitMarkers(null);
      expect(result).toEqual([]);
    });

    test("should return empty array when sdrSettings is undefined", () => {
      const result = buildSdrLimitMarkers(undefined);
      expect(result).toEqual([]);
    });

    test("should return empty array when limits is undefined", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
      };
      const result = buildSdrLimitMarkers(sdrSettings);
      expect(result).toEqual([]);
    });

    test("should return empty array when limits is null", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
      };
      const result = buildSdrLimitMarkers(sdrSettings);
      expect(result).toEqual([]);
    });

    test("should create marker for lower limit only", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        freq: 100,
        kind: "lower_limit",
        label: "100 MHz / Lower limit",
      });
      expect(formatFrequency).toHaveBeenCalledWith(100);
    });

    test("should create marker for upper limit only", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          upper_limit_hz: 200,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        freq: 200,
        kind: "upper_limit",
        label: "200 MHz / Upper limit",
      });
      expect(formatFrequency).toHaveBeenCalledWith(200);
    });

    test("should create markers for both limits", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100,
          upper_limit_hz: 200,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        kind: "lower_limit",
        label: "100 MHz / Lower limit",
      });
      expect(result[1]).toEqual({
        freq: 200,
        kind: "upper_limit",
        label: "200 MHz / Upper limit",
      });
      expect(formatFrequency).toHaveBeenCalledWith(100);
      expect(formatFrequency).toHaveBeenCalledWith(200);
    });

    test("should use custom labels when provided", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100,
          upper_limit_hz: 200,
          lower_limit_label: "Custom Lower",
          upper_limit_label: "Custom Upper",
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        kind: "lower_limit",
        label: "Custom Lower",
      });
      expect(result[1]).toEqual({
        freq: 200,
        kind: "upper_limit",
        label: "Custom Upper",
      });
      expect(formatFrequency).not.toHaveBeenCalled();
    });

    test("should use custom label for lower limit only", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100,
          upper_limit_hz: 200,
          lower_limit_label: "Custom Lower",
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        kind: "lower_limit",
        label: "Custom Lower",
      });
      expect(result[1]).toEqual({
        freq: 200,
        kind: "upper_limit",
        label: "200 MHz / Upper limit",
      });
      expect(formatFrequency).toHaveBeenCalledWith(200);
    });

    test("should use custom label for upper limit only", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100,
          upper_limit_hz: 200,
          upper_limit_label: "Custom Upper",
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        kind: "lower_limit",
        label: "100 MHz / Lower limit",
      });
      expect(result[1]).toEqual({
        freq: 200,
        kind: "upper_limit",
        label: "Custom Upper",
      });
      expect(formatFrequency).toHaveBeenCalledWith(100);
    });

    test("should handle zero frequency values", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 0,
          upper_limit_hz: 0,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 0,
        kind: "lower_limit",
        label: "0 MHz / Lower limit",
      });
      expect(result[1]).toEqual({
        freq: 0,
        kind: "upper_limit",
        label: "0 MHz / Upper limit",
      });
    });

    test("should handle negative frequency values", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: -100,
          upper_limit_hz: -50,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: -100,
        kind: "lower_limit",
        label: "-100 MHz / Lower limit",
      });
      expect(result[1]).toEqual({
        freq: -50,
        kind: "upper_limit",
        label: "-50 MHz / Upper limit",
      });
    });

    test("should handle very large frequency values", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 1000000,
          upper_limit_hz: 2000000,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 1000000,
        kind: "lower_limit",
        label: "1000000 MHz / Lower limit",
      });
      expect(result[1]).toEqual({
        freq: 2000000,
        kind: "upper_limit",
        label: "2000000 MHz / Upper limit",
      });
    });

    test("should handle decimal frequency values", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100.5,
          upper_limit_hz: 200.75,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100.5,
        kind: "lower_limit",
        label: "100.5 MHz / Lower limit",
      });
      expect(result[1]).toEqual({
        freq: 200.75,
        kind: "upper_limit",
        label: "200.75 MHz / Upper limit",
      });
    });

    test("should handle empty custom labels", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100,
          upper_limit_hz: 200,
          lower_limit_label: "",
          upper_limit_label: "",
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        kind: "lower_limit",
        label: "",
      });
      expect(result[1]).toEqual({
        freq: 200,
        kind: "upper_limit",
        label: "",
      });
      expect(formatFrequency).not.toHaveBeenCalled();
    });

    test("should maintain order: lower limit first, then upper limit", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {
          lower_limit_hz: 100,
          upper_limit_hz: 200,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0].freq).toBe(100); // Lower limit first
      expect(result[1].freq).toBe(200); // Upper limit second
    });

    test("should handle limits object with no valid properties", () => {
      const sdrSettings: MockSdrSettingsConfig = {
        sample_rate: 2400000,
        center_frequency: 100000000,
        limits: {},
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toEqual([]);
      expect(formatFrequency).not.toHaveBeenCalled();
    });
  });
});
