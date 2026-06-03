/**
 * Zod validation schemas generated from Rust Serde types
 * Provides runtime validation for all WebSocket and authentication data
 */

import { z } from "zod";
import type { TrustLevel, ExpectedLatency } from "./types";

// Preprocesses null values to undefined so they map properly to optional types rather than null
const nullableToOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === null ? undefined : val), schema.optional());

// Base schemas
const TrustLevelSchema = z.enum([
  "high",
  "medium",
  "low",
]) as z.ZodType<TrustLevel>;
const ExpectedLatencySchema = z.enum([
  "none",
  "normal",
  "high",
]) as z.ZodType<ExpectedLatency>;

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
  min_receive_sample_rate: z.number().optional(),
  center_frequency: z.number(),
  gain: z
    .object({
      tuner_gain: z.number(),
      rtl_agc: z.boolean(),
      tuner_agc: z.boolean(),
      hackrf_lna_gain: z.number().min(0).max(49.6).optional(),
      hackrf_vga_gain: z.number().min(0).max(62).optional(),
      hackrf_amp_enable: z.boolean().optional(),
      tuner_bandwidth: z.number().min(0).max(20_000_000).optional(),
    })
    .optional(),
  ppm: z.number().int().nonnegative().optional(),
  fft: z
    .object({
      default_size: z.number(),
      default_frame_rate: z.number(),
      max_size: z.number(),
      max_frame_rate: z.number(),
      size_to_frame_rate: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
  display: z
    .object({
      min_db: z.number(),
      max_db: z.number(),
      padding: z.number(),
    })
    .optional(),
  fft_sizes: nullableToOptional(
    z.array(
      z.object({
        base: z.string(),
        fft_min: z.number().optional(),
        fft_max: z.number().optional(),
      })
    )
  ),
  devices: nullableToOptional(
    z.record(
      z.string(),
      z.object({
        sample_rate: z.any(),
        fft_display: nullableToOptional(z.any()),
        fft_sizes: nullableToOptional(
          z.array(
            z.object({
              base: z.string(),
              fft_min: z.number().optional(),
              fft_max: z.number().optional(),
            })
          )
        ),
        gain_limits: nullableToOptional(
          z.object({
            min: nullableToOptional(z.number()),
            max: nullableToOptional(z.number()),
            step: nullableToOptional(z.number()),
            lna_min: nullableToOptional(z.number()),
            lna_max: nullableToOptional(z.number()),
            lna_step: nullableToOptional(z.number()),
            vga_min: nullableToOptional(z.number()),
            vga_max: nullableToOptional(z.number()),
            vga_step: nullableToOptional(z.number()),
          })
        ),
      })
    )
  ),
});

export const DeviceProfileSchema = z.object({
  kind: z.string(),
  is_rtl_sdr: z.boolean(),
  supports_approx_dbm: z.boolean(),
  supports_raw_iq_stream: z.boolean(),
});

export const SourceCapabilitySchema = z.enum(["rx", "tx", "tx_rx", "mock"]);

export const SourceStatusSchema = z.enum([
  "connected",
  "loading",
  "disconnected",
  "stale",
  "error",
  "transmitting",
  "streaming",
]);

export const SourceSdrSettingsSchema = z.object({
  fft_size: z.number().optional(),
  fft_window: z.string().optional(),
  frame_rate: z.number().optional(),
  sample_rate: z.number().optional(),
  min_receive_sample_rate: z.number().optional(),
  center_frequency: z.number().optional(),
  gain: z
    .union([
      z.number(),
      z.object({
        tuner_gain: z.number(),
        rtl_agc: z.boolean(),
        tuner_agc: z.boolean(),
        hackrf_lna_gain: z.number().optional(),
        hackrf_vga_gain: z.number().optional(),
        hackrf_amp_enable: z.boolean().optional(),
        tuner_bandwidth: z.number().optional(),
      }),
    ])
    .optional(),
  hackrf_lna_gain: z.number().optional(),
  hackrf_vga_gain: z.number().optional(),
  hackrf_amp_enable: z.boolean().optional(),
  ppm: z.number().optional(),
  tuner_agc: z.boolean().optional(),
  rtl_agc: z.boolean().optional(),
  offset_tuning: z.boolean().optional(),
  direct_sampling: z.number().optional(),
  tuner_bandwidth: z.number().optional(),
  fft: SdrSettingsConfigSchema.shape.fft,
  display: SdrSettingsConfigSchema.shape.display,
  devices: SdrSettingsConfigSchema.shape.devices,
});

