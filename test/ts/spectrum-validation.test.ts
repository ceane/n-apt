/**
 * Tests for spectrum data validation
 */

import { 
  validateSpectrumData,
  validateSpectrumDataComprehensive,
  isValidFloat32Array,
} from "@n-apt/validation";

describe('Spectrum Data Validation', () => {
  describe('Basic Validation', () => {
    test('should validate valid Float32Array spectrum data', () => {
      const validData = new Float32Array([1.0, 2.0, 3.0, 4.0]);
      expect(validateSpectrumData(validData)).toBe(true);
    });

    test('should reject non-Float32Array data', () => {
      expect(validateSpectrumData([1, 2, 3, 4])).toBe(false);
      expect(validateSpectrumData('not an array')).toBe(false);
      expect(validateSpectrumData(null)).toBe(false);
    });

    test('should reject data with infinite values', () => {
      const dataWithInfinity = new Float32Array([1.0, Infinity, 3.0]);
      expect(validateSpectrumData(dataWithInfinity)).toBe(false);
    });

    test('should reject data with NaN values', () => {
      const dataWithNaN = new Float32Array([1.0, NaN, 3.0]);
      expect(validateSpectrumData(dataWithNaN)).toBe(false);
    });

    test('should validate with expected length', () => {
      const data = new Float32Array([1.0, 2.0, 3.0, 4.0]);
      expect(validateSpectrumData(data, 4)).toBe(true);
      expect(validateSpectrumData(data, 5)).toBe(false);
    });
  });

  describe('Comprehensive Validation', () => {
    test('should pass validation for perfect spectrum data', () => {
      const perfectData = new Float32Array(2048);
      // Fill with realistic spectrum values (-100 to 0 dB range)
      for (let i = 0; i < perfectData.length; i++) {
        perfectData[i] = -Math.random() * 100; // Random values between -100 and 0
      }

      const result = validateSpectrumDataComprehensive(perfectData, {
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.metadata.dataPoints).toBe(2048);
      expect(result.metadata.fftSize).toBe(2048);
    });

    test('should detect FFT size mismatch', () => {
      const data = new Float32Array(1024);
      const result = validateSpectrumDataComprehensive(data, {
        fftSize: 2048, // Expected 2048 but got 1024
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Data length (1024) does not match expected FFT size (2048)');
    });

    test('should warn about non-power-of-2 data length', () => {
      const data = new Float32Array(1000); // Not a power of 2
      const result = validateSpectrumDataComprehensive(data, {
        fftSize: 1000,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Data length (1000) is not a power of 2, unusual for FFT data');
    });

    test('should detect invalid sample rate', () => {
      const data = new Float32Array(2048);
      const result = validateSpectrumDataComprehensive(data, {
        fftSize: 2048,
        sampleRate: -1000, // Invalid negative sample rate
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid sample rate: -1000');
    });

    test('should warn about very high sample rate', () => {
      const data = new Float32Array(2048);
      const result = validateSpectrumDataComprehensive(data, {
        fftSize: 2048,
        sampleRate: 20000000, // 20 MHz - very high
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Very high sample rate: 20000000 Hz');
    });

    test('should detect all-zero data', () => {
      const zeroData = new Float32Array(2048).fill(0);
      const result = validateSpectrumDataComprehensive(zeroData, {
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('All spectrum values are zero - possible signal issue');
    });

    test('should provide context-specific warnings for first frame', () => {
      const zeroData = new Float32Array(2048).fill(0);
      const result = validateSpectrumDataComprehensive(zeroData, {
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: true // First frame context
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('First frame contains all zeros - device may be initializing');
    });

    test('should validate timestamp sanity', () => {
      const data = new Float32Array(2048);
      const futureTimestamp = Date.now() + 10000; // 10 seconds in future
      
      const result = validateSpectrumDataComprehensive(data, {
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: futureTimestamp,
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should measure validation performance', () => {
      const largeData = new Float32Array(8192); // Large FFT size
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = -Math.random() * 100;
      }

      const result = validateSpectrumDataComprehensive(largeData, {
        fftSize: 8192,
        sampleRate: 8192000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: true, // Paused scenario
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.metadata.validationTime).toBeGreaterThan(0);
      expect(result.metadata.validationTime).toBeLessThan(100); // Should be fast
    });
  });
});
