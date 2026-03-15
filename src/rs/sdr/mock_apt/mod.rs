//! # Mock APT SDR Device Implementation
//!
//! Provides a simulated SDR device that generates realistic signals for testing and demonstration.
//! Uses bin-based frequency modeling for consistent FFT placement and dynamic signal behavior.
//! Reads configuration from signals.yaml for signal parameters and variation settings.

use crate::fft::types::RawSamples;
use anyhow::Result;
use crossbeam_channel::Receiver;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::f32::consts::PI;
use std::f64::consts::PI as PI64;
use std::thread::JoinHandle;

use super::SdrDevice;

/// Mock APT signal configuration
#[derive(Debug, Clone)]
struct MockAptSignalConfig {
  center_frequency_mhz: f64,
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
  signal_modulation_rate: f32,
  rng: StdRng,
  settle_time_samples: u64,
  samples_since_init: u64,
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

/// Generate a block of mock samples with settle time behavior
fn generate_mock_block(
  block_size: usize,
  center_freq: u32,
  sample_rate: u32,
  gain: f64,
  ppm: i32,
  noise_floor_db: f32,
  signal_modulation_rate: f32,
  settle_time_samples: u64,
  total_samples: u64,
  rng: &mut impl rand::Rng,
  signals: &[MockAptSignal],
) -> Vec<u8> {
  let mut block = Vec::with_capacity(block_size);
  let samples_per_block = block_size / 2;
  
  // Calculate settle factor (0.0 to 1.0) for realistic warm-up
  let settle_factor = if total_samples < settle_time_samples {
    (total_samples as f64 / settle_time_samples as f64).powf(2.0)
  } else {
    1.0
  };

  let sample_rate_f = sample_rate as f64;
  let center_freq_f = center_freq as f64;

  // Hardware RF & ADC Simulation Pipeline
  let rf_noise_db = noise_floor_db as f64;
  let frontend_noise_db = rf_noise_db + gain;
  let adc_intrinsic_noise_db = -38.0;
  let total_adc_noise_power = 10f64.powf(frontend_noise_db / 10.0)
    + 10f64.powf(adc_intrinsic_noise_db / 10.0);
  let total_adc_noise_db = 10.0 * total_adc_noise_power.log10();
  let noise_level = 10f64.powf(total_adc_noise_db / 20.0);

  // Pre-calculate signal parameters
  let mut cached_signals = Vec::new();
  for signal in signals.iter() {
    if !signal.active {
      continue;
    }
    
    let abs_freq_hz = (signal.config.center_frequency_mhz * 1_000_000.0)
      + (signal.drift_offset as f64);
    let effective_center_freq = center_freq_f * (1.0 - ppm as f64 / 1_000_000.0);
    let rel_freq = abs_freq_hz - effective_center_freq;
    
    if rel_freq.abs() > (sample_rate_f / 2.0) {
      continue;
    }

    let modulation = (signal.modulation_phase as f64).sin() * 0.1 + 0.9;
    let rf_signal_db = signal.config.strength_db * modulation;
    let adc_signal_db = rf_signal_db + gain;
    let mut amp = 10f64.powf(adc_signal_db / 20.0);
    let mut amp_side = amp * 0.707;

    // Apply settle factor
    amp *= settle_factor;
    amp_side *= settle_factor;

    let (p_im, p_re) = signal.phase.sin_cos();
    let phase_step = 2.0 * PI64 * rel_freq / sample_rate_f;
    let (r_im, r_re) = phase_step.sin_cos();

    cached_signals.push((amp, amp_side, p_re, p_im, r_re, r_im));
  }

  let mut signal_states = cached_signals.iter().map(|(_, _, p_re, p_im, _, _)| (*p_re, *p_im)).collect::<Vec<_>>();

  for _ in 0..samples_per_block {
    let mut i_sample = 0.0f64;
    let mut q_sample = 0.0f64;

    if noise_level > 0.0 {
      i_sample += (rng.gen::<f64>() - 0.5) * 2.0 * noise_level;
      q_sample += (rng.gen::<f64>() - 0.5) * 2.0 * noise_level;
    }

    for (idx, (amp, amp_side, p_re, p_im, r_re, r_im)) in cached_signals.iter().enumerate() {
      // Update main signal
      i_sample += amp * signal_states[idx].1;
      q_sample += amp * signal_states[idx].0;

      let (current_p_re, current_p_im) = &mut signal_states[idx];
      let next_re = *current_p_re * r_re - *current_p_im * r_im;
      let next_im = *current_p_im * r_re + *current_p_re * r_im;
      *current_p_re = next_re;
      *current_p_im = next_im;
    }

    // Fast linear clipping
    let i_f = i_sample.clamp(-1.0, 1.0);
    let q_f = q_sample.clamp(-1.0, 1.0);

    // Convert to offset binary 8-bit
    let i_u8 = (i_f * 127.0 + 128.5) as u8;
    let q_u8 = (q_f * 127.0 + 128.5) as u8;

    block.push(i_u8);
    block.push(q_u8);
  }

  block
}

impl MockAptDevice {
  /// Create a new mock APT SDR device
  pub fn new() -> Self {
    let signals = Self::create_signals();

    let mock_settings = crate::server::utils::load_mock_apt_settings();
    let sdr_settings = crate::server::utils::load_sdr_settings();

    Self {
      center_freq: 1_600_000, // 1.6 MHz default
      sample_rate: 3_200_000, // 3.2 MSPS default
      gain: sdr_settings.gain.tuner_gain,
      ppm: 1,
      tuner_agc: false,
      rtl_agc: false,
      offset_tuning: false,
      tuner_bandwidth: 0,
      direct_sampling: 0,
      total_samples: 0,
      signals,
      noise_floor_db: mock_settings.global_settings.noise_floor_base as f32,
      signal_modulation_rate: mock_settings
        .global_settings
        .signal_modulation_rate as f32,
      rng: StdRng::from_entropy(),
      settle_time_samples: 160_000, // 50ms at 3.2MSPS
      samples_since_init: 0,
      rx_queue: None,
      async_thread: None,
      iq_overflow: Vec::new(),
    }
  }

