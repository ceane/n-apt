//! Mock APT SDR Device Implementation
//!
//! Provides a simulated SDR device that generates realistic signals for testing and demonstration.
//! Uses bin-based frequency modeling for consistent FFT placement and dynamic signal behavior.
//! Reads configuration from signals.yaml for signal parameters and variation settings.

use crate::fft::types::RawSamples;
use anyhow::Result;
use crossbeam_channel::Receiver;
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};
use std::f32::consts::PI;
use std::f64::consts::PI as PI64;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use super::SdrDevice;

/// Mock APT signal configuration
#[derive(Debug, Clone)]
struct MockAptSignalConfig {
  center_frequency_hz: f64,
  strength_db: f64,
}

/// Mock APT SDR device implementation
pub struct MockAptDevice {
  center_freq: u32,
  sample_rate: u32,
  gain: f64,
  ppm: i32,
  tuner_agc: bool,
  rtl_agc: bool,
  offset_tuning: bool,
  tuner_bandwidth: u32,
  direct_sampling: u8,
  total_samples: u64,
  signals: Vec<MockAptSignal>,
  noise_floor_db: f32,
  rng: StdRng,
  settle_time_samples: u64,
  samples_since_init: u64,
  last_config_reload_check: Instant,
  last_config_modified: Option<SystemTime>,
  rx_queue: Option<Receiver<Vec<u8>>>,
  async_thread: Option<JoinHandle<()>>,
  iq_overflow: Vec<u8>,
}

/// Individual mock APT signal state
#[derive(Debug, Clone)]
struct MockAptSignal {
  config: MockAptSignalConfig,
  drift_offset: f32,
  modulation_phase: f32,
  active: bool,
  bandwidth_hz: f64,
  phase: f64,
  phase_side_low: f64,
  phase_side_high: f64,
}

impl Default for MockAptDevice {
  fn default() -> Self {
    Self::new()
  }
}

impl MockAptDevice {
  /// Create a new mock APT SDR device
  pub fn new() -> Self {
    let mock_settings = crate::server::utils::load_mock_apt_settings();
    let signals = Self::create_signals(&mock_settings);
    let noise_floor_db = Self::noise_floor_from_settings(&mock_settings);

    Self {
      center_freq: 1_600_000, // 1.6 MHz default
      sample_rate: 3_200_000, // 3.2 MSPS default
      gain: 49.6,
      ppm: 1,
      tuner_agc: false,
      rtl_agc: false,
      offset_tuning: false,
      tuner_bandwidth: 0,
      direct_sampling: 0,
      total_samples: 0,
      signals,
      noise_floor_db,
      rng: StdRng::from_rng(&mut ::rand::rng()),
      settle_time_samples: 160_000, // 50ms at 3.2MSPS
      samples_since_init: 0,
      last_config_reload_check: Instant::now(),
      last_config_modified: crate::server::utils::signals_config_modified_at(),
      rx_queue: None,
      async_thread: None,
      iq_overflow: Vec::new(),
    }
  }

