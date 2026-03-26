/**
 * Tests for WebSocket validation system
 */

import {
  validateWebSocketMessage,
  validateStatusMessage,
  validateCaptureStatus,
  validateAutoFftOptions,
  validateAuthInfo,
  validateAuthResult,
  validateSessionValidation,
  processWebSocketMessageWithValidation,
  validateReduxAction,
  getValidationMetrics,
  resetValidationMetrics,
} from "@n-apt/validation";

describe('WebSocket Validation System', () => {
  beforeEach(() => {
    resetValidationMetrics();
  });

  describe('WebSocket Message Validation', () => {
    test('should validate valid WebSocket messages', () => {
      const validMessage = {
        type: "status",
        device_state: "connected",
        device_name: "RTL-SDR Device",
        backend: "rtl-sdr",
        timestamp: Date.now()
      };

      expect(validateWebSocketMessage(validMessage)).toBe(true);
    });

    test('should reject invalid WebSocket messages', () => {
      const invalidMessages = [
        null,
        undefined,
        "string",
        123,
        [],
        {},
        { type: 123 }, // type should be string
        { type: "unknown" }, // unknown type
      ];

      invalidMessages.forEach(msg => {
        expect(validateWebSocketMessage(msg)).toBe(false);
      });
    });

    test('should handle ArrayBuffer data (binary)', () => {
      const binaryData = new ArrayBuffer(1024);
      // Should skip validation for binary data
      expect(validateWebSocketMessage(binaryData)).toBe(true);
    });
  });

  describe('Status Message Validation', () => {
    test('should validate valid status messages', () => {
      const validStatus = {
        type: "status",
        device_state: "connected",
        device_name: "RTL-SDR Device",
        backend: "rtl-sdr",
        paused: false,
        max_sample_rate: 2048000,
        sdr_settings: {
          sample_rate: 2048000,
          gain: 20,
          fft_size: 2048
        },
        channels: [
          {
            id: "channel1",
            label: "Test Channel",
            min_mhz: 100,
            max_mhz: 200,
            description: "Test description"
          }
        ]
      };

      expect(validateStatusMessage(validStatus)).toBe(true);
    });

    test('should reject invalid status messages', () => {
      const invalidStatus = {
        type: "status",
        device_state: "invalid_state", // invalid state
        device_name: "",
        backend: "",
        paused: "not_boolean", // should be boolean
        max_sample_rate: -1000, // negative sample rate
        sdr_settings: {
          sample_rate: "not_number", // should be number
          gain: null,
          fft_size: 0 // invalid FFT size
        },
        channels: "not_array" // should be array
      };

      expect(validateStatusMessage(invalidStatus)).toBe(false);
    });

    test('should handle partial status messages', () => {
      const partialStatus = {
        type: "status",
        device_state: "connected"
        // Other fields are optional
      };

      expect(validateStatusMessage(partialStatus)).toBe(true);
    });
  });

  describe('Capture Status Validation', () => {
    test('should validate valid capture status', () => {
      const validCaptureStatus = {
        type: "capture_status",
        status: {
          jobId: "job-123",
          status: "started",
          message: "Capture started",
          progress: 25,
          downloadUrl: "http://example.com/download",
          filename: "capture.bin",
          fileCount: 10
        }
      };

      expect(validateCaptureStatus(validCaptureStatus)).toBe(true);
    });

    test('should validate capture status without optional fields', () => {
      const minimalCaptureStatus = {
        type: "capture_status",
        status: {
          jobId: "job-123",
          status: "done"
        }
      };

      expect(validateCaptureStatus(minimalCaptureStatus)).toBe(true);
    });

    test('should reject invalid capture status', () => {
      const invalidCaptureStatus = {
        type: "capture_status",
        status: {
          jobId: "", // empty job ID
          status: "invalid_status", // invalid status
          progress: 150, // progress > 100
          fileCount: -5 // negative file count
        }
      };

      expect(validateCaptureStatus(invalidCaptureStatus)).toBe(false);
    });
  });

  describe('Auto FFT Options Validation', () => {
    test('should validate valid auto FFT options', () => {
      const validOptions = {
        type: "auto_fft_options",
        autoSizes: [512, 1024, 2048, 4096],
        recommended: 2048
      };

      expect(validateAutoFftOptions(validOptions)).toBe(true);
    });

    test('should reject invalid auto FFT options', () => {
      const invalidOptions = {
        type: "auto_fft_options",
        autoSizes: "not_array", // should be array
        recommended: "not_number" // should be number
      };

      expect(validateAutoFftOptions(invalidOptions)).toBe(false);
    });

    test('should handle empty auto sizes', () => {
      const emptyOptions = {
        type: "auto_fft_options",
        autoSizes: [],
        recommended: 1024
      };

      expect(validateAutoFftOptions(emptyOptions)).toBe(true);
    });
  });

  describe('Authentication Validation', () => {
    test('should validate valid auth info', () => {
      const validAuthInfo = {
        has_passkeys: true
      };

      expect(validateAuthInfo(validAuthInfo)).toBe(true);
    });

    test('should validate valid auth result', () => {
      const validAuthResult = {
        token: "jwt-token-123",
        expires_in: 3600
      };

      expect(validateAuthResult(validAuthResult)).toBe(true);
    });

    test('should validate valid session validation', () => {
      const validSessionValidation = {
        valid: true,
        userId: "user-123",
        expiresAt: Date.now() + 3600000
      };

      expect(validateSessionValidation(validSessionValidation)).toBe(true);
    });

    test('should reject invalid auth data', () => {
      expect(validateAuthInfo({ has_passkeys: "not_boolean" })).toBe(false);
      expect(validateAuthResult({ token: 123, expires_in: "not_number" })).toBe(false);
      expect(validateSessionValidation({ valid: "not_boolean" })).toBe(false);
    });
  });

  describe('Redux Action Validation', () => {
    test('should validate WebSocket Redux actions', () => {
      const validActions = [
        { type: "websocket/connect" },
        { type: "websocket/disconnect" },
        { type: "websocket/setPaused", payload: true },
        { type: "websocket/updateDeviceState", payload: { deviceName: "Test" } }
      ];

      validActions.forEach(action => {
        expect(validateReduxAction(action)).toBe(true);
      });
    });

    test('should reject invalid Redux actions', () => {
      const invalidActions = [
        null,
        undefined,
        {},
        { type: 123 }, // type should be string
        { type: "" }, // empty type
        { type: "other/action" } // non-websocket action (should still be valid though)
      ];

      invalidActions.forEach(action => {
        // Non-websocket actions should still be valid if they have proper type
        if (action && typeof action.type === 'string' && action.type.length > 0) {
          expect(validateReduxAction(action)).toBe(true);
        } else {
          expect(validateReduxAction(action)).toBe(false);
        }
      });
    });
  });

  describe('Process WebSocket Message with Validation', () => {
    test('should process valid WebSocket messages', () => {
      const mockDispatch = jest.fn();
      const mockGetState = jest.fn(() => ({
        websocket: { isPaused: false }
      }));

      const validMessage = {
        type: "status",
        device_state: "connected",
        device_name: "RTL-SDR Device"
      };

      const result = processWebSocketMessageWithValidation(mockDispatch, mockGetState, validMessage);
      expect(result).toBe(true);
    });

    test('should reject invalid WebSocket messages', () => {
      const mockDispatch = jest.fn();
      const mockGetState = jest.fn(() => ({
        websocket: { isPaused: false }
      }));

      const invalidMessage = {
        type: "status",
        device_state: "invalid_state"
      };

      const result = processWebSocketMessageWithValidation(mockDispatch, mockGetState, invalidMessage);
      expect(result).toBe(false);
    });

    test('should handle binary data', () => {
      const mockDispatch = jest.fn();
      const mockGetState = jest.fn(() => ({
        websocket: { isPaused: false }
      }));

      const binaryData = new ArrayBuffer(1024);

      const result = processWebSocketMessageWithValidation(mockDispatch, mockGetState, binaryData);
      expect(result).toBe(true); // Binary data should be allowed
    });
  });

  describe('Validation Metrics', () => {
    test('should track validation metrics', () => {
      // Perform some validations
      validateWebSocketMessage({ type: "status" });
      validateStatusMessage({ type: "status", device_state: "connected" });
      validateWebSocketMessage({ type: "invalid" });

      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBeGreaterThan(0);
      expect(metrics.failedValidations).toBeGreaterThan(0);
      expect(metrics.successRate).toBeGreaterThan(0);
      expect(metrics.averageValidationTime).toBeGreaterThanOrEqual(0);
    });

    test('should reset validation metrics', () => {
      // Perform some validations
      validateWebSocketMessage({ type: "status" });
      
      // Reset metrics
      resetValidationMetrics();
      
      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBe(0);
      expect(metrics.failedValidations).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.averageValidationTime).toBe(0);
    });

    test('should calculate success rate correctly', () => {
      // Perform validations with known outcomes
      validateWebSocketMessage({ type: "status" }); // valid
      validateWebSocketMessage({ type: "status" }); // valid
      validateWebSocketMessage({ type: "invalid" }); // invalid

      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBe(3);
      expect(metrics.failedValidations).toBe(1);
      expect(metrics.successRate).toBeCloseTo(0.667, 2); // 2/3 ≈ 66.7%
    });
  });

  describe('Performance Tests', () => {
    test('should validate messages quickly', () => {
      const startTime = performance.now();
      
      // Validate 1000 messages
      for (let i = 0; i < 1000; i++) {
        validateWebSocketMessage({
          type: "status",
          device_state: "connected",
          device_name: `Device-${i}`
        });
      }
      
      const endTime = performance.now();
      const averageTime = (endTime - startTime) / 1000;
      
      // Should validate messages in less than 1ms on average
      expect(averageTime).toBeLessThan(1);
    });

    test('should handle large messages efficiently', () => {
      const largeMessage = {
        type: "status",
        device_state: "connected",
        device_name: "RTL-SDR Device",
        // Add many channels to simulate a large message
        channels: Array.from({ length: 1000 }, (_, i) => ({
          id: `channel-${i}`,
          label: `Channel ${i}`,
          min_mhz: i * 10,
          max_mhz: (i + 1) * 10,
          description: `Description for channel ${i}`
        }))
      };

      const startTime = performance.now();
      validateStatusMessage(largeMessage);
      const endTime = performance.now();

      // Should handle large messages quickly
      expect(endTime - startTime).toBeLessThan(10); // Less than 10ms
    });
  });

  describe('Edge Cases', () => {
    test('should handle circular references in objects', () => {
      const circularMessage: any = {
        type: "status",
        device_state: "connected"
      };
      circularMessage.self = circularMessage; // Create circular reference

      // Should not throw an error
      expect(() => validateWebSocketMessage(circularMessage)).not.toThrow();
    });

    test('should handle very long strings', () => {
      const longStringMessage = {
        type: "status",
        device_state: "connected",
        device_name: "A".repeat(10000) // Very long string
      };

      expect(validateWebSocketMessage(longStringMessage)).toBe(true);
    });

    test('should handle extreme numeric values', () => {
      const extremeValuesMessage = {
        type: "status",
        device_state: "connected",
        max_sample_rate: Number.MAX_SAFE_INTEGER,
        timestamp: 0,
        channels: [{
          id: "test",
          label: "test",
          min_mhz: 0,
          max_mhz: Number.MAX_SAFE_INTEGER,
          description: "test"
        }]
      };

      expect(validateStatusMessage(extremeValuesMessage)).toBe(true);
    });

    test('should handle null and undefined values in optional fields', () => {
      const nullUndefinedMessage = {
        type: "status",
        device_state: "connected",
        device_name: null,
        backend: undefined,
        paused: null,
        max_sample_rate: undefined,
        sdr_settings: null,
        channels: undefined
      };

      // Should handle null/undefined in optional fields gracefully
      expect(validateStatusMessage(nullUndefinedMessage)).toBe(true);
    });
  });
});