  /// Create initial signals based on configuration
  fn create_signals() -> Vec<MockAptSignal> {
    let mut signals = Vec::new();
    let mut rng = rand::thread_rng();

    // Create signals across the spectrum
    // Area A: 0.1 - 4.5 MHz (covering the first N-APT range)
    for i in 0..10 {
      let freq = 0.1 + (i as f64 * 0.45);
      signals.push(MockAptSignal {
        config: MockAptSignalConfig {
          center_frequency_mhz: freq,
          strength_db: rng.gen_range(-70.0..-40.0),
        },
        modulation_phase: rng.gen_range(0.0..=2.0 * PI),
        drift_offset: rng.gen_range(-10.0..=10.0),
        active: true,
        bandwidth_hz: 30000.0,
        phase: rng.gen_range(0.0..=2.0 * PI64),
        phase_side_low: rng.gen_range(0.0..=2.0 * PI64),
        phase_side_high: rng.gen_range(0.0..=2.0 * PI64),
      });
    }

    // Area B: 24.7 - 30.0 MHz (covering the second N-APT range)
    for i in 0..11 {
      let freq = 24.7 + (i as f64 * 0.5);
      signals.push(MockAptSignal {
        config: MockAptSignalConfig {
          center_frequency_mhz: freq,
          strength_db: rng.gen_range(-60.0..-30.0),
        },
        drift_offset: rng.gen_range(-50.0..50.0),
        modulation_phase: rng.gen_range(0.0..=2.0 * PI),
        active: true,
        bandwidth_hz: 100000.0,
        phase: rng.gen_range(0.0..=2.0 * PI64),
        phase_side_low: rng.gen_range(0.0..=2.0 * PI64),
        phase_side_high: rng.gen_range(0.0..=2.0 * PI64),
      });
    }

    signals
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

impl MockAptDevice {
  /// Fallback synchronous read method
  fn read_samples_sync(&mut self, fft_size: usize) -> Result<RawSamples> {
    // State updates now happen per-sample in read_samples loop
    // for better continuity during hopping.

    let mut frame = Vec::with_capacity(fft_size * 2);

    let sample_rate = self.sample_rate as f64;
    let center_freq = self.center_freq as f64;

    // Calculate settle factor (0.0 to 1.0) for realistic warm-up
    let settle_factor = if self.samples_since_init < self.settle_time_samples {
      (self.samples_since_init as f64 / self.settle_time_samples as f64).powf(2.0)
    } else {
      1.0
    };

    // Hardware RF & ADC Simulation Pipeline
    // 1. Calculate physical RF noise floor hitting the analog front-end
    let rf_noise_db = self.noise_floor_db as f64;
    let analog_gain = self.gain;
    let frontend_noise_db = rf_noise_db + analog_gain;

    // 2. Incorporate the intrinsic 8-bit ADC quantization/thermal noise floor
    // We set this to approx -38.0 dBFS instead of -50.0 to guarantee sufficient analog dither.
    // If noise falls below 1/128 amplitude, the offset-binary u8 cast rounds everything
    // to a perfectly solid 128, creating an artificial -120dB deep-null FFT cliff on empty channels
    // compared to the -50dB quantization noise floor of channels carrying real signals.
    let adc_intrinsic_noise_db = -38.0;
    let total_adc_noise_power = 10f64.powf(frontend_noise_db / 10.0)
      + 10f64.powf(adc_intrinsic_noise_db / 10.0);
    let total_adc_noise_db = 10.0 * total_adc_noise_power.log10();
    let noise_level = 10f64.powf(total_adc_noise_db / 20.0);

    // Optimization: Pre-calculate per-signal parameters out of the inner loop
    struct CachedSignal<'a> {
      signal: &'a mut MockAptSignal,
      amp: f64,
      amp_side: f64,
      has_sidebands: bool,

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
      let abs_freq_hz = (signal.config.center_frequency_mhz * 1_000_000.0)
        + (signal.drift_offset as f64);
      // Simulate PPM error: f_effective = f_requested * (1.0 - ppm / 1e6)
      let effective_center_freq =
        center_freq * (1.0 - self.ppm as f64 / 1_000_000.0);
      let rel_freq = abs_freq_hz - effective_center_freq;
      if rel_freq.abs() > (sample_rate / 2.0) {
        continue;
      }

      let modulation = (signal.modulation_phase as f64).sin() * 0.1 + 0.9;
      let rf_signal_db = signal.config.strength_db * modulation;
      let adc_signal_db = rf_signal_db + analog_gain;
      let mut amp = 10f64.powf(adc_signal_db / 20.0);
      let mut amp_side = amp * 0.707;

      // Apply settle factor to signal amplitude during warm-up
      amp *= settle_factor;
      amp_side *= settle_factor;

      // Advance modulation phase once per frame instead of per sample
      // 8192 samples is ~4ms, plenty fast for modulation
      signal.modulation_phase += self.signal_modulation_rate;
      if signal.modulation_phase > 2.0 * PI {
        signal.modulation_phase -= 2.0 * PI;
      }

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
      let mut i_sample = 0.0f64;
      let mut q_sample = 0.0f64;

      if noise_level > 0.0 {
        i_sample += (self.rng.gen::<f64>() - 0.5) * 2.0 * noise_level;
        q_sample += (self.rng.gen::<f64>() - 0.5) * 2.0 * noise_level;
      }

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
      }

      // Fast linear clipping instead of tanh
      let i_f = i_sample.clamp(-1.0, 1.0);
      let q_f = q_sample.clamp(-1.0, 1.0);

      // Convert back to offset binary 8-bit output
      // Faster conversion for dev builds: skip .round().clamp()
      let i_u8 = (i_f * 127.0 + 128.5) as u8;
      let q_u8 = (q_f * 127.0 + 128.5) as u8;

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
    }
    self.total_samples = self.total_samples.wrapping_add(fft_size as u64);
    self.samples_since_init = self.samples_since_init.wrapping_add(fft_size as u64);

    Ok(RawSamples {
      data: frame,
      sample_rate: self.sample_rate,
    })
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
}

impl MockAptDevice {
  /// Set settle time in samples
  pub fn set_settle_time(&mut self, samples: u64) {
    self.settle_time_samples = samples;
  }

  /// Get settle time in samples
  pub fn get_settle_time(&self) -> u64 {
    self.settle_time_samples
  }
}
