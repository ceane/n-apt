/**
 * Tests for validation system
 */

import {
  isValidAuthInfo,
  isValidAuthResult,
  isValidWebSocketMessage,
  isValidSpectrumFrame,
  isValidCaptureRequest,
  calculateExpectedLatency,
  calculateTrustLevel,
  addIntegrityMetadata,
} from "@n-apt/validation";

describe('Validation System', () => {
  describe('Authentication Validation', () => {
    test('should validate valid auth info', () => {
      const validAuthInfo = {
        has_passkeys: true,
      };
      
      expect(isValidAuthInfo(validAuthInfo)).toBe(true);
    });

    test('should reject invalid auth info', () => {
      const invalidAuthInfo = {
        has_passkeys: 'yes', // Should be boolean
      };
      
      expect(isValidAuthInfo(invalidAuthInfo)).toBe(false);
    });

    test('should validate valid auth result', () => {
      const validAuthResult = {
        token: 'abc123def456',
        expires_in: 3600,
      };
      
      expect(isValidAuthResult(validAuthResult)).toBe(true);
    });

    test('should reject invalid auth result', () => {
      const invalidAuthResult = {
        token: 123, // Should be string
        expires_in: 3600,
      };
      
      expect(isValidAuthResult(invalidAuthResult)).toBe(false);
    });
  });

  describe('WebSocket Message Validation', () => {
    test('should validate valid frequency range message', () => {
      const validMessage = {
        type: 'frequency_range',
        min_hz: 100_500_000,
        max_hz: 200_500_000,
      };
      
      expect(isValidWebSocketMessage(validMessage)).toBe(true);
    });

    test('should validate valid pause message', () => {
      const validMessage = {
        type: 'pause',
        paused: true,
      };
      
      expect(isValidWebSocketMessage(validMessage)).toBe(true);
    });

    test('should reject invalid message type', () => {
      const invalidMessage = {
        type: 'invalid_type',
        min_hz: 100_500_000,
        max_hz: 200_500_000,
      };
      
      expect(isValidWebSocketMessage(invalidMessage)).toBe(false);
    });
  });

  describe('Spectrum Frame Validation', () => {
    test('should validate valid spectrum frame', () => {
      const validFrame = {
        id: 'frame-1',
        label: 'Test Frame',
        min_hz: 100_500_000,
        max_hz: 200_500_000,
        description: 'Test description',
      };
      
      expect(isValidSpectrumFrame(validFrame)).toBe(true);
    });

    test('should reject spectrum frame with invalid frequency range', () => {
      const invalidFrame = {
        id: 'frame-1',
        label: 'Test Frame',
        min_hz: 200_500_000, // Higher than max
        max_hz: 100_500_000,
        description: 'Test description',
      };
      
      expect(isValidSpectrumFrame(invalidFrame)).toBe(false);
    });
  });

  describe('Capture Request Validation', () => {
    test('should validate valid capture request', () => {
      const validRequest = {
        jobId: 'job-123',
        fragments: [
          { minFreq: 100_000_000, maxFreq: 200_000_000 },
          { minFreq: 300_000_000, maxFreq: 400_000_000 },
        ],
        durationS: 60.0,
        fileType: '.napt' as const,
        acquisitionMode: 'stepwise' as const,
        encrypted: true,
        fftSize: 2048,
        fftWindow: 'hann',
      };
      
      expect(isValidCaptureRequest(validRequest)).toBe(true);
    });
 
    test('should reject capture request with invalid fragments', () => {
      const invalidRequest = {
        jobId: 'job-123',
        fragments: [
          { minFreq: 200_000_000, maxFreq: 100_000_000 }, // Invalid range
        ],
        durationS: 60.0,
        fileType: '.napt' as const,
        acquisitionMode: 'stepwise' as const,
        encrypted: true,
        fftSize: 2048,
        fftWindow: 'hann',
      };
      
      expect(isValidCaptureRequest(invalidRequest)).toBe(false);
    });
  });

  describe('Latency and Trust Level Calculations', () => {
    test('should calculate expected latency correctly', () => {
      expect(calculateExpectedLatency(1024)).toBe('none');
      expect(calculateExpectedLatency(2048)).toBe('normal');
      expect(calculateExpectedLatency(4096)).toBe('high');
      expect(calculateExpectedLatency(8192)).toBe('high');
      expect(calculateExpectedLatency()).toBe('none');
    });

    test('should calculate trust level correctly', () => {
      expect(calculateTrustLevel('mock_apt', true)).toBe('high');
      expect(calculateTrustLevel('rtl-sdr', true)).toBe('medium');
      expect(calculateTrustLevel('rtl-sdr', false)).toBe('low');
      expect(calculateTrustLevel('unknown', true)).toBe('low');
    });
  });

  describe('Integrity Metadata', () => {
    test('should add integrity metadata to SDR data', () => {
      const sdrData = {
        fftSize: 2048,
        gain: 10.5,
      };
      
      const enhancedData = addIntegrityMetadata(sdrData, 'rtl-sdr', 2048, 15.5);
      
      expect(enhancedData.integrity).toBeDefined();
      expect(enhancedData.integrity?.trustLevel).toBe('medium');
      expect(enhancedData.latency).toBeDefined();
      expect(enhancedData.latency?.expectedLatency).toBe('normal');
      expect(enhancedData.latency?.processingTimeMs).toBe(15.5);
    });
  });
});