export const SourceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  capability: SourceCapabilitySchema,
  status: SourceStatusSchema.nullable(),
  loading_attempt: z.number().int().nonnegative(),
  loading_attempt_max: z.number().int().nonnegative(),
  supports_approx_dbm: z.boolean(),
  supports_raw_iq_stream: z.boolean(),
  sdr: z.object({
    max_sample_rate: z.number(),
    sample_rate_options: z.array(z.number()),
    fft_display: z.object({
      markers: z.array(
        z.object({
          kind: z.string(),
          freq_hz: z.number(),
          label: z.string().optional(),
        }),
      ),
    }),
    settings: SourceSdrSettingsSchema,
  }),
});

export const SourceInfoMessageSchema = z.object({
  type: z.literal("source_info"),
  active_source: z.string(),
  active_source_mode: z.enum(["live", "file"]),
  sources: z.array(SourceInfoSchema),
});

export const ActiveSourceMessageSchema = z.object({
  type: z.literal("active_source"),
  source_id: z.string(),
  source_mode: z.enum(["live", "file"]),
});

export const SourceStatusMessageSchema = z.object({
  type: z.literal("status"),
  source_id: z.string(),
  status: SourceStatusSchema,
  loading_attempt: z.number().int().nonnegative().optional(),
  loading_attempt_max: z.number().int().nonnegative().optional(),
});

export const SourceSdrSettingsMessageSchema = z.object({
  type: z.literal("sdr_settings"),
  source_id: z.string(),
  sdr: SourceSdrSettingsSchema,
});

export const SourceErrorMessageSchema = z.object({
  type: z.literal("error"),
  source_id: z.string(),
  code: z.string(),
  message: z.string(),
});

export const SpectrumFrameSchema = z.object({
  id: z.string(),
  label: z.string(),
  min_hz: z.number(),
  max_hz: z.number(),
  description: z.string(),
});

