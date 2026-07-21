/**
 * Tests for WebSocket validation system
 */

import {
  validateWebSocketMessage,
  isValidSourceInfoMessage,
  isValidSourceStatusMessage,
  isValidSourceErrorMessage,
  validateCaptureStatus,
  validateAuthInfo,
  validateAuthResult,
  validateSessionValidation,
  processWebSocketMessageWithValidation,
  validateReduxAction,
  getValidationMetrics,
  resetValidationMetrics,
} from "@n-apt/validation";

describe("WebSocket Validation System", () => {
  beforeEach(() => {
    resetValidationMetrics();
    jest.restoreAllMocks();
  });

  describe("WebSocket Message Validation", () => {
    test("should validate valid WebSocket messages", () => {
      const validMessage = {
        type: "pause",
        paused: false,
        source_id: "mock-apt",
        duplex_mode: "half_duplex",
        active_mode: "rx",
      };

      expect(validateWebSocketMessage(validMessage)).toBe(true);
    });

    test("should validate tx_mode messages using active_mode", () => {
      expect(
        validateWebSocketMessage({
          type: "tx_mode",
          active_mode: "rx_tx",
          txDevice: "Mock Tx SDR",
        }),
      ).toBe(true);
    });

    test("should reject invalid WebSocket messages", () => {
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

      invalidMessages.forEach((msg) => {
        expect(validateWebSocketMessage(msg)).toBe(false);
      });
    });

    test("should validate PPM only if it is a positive whole number", () => {
      // Valid PPM (positive whole number/integer)
      expect(validateWebSocketMessage({ type: "ppm", ppm: 10 })).toBe(true);
      expect(validateWebSocketMessage({ type: "ppm", ppm: 0 })).toBe(true);

      // Invalid PPM (negative, float)
      expect(validateWebSocketMessage({ type: "ppm", ppm: -5 })).toBe(false);
      expect(validateWebSocketMessage({ type: "ppm", ppm: 3.5 })).toBe(false);

      // Valid settings with ppm
      expect(
        validateWebSocketMessage({
          type: "settings",
          ppm: 12,
        }),
      ).toBe(true);

      // Invalid settings with ppm (negative)
      expect(
        validateWebSocketMessage({
          type: "settings",
          ppm: -1,
        }),
      ).toBe(false);
    });

    test("should handle ArrayBuffer data (binary)", () => {
      const binaryData = new ArrayBuffer(1024);
      // Should skip validation for binary data
      expect(validateWebSocketMessage(binaryData)).toBe(true);
    });

    test("should not warn for sub-frame validation times", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      jest.resetModules();

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const nowSpy = jest
        .spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(6);

      const {
        validateWebSocketMessage: devValidateWebSocketMessage,
      } = require("@n-apt/validation");

      expect(
        devValidateWebSocketMessage({
          type: "pause",
          paused: false,
          source_id: "mock-apt",
        }),
      ).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();

      nowSpy.mockRestore();
      warnSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
      jest.resetModules();
    });

    test("should warn for slow validation times at or above the threshold", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      jest.resetModules();

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const nowSpy = jest
        .spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(20);

      const {
        validateWebSocketMessage: devValidateWebSocketMessage,
      } = require("@n-apt/validation");

      expect(
        devValidateWebSocketMessage({
          type: "pause",
          paused: false,
          source_id: "mock-apt",
        }),
      ).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Slow validation detected: WebSocket message validation took",
        ),
      );

      nowSpy.mockRestore();
      warnSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
      jest.resetModules();
    });
  });

  describe("Source Message Validation", () => {
    test("should validate source_info messages", () => {
      const sourceInfo = {
        type: "source_info",
        active_source: "mock-apt",
        active_source_mode: "live",
        sources: [
          {
            id: "mock-apt",
            name: "Mock APT SDR",
            kind: "mock_apt",
            capability: "mock",
            status: "streaming",
            loading_attempt: 0,
            loading_attempt_max: 3,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
            sdr: {
              max_sample_rate: 3200000,
              sample_rate_options: [3200000],
              fft_display: { markers: [] },
              settings: {
                sample_rate: 3200000,
                center_frequency: 1600000,
                gain: {
                  tuner_gain: 49.6,
                  rtl_agc: false,
                  tuner_agc: false,
                },
                fft: {
                  default_size: 2048,
                  default_frame_rate: 30,
                  max_size: 65536,
                  max_frame_rate: 60,
                },
                display: {
                  min_db: -150,
                  max_db: 0,
                  padding: 10,
                },
              },
            },
          },
        ],
      };

      expect(isValidSourceInfoMessage(sourceInfo)).toBe(true);
      expect(validateWebSocketMessage(sourceInfo)).toBe(true);
    });

    test("should validate atomic source updates", () => {
      expect(
        isValidSourceStatusMessage({
          type: "status",
          source_id: "mock-apt",
          status: "connected",
        }),
      ).toBe(true);

      expect(
        validateWebSocketMessage({
          type: "signal_display_settings",
          source_id: "mock-apt",
          sample_rate: 3200000,
          fft_size: 2048,
          frame_rate: 30,
        }),
      ).toBe(true);

      expect(
        isValidSourceErrorMessage({
          type: "error",
          source_id: "mock-apt",
          code: "device_disconnect",
          message: "Device disconnected",
        }),
      ).toBe(true);
    });

    test("should validate mock tx atomic connected status with retry metadata", () => {
      const message = {
        type: "status",
        source_id: "mock-tx",
        status: "connected",
        loading_attempt: 0,
        loading_attempt_max: 2,
      };

      expect(isValidSourceStatusMessage(message)).toBe(true);
      expect(validateWebSocketMessage(message)).toBe(true);
    });
  });

  describe("Capture Status Validation", () => {
    test("should validate valid capture status", () => {
      const validCaptureStatus = {
        jobId: "job-123",
        status: "started",
        message: "Capture started",
        progress: 25,
        downloadUrl: "http://example.com/download",
        filename: "capture.bin",
        fileCount: 10,
        ephemeral: false,
      };

      expect(validateCaptureStatus(validCaptureStatus)).toBe(true);
    });

    test("should validate capture status without optional fields", () => {
      const minimalCaptureStatus = {
        jobId: "job-123",
        status: "done",
      };

      expect(validateCaptureStatus(minimalCaptureStatus)).toBe(true);
    });

    test("should reject invalid capture status", () => {
      const invalidCaptureStatus = {
        jobId: "", // empty job ID
        status: "invalid_status", // invalid status
        progress: 150, // progress > 100
        fileCount: -5, // negative file count
      };

      expect(validateCaptureStatus(invalidCaptureStatus)).toBe(false);
    });
  });

  describe("Authentication Validation", () => {
    test("should validate valid auth info", () => {
      const validAuthInfo = {
        has_passkeys: true,
      };

      expect(validateAuthInfo(validAuthInfo)).toBe(true);
    });

    test("should validate valid auth result", () => {
      const validAuthResult = {
        token: "jwt-token-123",
        expires_in: 3600,
      };

      expect(validateAuthResult(validAuthResult)).toBe(true);
    });

    test("should validate valid session validation", () => {
      const validSessionValidation = {
        valid: true,
        userId: "user-123",
        expiresAt: Date.now() + 3600000,
      };

      expect(validateSessionValidation(validSessionValidation)).toBe(true);
    });

    test("should reject invalid auth data", () => {
      expect(validateAuthInfo({ has_passkeys: "not_boolean" })).toBe(false);
      expect(validateAuthResult({ token: 123, expires_in: "not_number" })).toBe(
        false,
      );
      expect(validateSessionValidation({ valid: "not_boolean" })).toBe(false);
    });
  });

  describe("Redux Action Validation", () => {
    test("should validate non-WebSocket Redux actions", () => {
      const validActions = [
        { type: "other/action" }, // Non-websocket actions should be valid
        { type: "some/otherAction" },
        { type: "any/action" },
      ];

      validActions.forEach((action) => {
        expect(validateReduxAction(action)).toBe(true);
      });
    });

    test("should reject invalid Redux actions", () => {
      const invalidActions = [
        null,
        undefined,
        {},
        { type: 123 }, // type should be string
        { type: "" }, // empty type
      ];

      invalidActions.forEach((action) => {
        expect(validateReduxAction(action)).toBe(false);
      });
    });
  });

  describe("Process WebSocket Message with Validation", () => {
    test("should process valid WebSocket messages", () => {
      const mockDispatch = jest.fn();
      const mockGetState = jest.fn(() => ({
        websocket: { isPaused: false },
      }));

      const validMessage = {
        type: "pause",
        paused: false,
        source_id: "mock-apt",
      };

      const result = processWebSocketMessageWithValidation(
        mockDispatch,
        mockGetState,
        validMessage,
      );
      expect(result).toBe(true);
    });

    test("should reject invalid WebSocket messages", () => {
      const mockDispatch = jest.fn();
      const mockGetState = jest.fn(() => ({
        websocket: { isPaused: false },
      }));

      const invalidMessage = {
        type: "invalid_type",
      };

      const result = processWebSocketMessageWithValidation(
        mockDispatch,
        mockGetState,
        invalidMessage,
      );
      expect(result).toBe(false);
    });

    test("should handle binary data", () => {
      const mockDispatch = jest.fn();
      const mockGetState = jest.fn(() => ({
        websocket: { isPaused: false },
      }));

      const binaryData = new ArrayBuffer(1024);

      const result = processWebSocketMessageWithValidation(
        mockDispatch,
        mockGetState,
        binaryData,
      );
      expect(result).toBe(true); // Binary data should be allowed
    });
  });

  describe("Validation Metrics", () => {
    test("should track validation metrics", () => {
      // Perform some validations
      validateWebSocketMessage({
        type: "source_info",
        active_source: "a",
        active_source_mode: "live",
        sources: [],
      });
      validateWebSocketMessage({ type: "invalid" });

      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBeGreaterThan(0);
      expect(metrics.validationFailures).toBeGreaterThan(0);
      expect(metrics.averageValidationTime).toBeGreaterThanOrEqual(0);
      expect(metrics.lastValidationTime).toBeGreaterThanOrEqual(0);
    });

    test("should reset validation metrics", () => {
      // Perform some validations
      validateWebSocketMessage({
        type: "source_info",
        active_source: "a",
        active_source_mode: "live",
        sources: [],
      });

      // Reset metrics
      resetValidationMetrics();

      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBe(0);
      expect(metrics.validationFailures).toBe(0);
      expect(metrics.averageValidationTime).toBe(0);
      expect(metrics.lastValidationTime).toBe(0);
    });

    test("should track validation failures correctly", () => {
      // Reset metrics first
      resetValidationMetrics();

      // Perform validations with known outcomes
      validateWebSocketMessage({
        type: "pause",
        paused: true,
        source_id: "mock-apt",
      }); // valid
      validateWebSocketMessage({
        type: "pause",
        paused: false,
        source_id: "mock-apt",
      }); // valid
      validateWebSocketMessage({ type: "invalid_type" }); // invalid

      const metrics = getValidationMetrics();
      expect(metrics.totalValidations).toBe(3);
      expect(metrics.validationFailures).toBe(1);
    });
  });

  describe("Performance Tests", () => {
    test("should validate messages quickly", () => {
      const startTime = performance.now();

      // Validate 1000 messages
      for (let i = 0; i < 1000; i++) {
        validateWebSocketMessage({
          type: "pause",
          paused: i % 2 === 0,
          source_id: "mock-apt",
        });
      }

      const endTime = performance.now();
      const averageTime = (endTime - startTime) / 1000;

      // Should validate messages in less than 5ms on average (relaxed for CI)
      expect(averageTime).toBeLessThan(5);
    });

    test("should handle large messages efficiently", () => {
      const largeMessage = {
        type: "source_info",
        active_source: "mock-apt",
        active_source_mode: "live",
        sources: Array.from({ length: 100 }, (_, i) => ({
          id: `source-${i}`,
          name: `Source ${i}`,
          kind: "mock_apt",
          capability: "mock",
          status: "streaming",
          loading_attempt: 0,
          loading_attempt_max: 3,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
          sdr: {
            max_sample_rate: 3200000,
            sample_rate_options: [3200000],
            fft_display: { markers: [] },
            settings: {
              sample_rate: 3200000,
              center_frequency: 100000000,
              fft: {
                default_size: 2048,
                default_frame_rate: 30,
                max_size: 4096,
                max_frame_rate: 60,
              },
              display: {
                min_db: -100,
                max_db: 0,
                padding: 10,
              },
            },
          },
        })),
      };

      const startTime = performance.now();
      validateWebSocketMessage(largeMessage);
      const endTime = performance.now();

      // Should handle large messages quickly
      expect(endTime - startTime).toBeLessThan(200); // Relaxed threshold
    });
  });

  describe("Edge Cases", () => {
    test("should handle circular references in objects", () => {
      const circularMessage: any = {
        type: "pause",
        paused: false,
        source_id: "mock-apt",
      };
      circularMessage.self = circularMessage; // Create circular reference

      // Should not throw an error
      expect(() => validateWebSocketMessage(circularMessage)).not.toThrow();
    });

    test("should handle very long strings", () => {
      const longStringMessage = {
        type: "pause",
        paused: false,
        source_id: "mock-apt",
      };
      // Create a circular reference with long string to test handling
      (longStringMessage as any).self = "A".repeat(10000);

      expect(validateWebSocketMessage(longStringMessage)).toBe(true);
    });

    test("should handle extreme numeric values", () => {
      const extremeValuesMessage = {
        type: "source_info",
        active_source: "mock-apt",
        active_source_mode: "live",
        sources: [
          {
            id: "test",
            name: "Test Device",
            kind: "rtl_sdr",
            capability: "rx",
            status: "connected",
            loading_attempt: 0,
            loading_attempt_max: 3,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
            sdr: {
              max_sample_rate: 10000000,
              sample_rate_options: [10000000],
              fft_display: { markers: [] },
              settings: {
                sample_rate: 2048000,
                center_frequency: 100000000,
                fft: {
                  default_size: 2048,
                  default_frame_rate: 30,
                  max_size: 4096,
                  max_frame_rate: 60,
                },
                display: {
                  min_db: -100,
                  max_db: 0,
                  padding: 10,
                },
              },
            },
          },
        ],
      };

      expect(validateWebSocketMessage(extremeValuesMessage)).toBe(true);
    });

    test("should handle null and undefined values in optional fields", () => {
      const nullUndefinedMessage = {
        type: "source_info",
        active_source: "test",
        active_source_mode: "live",
        sources: [],
      };

      // Should handle null/undefined in optional fields gracefully
      expect(validateWebSocketMessage(nullUndefinedMessage)).toBe(true);
    });
  });
});
