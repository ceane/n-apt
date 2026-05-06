//! # SIMD Mock Signal Generator
//!
//! High-performance SIMD-accelerated mock signal generation for testing and demos.
//! Generates realistic SDR signals with multiple carriers, noise, and modulation.

use crate::fft::types::RawSamples;
#[cfg(any(target_arch = "wasm32", target_arch = "aarch64"))]
use crate::simd::fast_math::fast_tanhq_f32;
use anyhow::Result;
use rand::RngExt;
#[cfg(target_arch = "aarch64")]
use std::arch::aarch64::*;
#[cfg(target_arch = "wasm32")]
use std::arch::wasm32::*;

/// Mock signal structure for testing
#[derive(Debug, Clone)]
pub struct MockSignal {
  pub center_bin: f32,
  pub base_strength: f32,
  pub bandwidth: u32,
  pub active: bool,
  pub drift_offset: f32,
  pub modulation_phase: f32,
}

/// Mock signals configuration
#[derive(Debug, Clone, Default)]
pub struct MockSignalsConfig {
  pub global_settings: GlobalMockSettings,
}

#[derive(Debug, Clone, Default)]
pub struct GlobalMockSettings {
  pub signal_appearance_chance: u32,
  pub signal_disappearance_chance: u32,
  pub signal_drift_rate: u32,
  pub signal_modulation_rate: f32,
  pub signal_strength_variation: u32,
  pub noise_floor_variation: u32,
}

/// SIMD-accelerated mock signal generator
pub struct MockSignalGenerator {
  frame_counter: u32,
  rng: rand::rngs::ThreadRng,
  total_samples: u64,
}

impl MockSignalGenerator {
  /// Creates a new mock signal generator
  pub fn new() -> Self {
    Self {
      frame_counter: 0,
      rng: ::rand::rng(),
      total_samples: 0,
    }
  }

  /// Generate mock IQ samples with SIMD acceleration
  pub fn generate_frame(
    &mut self,
    fft_size: usize,
    sample_rate: u32,
    signals: &mut [MockSignal],
    config: &MockSignalsConfig,
  ) -> Result<RawSamples> {
    let mut frame = vec![0u8; fft_size * 2];
    self.frame_counter = self.frame_counter.wrapping_add(1);

    // Update signal state
    self.update_signal_state(signals, config);

    let noise_level = self.calculate_noise_level(fft_size, config);
    let t0 =
      (self.frame_counter as f32) * (fft_size as f32) / (sample_rate as f32);

    #[cfg(any(target_arch = "wasm32", target_arch = "aarch64"))]
    {
      self.generate_frame_simd(
        &mut frame,
        fft_size,
        sample_rate,
        signals,
        noise_level,
        t0,
      );
    }

    #[cfg(not(any(target_arch = "wasm32", target_arch = "aarch64")))]
    self.generate_frame_native(
      &mut frame,
      fft_size,
      sample_rate,
      signals,
      noise_level,
      t0,
    );

    Ok(RawSamples {
      data: frame,
      sample_rate,
    })
  }

