export interface CaptureDeviceProfileMetadata {
  kind: string;
  serial_number?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmware_version?: string | null;
}

export interface CaptureGeolocationMetadata {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number | null;
  timestamp: number;
}

export interface CaptureChannelMetadata {
  center_freq_hz: number;
  sample_rate_hz: number;
  requested_min_freq_hz?: number | null;
  requested_max_freq_hz?: number | null;
  bins_per_frame: number;
  label?: string | null;
  offset_iq?: number;
  iq_length?: number;
}

export interface CaptureFrameUpdateMetadata {
  sample_offset: number;
  timestamp_us: number;
  channel?: number;
  kind?: string;
  frame_sequence?: number;
  source_id?: string;
  job_id?: string;
  patch: Record<string, unknown>;
}

export interface CaptureSampleEncodingMetadata {
  element_type: string;
  bits_per_element: number;
  signed: boolean;
  byte_order: string;
  normalization: string;
}

export interface CaptureMetadata {
  [key: string]: unknown;
  center_frequency_hz?: number;
  capture_sample_rate_hz?: number;
  hardware_sample_rate_hz?: number;
  encrypted?: boolean;
  timestamp_utc?: string;
  frame_rate?: number;
  fft_size?: number;
  fft_window?: string;
  duration_s?: number;
  acquisition_mode?: string;
  source_device?: string;
  gain?: number;
  ppm?: number;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  data_format?: string;
  spectrum_shifted?: boolean;
  format?: string;
  format_version?: number;
  interleaving?: string;
  sample_encoding?: CaptureSampleEncodingMetadata;
  device_profile?: CaptureDeviceProfileMetadata;
  encryption?: string;
  vault_key_recovery?: Record<string, unknown>;
  ref_based_demod_baseline?: string;
  capture_labels?: string[];
  frequency_range?: [number, number];
  bandwidth?: number;
  bandwidth_center_frequency?: number;
  geolocation?: CaptureGeolocationMetadata;
  channels?: CaptureChannelMetadata[];
  frame_updates?: CaptureFrameUpdateMetadata[];
  wrapped_dek?: string;
  sections?: Record<string, unknown>;
  checksum?: string;
  integrity?: Record<string, unknown>;
  trailer?: Record<string, unknown>;
}

export interface SnapshotMetadata {
  frequency_range?: [number, number];
  timestamp_utc?: string;
  timestamp_label?: string;
  source_device?: string;
  device_profile?: Pick<CaptureDeviceProfileMetadata, "serial_number">;
  channel_name?: string;
  channel_label?: string;
  active_signal_area_bounds?: { min: number; max: number } | null;
  signal_area_bounds?: Record<string, { min: number; max: number }> | null;
  fft_size?: number | string;
  fft_window?: string;
  hardware_sample_rate_hz?: number;
  gain?: number;
  ppm?: number;
  gain_label?: string;
  mode_label?: string;
  whole?: boolean;
  show_geolocation?: boolean;
  geolocation?: Partial<CaptureGeolocationMetadata>;
  location_label?: string | null;
}
