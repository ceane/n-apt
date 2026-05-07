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
    const MAX_SIGNALS_PER_CHANNEL: usize = 1024;

    // Create signals based on configured channels
    for (_, channel_config) in &mock_settings.channels {
      if channel_config.freq_range_hz.len() < 2 {
        continue;
      }

      let min_freq = channel_config.freq_range_hz[0];
      let max_freq = channel_config.freq_range_hz[1];
      let _freq_span_hz = max_freq - min_freq;

      // Get spike density (frequency spacing between signals)
      // Can be single: !frequency 33kHz → Single(33000)
      // Or range: !frequency_range 30kHz..40kHz → Range(30000, 40000)
      let _spike_hz = match &channel_config.apt_spike_density {
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


      let _mid = (range_min + range_max) * 0.5;
      let _span = (range_max - range_min) * 0.5;

      // Generate signals distributed across the channel's frequency range with randomized spacing
      let mut current_freq = min_freq;
      
      // Calculate total potential amplitude to prevent clipping later
      let mut total_amp = 0.0;
      let mut temp_signals = Vec::new();

      while current_freq < max_freq {
        let strength_db = rng.random_range(range_min..range_max);
        let amp = 10.0f64.powf(strength_db / 20.0);
        total_amp += amp;

        temp_signals.push((current_freq, strength_db));

        // Advance frequency by a random amount within the configured density range
        let next_gap = match &channel_config.apt_spike_density {
          Some(crate::server::types::FrequencySpacing::Range(min_hz, max_hz)) => {
            rng.random_range(*min_hz..*max_hz)
          }
          Some(crate::server::types::FrequencySpacing::Single(hz)) => *hz,
          _ => DEFAULT_SPIKE_HZ,
        };
        current_freq += next_gap;
        
        if temp_signals.len() >= MAX_SIGNALS_PER_CHANNEL {
          break;
        }
      }

      // Normalization factor to keep peak sum < 0.8 (room for noise)
      let norm_factor = if total_amp > 0.8 { 0.8 / total_amp } else { 1.0 };

      for (freq, db) in temp_signals {
        // Adjust strength_db by norm_factor
        let adjusted_db = db + 20.0 * norm_factor.log10();
        
        signals.push(MockAptSignal {
          config: MockAptSignalConfig {
            center_frequency_hz: freq,
            strength_db: adjusted_db,
          },
          modulation_phase: rng.random_range(0.0..=2.0 * PI),
          drift_offset: rng.random_range(-50.0..=50.0),
          active: true,
          bandwidth_hz: 15000.0,
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
          drift_offset: rng.random_range(-10.0..10.0),
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
      .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
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
    let analog_gain = 0.0;
    // Hardware RF & ADC Simulation Pipeline
    let rf_noise_db = self.noise_floor_db as f32;
    let frontend_noise_db = rf_noise_db + analog_gain as f32;
    let adc_intrinsic_noise_db = -120.0f32;

    // Combine noise sources in linear power domain (f32)
    let total_adc_noise_power = 10.0f32.powf(frontend_noise_db / 10.0)
      + 10.0f32.powf(adc_intrinsic_noise_db / 10.0);
    let noise_amplitude = (1.5f32 * total_adc_noise_power).sqrt();

    // Optimization: Use f64 for phasor math to maintain precision over 262k iterations
    struct CachedSignal<'a> {
      signal: &'a mut MockAptSignal,
      amp: f64,
      amp_side: f64,
      has_sidebands: bool,

      // Main Signal Phasor (f64 for phase stability)
      p_re: f64,
      p_im: f64,
      r_re: f64,
      r_im: f64,

      // Modulation Phasor (for 1Hz detail)
      m_re: f64,
      m_im: f64,
      mr_re: f64,
      mr_im: f64,

      // Sideband Phasors
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

      let abs_freq_hz =
        signal.config.center_frequency_hz + (signal.drift_offset as f64);
      let effective_center_freq =
        center_freq * (1.0 - self.ppm as f64 / 1_000_000.0);
      let rel_freq = abs_freq_hz - effective_center_freq;

      if rel_freq.abs() > (sample_rate / 2.0) + 100_000.0 {
        continue;
      }

      // 1.0 Hz modulation rate
      let m_rate = 1.0f64;
      let m_step = 2.0 * PI64 * m_rate / sample_rate;
      let (m_im, m_re) = (signal.modulation_phase as f64).sin_cos();
      let (mr_im, mr_re) = m_step.sin_cos();

      let rf_signal_db = signal.config.strength_db;
      let adc_signal_db = rf_signal_db + analog_gain;
      let amp = 10f64.powf(adc_signal_db / 20.0) * settle_factor;

      let (p_im, p_re) = (signal.phase).sin_cos();
      let phase_step = 2.0 * PI64 * rel_freq / sample_rate;
      let (r_im, r_re) = phase_step.sin_cos();

      let (mut sl_re, mut sl_im, mut rl_re, mut rl_im) = (1.0, 0.0, 1.0, 0.0);
      let (mut sh_re, mut sh_im, mut rh_re, mut rh_im) = (1.0, 0.0, 1.0, 0.0);
      let mut has_sidebands = false;

      // Sidebands disabled for mock spikes to ensure spectral purity and respect density settings.
      // Only enabled for very wide signals (> 1MHz) which aren't typical for N-APT spikes.
      if signal.bandwidth_hz > 1_000_000.0 {
        has_sidebands = true;
        let offset = signal.bandwidth_hz * 0.15;
        let (im_l, re_l) = (signal.phase_side_low).sin_cos();
        sl_im = im_l;
        sl_re = re_l;
        let (im_sl, re_sl) =
          (2.0 * PI64 * (rel_freq - offset) / sample_rate).sin_cos();
        rl_im = im_sl;
        rl_re = re_sl;

        let (im_h, re_h) = (signal.phase_side_high).sin_cos();
        sh_im = im_h;
        sh_re = re_h;
        let (im_sh, re_sh) =
          (2.0 * PI64 * (rel_freq + offset) / sample_rate).sin_cos();
        rh_im = im_sh;
        rh_re = re_sh;
      }

      cached_signals.push(CachedSignal {
        signal,
        amp,
        amp_side: amp * 0.707,
        has_sidebands,
        p_re,
        p_im,
        r_re,
        r_im,
        m_re,
        m_im,
        mr_re,
        mr_im,
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

    // Tiled processing for L1 cache locality (256 samples fits in 4KB)
    const BLOCK_SIZE: usize = 256;
    let mut i_block = [0.0f64; BLOCK_SIZE];
    let mut q_block = [0.0f64; BLOCK_SIZE];

    for block_start in (0..fft_size).step_by(BLOCK_SIZE) {
      let current_block_size = std::cmp::min(BLOCK_SIZE, fft_size - block_start);
      
      // Zero out the block buffers
      for j in 0..current_block_size {
        i_block[j] = 0.0;
        q_block[j] = 0.0;
      }

      // Process each signal for the current block
      for sig in &mut cached_signals {
        let amp = sig.amp;
        let mut p_re = sig.p_re;
        let mut p_im = sig.p_im;
        let r_re = sig.r_re;
        let r_im = sig.r_im;

        let mut m_re = sig.m_re;
        let mut m_im = sig.m_im;
        let mr_re = sig.mr_re;
        let mr_im = sig.mr_im;

        for j in 0..current_block_size {
          let modulation = m_im * 0.1 + 0.9;
          let cur_amp = amp * modulation;

          i_block[j] += cur_amp * p_re;
          q_block[j] += cur_amp * p_im;

          // Phasor updates
          let next_re = p_re * r_re - p_im * r_im;
          let next_im = p_im * r_re + p_re * r_im;
          p_re = next_re;
          p_im = next_im;

          let next_m_re = m_re * mr_re - m_im * mr_im;
          let next_m_im = m_im * mr_re + m_re * mr_im;
          m_re = next_m_re;
          m_im = next_m_im;
        }

        // Store back state for next block
        sig.p_re = p_re;
        sig.p_im = p_im;
        sig.m_re = m_re;
        sig.m_im = m_im;
      }

      // Apply noise, clip and quantize the block
      for j in 0..current_block_size {
        let i_noise = (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amplitude as f64;
        let q_noise = (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amplitude as f64;
        
        let i_u8 = (((i_block[j] + i_noise).clamp(-1.0, 1.0) * 127.0) + 128.0) as u8;
        let q_u8 = (((q_block[j] + q_noise).clamp(-1.0, 1.0) * 127.0) + 128.0) as u8;

        frame.push(i_u8);
        frame.push(q_u8);
      }
    }

    // Final sync of state back to original signals
    for sig in &mut cached_signals {
      sig.signal.phase = sig.p_im.atan2(sig.p_re);
      sig.signal.modulation_phase = sig.m_im.atan2(sig.m_re) as f32;
      
      while sig.signal.modulation_phase > (2.0 * PI) {
        sig.signal.modulation_phase -= 2.0 * PI;
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
  use std::thread::sleep;
  use crate::server::utils::cwd_lock;

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
    assert_eq!(device.signals.len(), 9);
    assert_eq!(device.noise_floor_db, -95.0);

    sleep(Duration::from_millis(300));
    write_test_signals_yaml(&yaml_path, 1_000_000, -70);
    sleep(Duration::from_millis(300));

    device.reload_config_if_needed();

    assert_eq!(device.signals.len(), 5);
    assert_eq!(device.noise_floor_db, -70.0);

    std::env::set_current_dir(&original_dir).expect("restore dir");
    let _ = fs::remove_dir_all(&temp_dir);
  }
}