  #[cfg(not(any(target_arch = "wasm32", target_arch = "aarch64")))]
  fn generate_frame_native(
    &mut self,
    frame: &mut [u8],
    fft_size: usize,
    sample_rate: u32,
    signals: &[MockSignal],
    noise_level: f32,
    t0: f32,
  ) {
    struct ActiveSignal {
      amp: f32,
      cos_phase: f32,
      sin_phase: f32,
      cos_step: f32,
      sin_step: f32,
      side_tones: Vec<ActiveSideTone>,
    }

    struct ActiveSideTone {
      amp_weight: f32,
      cos_phase: f32,
      sin_phase: f32,
      cos_step: f32,
      sin_step: f32,
    }

    let mut active_signals = Vec::with_capacity(signals.len());

    for s in signals.iter() {
      if !s.active {
        continue;
      }

      let current_bin = (s.center_bin + s.drift_offset).round() as i32;
      let k = current_bin.rem_euclid(fft_size as i32);
      let freq_hz = (k as f32) * (sample_rate as f32) / (fft_size as f32);
      let modulation = s.modulation_phase.sin() * 0.3 + 0.7;
      let current_strength_db = s.base_strength * modulation;
      let amp = (10f32.powf(current_strength_db / 20.0) * 0.05).clamp(0.0, 0.9);
      let phase0 = 2.0 * std::f32::consts::PI * freq_hz * t0;
      let step = 2.0 * std::f32::consts::PI * freq_hz / sample_rate as f32;

      let mut side_tones = Vec::new();
      if s.bandwidth > 1 {
        let side = (s.bandwidth as f32 / 4.0).round() as i32;
        if side > 0 {
          for mult in [-side, side] {
            let k2 = k + mult;
            let freq2 = (k2 as f32) * (sample_rate as f32) / (fft_size as f32);
            let phase2 = 2.0 * std::f32::consts::PI * freq2 * t0;
            let step2 = 2.0 * std::f32::consts::PI * freq2 / sample_rate as f32;
            side_tones.push(ActiveSideTone {
              amp_weight: 0.5,
              cos_phase: phase2.cos(),
              sin_phase: phase2.sin(),
              cos_step: step2.cos(),
              sin_step: step2.sin(),
            });
          }
        }
      }

      active_signals.push(ActiveSignal {
        amp,
        cos_phase: phase0.cos(),
        sin_phase: phase0.sin(),
        cos_step: step.cos(),
        sin_step: step.sin(),
        side_tones,
      });
    }

    let mut noise_i = Vec::with_capacity(fft_size);
    let mut noise_q = Vec::with_capacity(fft_size);
    for _ in 0..fft_size {
      noise_i.push((self.rng.random::<f32>() - 0.5) * 2.0 * noise_level);
      noise_q.push((self.rng.random::<f32>() - 0.5) * 2.0 * noise_level);
    }

    for i in 0..fft_size {
      let mut i_acc = noise_i[i];
      let mut q_acc = noise_q[i];

      for sig in &mut active_signals {
        i_acc += sig.amp * sig.sin_phase;
        q_acc += sig.amp * sig.cos_phase;

        let next_cos =
          sig.cos_phase * sig.cos_step - sig.sin_phase * sig.sin_step;
        let next_sin =
          sig.sin_phase * sig.cos_step + sig.cos_phase * sig.sin_step;
        sig.cos_phase = next_cos;
        sig.sin_phase = next_sin;

        for side in &mut sig.side_tones {
          let side_amp = sig.amp * side.amp_weight;
          i_acc += side_amp * side.sin_phase;
          q_acc += side_amp * side.cos_phase;

          let next_cos =
            side.cos_phase * side.cos_step - side.sin_phase * side.sin_step;
          let next_sin =
            side.sin_phase * side.cos_step + side.cos_phase * side.sin_step;
          side.cos_phase = next_cos;
          side.sin_phase = next_sin;
        }
      }

      let i_sample = i_acc.tanh();
      let q_sample = q_acc.tanh();

      frame[i * 2] =
        ((i_sample * 128.0) + 128.0).round().clamp(0.0, 255.0) as u8;
      frame[i * 2 + 1] =
        ((q_sample * 128.0) + 128.0).round().clamp(0.0, 255.0) as u8;
    }
  }

