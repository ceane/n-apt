import { validateStatusMessage } from "../../src/ts/validation";
import { updateDeviceState } from "../../src/ts/redux/slices/websocketSlice";
import { execSync } from "child_process";

describe('Backend-Frontend Hz Pipeline Integration (True E2E)', () => {
  let signalsConfig: any;

  beforeAll(() => {
    // True integration: Run the real Rust binary to get the processed signals.yaml
    try {
      // Use cargo run to execute the dump_config binary
      const output = execSync('cargo run --bin dump_config', { 
        encoding: 'utf8', 
        stdio: ['ignore', 'pipe', 'ignore'],
        cwd: process.cwd()
      });
      signalsConfig = JSON.parse(output);
    } catch (error) {
      console.error('Failed to run Rust dump_config binary. Ensure cargo is installed and working.');
      throw error;
    }
  });

  const constructStatusMessage = (config: any) => {
    const naptChannels = config.signals.n_apt.channels;
    const channelIds = Object.keys(naptChannels);
    
    return {
      type: "status",
      device_connected: true,
      device_info: "Mock RTL-SDR",
      device_name: "Mock SDR",
      device_loading: false,
      device_loading_reason: "null",
      device_state: "connected",
      paused: false,
      max_sample_rate: config.signals.sdr.sample_rate,
      channels: channelIds.map(id => ({
        id,
        label: naptChannels[id].label,
        min_hz: naptChannels[id].freq_range_hz[0],
        max_hz: naptChannels[id].freq_range_hz[1],
        description: naptChannels[id].description
      })),
      sdr_settings: {
        center_frequency: config.signals.sdr.center_frequency,
        sample_rate: config.signals.sdr.sample_rate,
        gain: {
          tuner_gain: config.signals.sdr.gain.tuner_gain,
          rtl_agc: config.signals.sdr.gain.rtl_agc,
          tuner_agc: config.signals.sdr.gain.tuner_agc
        },
        ppm: config.signals.sdr.ppm,
        fft: {
          default_size: config.signals.sdr.fft.default_size,
          default_frame_rate: config.signals.sdr.fft.default_frame_rate,
          max_size: config.signals.sdr.fft.max_size,
          max_frame_rate: config.signals.sdr.fft.max_frame_rate
        },
        display: {
          min_db: config.signals.sdr.display.min_db,
          max_db: config.signals.sdr.display.max_db,
          padding: config.signals.sdr.display.padding
        },
        limits: config.signals.sdr.limits || undefined
      },
      device: "rtl-sdr",
      device_profile: {
        kind: "rtl_sdr",
        is_rtl_sdr: true,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true
      }
    };
  };

  test('should validate real backend-processed Hz values from signals.yaml', () => {
    const mockStatusMessage = constructStatusMessage(signalsConfig);

    // 1. Validate the message structure and frequency integrity using the real frontend validator
    const isValid = validateStatusMessage(mockStatusMessage);
    expect(isValid).toBe(true);

    // Verify raw Hz integrity
    const channel = mockStatusMessage.channels[0];
    expect(typeof channel.min_hz).toBe('number');
    // It should be the exact value from our signals.yaml (e.g. 18000 for Channel A)
    expect(channel.min_hz).toBe(signalsConfig.signals.n_apt.channels[channel.id].freq_range_hz[0]);
  });

  test('should correctly map real backend config to Redux state', () => {
    const mockStatusMessage = constructStatusMessage(signalsConfig);

    // This simulates the mapping in websocketMiddleware.ts
    const updates: any = {
      serverPaused: mockStatusMessage.paused || false,
      backend: mockStatusMessage.device,
      deviceName: mockStatusMessage.device_name,
      maxSampleRateHz: mockStatusMessage.max_sample_rate,
      sdrSettings: mockStatusMessage.sdr_settings,
      sampleRateHz: mockStatusMessage.sdr_settings.sample_rate,
      spectrumFrames: mockStatusMessage.channels.map((f: any) => ({
        id: f.id,
        label: f.label,
        min_hz: Number(f.min_hz),
        max_hz: Number(f.max_hz),
        description: f.description,
      }))
    };

    // 2. Map to Redux action
    const action = updateDeviceState(updates);
    
    // Verify Redux state mapping preserved the real Hz values from the backend
    expect(action.payload.spectrumFrames).toBeDefined();
    const firstId = mockStatusMessage.channels[0].id;
    const mappedFrame = action.payload.spectrumFrames!.find((f: any) => f.id === firstId);
    expect(mappedFrame).toBeDefined();
    expect(mappedFrame!.min_hz).toBe(mockStatusMessage.channels[0].min_hz);
    expect(mappedFrame!.max_hz).toBe(mockStatusMessage.channels[0].max_hz);
  });
});
