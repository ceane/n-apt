/**
 * WebSocket Schema Definitions
 * 
 * This file contains the TypeScript definitions for all WebSocket messages
 * exchanged between the client and server.
 */

import { type GeolocationData } from "../../types/geolocation";
export { type GeolocationData };

export type DeviceState =
  | "connected"
  | "loading"
  | "disconnected"
  | "stale"
  | null;

export type DeviceLoadingReason = "connect" | "restart" | null;

export type FrequencyRange = {
  min: number;
  max: number;
};

export type SDRSettings = {
  fftSize?: number;
  fftWindow?: string;
  frameRate?: number;
  gain?: number;
  ppm?: number;
  tunerAGC?: boolean;
  rtlAGC?: boolean;
};

export type SdrSettingsConfig = {
  sample_rate: number;
  center_frequency: number;
  gain?: {
    tuner_gain: number;
    rtl_agc: boolean;
    tuner_agc: boolean;
  };
  ppm?: number;
  fft?: {
    default_size: number;
    default_frame_rate: number;
    max_size: number;
    max_frame_rate: number;
    size_to_frame_rate?: Record<string, number>;
  };
  display?: {
    min_db: number;
    max_db: number;
    padding: number;
  };
  limits?: {
    lower_limit_mhz?: number;
    upper_limit_mhz?: number;
    lower_limit_label?: string;
    upper_limit_label?: string;
  };
};

export type AptContentType = "audio_hearing" | "audio_internal" | "speech" | "video_vision";

export interface AptChannelMetadata {
  windowSizeHz: number;
  contentType: AptContentType;
  subChannelRange: [number, number];
  centerFreqHz: number;
  signalStrengthDb: number;
  snr: number;
  demodProcessor: string;
}

export interface SdrProcessorSettings {
  fft_size?: number;
  fft_window?: string;
  frame_rate?: number;
  gain?: number;
  ppm?: number;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  offset_tuning?: boolean;
  direct_sampling?: number;
  tuner_bandwidth?: number;
}

export type SpectrumFrame = {
  id: string;
  label: string;
  min_mhz: number;
  max_mhz: number;
  description: string;
};

export type IqRawFrame = {
  type: "spectrum";
  is_mock_apt?: boolean;
  center_frequency_hz?: number;
  waveform_span_mhz?: number | null;
  timestamp?: number;
  data_type: "iq_raw";
  sample_rate?: number;
  iq_data: Uint8Array;
};

export type LiveFrameData = IqRawFrame;

export type CaptureFileType = ".napt" | ".wav";

export type CaptureRequest = {
  jobId: string;
  fragments: { minFreq: number; maxFreq: number }[];
  durationS: number;
  fileType: CaptureFileType;
  acquisitionMode: "stepwise" | "interleaved" | "whole_sample";
  encrypted: boolean;
  fftSize: number;
  fftWindow: string;
  geolocation?: GeolocationData;
  refBasedDemodBaseline?: "audio_hearing" | "audio_internal" | "speech" | "vision";
  liveMode?: boolean;
};

export type CaptureStatus = {
  jobId: string;
  status: "started" | "progress" | "failed" | "done";
  message?: string;
  progress?: number;
  error?: string;
  downloadUrl?: string;
  filename?: string;
  fileCount?: number;
  ephemeral?: boolean;
  timestamp?: number;
  fileSize?: number;
} | null;

export type AutoFftOptionsResponse = {
  type: "auto_fft_options";
  autoSizes: number[];
  recommended: number;
};

export interface DeviceProfile {
  kind: string;
  is_rtl_sdr: boolean;
  supports_approx_dbm: boolean;
  supports_raw_iq_stream: boolean;
}

export interface StatusMessage {
  type: "status";
  device_connected: boolean;
  device_info: string;
  device_name: string;
  device_loading: boolean;
  device_loading_reason: DeviceLoadingReason;
  device_state: DeviceState;
  paused: boolean;
  max_sample_rate: number;
  channels: SpectrumFrame[];
  sdr_settings: SdrSettingsConfig;
  device: "rtl-sdr" | "mock_apt";
  device_profile: DeviceProfile;
}

export type WebSocketMessage =
  | { type: "frequency_range" | "set_frequency_range"; min_mhz: number; max_mhz: number }
  | { type: "pause"; paused: boolean }
  | { type: "gain"; gain: number }
  | { type: "ppm"; ppm: number }
  | ({ type: "settings" } & SDRSettings)
  | { type: "frame_rate"; frameRate: number }
  | { type: "restart_device" }
  | { type: "training_capture"; action: "start" | "stop"; label: "target" | "noise"; signalArea: string }
  | ({ type: "capture" } & CaptureRequest)
  | { type: "get_auto_fft_options"; screenWidth: number };
