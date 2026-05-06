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
        type: "pause",
        paused: false
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
        device_connected: true,
        device_info: "RTL-SDR Device Connected",
        device_name: "RTL-SDR Device",
        device_loading: false,
        device_loading_reason: null,
        device_state: "connected",
        paused: false,
        max_sample_rate: 2048000,
        channels: [
          {
            id: "channel1",
            label: "Test Channel",
            min_hz: 100000000,
            max_hz: 200000000,
            description: "Test description"
          }
        ],
        sdr_settings: {
          sample_rate: 2048000,
          center_frequency: 100000000,
          gain: {
            tuner_gain: 20,
            rtl_agc: false,
            tuner_agc: false
          },
          fft: {
            default_size: 2048,
            default_frame_rate: 30,
            max_size: 4096,
            max_frame_rate: 60
          },
          display: {
            min_db: -100,
            max_db: 0,
            padding: 10
          }
        },
        device: "rtl-sdr",
        device_profile: {
          kind: "rtl_sdr",
          is_rtl_sdr: true,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true
        }
      };

      expect(validateStatusMessage(validStatus)).toBe(true);
    });

    test('should reject invalid status messages', () => {
      const invalidStatus = {
        type: "status",
        device_connected: "not_boolean", // should be boolean
        device_info: 123, // should be string
        device_name: "", // empty string might be invalid
        device_loading: "not_boolean", // should be boolean
        device_loading_reason: "invalid_reason", // invalid enum value
        device_state: "invalid_state", // invalid enum value
        paused: "not_boolean", // should be boolean
        max_sample_rate: -1000, // negative sample rate
        channels: "not_array", // should be array
        sdr_settings: "not_object", // should be object
        device: "invalid_device", // invalid enum
        device_profile: "not_object" // should be object
      };

      expect(validateStatusMessage(invalidStatus)).toBe(false);
    });

    test('should handle partial status messages', () => {
      // Note: StatusMessageSchema requires all fields, so partial messages won't be valid
      const partialStatus = {
        type: "status",
        device_connected: true,
        device_info: "Test",
        device_name: "Test Device",
        device_loading: false,
        device_loading_reason: null,
        device_state: "connected",
        paused: false,
        max_sample_rate: 2048000,
        channels: [],
        sdr_settings: {
          sample_rate: 2048000,
          center_frequency: 100000000
        },
        device: "mock_apt",
        device_profile: {
          kind: "mock",
          is_rtl_sdr: false,
          supports_approx_dbm: false,
          supports_raw_iq_stream: false
        }
      };

      expect(validateStatusMessage(partialStatus)).toBe(true);
    });
  });

  describe('Capture Status Validation', () => {
    test('should validate valid capture status', () => {
      const validCaptureStatus = {
        jobId: "job-123",
        status: "started",
        message: "Capture started",
        progress: 25,
        downloadUrl: "http://example.com/download",
        filename: "capture.bin",
        fileCount: 10,
        ephemeral: false
      };

      expect(validateCaptureStatus(validCaptureStatus)).toBe(true);
    });

    test('should validate capture status without optional fields', () => {
      const minimalCaptureStatus = {
        jobId: "job-123",
        status: "done"
      };

      expect(validateCaptureStatus(minimalCaptureStatus)).toBe(true);
    });

    test('should reject invalid capture status', () => {
      const invalidCaptureStatus = {
        jobId: "", // empty job ID
        status: "invalid_status", // invalid status
        progress: 150, // progress > 100
        fileCount: -5 // negative file count
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
    test('should validate non-WebSocket Redux actions', () => {
      const validActions = [
        { type: "other/action" }, // Non-websocket actions should be valid
        { type: "some/otherAction" },
        { type: "any/action" }
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
      ];

      invalidActions.forEach(action => {
        expect(validateReduxAction(action)).toBe(false);
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
        type: "pause",
        paused: false
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
        type: "invalid_type"
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
      expect(metrics.validationFailures).toBeGreaterThan(0);
      expect(metrics.averageValidationTime).toBeGreaterThanOrEqual(0);
      expect(metrics.lastValidationTime).toBeGreaterThanOrEqual(0);
    });

    test('should reset validation metrics', () => {
      // Perform some validations
      validateWebSocketMessage({ type: "status" });
      
      // Reset metrics
      resetValidationMetrics();
      
      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBe(0);
      expect(metrics.validationFailures).toBe(0);
      expect(metrics.averageValidationTime).toBe(0);
      expect(metrics.lastValidationTime).toBe(0);
    });

    test('should track validation failures correctly', () => {
      // Reset metrics first
      resetValidationMetrics();
      
      // Perform validations with known outcomes
      validateWebSocketMessage({ type: "pause", paused: true }); // valid
      validateWebSocketMessage({ type: "pause", paused: false }); // valid
      validateWebSocketMessage({ type: "invalid_type" }); // invalid

      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBe(3);
      expect(metrics.validationFailures).toBe(1);
    });
  });

  describe('Performance Tests', () => {
    test('should validate messages quickly', () => {
      const startTime = performance.now();
      
      // Validate 1000 messages
      for (let i = 0; i < 1000; i++) {
        validateWebSocketMessage({
          type: "pause",
          paused: i % 2 === 0
        });
      }
      
      const endTime = performance.now();
      const averageTime = (endTime - startTime) / 1000;
      
      // Should validate messages in less than 5ms on average (relaxed for CI)
      expect(averageTime).toBeLessThan(5);
    });

    test('should handle large messages efficiently', () => {
      const largeMessage = {
        type: "status",
        device_connected: true,
        device_info: "RTL-SDR Device Connected",
        device_name: "RTL-SDR Device",
        device_loading: false,
        device_loading_reason: null,
        device_state: "connected",
        paused: false,
        max_sample_rate: 2048000,
        // Add many channels to simulate a large message
        channels: Array.from({ length: 100 }, (_, i) => ({
          id: `channel-${i}`,
          label: `Channel ${i}`,
          min_hz: i * 10000000,
          max_hz: (i + 1) * 10000000,
          description: `Description for channel ${i}`
        })),
        sdr_settings: {
          sample_rate: 2048000,
          center_frequency: 100000000,
          gain: {
            tuner_gain: 20,
            rtl_agc: false,
            tuner_agc: false
          },
          fft: {
            default_size: 2048,
            default_frame_rate: 30,
            max_size: 4096,
            max_frame_rate: 60
          },
          display: {
            min_db: -100,
            max_db: 0,
            padding: 10
          }
        },
        device: "rtl-sdr",
        device_profile: {
          kind: "rtl_sdr",
          is_rtl_sdr: true,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true
        }
      };

      const startTime = performance.now();
      validateStatusMessage(largeMessage);
      const endTime = performance.now();

      // Should handle large messages quickly
      expect(endTime - startTime).toBeLessThan(50); // Relaxed threshold
    });
  });

  describe('Edge Cases', () => {
    test('should handle circular references in objects', () => {
      const circularMessage: any = {
        type: "pause",
        paused: false
      };
      circularMessage.self = circularMessage; // Create circular reference

      // Should not throw an error
      expect(() => validateWebSocketMessage(circularMessage)).not.toThrow();
    });

    test('should handle very long strings', () => {
      const longStringMessage = {
        type: "pause",
        paused: false
      };
      // Create a circular reference with long string to test handling
      (longStringMessage as any).self = "A".repeat(10000);

      expect(validateWebSocketMessage(longStringMessage)).toBe(true);
    });

    test('should handle extreme numeric values', () => {
      const extremeValuesMessage = {
        type: "status",
        device_connected: true,
        device_info: "Test",
        device_name: "Test Device",
        device_loading: false,
        device_loading_reason: null,
        device_state: "connected",
        paused: false,
        max_sample_rate: 10000000, // 10MHz sample rate in Hz
        channels: [{
          id: "test",
          label: "test",
          min_hz: 0,
          max_hz: 6000000000, // 6000 MHz = 6 GHz - high but reasonable for SDR
          description: "test"
        }],
        sdr_settings: {
          sample_rate: 2048000, // 2.048 MHz sample rate in Hz
          center_frequency: 100000000, // 100 MHz center frequency in Hz
          gain: {
            tuner_gain: 20,
            rtl_agc: false,
            tuner_agc: false
          },
          fft: {
            default_size: 2048,
            default_frame_rate: 30,
            max_size: 4096,
            max_frame_rate: 60
          },
          display: {
            min_db: -100,
            max_db: 0,
            padding: 10
          }
        },
        device: "rtl-sdr",
        device_profile: {
          kind: "rtl_sdr",
          is_rtl_sdr: true,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true
        }
      };

      expect(validateStatusMessage(extremeValuesMessage)).toBe(true);
    });

    test('should handle null and undefined values in optional fields', () => {
      const nullUndefinedMessage = {
        type: "status",
        device_connected: true,
        device_info: "Test",
        device_name: "Test Device",
        device_loading: false,
        device_loading_reason: null,
        device_state: "connected",
        paused: false,
        max_sample_rate: 2048000,
        channels: [],
        sdr_settings: {
          sample_rate: 2048000,
          center_frequency: 100000000,
          gain: {
            tuner_gain: 20,
            rtl_agc: false,
            tuner_agc: false
          },
          fft: {
            default_size: 2048,
            default_frame_rate: 30,
            max_size: 4096,
            max_frame_rate: 60
          },
          display: {
            min_db: -100,
            max_db: 0,
            padding: 10
          }
        },
        device: "rtl-sdr",
        device_profile: {
          kind: "rtl_sdr",
          is_rtl_sdr: true,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true
        }
      };

      // Should handle null/undefined in optional fields gracefully
      expect(validateStatusMessage(nullUndefinedMessage)).toBe(true);
    });
  });
});
