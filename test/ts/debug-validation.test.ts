/**
 * Debug test to understand validation failures
 */

import {
  validateWebSocketMessage,
  validateStatusMessage,
  validateAutoFftOptions,
} from '@n-apt/validation';

describe('Debug WebSocket Validation', () => {
  test('should validate the actual failing messages', () => {
    // Test the exact message from the error
    const statusMessage = {
      type: 'status',
      device_connected: false,
      device_info: 'Mock APT SDR - Freq: 1600000 Hz, Rate: 3200000 Hz (Sample Rate: 3200000 Hz), Gain: 49.6 dB, PPM: 1',
      device_name: 'Mock APT SDR',
      device_loading: false,
      device_loading_reason: null,
      device_state: 'disconnected',
      paused: false,
      max_sample_rate: 3200000,
      channels: [],
      sdr_settings: {
        sample_rate: 3200000,
        center_frequency: 1600000,
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
      device: 'mock_apt',
      device_profile: {
        kind: 'mock_apt',
        is_rtl_sdr: false,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
      },
    };

    console.log('Status message validation result:', validateStatusMessage(statusMessage));
    console.log('WebSocket message validation result:', validateWebSocketMessage(statusMessage));

    // Test the auto_fft_options message
    const autoFftOptions = {
      type: 'auto_fft_options',
      autoSizes: [1024, 2048, 4096],
      recommended: 2048,
    };

    console.log('Auto FFT options validation result:', validateAutoFftOptions(autoFftOptions));
    console.log('Auto FFT WebSocket validation result:', validateWebSocketMessage(autoFftOptions));
  });
});