  #[cfg(any(target_arch = "wasm32", target_arch = "aarch64"))]
  fn generate_frame_simd(
    &mut self,
    frame: &mut [u8],
    fft_size: usize,
    sample_rate: u32,
    signals: &[MockSignal],
    noise_level: f32,
    t0: f32,
  ) {
    let sample_rate_f = sample_rate as f32;
    let inv_sample_rate = 1.0 / sample_rate_f;

    // Pre-calculate signal parameters once per frame to save cycles
    struct ActiveSignal {
      amp: f32,
      // Phasor state for 4 lanes
      v_re: [f32; 4],
      v_im: [f32; 4],
      // 4-step rotation vector
      rot_re: f32,
      rot_im: f32,
      side_tones: Vec<ActiveSideTone>,
    }

    struct ActiveSideTone {
      amp_weight: f32,
      v_re: [f32; 4],
      v_im: [f32; 4],
      rot_re: f32,
      rot_im: f32,
    }

    let mut active_list = Vec::with_capacity(signals.len());
    let n0 = self.total_samples;

    for s in signals {
      if !s.active {
        continue;
      }
      let current_bin = (s.center_bin + s.drift_offset).round() as i32;
      let k = current_bin.rem_euclid(fft_size as i32);
      let freq_hz = (k as f32) * (sample_rate as f32) / (fft_size as f32);

      let modulation = s.modulation_phase.sin() * 0.3 + 0.7;
      let current_strength_db = s.base_strength * modulation;
      let amp = (10f32.powf(current_strength_db / 20.0) * 0.05).clamp(0.0, 0.9);

      let pps =
        2.0 * std::f64::consts::PI * freq_hz as f64 / sample_rate as f64;

      let build_phasor = |step_pps: f64| {
        let mut re = [0.0f32; 4];
        let mut im = [0.0f32; 4];
        for j in 0..4 {
          let p = (n0 as f64 + j as f64) * step_pps;
          re[j] = p.cos() as f32;
          im[j] = p.sin() as f32;
        }
        let (rot_im, rot_re) = (step_pps * 4.0).sin_cos();
        (re, im, rot_re as f32, rot_im as f32)
      };

      let (v_re, v_im, rot_re, rot_im) = build_phasor(pps);

      let mut side_tones = Vec::new();
      if s.bandwidth > 1 {
        let side = (s.bandwidth as f32 / 4.0).round() as i32;
        if side > 0 {
          for mult in [-side, side] {
            let k2 = k + mult;
            let freq2 = (k2 as f32) * (sample_rate as f32) / (fft_size as f32);
            let pps2 =
              2.0 * std::f64::consts::PI * freq2 as f64 / sample_rate as f64;
            let (s_re, s_im, s_rot_re, s_rot_im) = build_phasor(pps2);
            side_tones.push(ActiveSideTone {
              amp_weight: 0.5,
              v_re: s_re,
              v_im: s_im,
              rot_re: s_rot_re,
              rot_im: s_rot_im,
            });
          }
        }
      }
      active_list.push(ActiveSignal {
        amp,
        v_re,
        v_im,
        rot_re,
        rot_im,
        side_tones,
      });
    }

    self.total_samples += fft_size as u64;

    unsafe {
      // Process in blocks of 4 samples
      for i in (0..fft_size).step_by(4) {
        if i + 4 > fft_size {
          break;
        }

        #[cfg(target_arch = "aarch64")]
        let (mut i_acc, mut q_acc) = {
          let noise_i =
            vdupq_n_f32((self.rng.random::<f32>() - 0.5) * 2.0 * noise_level);
          let noise_q =
            vdupq_n_f32((self.rng.random::<f32>() - 0.5) * 2.0 * noise_level);
          (noise_i, noise_q)
        };
        #[cfg(target_arch = "wasm32")]
        let (mut i_acc, mut q_acc) = {
          let n_val_i = (self.rng.random::<f32>() - 0.5) * 2.0 * noise_level;
          let n_val_q = (self.rng.random::<f32>() - 0.5) * 2.0 * noise_level;
          (
            f32x4(n_val_i, n_val_i, n_val_i, n_val_i),
            f32x4(n_val_q, n_val_q, n_val_q, n_val_q),
          )
        };

        for sig in &mut active_list {
          #[cfg(target_arch = "aarch64")]
          let v_amp = vdupq_n_f32(sig.amp);
          #[cfg(target_arch = "wasm32")]
          let v_amp = f32x4(sig.amp, sig.amp, sig.amp, sig.amp);

          #[cfg(target_arch = "aarch64")]
          let s_re = vld1q_f32(sig.v_re.as_ptr());
          #[cfg(target_arch = "aarch64")]
          let s_im = vld1q_f32(sig.v_im.as_ptr());

          #[cfg(target_arch = "wasm32")]
          let s_re = v128_load(sig.v_re.as_ptr() as *const v128);
          #[cfg(target_arch = "wasm32")]
          let s_im = v128_load(sig.v_im.as_ptr() as *const v128);

          #[cfg(target_arch = "aarch64")]
          {
            i_acc = vfmaq_f32(i_acc, v_amp, s_im);
            q_acc = vfmaq_f32(q_acc, v_amp, s_re);
          }
          #[cfg(target_arch = "wasm32")]
          {
            i_acc = f32x4_add(i_acc, f32x4_mul(v_amp, s_im));
            q_acc = f32x4_add(q_acc, f32x4_mul(v_amp, s_re));
          }

          // Rotation update
          #[cfg(target_arch = "aarch64")]
          {
            let v_rot_re = vdupq_n_f32(sig.rot_re);
            let v_rot_im = vdupq_n_f32(sig.rot_im);
            let next_re =
              vsubq_f32(vmulq_f32(s_re, v_rot_re), vmulq_f32(s_im, v_rot_im));
            let next_im =
              vaddq_f32(vmulq_f32(s_im, v_rot_re), vmulq_f32(s_re, v_rot_im));
            vst1q_f32(sig.v_re.as_mut_ptr(), next_re);
            vst1q_f32(sig.v_im.as_mut_ptr(), next_im);
          }
          #[cfg(target_arch = "wasm32")]
          {
            let v_rot_re =
              f32x4(sig.rot_re, sig.rot_re, sig.rot_re, sig.rot_re);
            let v_rot_im =
              f32x4(sig.rot_im, sig.rot_im, sig.rot_im, sig.rot_im);
            let next_re =
              f32x4_sub(f32x4_mul(s_re, v_rot_re), f32x4_mul(s_im, v_rot_im));
            let next_im =
              f32x4_add(f32x4_mul(s_im, v_rot_re), f32x4_mul(s_re, v_rot_im));
            v128_store(sig.v_re.as_mut_ptr() as *mut v128, next_re);
            v128_store(sig.v_im.as_mut_ptr() as *mut v128, next_im);
          }

          for side in &mut sig.side_tones {
            #[cfg(target_arch = "aarch64")]
            let v_side_amp = vdupq_n_f32(sig.amp * side.amp_weight);
            #[cfg(target_arch = "wasm32")]
            let v_side_amp = f32x4(
              sig.amp * side.amp_weight,
              sig.amp * side.amp_weight,
              sig.amp * side.amp_weight,
              sig.amp * side.amp_weight,
            );

            #[cfg(target_arch = "aarch64")]
            let ss_re = vld1q_f32(side.v_re.as_ptr());
            #[cfg(target_arch = "aarch64")]
            let ss_im = vld1q_f32(side.v_im.as_ptr());

            #[cfg(target_arch = "wasm32")]
            let ss_re = v128_load(side.v_re.as_ptr() as *const v128);
            #[cfg(target_arch = "wasm32")]
            let ss_im = v128_load(side.v_im.as_ptr() as *const v128);

            #[cfg(target_arch = "aarch64")]
            {
              i_acc = vfmaq_f32(i_acc, v_side_amp, ss_im);
              q_acc = vfmaq_f32(q_acc, v_side_amp, ss_re);
            }
            #[cfg(target_arch = "wasm32")]
            {
              i_acc = f32x4_add(i_acc, f32x4_mul(v_side_amp, ss_im));
              q_acc = f32x4_add(q_acc, f32x4_mul(v_side_amp, ss_re));
            }

            // Side rotation update
            #[cfg(target_arch = "aarch64")]
            {
              let v_rot_re = vdupq_n_f32(side.rot_re);
              let v_rot_im = vdupq_n_f32(side.rot_im);
              let next_re = vsubq_f32(
                vmulq_f32(ss_re, v_rot_re),
                vmulq_f32(ss_im, v_rot_im),
              );
              let next_im = vaddq_f32(
                vmulq_f32(ss_im, v_rot_re),
                vmulq_f32(ss_re, v_rot_im),
              );
              vst1q_f32(side.v_re.as_mut_ptr(), next_re);
              vst1q_f32(side.v_im.as_mut_ptr(), next_im);
            }
            #[cfg(target_arch = "wasm32")]
            {
              let v_rot_re =
                f32x4(side.rot_re, side.rot_re, side.rot_re, side.rot_re);
              let v_rot_im =
                f32x4(side.rot_im, side.rot_im, side.rot_im, side.rot_im);
              let next_re = f32x4_sub(
                f32x4_mul(ss_re, v_rot_re),
                f32x4_mul(ss_im, v_rot_im),
              );
              let next_im = f32x4_add(
                f32x4_mul(ss_im, v_rot_re),
                f32x4_mul(ss_re, v_rot_im),
              );
              v128_store(side.v_re.as_mut_ptr() as *mut v128, next_re);
              v128_store(side.v_im.as_mut_ptr() as *mut v128, next_im);
            }
          }
        }

        // Soft clamp via fast_tanh
        let i_f = fast_tanhq_f32(i_acc);
        let q_f = fast_tanhq_f32(q_acc);

        // Convert to u8 [0, 255]
        #[cfg(target_arch = "aarch64")]
        let v_128_mult = vdupq_n_f32(128.0);
        #[cfg(target_arch = "wasm32")]
        let v_128_mult = f32x4(128.0, 128.0, 128.0, 128.0);

        #[cfg(target_arch = "aarch64")]
        let v_128 = vdupq_n_f32(128.0);
        #[cfg(target_arch = "wasm32")]
        let v_128 = f32x4(128.0, 128.0, 128.0, 128.0);

        #[cfg(target_arch = "aarch64")]
        {
          let i_u32 =
            vcvtnq_u32_f32(vaddq_f32(vmulq_f32(i_f, v_128_mult), v_128));
          let q_u32 =
            vcvtnq_u32_f32(vaddq_f32(vmulq_f32(q_f, v_128_mult), v_128));

          frame[i * 2] = vgetq_lane_u32(i_u32, 0) as u8;
          frame[i * 2 + 1] = vgetq_lane_u32(q_u32, 0) as u8;
          frame[(i + 1) * 2] = vgetq_lane_u32(i_u32, 1) as u8;
          frame[(i + 1) * 2 + 1] = vgetq_lane_u32(q_u32, 1) as u8;
          frame[(i + 2) * 2] = vgetq_lane_u32(i_u32, 2) as u8;
          frame[(i + 2) * 2 + 1] = vgetq_lane_u32(q_u32, 2) as u8;
          frame[(i + 3) * 2] = vgetq_lane_u32(i_u32, 3) as u8;
          frame[(i + 3) * 2 + 1] = vgetq_lane_u32(q_u32, 3) as u8;
        }
        #[cfg(target_arch = "wasm32")]
        {
          let i_val = f32x4_add(f32x4_mul(i_f, v_128_mult), v_128);
          let q_val = f32x4_add(f32x4_mul(q_f, v_128_mult), v_128);
          let i_u32 = u32x4_trunc_sat_f32x4(i_val);
          let q_u32 = u32x4_trunc_sat_f32x4(q_val);

          frame[(i + 0) * 2] = u32x4_extract_lane::<0>(i_u32) as u8;
          frame[(i + 0) * 2 + 1] = u32x4_extract_lane::<0>(q_u32) as u8;
          frame[(i + 1) * 2] = u32x4_extract_lane::<1>(i_u32) as u8;
          frame[(i + 1) * 2 + 1] = u32x4_extract_lane::<1>(q_u32) as u8;
          frame[(i + 2) * 2] = u32x4_extract_lane::<2>(i_u32) as u8;
          frame[(i + 2) * 2 + 1] = u32x4_extract_lane::<2>(q_u32) as u8;
          frame[(i + 3) * 2] = u32x4_extract_lane::<3>(i_u32) as u8;
          frame[(i + 3) * 2 + 1] = u32x4_extract_lane::<3>(q_u32) as u8;
        }
      }

      // Tail handling
      for i in (fft_size / 4 * 4)..fft_size {
        let t = t0 + (i as f32 * inv_sample_rate);
        let (i_sample, q_sample) = self.generate_sample(
          i,
          t,
          signals,
          noise_level,
          sample_rate,
          fft_size,
        );
        frame[i * 2] =
          ((i_sample * 128.0) + 128.0).round().clamp(0.0, 255.0) as u8;
        frame[i * 2 + 1] =
          ((q_sample * 128.0) + 128.0).round().clamp(0.0, 255.0) as u8;
      }
    }
  }