  /// Create initial signals based on configuration
  fn create_signals(
    mock_settings: &crate::server::types::MockAptSignalsConfig,
  ) -> Vec<MockAptSignal> {
    let mut signals = Vec::new();
    let mut rng = ::rand::rng();

    // Default values
    const DEFAULT_SPIKE_HZ: f64 = 33_000.0;
    const DEFAULT_MIN_DB: f64 = -80.0;
    const DEFAULT_MAX_DB: f64 = -20.0;
    const MAX_SIGNALS_PER_CHANNEL: usize = 128;

    // Create signals based on configured channels
    for (_, channel_config) in &mock_settings.channels {
      if channel_config.freq_range_hz.len() < 2 {
        continue;
      }

      let min_freq = channel_config.freq_range_hz[0];
      let max_freq = channel_config.freq_range_hz[1];
      let freq_span_hz = max_freq - min_freq;

      // Get spike density (frequency spacing between signals)
      // Can be single: !frequency 33kHz → Single(33000)
      // Or range: !frequency_range 30kHz..40kHz → Range(30000, 40000)
      let spike_hz = match &channel_config.apt_spike_density {
        Some(crate::server::types::FrequencySpacing::Range(min_hz, max_hz)) => {
          rng.random_range(*min_hz..*max_hz)
        }
        Some(crate::server::types::FrequencySpacing::Single(hz)) => *hz,
        _ => DEFAULT_SPIKE_HZ,
      };

      // Get signal strength range or use default
      let (range_min, range_max) = match &channel_config.signal_strength_range {
        Some(sr) if sr.len() >= 2 => (sr[0], sr[1]),
        _ => (DEFAULT_MIN_DB, DEFAULT_MAX_DB),
      };

      // Calculate signal count from frequency span and spike spacing
      let signal_count = ((freq_span_hz / spike_hz).max(1.0)) as usize;
      let signal_count = signal_count.clamp(1, MAX_SIGNALS_PER_CHANNEL);

      let mid = (range_min + range_max) * 0.5;
      let span = (range_max - range_min) * 0.5;

      // Generate signals distributed across the channel's frequency range
      for i in 0..signal_count {
        let freq_offset = if signal_count > 1 {
          (i as f64 / (signal_count - 1) as f64) * freq_span_hz
        } else {
          freq_span_hz / 2.0
        };
        let freq = min_freq + freq_offset;

        let strength_db = rng.random_range((mid - span)..(mid + span));

        signals.push(MockAptSignal {
          config: MockAptSignalConfig {
            center_frequency_hz: freq,
            strength_db,
          },
          modulation_phase: rng.random_range(0.0..=2.0 * PI),
          drift_offset: rng.random_range(-50.0..=50.0),
          active: true,
          bandwidth_hz: (freq_span_hz / signal_count as f64)
            .clamp(15000.0, 200000.0),
          phase: rng.random_range(0.0..=2.0 * PI64),
          phase_side_low: rng.random_range(0.0..=2.0 * PI64),
          phase_side_high: rng.random_range(0.0..=2.0 * PI64),
        });
      }
    }

    // If no channels are configured, fall back to legacy behavior
    if signals.is_empty() {
      // Legacy Area A: 100kHz - 4.5MHz
      for i in 0..10 {
        let freq = 100_000.0 + (i as f64 * 450_000.0);
        let strength_db = rng.random_range(-80.0..-70.0);
        signals.push(MockAptSignal {
          config: MockAptSignalConfig {
            center_frequency_hz: freq,
            strength_db,
          },
          modulation_phase: rng.random_range(0.0..=2.0 * PI),
          drift_offset: rng.random_range(-10.0..=10.0),
          active: true,
          bandwidth_hz: 30000.0,
          phase: rng.random_range(0.0..=2.0 * PI64),
          phase_side_low: rng.random_range(0.0..=2.0 * PI64),
          phase_side_high: rng.random_range(0.0..=2.0 * PI64),
        });
      }

      // Legacy Area B: 24.7MHz - 30.0MHz
      for i in 0..11 {
        let freq = 24_700_000.0 + (i as f64 * 500_000.0);
        let strength_db = rng.random_range(-70.0..-50.0);
        signals.push(MockAptSignal {
          config: MockAptSignalConfig {
            center_frequency_hz: freq,
            strength_db,
          },
          drift_offset: rng.random_range(-50.0..50.0),
          modulation_phase: rng.random_range(0.0..=2.0 * PI),
          active: true,
          bandwidth_hz: 100000.0,
          phase: rng.random_range(0.0..=2.0 * PI64),
          phase_side_low: rng.random_range(0.0..=2.0 * PI64),
          phase_side_high: rng.random_range(0.0..=2.0 * PI64),
        });
      }
    }

    signals
  }

  fn noise_floor_from_settings(
    mock_settings: &crate::server::types::MockAptSignalsConfig,
  ) -> f32 {
    mock_settings
      .channels
      .values()
      .filter_map(|ch| ch.noise_floor_db)
      .next()
      .unwrap_or(-100.0) as f32
  }

