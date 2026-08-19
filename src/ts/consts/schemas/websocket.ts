/**
 * WebSocket Schema Definitions
 *
 * This file contains the TypeScript definitions for all WebSocket messages
 * exchanged between the client and server.
 */

import { type GeolocationData } from "@n-apt/types/geolocation";
export { type GeolocationData };

export type DeviceState =
  | "connected"
  | "initializing"
  | "loading"
  | "disconnected"
  | "stale"
  | "error"
  | "receiving"
  | "paused"
  | "standby"
  | "transmitting"
  | "streaming"
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
  maxFrameRate?: number;
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
  min_receive_sample_rate?: number | null;
  center_frequency: number;
  gain?: {
    tuner_gain: number;
    rtl_agc: boolean;
    tuner_agc: boolean;
    hackrf_lna_gain?: number | null;
    hackrf_vga_gain?: number | null;
    hackrf_amp_enable?: boolean | null;
    tuner_bandwidth?: number | null;
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
};

export type SdrSampleRateSpec =
  | number
  | string
  | string[]
  | { value: string; min: string; max: string };

export type SignalsSdrDefaults = SdrSettingsConfig & {
  gain: NonNullable<SdrSettingsConfig["gain"]> & {
    hackrf_lna_gain?: number | null;
    hackrf_vga_gain?: number | null;
    hackrf_amp_enable?: boolean | null;
    tuner_bandwidth?: number | null;
  };
  ppm: number;
  devices: Record<string, {
    duplex_mode?: string | null;
    max_sample_rate?: number | null;
    sample_rate: SdrSampleRateSpec;
    fft_display?: {
      markers: Array<{ kind: string; freq_hz: number; label?: string | null }>;
    } | null;
    gain_limits?: Record<string, number | null> | null;
    fft_sizes?: Array<{
      base: string;
      fft_min?: number | null;
      fft_max?: number | null;
    }> | null;
    _tx_power_mapping?: Record<string, unknown> | null;
    _tx_iq_power_model?: Record<string, unknown> | null;
  }>;
  fft_sizes?: Array<{
    base: string;
    fft_min?: number | null;
    fft_max?: number | null;
  }> | null;
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

/** Canonical channel metadata derived by the backend from signals.channels. */
export type ChannelsMessage = {
  type: "channels";
  source_id: string;
  channels: SpectrumFrame[];
  active_signal_area?: string | null;
  frequency_range?: { min: number; max: number } | null;
  sample_rate?: number;
  error?: string | null;
};

export type IqFrameStatus =
  | "receiving"
  | "standby"
  | "transmitting"
  | "paused";

type IqRawFramePayload = {
  type: "spectrum";
  is_mock_apt?: boolean;
  frame_status?: IqFrameStatus;
  is_tx_preview?: boolean;
  is_mock_tx_preview?: boolean;
  center_frequency_hz?: number;
  waveform_span_hz?: number | null;
  timestamp?: number;
  data_type: "iq_raw";
  sample_rate?: number;
  iq_data: Uint8Array;
};

/** Legacy in-memory or 24-byte v1 frame with client-scoped ownership. */
export type IqRawFrameV1 = IqRawFramePayload & {
  protocol_version?: 1;
  source_id?: string;
  stream_epoch?: undefined;
  sequence?: undefined;
};

/** Negotiated v2 frame with explicit source and lifecycle ordering metadata. */
export type IqRawFrameV2 = IqRawFramePayload & {
  protocol_version: 2;
  source_id: string;
  stream_epoch: number;
  sequence: number;
};

/** Compatible raw I/Q publication shape discriminated by wire protocol. */
export type IqRawFrame = IqRawFrameV1 | IqRawFrameV2;

export type LiveFrameData = IqRawFrame;

export type IqElementType = "u8";
export type IqLayout = "interleaved_iq";

export interface IqFormat {
  element_type: IqElementType;
  layout: IqLayout;
  typed_array: "Uint8Array";
}

export type CaptureFileType = ".napt" | ".wav" | ".iq";

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

export type TxSafetyResult = {
  type: "tx_safety";
  source_id: string;
  effective_power_dbm: number;
  maximum_safe_power_dbm: number;
  minimum_iq_power_floor_dbm: number;
  recommended_ifft_size: number;
  effective_ifft_size: number;
  vga_gain_db?: number;
  amp_enabled?: boolean;
  safety_clamped: boolean;
  validation_errors: string[];
};

export interface DeviceProfile {
  kind: string;
  is_rtl_sdr: boolean;
  supports_approx_dbm: boolean;
  iq_format?: IqFormat;
}

export type SourceCapability = "rx" | "tx" | "tx_rx" | "mock";

export type SourceCapabilities = {
  can_receive: boolean;
  can_transmit: boolean;
  /** Source can publish a live TX-monitor/preview stream. */
  supports_tx_monitor?: boolean;
  /** Configured inventory label, e.g. "Simplex" or "Half-duplex". */
  duplex_mode?: string | null;
  active_duplex_mode?: DeviceActiveMode | null;
  active_duplex_modes?: DeviceActiveMode[] | null;
  supports_approx_dbm: boolean;
  iq_format?: IqFormat;
  supported_controls: string[];
  sample_rates: number[];
  max_sample_rate: number;
  /** Maximum instantaneous render/acquisition span in Hz. */
  max_instantaneous_sample_rate: number;
  frequency_range?: FrequencyRange | null;
  tx_power_dbm?: {
    min?: number;
    max?: number;
  } | null;
  gain_limits?: {
    min?: number | null;
    max?: number | null;
    step?: number | null;
    lna_min?: number | null;
    lna_max?: number | null;
    lna_step?: number | null;
    vga_min?: number | null;
    vga_max?: number | null;
    vga_step?: number | null;
  } | null;
  fft?: {
    sizes: number[];
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
};

export type DeviceActiveMode = "rx" | "tx" | "rx_tx";
export type DeviceDuplexMode = "half_duplex";

export type SourceStatus =
  | "connected"
  | "initializing"
  | "loading"
  | "disconnected"
  | "stale"
  | "error"
  | "receiving"
  | "paused"
  | "standby"
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
  hackrf_lna_gain?: number | null;
  hackrf_vga_gain?: number | null;
  hackrf_amp_enable?: boolean | null;
  ppm?: number;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  offset_tuning?: boolean;
  direct_sampling?: number;
  tuner_bandwidth?: number | null;
  fft?: SdrSettingsConfig["fft"];
  display?: SdrSettingsConfig["display"];
};

export interface SourceInfo {
  id: string;
  name: string;
  kind: string;
  capability: SourceCapability;
  duplex_mode?: string | null;
  /** Backend-reported hardware mode; view mode remains UI-owned. */
  active_duplex_mode?: DeviceActiveMode | null;
  active_duplex_modes?: DeviceActiveMode[] | null;
  status: SourceStatus;
  paused?: boolean;
  loading_attempt: number;
  loading_attempt_max: number;
  supports_approx_dbm: boolean;
  iq_format?: IqFormat;
  /** Generic capability envelope. Legacy top-level fields remain during migration. */
  capabilities?: SourceCapabilities;
  stream_key?: string;
  stream_key_kind?: "serial" | "source_id";
  /** Additive raw-I/Q wire versions supported by this source. */
  iq_stream_protocols?: Array<1 | 2>;
  /** Current source lifecycle generation for v2 frame validation. */
  stream_epoch?: number;
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
  stream_epoch?: number;
}

export interface SourceStatusMessage {
  type: "status";
  source_id: string;
  status: Exclude<SourceStatus, null>;
  loading_attempt?: number;
  loading_attempt_max?: number;
  stream_epoch?: number;
}

export interface SourceSdrSettingsMessage {
  type: "sdr_settings";
  source_id: string;
  sdr: SourceSdrSettings;
}

export interface SignalsDefaultsMessage {
  type: "signals_defaults";
  sdr: SignalsSdrDefaults;
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
  | TxSafetyResult
  | {
      type: "frequency_range" | "set_frequency_range";
      scope?: "device";
      min_hz: number;
      max_hz: number;
      center_frequency?: number;
      bandwidth_center_frequency?: number;
      signal_area?: string;
    }
  | ChannelsMessage
  | {
      type: "pause";
      scope?: "subscriber";
      paused: boolean;
      source_id: string;
      duplex_mode?: DeviceDuplexMode;
    }
  | {
      type: "status";
      scope?: "device";
      status: "standby" | "transmitting";
      txDevice?: string;
      serialNumber?: string;
      centerFrequencyHz?: number;
      bandwidthHz?: number;
      sampleRateHz?: number;
      ifftSize?: number;
      powerDbm?: number;
      lnaGainDb?: number;
      vgaGainDb?: number;
      ampEnabled?: boolean;
      tunerAgc?: boolean;
      rtlAgc?: boolean;
      ppm?: number;
      txSafetyEnabled?: boolean;
      txSafetyLimit?: string;
      txSignal?: string;
      txHopEnabled?: boolean;
      txHopType?: string;
      txHopStartFrequencyHz?: number;
      txHopEndFrequencyHz?: number;
      txHopChannels?: string[];
      txHopRateHz?: number;
    }
  | { type: "gain"; scope?: "device"; gain: number }
  | { type: "ppm"; scope?: "device"; ppm: number }
  | ({ type: "settings"; scope?: "device" } & SDRSettings)
  | SignalDisplaySettingsMessage
  | SignalsDefaultsMessage
  | { type: "restart_device"; scope?: "device" }
  | {
      type: "select_source";
      scope?: "device";
      source_id: string;
      sample_rate?: number;
    }
  | {
      type: "training_capture";
      action: "start" | "stop";
      label: "target" | "noise";
      signalArea: string;
    }
  | ({ type: "capture" } & CaptureRequest)
  | { type: "capture_stop"; jobId?: string }
  | ActiveSourceMessage;
