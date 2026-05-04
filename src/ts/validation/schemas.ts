/**
 * Zod validation schemas generated from Rust Serde types
 * Provides runtime validation for all WebSocket and authentication data
 */

import { z } from 'zod';
import type { TrustLevel, ExpectedLatency } from './types';

// Base schemas
const TrustLevelSchema = z.enum(['high', 'medium', 'low']) as z.ZodType<TrustLevel>;
const ExpectedLatencySchema = z.enum(['none', 'normal', 'high']) as z.ZodType<ExpectedLatency>;

// Integrity and Latency schemas
const DataIntegritySchema = z.object({
  trustLevel: TrustLevelSchema,
  checksum: z.string().optional(),
});

const DataLatencySchema = z.object({
  expectedLatency: ExpectedLatencySchema,
  processingTimeMs: z.number().optional(),
});

// Authentication schemas (from auth.ts)
export const AuthInfoSchema = z.object({
  has_passkeys: z.boolean(),
});

export const AuthResultSchema = z.object({
  token: z.string(),
  expires_in: z.number(),
});

export const SessionValidationSchema = z.object({
  valid: z.boolean(),
  token: z.string().optional(),
  error: z.string().optional(),
});

// WebSocket message schemas (from Rust types)
export const GeolocationDataSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number().optional(),
  timestamp: z.number(),
});

export const FrequencyRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});

export const FreqRangeSchema = z.object({
  minFreq: z.number(),
  maxFreq: z.number(),
});

export const SdrSettingsConfigSchema = z.object({
  sample_rate: z.number(),
  center_frequency: z.number(),
  gain: z.object({
    tuner_gain: z.number(),
    rtl_agc: z.boolean(),
    tuner_agc: z.boolean(),
  }).optional(),
  ppm: z.number().optional(),
  fft: z.object({
    default_size: z.number(),
    default_frame_rate: z.number(),
    max_size: z.number(),
    max_frame_rate: z.number(),
    size_to_frame_rate: z.record(z.string(), z.number()).optional(),
  }).optional(),
  display: z.object({
    min_db: z.number(),
    max_db: z.number(),
    padding: z.number(),
  }).optional(),
  limits: z.object({
    lower_limit_hz: z.number().optional(),
    upper_limit_hz: z.number().optional(),
    lower_limit_label: z.string().optional(),
    upper_limit_label: z.string().optional(),
  }).optional(),
});

export const DeviceProfileSchema = z.object({
  kind: z.string(),
  is_rtl_sdr: z.boolean(),
  supports_approx_dbm: z.boolean(),
  supports_raw_iq_stream: z.boolean(),
});

export const SpectrumFrameSchema = z.object({
  id: z.string(),
  label: z.string(),
  min_hz: z.number(),
  max_hz: z.number(),
  description: z.string(),
});

export const CaptureRequestSchema = z.object({
  jobId: z.string(),
  fragments: z.array(z.object({
    minFreq: z.number(),
    maxFreq: z.number(),
  })),
  durationMode: z.enum(['timed', 'manual']),
  durationS: z.number().optional(),
  fileType: z.enum(['.napt', '.wav']),
  acquisitionMode: z.enum(['stepwise', 'interleaved', 'whole_sample']),
  encrypted: z.boolean(),
  fftSize: z.number(),
  fftWindow: z.string(),
  geolocation: GeolocationDataSchema.optional(),
  refBasedDemodBaseline: z.enum(['audio_hearing', 'audio_internal', 'speech', 'vision']).optional(),
  liveMode: z.boolean().optional(),
});

export const CaptureStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(['started', 'progress', 'failed', 'done']),
  message: z.string().optional(),
  progress: z.number().optional(),
  error: z.string().optional(),
  downloadUrl: z.string().optional(),
  filename: z.string().optional(),
  fileCount: z.number().optional(),
  ephemeral: z.boolean().optional(),
  timestamp: z.number().optional(),
  fileSize: z.number().optional(),
  duration: z.number().optional(),
});

export const AutoFftOptionsResponseSchema = z.object({
  type: z.literal('auto_fft_options'),
  autoSizes: z.array(z.number()),
  recommended: z.number(),
});

