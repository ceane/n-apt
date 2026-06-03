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
  | "error"
  | "transmitting"
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
  sampleRate?: number;
  gain?: number;
  hackrfLnaGain?: number;
  hackrfVgaGain?: number;
  hackrfAmpEnabled?: boolean;
  tunerBandwidth?: number;
  ppm?: number;
  tunerAGC?: boolean;
  rtlAGC?: boolean;
};

export type SdrSettingsConfig = {
  sample_rate: number;
  min_receive_sample_rate?: number;
  center_frequency: number;
  gain?: {
    tuner_gain: number;
    rtl_agc: boolean;
    tuner_agc: boolean;
    hackrf_lna_gain?: number;
    hackrf_vga_gain?: number;
    hackrf_amp_enable?: boolean;
    tuner_bandwidth?: number;
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
  fft_sizes?: Array<{
    base: string;
    fft_min?: number;
    fft_max?: number;
  }>;
  devices?: Record<
    string,
    {
      sample_rate: number | string | Array<string> | Record<string, any>;
      fft_display?: {
        markers?: Array<{
          kind: string;
          freq_hz: number;
          label?: string;
        }>;
      };
      fft_sizes?: Array<{
        base: string;
        fft_min?: number;
        fft_max?: number;
      }>;
      gain_limits?: {
        min?: number;
        max?: number;
        step?: number;
        lna_min?: number;
        lna_max?: number;
        lna_step?: number;
        vga_min?: number;
        vga_max?: number;
        vga_step?: number;
      };
    }
  >;
};

export type AptContentType =
  | "audio_hearing"
  | "audio_internal"
  | "speech"
  | "video_vision";

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
  min_hz: number;
  max_hz: number;
  description: string;
};

export type ChannelsMessage = {
  type: "channels";
  source_id: string;
  channels: SpectrumFrame[];
  active_signal_area?: string | null;
  error?: string | null;
};

export type IqRawFrame = {
  type: "spectrum";
  is_mock_apt?: boolean;
  center_frequency_hz?: number;
  waveform_span_hz?: number | null;
  timestamp?: number;
  data_type: "iq_raw";
  sample_rate?: number;
  iq_data: Uint8Array;
};

export type LiveFrameData = IqRawFrame;

export type CaptureFileType = ".napt" | ".wav";

export type CaptureDurationMode = "timed" | "manual";

export type CaptureRequest = {
  jobId: string;
  fragments: { minFreq: number; maxFreq: number }[];
  bandwidth?: number;
  bandwidthCenterFrequency?: number;
  durationMode: CaptureDurationMode;
  durationS?: number;
  fileType: CaptureFileType;
  acquisitionMode: "stepwise" | "interleaved" | "whole_sample";
  encrypted: boolean;
  fftSize: number;
  fftWindow: string;
  geolocation?: GeolocationData;
  refBasedDemodBaseline?:
    | "audio_hearing"
    | "audio_internal"
    | "speech"
    | "vision";
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
  /** Capture length in seconds (server-computed). */
  duration?: number;
} | null;

export interface DeviceProfile {
  kind: string;
  is_rtl_sdr: boolean;
  supports_approx_dbm: boolean;
  supports_raw_iq_stream: boolean;
}

export type SourceCapability = "rx" | "tx" | "tx_rx" | "mock";

export type SourceStatus =
  | "connected"
  | "loading"
  | "disconnected"
  | "stale"
  | "error"
  | "transmitting"
  | "streaming"
  | null;

export type SourceSdrSettings = {
  fft_size?: number;
  fft_window?: string;
  frame_rate?: number;
  sample_rate?: number;
  min_receive_sample_rate?: number;
  center_frequency?: number;
  gain?: number | SdrSettingsConfig["gain"];
  hackrf_lna_gain?: number;
  hackrf_vga_gain?: number;
  hackrf_amp_enable?: boolean;
  ppm?: number;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  offset_tuning?: boolean;
  direct_sampling?: number;
  tuner_bandwidth?: number;
  fft?: SdrSettingsConfig["fft"];
  display?: SdrSettingsConfig["display"];
  devices?: SdrSettingsConfig["devices"];
  fft_sizes?: SdrSettingsConfig["fft_sizes"];
};

export interface SourceInfo {
  id: string;
  name: string;
  kind: string;
  capability: SourceCapability;
  status: SourceStatus;
  loading_attempt: number;
  loading_attempt_max: number;
  supports_approx_dbm: boolean;
  supports_raw_iq_stream: boolean;
  serial_number?: string;
  manufacturer?: string;
  product?: string;
  sdr: {
    max_sample_rate: number;
    sample_rate_options: number[];
    fft_display: {
      markers: Array<{
        kind: string;
        freq_hz: number;
        label?: string;
      }>;
    };
    settings: SourceSdrSettings;
  };
}

export interface SourceInfoMessage {
  type: "source_info";
  active_source: string;
  active_source_mode: "live" | "file";
  sources: SourceInfo[];
}

export interface ActiveSourceMessage {
  type: "active_source";
  source_id: string;
  source_mode: "live" | "file";
}

export interface SourceStatusMessage {
  type: "status";
  source_id: string;
  status: Exclude<SourceStatus, null>;
  loading_attempt?: number;
  loading_attempt_max?: number;
}

export interface SourceSdrSettingsMessage {
  type: "sdr_settings";
  source_id: string;
  sdr: SourceSdrSettings;
}

export interface SourceErrorMessage {
  type: "error";
  source_id: string;
  code: string;
  message: string;
}

export interface SignalDisplaySettingsMessage {
  type: "signal_display_settings";
  source_id: string;
  sample_rate: number;
  fft_size: number;
  frame_rate: number;
}

export type WebSocketMessage =
  | {
      type: "frequency_range" | "set_frequency_range";
      min_hz: number;
      max_hz: number;
      center_frequency?: number;
    }
  | ChannelsMessage
  | { type: "pause"; paused: boolean }
  | { type: "gain"; gain: number }
  | { type: "ppm"; ppm: number }
  | ({ type: "settings" } & SDRSettings)
  | SignalDisplaySettingsMessage
  | { type: "restart_device" }
  | { type: "select_source"; source_id: string }
  | {
      type: "training_capture";
      action: "start" | "stop";
      label: "target" | "noise";
      signalArea: string;
    }
  | ({ type: "capture" } & CaptureRequest)
  | { type: "capture_stop"; jobId?: string }
  | ActiveSourceMessage;