  fn reload_config_if_needed(&mut self) {
    const CONFIG_POLL_INTERVAL: Duration = Duration::from_millis(250);

    if self.last_config_reload_check.elapsed() < CONFIG_POLL_INTERVAL {
      return;
    }
    self.last_config_reload_check = Instant::now();

    let current_modified = crate::server::utils::signals_config_modified_at();
    if current_modified == self.last_config_modified {
      return;
    }

    let mock_settings = crate::server::utils::load_mock_apt_settings();
    self.signals = Self::create_signals(&mock_settings);
    self.noise_floor_db = Self::noise_floor_from_settings(&mock_settings);
    self.last_config_modified =
      crate::server::utils::signals_config_modified_at().or(current_modified);
    log::info!(
      "Reloaded mock APT config from signals.yaml ({} signals)",
      self.signals.len()
    );
  }

}

impl SdrDevice for MockAptDevice {
  fn device_type(&self) -> &'static str {
    "Mock APT SDR"
  }

  fn get_device_info(&self) -> String {
    format!(
      "Mock APT SDR - Freq: {} Hz, Rate: {} Hz (Sample Rate: {} Hz), Gain: {:.1} dB, PPM: {}",
      self.center_freq,
      self.sample_rate,
      self.sample_rate,
      self.gain,
      self.ppm
    )
  }

  fn initialize(&mut self) -> Result<()> {
    log::info!("Initializing mock APT SDR device");
    self.total_samples = 0;
    self.samples_since_init = 0;

    // For now, use simple synchronous initialization
    // TODO: Add optional async mode when it's properly implemented
    Ok(())
  }

  fn is_ready(&self) -> bool {
    true // Mock device is always ready in sync mode
  }

  fn read_samples(&mut self, fft_size: usize) -> Result<RawSamples> {
    self.reload_config_if_needed();
    // For now, use the synchronous implementation which was working correctly
    // TODO: Fix async implementation and make it optional
    self.read_samples_sync(fft_size)
  }

  fn set_sample_rate(&mut self, rate: u32) -> Result<()> {
    self.sample_rate = rate;
    log::debug!("Mock device sample rate set to {} Hz", rate);
    Ok(())
  }

  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    self.center_freq = freq;
    log::debug!("Mock device center frequency set to {} Hz", freq);
    Ok(())
  }

  fn set_gain(&mut self, gain: f64) -> Result<()> {
    self.gain = gain;
    log::debug!("Mock device gain set to {} dB", gain);
    Ok(())
  }

  fn set_ppm(&mut self, ppm: i32) -> Result<()> {
    self.ppm = ppm;
    log::debug!("Mock device PPM set to {}", ppm);
    Ok(())
  }

  fn set_tuner_agc(&mut self, enabled: bool) -> Result<()> {
    self.tuner_agc = enabled;
    log::debug!("Mock device tuner AGC set to {}", enabled);
    Ok(())
  }

  fn set_rtl_agc(&mut self, enabled: bool) -> Result<()> {
    self.rtl_agc = enabled;
    log::debug!("Mock device RTL AGC set to {}", enabled);
    Ok(())
  }

  fn set_offset_tuning(&mut self, enabled: bool) -> Result<()> {
    self.offset_tuning = enabled;
    log::debug!("Mock device offset tuning set to {}", enabled);
    Ok(())
  }

  fn set_tuner_bandwidth(&mut self, bw: u32) -> Result<()> {
    self.tuner_bandwidth = bw;
    log::debug!("Mock device tuner bandwidth set to {} Hz", bw);
    Ok(())
  }

  fn set_direct_sampling(&mut self, mode: u8) -> Result<()> {
    self.direct_sampling = mode;
    log::debug!("Mock device direct sampling set to {}", mode);
    Ok(())
  }

  fn get_center_frequency(&self) -> u32 {
    self.center_freq
  }

  fn get_sample_rate(&self) -> u32 {
    self.sample_rate
  }

  fn reset_buffer(&mut self) -> Result<()> {
    log::debug!("Mock APT device buffer reset");
    self.total_samples = 0;
    self.samples_since_init = 0;
    Ok(())
  }

  fn cleanup(&mut self) -> Result<()> {
    // Stop async thread if running
    if let Some(handle) = self.async_thread.take() {
      if !handle.is_finished() {
        log::info!("Stopping mock APT async thread...");
        // Note: In a real implementation, we'd need a cancellation mechanism
        // For now, the thread will be detached when the handle is dropped
      }
    }

    self.rx_queue = None;
    self.iq_overflow.clear();
    log::info!("Mock APT device cleanup completed");
    Ok(())
  }

  fn is_healthy(&self) -> bool {
    // Check if async thread is still running (if it exists)
    if let Some(handle) = &self.async_thread {
      !handle.is_finished()
    } else {
      true // Not initialized yet or sync mode
    }
  }

  fn get_error(&self) -> Option<String> {
    None
  }

  fn flush_read_queue(&mut self) {
    // Drain the async queue and clear overflow buffer
    if let Some(rx) = &self.rx_queue {
      while rx.try_recv().is_ok() {}
    }
    self.iq_overflow.clear();
  }
}

