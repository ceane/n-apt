/**
 * Validation system entry point
 * Exports all validation utilities, schemas, and middleware
 */

// Types
export type {
  TrustLevel,
  ExpectedLatency,
  DataIntegrity,
  DataLatency,
  SdrProcessorMetadata,
  EnhancedSdrSettings,
  EnhancedSpectrumFrame,
  EnhancedCaptureRequest,
} from "@n-apt/validation/types";

export {
  calculateExpectedLatency,
  calculateTrustLevel,
} from "@n-apt/validation/types";

// Schemas
export {
  AuthInfoSchema,
  AuthResultSchema,
  SessionValidationSchema,
  GeolocationDataSchema,
  FrequencyRangeSchema,
  FreqRangeSchema,
  SdrSettingsConfigSchema,
  DeviceProfileSchema,
  SpectrumFrameSchema,
  CaptureRequestSchema,
  CaptureStatusSchema,
  AutoFftOptionsResponseSchema,
  StatusMessageSchema,
  EnhancedSdrSettingsSchema,
  EnhancedSpectrumFrameSchema,
  EnhancedCaptureRequestSchema,
  WebSocketMessageSchema,
} from "@n-apt/validation/schemas";

// Type guards
export {
  isValidAuthInfo,
  isValidAuthResult,
  isValidSessionValidation,
  isValidWebSocketMessage,
  isValidStatusMessage,
  isValidSpectrumFrame,
  isValidCaptureRequest,
  isValidCaptureStatus,
  isValidAutoFftOptions,
  isValidString,
  isValidNumber,
  isValidBoolean,
  isValidObject,
  isValidArray,
  isValidFloat32Array,
  isValidUint8ClampedArray,
  isValidSpectrumData,
  validateSpectrumData,
  isValidWaterfallData,
  validateWaterfallData,
  validateSpectrumDataComprehensive,
  validateWaterfallDataComprehensive,
  isValidString as isValidStringEnhanced,
  isValidNumber as isValidNumberEnhanced,
  isValidFrequency,
  isValidTimestamp,
  hasValidIntegrity,
  isValidWebSocketMessageWithIntegrity,
  isValidSpectrumFrameEnhanced,
  isValidCaptureRequestEnhanced,
  isValidStatusMessageEnhanced,
  isValidAuthResponse,
  isValidSessionToken,
  isValidError,
  addIntegrityMetadata,
  validateAndExtract,
  quickValidate,
  validateArray,
} from "@n-apt/validation/guards";

// Middleware
export {
  validateWebSocketMessage,
  validateStatusMessage,
  validateCaptureStatus,
  validateAutoFftOptions,
  validateAuthInfo,
  validateAuthResult,
  validateSessionValidation,
  validateReduxAction,
  processWebSocketMessageWithValidation,
  getValidationMetrics,
  resetValidationMetrics,
  enableStrictValidation,
  disableStrictValidation,
  performValidationHealthCheck,
} from "@n-apt/validation/middleware";

// Additional exports not explicitly covered above - explicit exports to prevent Safari issues
// Basic type guards from guards module
export {
  isString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
} from "@n-apt/validation/guards";
