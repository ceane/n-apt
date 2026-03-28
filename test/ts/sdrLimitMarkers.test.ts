import { buildSdrLimitMarkers } from '../../src/ts/utils/sdrLimitMarkers';

// Mock the formatFrequency function
jest.mock('../../src/ts/utils/frequency', () => ({
  formatFrequency: jest.fn((freq: number) => `${freq} MHz`),
}));

import { formatFrequency } from '../../src/ts/utils/frequency';

// Mock SdrSettingsConfig type
interface MockSdrSettingsConfig {
  limits?: {
    lower_limit_mhz?: number;
    upper_limit_mhz?: number;
    lower_limit_label?: string;
    upper_limit_label?: string;
  } | null;
}

describe('SDR Limit Markers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildSdrLimitMarkers', () => {
    test('should return empty array when sdrSettings is null', () => {
      const result = buildSdrLimitMarkers(null);
      expect(result).toEqual([]);
    });

    test('should return empty array when sdrSettings is undefined', () => {
      const result = buildSdrLimitMarkers(undefined);
      expect(result).toEqual([]);
    });

    test('should return empty array when limits is undefined', () => {
      const sdrSettings: MockSdrSettingsConfig = {};
      const result = buildSdrLimitMarkers(sdrSettings);
      expect(result).toEqual([]);
    });

    test('should return empty array when limits is null', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: null,
      };
      const result = buildSdrLimitMarkers(sdrSettings);
      expect(result).toEqual([]);
    });

    test('should create marker for lower limit only', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        freq: 100,
        label: '100 MHz / Lower limit',
      });
      expect(formatFrequency).toHaveBeenCalledWith(100);
    });

    test('should create marker for upper limit only', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          upper_limit_mhz: 200,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        freq: 200,
        label: '200 MHz / Upper limit',
      });
      expect(formatFrequency).toHaveBeenCalledWith(200);
    });

    test('should create markers for both limits', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100,
          upper_limit_mhz: 200,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        label: '100 MHz / Lower limit',
      });
      expect(result[1]).toEqual({
        freq: 200,
        label: '200 MHz / Upper limit',
      });
      expect(formatFrequency).toHaveBeenCalledWith(100);
      expect(formatFrequency).toHaveBeenCalledWith(200);
    });

    test('should use custom labels when provided', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100,
          upper_limit_mhz: 200,
          lower_limit_label: 'Custom Lower',
          upper_limit_label: 'Custom Upper',
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        label: 'Custom Lower',
      });
      expect(result[1]).toEqual({
        freq: 200,
        label: 'Custom Upper',
      });
      expect(formatFrequency).not.toHaveBeenCalled();
    });

    test('should use custom label for lower limit only', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100,
          upper_limit_mhz: 200,
          lower_limit_label: 'Custom Lower',
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        label: 'Custom Lower',
      });
      expect(result[1]).toEqual({
        freq: 200,
        label: '200 MHz / Upper limit',
      });
      expect(formatFrequency).toHaveBeenCalledWith(200);
    });

    test('should use custom label for upper limit only', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100,
          upper_limit_mhz: 200,
          upper_limit_label: 'Custom Upper',
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        label: '100 MHz / Lower limit',
      });
      expect(result[1]).toEqual({
        freq: 200,
        label: 'Custom Upper',
      });
      expect(formatFrequency).toHaveBeenCalledWith(100);
    });

    test('should handle zero frequency values', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 0,
          upper_limit_mhz: 0,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 0,
        label: '0 MHz / Lower limit',
      });
      expect(result[1]).toEqual({
        freq: 0,
        label: '0 MHz / Upper limit',
      });
    });

    test('should handle negative frequency values', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: -100,
          upper_limit_mhz: -50,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: -100,
        label: '-100 MHz / Lower limit',
      });
      expect(result[1]).toEqual({
        freq: -50,
        label: '-50 MHz / Upper limit',
      });
    });

    test('should handle very large frequency values', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 1000000,
          upper_limit_mhz: 2000000,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 1000000,
        label: '1000000 MHz / Lower limit',
      });
      expect(result[1]).toEqual({
        freq: 2000000,
        label: '2000000 MHz / Upper limit',
      });
    });

    test('should handle decimal frequency values', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100.5,
          upper_limit_mhz: 200.75,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100.5,
        label: '100.5 MHz / Lower limit',
      });
      expect(result[1]).toEqual({
        freq: 200.75,
        label: '200.75 MHz / Upper limit',
      });
    });

    test('should handle empty custom labels', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100,
          upper_limit_mhz: 200,
          lower_limit_label: '',
          upper_limit_label: '',
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        freq: 100,
        label: '',
      });
      expect(result[1]).toEqual({
        freq: 200,
        label: '',
      });
      expect(formatFrequency).not.toHaveBeenCalled();
    });

    test('should maintain order: lower limit first, then upper limit', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {
          lower_limit_mhz: 100,
          upper_limit_mhz: 200,
        },
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toHaveLength(2);
      expect(result[0].freq).toBe(100); // Lower limit first
      expect(result[1].freq).toBe(200); // Upper limit second
    });

    test('should handle limits object with no valid properties', () => {
      const sdrSettings: MockSdrSettingsConfig = {
        limits: {},
      };

      const result = buildSdrLimitMarkers(sdrSettings);

      expect(result).toEqual([]);
      expect(formatFrequency).not.toHaveBeenCalled();
    });
  });
});