#[allow(dead_code)]
impl MockAptDevice {
  /// Fallback synchronous read method
  fn read_samples_sync(&mut self, fft_size: usize) -> Result<RawSamples> {
    let mut frame = Vec::with_capacity(fft_size * 2);

    let sample_rate = self.sample_rate as f64;
    let center_freq = self.center_freq as f64;

    // Calculate settle factor (0.0 to 1.0) for realistic warm-up
    let settle_factor = if self.samples_since_init < self.settle_time_samples {
      (self.samples_since_init as f64 / self.settle_time_samples as f64)
        .powf(2.0)
    } else {
      1.0
    };

    // Use the actual device gain for realistic modeling.
    // In a real SDR, gain amplifies the RF signal and frontend noise,
    // but the ADC has a fixed noise floor and clipping point.
    // Reverting to 0.0 gain as requested by the user.
    // Gain modeling currently doesn't replicate real signal behavior well enough in the mock device.
    let analog_gain = 0.0;
    let rf_noise_db = self.noise_floor_db as f64;

    // Hardware RF & ADC Simulation Pipeline
    // SNR = Signal - (RF_Noise + Gain)
    let frontend_noise_db = rf_noise_db + analog_gain;
    let adc_intrinsic_noise_db = -38.0; // Fixed noise floor of the 8-bit ADC
    
    // Combine noise sources in linear power domain
    let total_adc_noise_power = 10f64.powf(frontend_noise_db / 10.0)
      + 10f64.powf(adc_intrinsic_noise_db / 10.0);
    // Split total noise power between I and Q components (total_power = E[I^2 + Q^2])
    // For Uniform distribution [-A, A], Variance = A^2 / 3. 
    // We want Var = power/2, so A = sqrt(1.5 * power).
    let noise_amplitude = (1.5 * total_adc_noise_power).sqrt();

    // Optimization: Pre-calculate per-signal parameters out of the inner loop
    struct CachedSignal<'a> {
      signal: &'a mut MockAptSignal,
      amp: f64,
      amp_side: f64,
      has_sidebands: bool,
      modulation_phase_step: f64,

      // Phasor states (cos, sin)
      p_re: f64,
      p_im: f64,
      r_re: f64,
      r_im: f64,

      sl_re: f64,
      sl_im: f64,
      rl_re: f64,
      rl_im: f64,

      sh_re: f64,
      sh_im: f64,
      rh_re: f64,
      rh_im: f64,
    }

