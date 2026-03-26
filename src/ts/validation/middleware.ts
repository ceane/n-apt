/**
 * Validation middleware for WebSocket and authentication data
 * Provides runtime validation with performance optimizations
 */

import type { Dispatch } from '@reduxjs/toolkit';
import {
  isValidWebSocketMessageWithIntegrity,
  isValidStatusMessageEnhanced,
  isValidCaptureStatus,
  isValidAutoFftOptions,
  quickValidate,
  validateAndExtract,
  isValidObject,
} from "@n-apt/validation/guards";
import {
  AuthInfoSchema,
  AuthResultSchema,
  SessionValidationSchema,
} from "@n-apt/validation/schemas";

// Validation configuration
const VALIDATION_CONFIG = {
  enableLogging: process.env.NODE_ENV === 'development',
  enableStrictValidation: process.env.NODE_ENV === 'development',
  skipBinaryValidation: true, // Performance optimization
  logValidationFailures: true,
};

// Validation metrics tracking
interface ValidationMetrics {
  totalValidations: number;
  validationFailures: number;
  averageValidationTime: number;
  lastValidationTime: number;
}

const validationMetrics: ValidationMetrics = {
  totalValidations: 0,
  validationFailures: 0,
  averageValidationTime: 0,
  lastValidationTime: 0,
};

// Performance monitoring
function measureValidationTime<T>(
  validator: () => T,
  operation: string
): T {
  const startTime = performance.now();
  const result = validator();
  const endTime = performance.now();
  
  const duration = endTime - startTime;
  validationMetrics.lastValidationTime = duration;
  validationMetrics.totalValidations++;
  validationMetrics.averageValidationTime = 
    (validationMetrics.averageValidationTime * (validationMetrics.totalValidations - 1) + duration) / 
    validationMetrics.totalValidations;
  
  if (VALIDATION_CONFIG.enableLogging && duration > 5) {
    console.warn(`Slow validation detected: ${operation} took ${duration.toFixed(2)}ms`);
  }
  
  return result;
}

// Logging utilities
function logValidationSuccess(operation: string, data: any): void {
  if (VALIDATION_CONFIG.enableLogging) {
    console.debug(`✅ Validation passed: ${operation}`, data);
  }
}

function logValidationFailure(operation: string, data: unknown, error?: string): void {
  if (VALIDATION_CONFIG.logValidationFailures) {
    console.error(`❌ Validation failed: ${operation}`, data, error || '');
    validationMetrics.validationFailures++;
  }
}

// WebSocket message validation
export function validateWebSocketMessage(data: unknown): boolean {
  return measureValidationTime(() => {
    // Skip validation for binary data (performance optimization)
    if (data instanceof ArrayBuffer) {
      return VALIDATION_CONFIG.skipBinaryValidation;
    }
    
    // Quick validation for common message types
    if (isValidObject(data) && 'type' in data) {
      const messageData = data as { type: unknown };
      const messageType = messageData.type;
      
      // Skip expensive validation for high-frequency messages
      if (messageType === 'spectrum' || messageType === 'encrypted_spectrum') {
        return quickValidate(data, ['type', 'timestamp', 'waveform']);
      }
    }
    
    // Full validation for control messages
    const isValid = isValidWebSocketMessageWithIntegrity(data);
    
    if (isValid) {
      logValidationSuccess('WebSocket message', data);
    } else {
      logValidationFailure('WebSocket message', data);
    }
    
    return isValid;
  }, 'WebSocket message validation');
}

// Status message validation
export function validateStatusMessage(data: unknown): boolean {
  return measureValidationTime(() => {
    const isValid = isValidStatusMessageEnhanced(data);
    
    if (isValid) {
      logValidationSuccess('Status message', data);
    } else {
      logValidationFailure('Status message', data);
    }
    
    return isValid;
  }, 'Status message validation');
}

// Capture status validation
export function validateCaptureStatus(data: unknown): boolean {
  return measureValidationTime(() => {
    const isValid = isValidCaptureStatus(data);
    
    if (isValid) {
      logValidationSuccess('Capture status', data);
    } else {
      logValidationFailure('Capture status', data);
    }
    
    return isValid;
  }, 'Capture status validation');
}

// Auto FFT options validation
export function validateAutoFftOptions(data: unknown): boolean {
  return measureValidationTime(() => {
    const isValid = isValidAutoFftOptions(data);
    
    if (isValid) {
      logValidationSuccess('Auto FFT options', data);
    } else {
      logValidationFailure('Auto FFT options', data);
    }
    
    return isValid;
  }, 'Auto FFT options validation');
}

