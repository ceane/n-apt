/**
 * Tests for waterfall data validation
 */

import { 
  validateWaterfallData,
  validateWaterfallDataComprehensive,
} from "@n-apt/validation";

describe('Waterfall Data Validation', () => {
  describe('Basic Validation', () => {
    test('should validate valid Uint8ClampedArray waterfall data', () => {
      const validData = new Uint8ClampedArray([255, 128, 0, 255, 100, 200, 50, 255]);
      expect(validateWaterfallData(validData)).toBe(true);
    });

    test('should reject non-Uint8ClampedArray data', () => {
      expect(validateWaterfallData([255, 128, 0, 255])).toBe(false);
      expect(validateWaterfallData('not an array')).toBe(false);
      expect(validateWaterfallData(null)).toBe(false);
      expect(validateWaterfallData(new Float32Array([1, 2, 3]))).toBe(false);
    });

    test('should handle Uint8ClampedArray clamping behavior', () => {
      // Uint8ClampedArray automatically clamps values to 0-255 range
      const clampedData = new Uint8ClampedArray([256, 128, -1, 255]);
      // Values get clamped: 256 -> 255, -1 -> 0
      expect(clampedData[0]).toBe(255); // 256 clamped to 255
      expect(clampedData[2]).toBe(0);   // -1 clamped to 0
      expect(validateWaterfallData(clampedData)).toBe(true); // Now valid after clamping
    });

    test('should validate with expected length', () => {
      const data = new Uint8ClampedArray(800); // 200px * 1px * 4 (RGBA)
      expect(validateWaterfallData(data, 800)).toBe(true);
      expect(validateWaterfallData(data, 801)).toBe(false);
    });

    test('should validate RGBA structure', () => {
      const rgbaData = new Uint8ClampedArray(16); // 4 pixels * 4 channels
      // Fill with valid RGBA data
      for (let i = 0; i < rgbaData.length; i += 4) {
        rgbaData[i] = 255;     // R
        rgbaData[i + 1] = 128; // G
        rgbaData[i + 2] = 64;  // B
        rgbaData[i + 3] = 255; // A (should be 255)
      }
      expect(validateWaterfallData(rgbaData)).toBe(true);
    });
  });

  describe('Comprehensive Validation', () => {
    test('should pass validation for perfect waterfall data', () => {
      const perfectData = new Uint8ClampedArray(800); // 200x1x4 RGBA
      // Fill with realistic waterfall color data
      for (let i = 0; i < perfectData.length; i += 4) {
        perfectData[i] = Math.floor(Math.random() * 256);     // R
        perfectData[i + 1] = Math.floor(Math.random() * 256); // G
        perfectData[i + 2] = Math.floor(Math.random() * 256); // B
        perfectData[i + 3] = 255;                            // A (always 255)
      }

      const result = validateWaterfallDataComprehensive(perfectData, {
        width: 200,
        height: 1,
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.metadata.dataPoints).toBe(800);
      expect(result.metadata.width).toBe(200);
      expect(result.metadata.height).toBe(1);
      expect(result.metadata.colorAnalysis.hasColor).toBe(true);
    });

    test('should detect dimension mismatch', () => {
      const data = new Uint8ClampedArray(800); // Wrong size for 200x2
      const result = validateWaterfallDataComprehensive(data, {
        width: 200,
        height: 2, // Expected 1600 bytes (200*2*4)
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Data length (800) does not match expected dimensions (200x2 = 1600)');
    });

    test('should warn about FFT size mismatch', () => {
      const data = new Uint8ClampedArray(1024); // 256x1x4
      const result = validateWaterfallDataComprehensive(data, {
        width: 256,
        height: 1,
        fftSize: 2048, // Expected 2048 but width is 256
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Waterfall width (256) may not match FFT size (2048)');
    });

    test('should detect all-black waterfall data', () => {
      const blackData = new Uint8ClampedArray(800).fill(0);
      const result = validateWaterfallDataComprehensive(blackData, {
        width: 200,
        height: 1,
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Waterfall contains no color data - completely black');
      expect(result.metadata.colorAnalysis.hasColor).toBe(false);
      expect(result.metadata.colorAnalysis.zeroPixels).toBe(200);
    });

    test('should provide context-specific warnings for first frame', () => {
      const blackData = new Uint8ClampedArray(800).fill(0);
      const result = validateWaterfallDataComprehensive(blackData, {
        width: 200,
        height: 1,
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: true // First frame context
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('First frame contains no color - waterfall may be initializing');
    });

    test('should error on completely black data when paused', () => {
      const blackData = new Uint8ClampedArray(800).fill(0);
      const result = validateWaterfallDataComprehensive(blackData, {
        width: 200,
        height: 1,
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: true, // Paused context
        isFirstFrame: false
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Waterfall is completely black when paused - possible data issue');
    });

    test('should detect alpha channel issues', () => {
      const data = new Uint8ClampedArray(800);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;     // R
        data[i + 1] = 128; // G
        data[i + 2] = 64;  // B
        data[i + 3] = 128; // A (should be 255)
      }

      const result = validateWaterfallDataComprehensive(data, {
        width: 200,
        height: 1,
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Found 200 pixels with non-255 alpha values');
    });

    test('should analyze color range correctly', () => {
      const data = new Uint8ClampedArray(800);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 10;      // R (min)
        data[i + 1] = 128; // G (mid)
        data[i + 2] = 245; // B (max)
        data[i + 3] = 255;  // A
      }

      const result = validateWaterfallDataComprehensive(data, {
        width: 200,
        height: 1,
        fftSize: 2048,
        sampleRate: 2048000,
        centerFrequencyHz: 100000000,
        timestamp: Date.now(),
        isPaused: false,
        isFirstFrame: false
      });

      expect(result.isValid).toBe(true);
      expect(result.metadata.colorAnalysis.minColorValue).toBe(10);
      expect(result.metadata.colorAnalysis.maxColorValue).toBe(245);
      expect(result.metadata.colorAnalysis.hasColor).toBe(true);
    });

    test('should validate timestamp sanity', () => {
      const data = new Uint8ClampedArray(800);
      // Fill with valid color data
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 100;
        data[i + 1] = 150;
        data[i + 2] = 200;
        data[i + 3] = 255;
      }

      const futureTimestamp = Date.now() + 10000; // 10 seconds in future
      
      const result = validateWaterfallDataComprehensive(data, {
        width: 200,
        height: 1,
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
      const largeData = new Uint8ClampedArray(3200); // 800x1x4 - large waterfall
      // Fill with realistic data
      for (let i = 0; i < largeData.length; i += 4) {
        largeData[i] = Math.floor(Math.random() * 256);
        largeData[i + 1] = Math.floor(Math.random() * 256);
        largeData[i + 2] = Math.floor(Math.random() * 256);
        largeData[i + 3] = 255;
      }

      const result = validateWaterfallDataComprehensive(largeData, {
        width: 800,
        height: 1,
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
      expect(result.metadata.colorAnalysis.hasColor).toBe(true);
    });
  });
});