  /// Update signal appearance/disappearance and modulation
  fn update_signal_state(
    &mut self,
    signals: &mut [MockSignal],
    config: &MockSignalsConfig,
  ) {
    for signal in signals.iter_mut() {
      if signal.active
        && self.rng.random::<f32>()
          < config.global_settings.signal_appearance_chance as f32
      {
        signal.active = false;
      } else if !signal.active
        && self.rng.random::<f32>()
          < config.global_settings.signal_disappearance_chance as f32
      {
        signal.active = true;
      }

      if signal.active {
        let drift = config.global_settings.signal_drift_rate as f32;
        if drift > 0.0 {
          signal.drift_offset += self.rng.random_range(-drift..drift);
        }
        signal.drift_offset = signal.drift_offset.clamp(-5.0, 5.0);

        signal.modulation_phase +=
          config.global_settings.signal_modulation_rate;
        if signal.modulation_phase > 2.0 * std::f32::consts::PI {
          signal.modulation_phase -= 2.0 * std::f32::consts::PI;
        }
      }
    }
  }

  /// Calculate noise level for FFT size
  fn calculate_noise_level(
    &self,
    fft_size: usize,
    config: &MockSignalsConfig,
  ) -> f32 {
    const MOCK_NOISE_REF_FFT_SIZE: f32 = 8192.0;
    let noise_level_base =
      ((config.global_settings.noise_floor_variation as f32) / 200.0)
        .clamp(0.001, 0.5);
    let noise_scale = ((fft_size as f32) / MOCK_NOISE_REF_FFT_SIZE)
      .sqrt()
      .clamp(0.25, 16.0);
    (noise_level_base * noise_scale).clamp(0.001, 0.9)
  }

