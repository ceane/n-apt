/**
 * Simple test to verify validation exports work
 */

import {
  isValidSpectrumData,
  isValidWaterfallData,
  validateSpectrumDataComprehensive,
  validateWaterfallDataComprehensive,
  validateWebSocketMessage,
} from '@n-apt/validation';

describe('Validation Exports', () => {
  test('should export isValidSpectrumData', () => {
    expect(typeof isValidSpectrumData).toBe('function');
    
    const validData = new Float32Array([1.0, 2.0, 3.0]);
    expect(isValidSpectrumData(validData)).toBe(true);
    expect(isValidSpectrumData([1, 2, 3])).toBe(false);
  });

  test('should export isValidWaterfallData', () => {
    expect(typeof isValidWaterfallData).toBe('function');
    
    const validData = new Uint8ClampedArray([255, 128, 0, 255]);
    expect(isValidWaterfallData(validData)).toBe(true);
    expect(isValidWaterfallData([255, 128, 0, 255])).toBe(false);
  });

  test('should export comprehensive validation functions', () => {
    expect(typeof validateSpectrumDataComprehensive).toBe('function');
    expect(typeof validateWaterfallDataComprehensive).toBe('function');
  });

  test('should export WebSocket validation', () => {
    expect(typeof validateWebSocketMessage).toBe('function');
    
    // Test that the function exists and returns a boolean
    const result = validateWebSocketMessage({ type: "test" });
    expect(typeof result).toBe('boolean');
  });
});