// Authentication validation
export function validateAuthInfo(data: unknown): data is { has_passkeys: boolean } {
  return measureValidationTime(() => {
    const result = AuthInfoSchema.safeParse(data);
    
    if (result.success) {
      logValidationSuccess('Auth info', data);
      return true;
    } else {
      logValidationFailure('Auth info', data, result.error.message);
      return false;
    }
  }, 'Auth info validation');
}

export function validateAuthResult(data: unknown): data is { token: string; expires_in: number } {
  return measureValidationTime(() => {
    const result = AuthResultSchema.safeParse(data);
    
    if (result.success) {
      logValidationSuccess('Auth result', data);
      return true;
    } else {
      logValidationFailure('Auth result', data, result.error.message);
      return false;
    }
  }, 'Auth result validation');
}

export function validateSessionValidation(data: unknown): data is { valid: boolean; token?: string; error?: string } {
  return measureValidationTime(() => {
    const result = SessionValidationSchema.safeParse(data);
    
    if (result.success) {
      logValidationSuccess('Session validation', data);
      return true;
    } else {
      logValidationFailure('Session validation', data, result.error.message);
      return false;
    }
  }, 'Session validation validation');
}

// Redux middleware validator
export function validateReduxAction(action: unknown): boolean {
  return measureValidationTime(() => {
    // Quick validation for Redux actions
    if (!isValidObject(action) || !('type' in action)) {
      return false;
    }
    
    const actionObj = action as { type: unknown };
    const actionType = actionObj.type;
    
    // Validate WebSocket actions more strictly
    if (typeof actionType === 'string' && actionType.startsWith('websocket/')) {
      return validateAndExtract(action, (data: unknown): data is typeof action => isValidWebSocketMessageWithIntegrity(data)) !== null;
    }
    
    // Basic validation for other actions
    return typeof actionType === 'string' && actionType.length > 0;
  }, 'Redux action validation');
}

// Enhanced WebSocket message processor with validation
export function processWebSocketMessageWithValidation(
  _dispatch: Dispatch,
  _getState: () => any,
  parsedData: unknown
): boolean {
  // Validate the message first
  if (!validateWebSocketMessage(parsedData)) {
    return false;
  }
  
  // Skip further processing for binary data
  if (parsedData instanceof ArrayBuffer) {
    return true;
  }
  
  // Process validated control messages
  if (isValidObject(parsedData)) {
    const data = parsedData as Record<string, unknown>;
    
    switch (data.type) {
      case 'status':
        return validateStatusMessage(data);
        
      case 'capture_status':
        return validateCaptureStatus(data.status || data);
        
      case 'auto_fft_options':
        return validateAutoFftOptions(data);
        
      default:
        // For other message types, we've already done basic validation
        return true;
    }
  }
  
  return true;
}

// Validation metrics API
export function getValidationMetrics(): ValidationMetrics {
  return { ...validationMetrics };
}

export function resetValidationMetrics(): void {
  validationMetrics.totalValidations = 0;
  validationMetrics.validationFailures = 0;
  validationMetrics.averageValidationTime = 0;
  validationMetrics.lastValidationTime = 0;
}

// Development helpers
export function enableStrictValidation(): void {
  VALIDATION_CONFIG.enableStrictValidation = true;
  VALIDATION_CONFIG.enableLogging = true;
  VALIDATION_CONFIG.logValidationFailures = true;
}

export function disableStrictValidation(): void {
  VALIDATION_CONFIG.enableStrictValidation = false;
  VALIDATION_CONFIG.enableLogging = false;
}

// Validation health check
export function performValidationHealthCheck(): {
  isHealthy: boolean;
  issues: string[];
  metrics: ValidationMetrics;
} {
  const issues: string[] = [];
  
  // Check validation failure rate
  const failureRate = validationMetrics.totalValidations > 0 
    ? validationMetrics.validationFailures / validationMetrics.totalValidations 
    : 0;
  
  if (failureRate > 0.1) { // More than 10% failures
    issues.push(`High validation failure rate: ${(failureRate * 100).toFixed(2)}%`);
  }
  
  // Check average validation time
  if (validationMetrics.averageValidationTime > 10) { // More than 10ms average
    issues.push(`Slow validation performance: ${validationMetrics.averageValidationTime.toFixed(2)}ms average`);
  }
  
  return {
    isHealthy: issues.length === 0,
    issues,
    metrics: getValidationMetrics(),
  };
}