  /// Generate a single IQ sample
  fn generate_sample(
    &mut self,
    _i: usize,
    t: f32,
    signals: &[MockSignal],
    noise_level: f32,
    sample_rate: u32,
    fft_size: usize,
  ) -> (f32, f32) {
    let mut i_acc = (self.rng.random::<f32>() - 0.5) * 2.0 * noise_level;
    let mut q_acc = (self.rng.random::<f32>() - 0.5) * 2.0 * noise_level;

    for signal in signals {
      if !signal.active {
        continue;
      }

      // Calculate frequency and add signal contribution
      let current_bin =
        (signal.center_bin + signal.drift_offset).round() as i32;
      let k = current_bin.rem_euclid(fft_size as i32);
      let freq_hz = (k as f32) * (sample_rate as f32) / (fft_size as f32);

      let modulation = signal.modulation_phase.sin() * 0.3 + 0.7;
      let current_strength_db = signal.base_strength * modulation;
      let amp = (10f32.powf(current_strength_db / 20.0) * 0.05).clamp(0.0, 0.9);

      let phase = 2.0 * std::f32::consts::PI * freq_hz * t;
      i_acc += amp * phase.sin();
      q_acc += amp * phase.cos();

      // Add side tones for bandwidth
      if signal.bandwidth > 1 {
        let side = (signal.bandwidth as f32 / 4.0).round() as i32;
        if side > 0 {
          for mult in [-side, side] {
            let k2 = k + mult;
            let freq2 = (k2 as f32) * (sample_rate as f32) / (fft_size as f32);
            let phase2 = 2.0 * std::f32::consts::PI * freq2 * t;
            i_acc += (amp * 0.5) * phase2.sin();
            q_acc += (amp * 0.5) * phase2.cos();
          }
        }
      }
    }

    // Soft clamp to keep within [-1, 1]
    let i_f = i_acc.tanh();
    let q_f = q_acc.tanh();

    (i_f, q_f)
  }
}

impl Default for MockSignalGenerator {
  fn default() -> Self {
    Self::new()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_mock_generator_creation() {
    let generator = MockSignalGenerator::new();
    assert_eq!(generator.frame_counter, 0);
  }

  #[test]
  fn test_generate_basic_frame() {
    let mut generator = MockSignalGenerator::new();
    let mut signals = vec![];
    let config = MockSignalsConfig::default();

    let result = generator.generate_frame(1024, 3200000, &mut signals, &config);
    assert!(result.is_ok());

    let samples = result.unwrap();
    assert_eq!(samples.data.len(), 1024 * 2);
    assert_eq!(samples.sample_rate, 3200000);
  }

  #[test]
  fn test_generate_with_signal() {
    let mut generator = MockSignalGenerator::new();
    let mut signals = vec![MockSignal {
      center_bin: 256.0,
      base_strength: -20.0,
      bandwidth: 4,
      active: true,
      drift_offset: 0.0,
      modulation_phase: 0.0,
    }];
    let config = MockSignalsConfig::default();

    let result = generator.generate_frame(512, 3200000, &mut signals, &config);
    assert!(result.is_ok());

    let samples = result.unwrap();
    assert_eq!(samples.data.len(), 512 * 2);
  }
}