export const ChannelsMessageSchema = z.object({
  type: z.literal("channels"),
  source_id: z.string(),
  channels: z.array(SpectrumFrameSchema),
  active_signal_area: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const CaptureRequestSchema = z.object({
  jobId: z.string(),
  fragments: z.array(
    z.object({
      minFreq: z.number(),
      maxFreq: z.number(),
    }),
  ),
  bandwidth: z.number().int().nonnegative().optional(),
  bandwidthCenterFrequency: z.number().int().nonnegative().optional(),
  durationMode: z.enum(["timed", "manual"]),
  durationS: z.number().optional(),
  fileType: z.enum([".napt", ".wav"]),
  acquisitionMode: z.enum(["stepwise", "interleaved", "whole_sample"]),
  encrypted: z.boolean(),
  fftSize: z.number(),
  fftWindow: z.string(),
  geolocation: GeolocationDataSchema.optional(),
  refBasedDemodBaseline: z
    .enum(["audio_hearing", "audio_internal", "speech", "vision"])
    .optional(),
  liveMode: z.boolean().optional(),
});

export const CaptureStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(["started", "progress", "failed", "done"]),
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
export const WebSocketMessageSchema = z.union([
  z.object({
    type: z.literal("frequency_range"),
    min_hz: z.number().int(),
    max_hz: z.number().int(),
    center_frequency: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("set_frequency_range"),
    min_hz: z.number().int(),
    max_hz: z.number().int(),
    center_frequency: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("pause"),
    paused: z.boolean(),
  }),
  z.object({
    type: z.literal("gain"),
    gain: z.number(),
  }),
  z.object({
    type: z.literal("ppm"),
    ppm: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("signal_display_settings"),
    source_id: z.string(),
    sample_rate: z.number(),
    fft_size: z.number(),
    frame_rate: z.number(),
  }),
  z.object({
    type: z.literal("settings"),
    fftSize: z.number().optional(),
    fftWindow: z.string().optional(),
    frameRate: z.number().optional(),
    gain: z.number().optional(),
    hackrfLnaGain: z.number().min(0).max(49.6).optional(),
    hackrfVgaGain: z.number().min(0).max(62).optional(),
    hackrfAmpEnabled: z.boolean().optional(),
    tunerBandwidth: z.number().min(0).max(20_000_000).optional(),
    ppm: z.number().int().nonnegative().optional(),
    tunerAGC: z.boolean().optional(),
    rtlAGC: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("restart_device"),
  }),
  z.object({
    type: z.literal("select_source"),
    source_id: z.string(),
  }),
  z.object({
    type: z.literal("training_capture"),
    action: z.enum(["start", "stop"]),
    label: z.enum(["target", "noise"]),
    signalArea: z.string(),
  }),
  z
    .object({
      type: z.literal("capture"),
    })
    .merge(CaptureRequestSchema.partial()),
  z.object({
    type: z.literal("capture_stop"),
    jobId: z.string().optional(),
  }),
  // Server-to-client messages
  SourceInfoMessageSchema,
  ActiveSourceMessageSchema,
  ChannelsMessageSchema,
  SourceStatusMessageSchema,
  SourceSdrSettingsMessageSchema,
  SourceErrorMessageSchema,
]);

// Type guards derived from schemas
export const isValidAuthInfo = (
  data: unknown,
): data is z.infer<typeof AuthInfoSchema> => {
  return AuthInfoSchema.safeParse(data).success;
};

export const isValidAuthResult = (
  data: unknown,
): data is z.infer<typeof AuthResultSchema> => {
  return AuthResultSchema.safeParse(data).success;
};

export const isValidSessionValidation = (
  data: unknown,
): data is z.infer<typeof SessionValidationSchema> => {
  return SessionValidationSchema.safeParse(data).success;
};

export const isValidWebSocketMessage = (
  data: unknown,
): data is z.infer<typeof WebSocketMessageSchema> => {
  return WebSocketMessageSchema.safeParse(data).success;
};

export const isValidSpectrumFrame = (
  data: unknown,
): data is z.infer<typeof SpectrumFrameSchema> => {
  return SpectrumFrameSchema.safeParse(data).success;
};

export const isValidCaptureRequest = (
  data: unknown,
): data is z.infer<typeof CaptureRequestSchema> => {
  return CaptureRequestSchema.safeParse(data).success;
};

export const isValidCaptureStatus = (
  data: unknown,
): data is z.infer<typeof CaptureStatusSchema> => {
  return CaptureStatusSchema.safeParse(data).success;
};

export const isValidSourceInfoMessage = (
  data: unknown,
): data is z.infer<typeof SourceInfoMessageSchema> => {
  return SourceInfoMessageSchema.safeParse(data).success;
};

export const isValidChannelsMessage = (
  data: unknown,
): data is z.infer<typeof ChannelsMessageSchema> => {
  return ChannelsMessageSchema.safeParse(data).success;
};

export const isValidSourceStatusMessage = (
  data: unknown,
): data is z.infer<typeof SourceStatusMessageSchema> => {
  return SourceStatusMessageSchema.safeParse(data).success;
};

export const isValidSourceSdrSettingsMessage = (
  data: unknown,
): data is z.infer<typeof SourceSdrSettingsMessageSchema> => {
  return SourceSdrSettingsMessageSchema.safeParse(data).success;
};

export const isValidSourceErrorMessage = (
  data: unknown,
): data is z.infer<typeof SourceErrorMessageSchema> => {
  return SourceErrorMessageSchema.safeParse(data).success;
};

export const isValidActiveSourceMessage = (
  data: unknown,
): data is z.infer<typeof ActiveSourceMessageSchema> => {
  return ActiveSourceMessageSchema.safeParse(data).success;
};