export const StatusMessageSchema = z.object({
  type: z.literal('status'),
  device_connected: z.boolean(),
  device_info: z.string(),
  device_name: z.string(),
  device_loading: z.boolean(),
  device_loading_reason: z.enum(['connect', 'restart', 'null']).nullable(),
  device_state: z.enum(['connected', 'loading', 'disconnected', 'stale', 'null']).nullable(),
  paused: z.boolean(),
  max_sample_rate: z.number(),
  channels: z.array(SpectrumFrameSchema),
  sdr_settings: SdrSettingsConfigSchema,
  device: z.enum(['rtl-sdr', 'mock_apt']),
  device_profile: DeviceProfileSchema,
});

// Enhanced schemas with integrity/latency for SDR processor types
export const EnhancedSdrSettingsSchema = SdrSettingsConfigSchema.extend({
  integrity: DataIntegritySchema.optional(),
  latency: DataLatencySchema.optional(),
});

export const EnhancedSpectrumFrameSchema = SpectrumFrameSchema.extend({
  integrity: DataIntegritySchema.optional(),
  latency: DataLatencySchema.optional(),
});

export const EnhancedCaptureRequestSchema = CaptureRequestSchema.extend({
  integrity: DataIntegritySchema.optional(),
  latency: DataLatencySchema.optional(),
});

// WebSocket message union schema
export const WebSocketMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('frequency_range'),
    min_hz: z.number(),
    max_hz: z.number(),
  }),
  z.object({
    type: z.literal('set_frequency_range'),
    min_hz: z.number(),
    max_hz: z.number(),
  }),
  z.object({
    type: z.literal('pause'),
    paused: z.boolean(),
  }),
  z.object({
    type: z.literal('gain'),
    gain: z.number(),
  }),
  z.object({
    type: z.literal('ppm'),
    ppm: z.number(),
  }),
  z.object({
    type: z.literal('frame_rate'),
    frameRate: z.number(),
  }),
  z.object({
    type: z.literal('settings'),
    fftSize: z.number().optional(),
    fftWindow: z.string().optional(),
    frameRate: z.number().optional(),
    gain: z.number().optional(),
    ppm: z.number().optional(),
    tunerAGC: z.boolean().optional(),
    rtlAGC: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('restart_device'),
  }),
  z.object({
    type: z.literal('training_capture'),
    action: z.enum(['start', 'stop']),
    label: z.enum(['target', 'noise']),
    signalArea: z.string(),
  }),
  z.object({
    type: z.literal('capture'),
  }).merge(CaptureRequestSchema.partial()),
  z.object({
    type: z.literal('capture_stop'),
    jobId: z.string().optional(),
  }),
  z.object({
    type: z.literal('get_auto_fft_options'),
    screenWidth: z.number(),
  }),
  // Server-to-client messages
  StatusMessageSchema,
  AutoFftOptionsResponseSchema,
]);

// Type guards derived from schemas
export const isValidAuthInfo = (data: unknown): data is z.infer<typeof AuthInfoSchema> => {
  return AuthInfoSchema.safeParse(data).success;
};

export const isValidAuthResult = (data: unknown): data is z.infer<typeof AuthResultSchema> => {
  return AuthResultSchema.safeParse(data).success;
};

export const isValidSessionValidation = (data: unknown): data is z.infer<typeof SessionValidationSchema> => {
  return SessionValidationSchema.safeParse(data).success;
};

export const isValidWebSocketMessage = (data: unknown): data is z.infer<typeof WebSocketMessageSchema> => {
  return WebSocketMessageSchema.safeParse(data).success;
};

export const isValidStatusMessage = (data: unknown): data is z.infer<typeof StatusMessageSchema> => {
  return StatusMessageSchema.safeParse(data).success;
};

export const isValidSpectrumFrame = (data: unknown): data is z.infer<typeof SpectrumFrameSchema> => {
  return SpectrumFrameSchema.safeParse(data).success;
};

export const isValidCaptureRequest = (data: unknown): data is z.infer<typeof CaptureRequestSchema> => {
  return CaptureRequestSchema.safeParse(data).success;
};

export const isValidCaptureStatus = (data: unknown): data is z.infer<typeof CaptureStatusSchema> => {
  return CaptureStatusSchema.safeParse(data).success;
};

export const isValidAutoFftOptions = (data: unknown): data is z.infer<typeof AutoFftOptionsResponseSchema> => {
  return AutoFftOptionsResponseSchema.safeParse(data).success;
};