    let mut cached_signals = Vec::with_capacity(self.signals.len());
    for signal in &mut self.signals {
      if !signal.active {
        continue;
      }
      let abs_freq_hz = signal.config.center_frequency_hz
        + (signal.drift_offset as f64);
      // Simulate PPM error: f_effective = f_requested * (1.0 - ppm / 1e6)
      let effective_center_freq =
        center_freq * (1.0 - self.ppm as f64 / 1_000_000.0);
      let rel_freq = abs_freq_hz - effective_center_freq;
      
      // Filter signals outside the current sample rate window
      if rel_freq.abs() > (sample_rate / 2.0) + 100000.0 {
        continue;
      }

      // 1.0 Hz modulation rate - sample-rate independent
      let modulation_rate_hz = 1.0;
      let modulation_phase_step = 2.0 * PI64 * modulation_rate_hz / sample_rate;
      
      let modulation = (signal.modulation_phase as f64).sin() * 0.1 + 0.9;
      let rf_signal_db = signal.config.strength_db * modulation;
      
      // Apply analog gain to the RF signal
      let adc_signal_db = rf_signal_db + analog_gain;
      
      let mut amp = 10f64.powf(adc_signal_db / 20.0);
      let mut amp_side = amp * 0.707;

      // Apply settle factor to signal amplitude during warm-up
      amp *= settle_factor;
      amp_side *= settle_factor;

      let (p_im, p_re) = signal.phase.sin_cos();
      let phase_step = 2.0 * PI64 * rel_freq / sample_rate;
      let (r_im, r_re) = phase_step.sin_cos();

      let mut has_sidebands = false;
      let (mut sl_re, mut sl_im, mut rl_re, mut rl_im) = (1.0, 0.0, 1.0, 0.0);
      let (mut sh_re, mut sh_im, mut rh_re, mut rh_im) = (1.0, 0.0, 1.0, 0.0);

      if signal.bandwidth_hz > 500.0 {
        has_sidebands = true;
        let offset = signal.bandwidth_hz * 0.3;

        let (im, re) = signal.phase_side_low.sin_cos();
        sl_im = im;
        sl_re = re;
        let step = 2.0 * PI64 * (rel_freq - offset) / sample_rate;
        let (im_s, re_s) = step.sin_cos();
        rl_im = im_s;
        rl_re = re_s;

        let (im_h, re_h) = signal.phase_side_high.sin_cos();
        sh_im = im_h;
        sh_re = re_h;
        let step_h = 2.0 * PI64 * (rel_freq + offset) / sample_rate;
        let (im_sh, re_sh) = step_h.sin_cos();
        rh_im = im_sh;
        rh_re = re_sh;
      }

      cached_signals.push(CachedSignal {
        signal,
        amp,
        amp_side,
        has_sidebands,
        modulation_phase_step,
        p_re,
        p_im,
        r_re,
        r_im,
        sl_re,
        sl_im,
        rl_re,
        rl_im,
        sh_re,
        sh_im,
        rh_re,
        rh_im,
      });
    }

