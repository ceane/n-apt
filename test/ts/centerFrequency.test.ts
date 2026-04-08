import { calculateCenterFrequency } from '../../src/ts/utils/centerFrequency';

// Mock the FrequencyRange type
interface FrequencyRange {
  min: number;
  max: number;
}

describe('Center Frequency Utilities', () => {
  describe('calculateCenterFrequency', () => {
    test('should calculate center frequency correctly', () => {
      const range: FrequencyRange = { min: 100, max: 200 };
      const result = calculateCenterFrequency(range);
      expect(result).toBe(150);
    });

    test('should return null for null input', () => {
      const result = calculateCenterFrequency(null);
      expect(result).toBeNull();
    });

    test('should handle equal min and max values', () => {
      const range: FrequencyRange = { min: 100, max: 100 };
      const result = calculateCenterFrequency(range);
      expect(result).toBe(100);
    });

    test('should handle negative frequencies', () => {
      const range: FrequencyRange = { min: -200, max: -100 };
      const result = calculateCenterFrequency(range);
      expect(result).toBe(-150);
    });

    test('should handle mixed positive and negative frequencies', () => {
      const range: FrequencyRange = { min: -100, max: 100 };
      const result = calculateCenterFrequency(range);
      expect(result).toBe(0);
    });

    test('should return null for infinite min value', () => {
      const range: FrequencyRange = { min: Infinity, max: 200 };
      const result = calculateCenterFrequency(range);
      expect(result).toBeNull();
    });

    test('should return null for infinite max value', () => {
      const range: FrequencyRange = { min: 100, max: Infinity };
      const result = calculateCenterFrequency(range);
      expect(result).toBeNull();
    });

    test('should return null for NaN values', () => {
      const range1: FrequencyRange = { min: NaN, max: 200 };
      const result1 = calculateCenterFrequency(range1);
      expect(result1).toBeNull();

      const range2: FrequencyRange = { min: 100, max: NaN };
      const result2 = calculateCenterFrequency(range2);
      expect(result2).toBeNull();
    });

    test('should handle very small frequencies', () => {
      const range: FrequencyRange = { min: 0.001, max: 0.003 };
      const result = calculateCenterFrequency(range);
      expect(result).toBe(0.002);
    });

    test('should handle very large frequencies', () => {
      const range: FrequencyRange = { min: 1000000, max: 2000000 };
      const result = calculateCenterFrequency(range);
      expect(result).toBe(1500000);
    });
  });
});