    for _ in 0..fft_size {
      // Use pre-calculated noise amplitude for correct power distribution
      let mut i_sample = (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amplitude;
      let mut q_sample = (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amplitude;

      for sig in &mut cached_signals {
        // Update main signal
        i_sample += sig.amp * sig.p_im;
        q_sample += sig.amp * sig.p_re;

        let next_re = sig.p_re * sig.r_re - sig.p_im * sig.r_im;
        let next_im = sig.p_im * sig.r_re + sig.p_re * sig.r_im;
        sig.p_re = next_re;
        sig.p_im = next_im;

        if sig.has_sidebands {
          // Update low sideband
          i_sample += sig.amp_side * sig.sl_im;
          q_sample += sig.amp_side * sig.sl_re;
          let next_l_re = sig.sl_re * sig.rl_re - sig.sl_im * sig.rl_im;
          let next_l_im = sig.sl_im * sig.rl_re + sig.sl_re * sig.rl_im;
          sig.sl_re = next_l_re;
          sig.sl_im = next_l_im;

          // Update high sideband
          i_sample += sig.amp_side * sig.sh_im;
          q_sample += sig.amp_side * sig.sh_re;
          let next_h_re = sig.sh_re * sig.rh_re - sig.sh_im * sig.rh_im;
          let next_h_im = sig.sh_im * sig.rh_re + sig.sh_re * sig.rh_im;
          sig.sh_re = next_h_re;
          sig.sh_im = next_h_im;
        }
        
        // Advance modulation phase per sample for perfect continuity
        sig.signal.modulation_phase += sig.modulation_phase_step as f32;
      }

      // Fast linear clipping instead of tanh
      let i_f = i_sample.clamp(-1.0, 1.0);
      let q_f = q_sample.clamp(-1.0, 1.0);

      // Convert back to offset binary 8-bit output (RTL-SDR format)
      let i_u8 = ((i_f * 127.0) + 128.0).clamp(0.0, 255.0) as u8;
      let q_u8 = ((q_f * 127.0) + 128.0).clamp(0.0, 255.0) as u8;

      frame.push(i_u8);
      frame.push(q_u8);
    }

    // Update persistent phases and total sample count
    for sig in &mut cached_signals {
      sig.signal.phase = sig.p_im.atan2(sig.p_re);
      if sig.has_sidebands {
        sig.signal.phase_side_low = sig.sl_im.atan2(sig.sl_re);
        sig.signal.phase_side_high = sig.sh_im.atan2(sig.sh_re);
      }
      
      // Wrap modulation phase
      while sig.signal.modulation_phase > (2.0 * PI) as f32 {
          sig.signal.modulation_phase -= (2.0 * PI) as f32;
      }
    }
    self.total_samples = self.total_samples.wrapping_add(fft_size as u64);
    self.samples_since_init =
      self.samples_since_init.wrapping_add(fft_size as u64);

    Ok(RawSamples {
      data: frame,
      sample_rate: self.sample_rate,
    })
  }

  /// Set settle time in samples
  pub fn set_settle_time(&mut self, samples: u64) {
    self.settle_time_samples = samples;
  }

  /// Get settle time in samples
  pub fn get_settle_time(&self) -> u64 {
    self.settle_time_samples
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::sync::{Mutex, OnceLock};
  use std::thread::sleep;

  fn cwd_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
  }

  fn write_test_signals_yaml(
    path: &std::path::Path,
    spike_hz: u32,
    noise_floor_db: i32,
  ) {
    let yaml = format!(
      r#"
signals:
  sdr:
    limits:
      lower_limit_hz: !frequency 500kHz
      upper_limit_hz: !frequency 28.8MHz
      lower_limit_label: "low"
      upper_limit_label: "high"
    sample_rate: !frequency 3.2MHz
    center_frequency: !frequency 1.6MHz
    gain:
      tuner_gain: !dB 49.6dB
      rtl_agc: false
      tuner_agc: false
    ppm: 1.0
    fft:
      default_size: 32768
      default_frame_rate: 60
      size_to_frame_rate: {{32768: 60}}
      max_size: 262144
      max_frame_rate: 60
    display:
      min_db: !dB -120dB
      max_db: !dB 0dB
      padding: 20
  mock_apt:
    channels:
      a:
        label: "A"
        freq_range_hz: !frequency_range 18kHz..4.37MHz
        description: "A"
        apt_spike_density: !frequency {spike_hz}Hz
        noise_floor_db: !dB {noise_floor_db}dB
        signal_strength_range: !dB_range -80dB..-20dB
  triangulation:
    static:
      freq_range_hz: !frequency_range 2.3GHz..2.344GHz
  n_apt:
    channels:
      a:
        label: "A"
        freq_range_hz: !frequency_range 18kHz..4.37MHz
        description: "A"
"#
    );
    fs::write(path, yaml).expect("write test signals.yaml");
  }

  #[test]
  fn reloads_mock_settings_when_signals_yaml_changes() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    let original_dir = std::env::current_dir().expect("current dir");
    let temp_dir = std::env::temp_dir().join(format!(
      "napt-mock-reload-{}",
      SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("time")
        .as_nanos()
    ));
    fs::create_dir_all(&temp_dir).expect("create temp dir");
    std::env::set_current_dir(&temp_dir).expect("set current dir");

    let yaml_path = temp_dir.join("signals.yaml");
    write_test_signals_yaml(&yaml_path, 500_000, -95);
    let mut device = MockAptDevice::new();
    assert_eq!(device.signals.len(), 8);
    assert_eq!(device.noise_floor_db, -95.0);

    sleep(Duration::from_millis(300));
    write_test_signals_yaml(&yaml_path, 1_000_000, -70);
    sleep(Duration::from_millis(300));

    device.reload_config_if_needed();

    assert_eq!(device.signals.len(), 4);
    assert_eq!(device.noise_floor_db, -70.0);

    std::env::set_current_dir(&original_dir).expect("restore dir");
    let _ = fs::remove_dir_all(&temp_dir);
  }
}
