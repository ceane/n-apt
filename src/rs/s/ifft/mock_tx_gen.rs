use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, PartialEq, Debug)]
pub struct MockTxParams {
  pub signal_key: String,
  pub sample_rate_hz: f64,
  pub bandwidth_hz: f64,
  pub tx_ifft_size: usize,
  /// Seed for per-frame subcarrier phase randomization (OFDM signals).
  /// When non-zero, each value produces a visually distinct OFDM symbol.
  pub phase_seed: u64,
}

pub fn canonical_mock_tx_signal_key(signal_name: &str) -> String {
  let normalized = signal_name
    .trim()
    .to_ascii_lowercase()
    .replace([' ', '-'], "_");
  match normalized.as_str() {
    "" => "wifi".to_string(),
    "dsharp" => "d_sharp".to_string(),
    other => other.to_string(),
  }
}

/// Deterministic hash mapping (bin, seed) → [0, 2π) for OFDM subcarrier
/// phase randomization. Different seeds produce visually distinct symbols.
fn subcarrier_phase_hash(bin: u64, seed: u64) -> f64 {
  let mut x = bin.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(seed);
  x ^= x >> 30;
  x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
  x ^= x >> 27;
  x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
  x ^= x >> 31;
  ((x >> 11) as f64 / ((1u64 << 53) as f64)) * 2.0 * std::f64::consts::PI
}

#[derive(Clone)]
struct MockTxPlanPair {
  inverse: Arc<dyn Fft<f32>>,
  forward: Arc<dyn Fft<f32>>,
}

pub struct MockTxGenerator {
  planner: FftPlanner<f32>,
  plans: HashMap<usize, MockTxPlanPair>,
  projected: Vec<Complex<f32>>,
  desired_magnitudes: Vec<f32>,
  test_block: Vec<Complex<f32>>,
}

impl Default for MockTxGenerator {
  fn default() -> Self {
    Self::new()
  }
}

impl MockTxGenerator {
  pub fn new() -> Self {
    Self {
      planner: FftPlanner::new(),
      plans: HashMap::new(),
      projected: Vec::new(),
      desired_magnitudes: Vec::new(),
      test_block: Vec::new(),
    }
  }

  fn plans_for_size(&mut self, size: usize) -> MockTxPlanPair {
    if let Some(plans) = self.plans.get(&size) {
      return plans.clone();
    }

    let plans = MockTxPlanPair {
      inverse: self.planner.plan_fft_inverse(size),
      forward: self.planner.plan_fft_forward(size),
    };
    self.plans.insert(size, plans.clone());
    plans
  }

  pub fn generate_into(
    &mut self,
    params: &MockTxParams,
    output: &mut Vec<Complex<f32>>,
  ) {
    let plans = self.plans_for_size(params.tx_ifft_size);
    let fft = plans.inverse;
    let forward_fft = plans.forward;
    output.resize(params.tx_ifft_size, Complex::new(0.0_f32, 0.0_f32));
    output.fill(Complex::new(0.0_f32, 0.0_f32));
    let spectrum = output;

    let key = params.signal_key.as_str();
    let bin_spacing = params.sample_rate_hz / params.tx_ifft_size as f64;
    // Use floor instead of round to ensure the generated signal never exceeds the requested bandwidth.
    // We do not use .max(1.0) because if the requested bandwidth is smaller than a single bin,
    // generating a signal anyway would cause it to spill outside the frontend's visual markers.
    let num_bins = (params.bandwidth_hz / bin_spacing).floor() as usize;

    let half_bins = num_bins / 2;

    if key == "d" || key == "d_sharp" {
      let max_harmonics = if key == "d_sharp" {
        (params.bandwidth_hz / 40_000.0).ceil() as usize
      } else {
        (params.bandwidth_hz / 90_000.0).ceil() as usize + 2
      }
      .clamp(2, 18);
      let spike_count = max_harmonics.min(half_bins);

      for n in 0..spike_count {
        let harmonic = n + 1;
        let edge_fraction = harmonic as f64 / (spike_count + 1) as f64;
        let bin_offset =
          (edge_fraction * half_bins.max(1) as f64).round().max(1.0) as usize;
        let amp = (1.0 / harmonic as f32)
          * (1.0 - 0.35 * n as f32 / spike_count as f32);
        let phase = if params.phase_seed != 0 {
          let seed_phase =
            subcarrier_phase_hash(harmonic as u64, params.phase_seed);
          if key == "d_sharp" {
            std::f64::consts::FRAC_PI_4 * harmonic as f64 + seed_phase
          } else {
            -std::f64::consts::FRAC_PI_2 * harmonic as f64 + seed_phase
          }
        } else if key == "d_sharp" {
          std::f64::consts::FRAC_PI_4 * harmonic as f64
        } else {
          -std::f64::consts::FRAC_PI_2 * harmonic as f64
        };
        let (sin_p, cos_p) = phase.sin_cos();

        if bin_offset < params.tx_ifft_size / 2 {
          spectrum[bin_offset] =
            Complex::new((cos_p as f32) * amp, (sin_p as f32) * amp);
        }
        let mirrored = params.tx_ifft_size - bin_offset;
        if mirrored > params.tx_ifft_size / 2 && mirrored < params.tx_ifft_size
        {
          spectrum[mirrored] =
            Complex::new((cos_p as f32) * amp, -(sin_p as f32) * amp);
        }
      }
    } else {
      // OFDM flat-top spectral envelope with steep roll-off edges.
      // WiFi 802.11ac: 52/64 data+pilot subcarriers ≈ 81% occupied BW.
      // 5G NR: ~90-93% of channel bandwidth occupied.
      // The roll-off uses a raised-cosine shape matching real spectral masks,
      // but starts slightly earlier than the nominal occupied bandwidth so the
      // visible shoulder is not mistaken for a square-edged block.
      let passband_edge = if key == "5g" { 0.62 } else { 0.58 };
      let rolloff_width = if key == "5g" { 0.38 } else { 0.40 };
      let passband_jitter_db: f64 = if key == "5g" { 0.75 } else { 0.9 };

      for k in 0..num_bins {
        let centered = k as isize - half_bins as isize;
        let bin_idx = if centered >= 0 {
          centered
        } else {
          params.tx_ifft_size as isize + centered
        };
        let wrapped_bin = bin_idx as usize;

        if wrapped_bin < params.tx_ifft_size {
          let bin_hz = centered as f64 * bin_spacing;
          let x = bin_hz.abs() / (params.bandwidth_hz / 2.0);

          let jitter_raw = subcarrier_phase_hash(
            k as u64,
            params.phase_seed.wrapping_add(0x4F46_444D),
          );
          let jitter_unit = jitter_raw / std::f64::consts::PI - 1.0;

          let amp = if x > 1.0 {
            0.0
          } else if x <= passband_edge {
            10.0f64.powf(jitter_unit * passband_jitter_db / 20.0)
          } else {
            let t = ((x - passband_edge) / rolloff_width).clamp(0.0, 1.0);
            let rc = 0.5 * (1.0 + (std::f64::consts::PI * t).cos());
            let skirt_db = -34.0 - 28.0 * t;
            let skirt = 10.0f64.powf(skirt_db / 20.0);
            let rolloff = rc.max(skirt);
            let edge_jitter =
              10.0f64.powf(jitter_unit * passband_jitter_db * (1.0 - t) / 20.0);
            rolloff * edge_jitter
          };

          let base_phase =
            std::f64::consts::PI * (centered as f64).powi(2) / num_bins as f64;
          let phase = if params.phase_seed != 0 {
            base_phase + 0.15 * subcarrier_phase_hash(k as u64, params.phase_seed)
          } else {
            base_phase
          };
          let (sin_p, cos_p) = phase.sin_cos();
          spectrum[wrapped_bin] = Complex::new(
            (cos_p as f32) * amp as f32,
            (sin_p as f32) * amp as f32,
          );
        }
      }

      self.desired_magnitudes.clear();
      self.desired_magnitudes.extend(
        spectrum
          .iter()
          .map(|bin| (bin.re * bin.re + bin.im * bin.im).sqrt()),
      );
      self
        .projected
        .resize(params.tx_ifft_size, Complex::new(0.0_f32, 0.0_f32));
      // PAPR reduction: iteratively clip time-domain peaks and restore
      // spectral magnitudes. The clip threshold is low enough that after
      // FFT normalization (peak/N = 1.0), the time-domain peak stays below
      // 1/saturation_rms ≈ 1.087, preventing DAC clipping at any power.
      let clip_threshold = 1.2_f32;
      for _ in 0..12 {
        self.projected.copy_from_slice(spectrum);
        fft.process(&mut self.projected);
        for sample in &mut self.projected {
          let mag = (sample.re * sample.re + sample.im * sample.im).sqrt();
          if mag > clip_threshold {
            let scale = clip_threshold / mag;
            sample.re *= scale;
            sample.im *= scale;
          }
        }
        forward_fft.process(&mut self.projected);
        for (bin, desired_mag) in self
          .projected
          .iter_mut()
          .zip(self.desired_magnitudes.iter())
        {
          if *desired_mag <= 0.0 {
            *bin = Complex::new(0.0, 0.0);
            continue;
          }
          let mag = (bin.re * bin.re + bin.im * bin.im).sqrt();
          if mag > 0.0 {
            let scale = *desired_mag / mag;
            bin.re *= scale;
            bin.im *= scale;
          } else {
            bin.re = *desired_mag;
            bin.im = 0.0;
          }
        }
        std::mem::swap(spectrum, &mut self.projected);
      }
    }

    // Transform to time domain
    fft.process(spectrum);

    // Normalize so the receiver-side FFT peak bin (|X[k]|/N) equals 1.0.
    self
      .test_block
      .resize(params.tx_ifft_size, Complex::new(0.0_f32, 0.0_f32));
    self.test_block.copy_from_slice(spectrum);
    forward_fft.process(&mut self.test_block);

    let mut max_fft_mag = 0.0_f32;
    for s in &self.test_block {
      let mag = (s.re * s.re + s.im * s.im).sqrt();
      if mag > max_fft_mag {
        max_fft_mag = mag;
      }
    }
    if max_fft_mag > 0.0 {
      let scale = (params.tx_ifft_size as f32) / max_fft_mag;
      for s in spectrum.iter_mut() {
        s.re *= scale;
        s.im *= scale;
      }
    }
  }

  #[cfg(test)]
  pub(crate) fn cached_fft_size_count(&self) -> usize {
    self.plans.len()
  }

  #[cfg(test)]
  fn scratch_capacity(&self) -> usize {
    self
      .projected
      .capacity()
      .max(self.desired_magnitudes.capacity())
      .max(self.test_block.capacity())
  }
}

pub fn generate_mock_tx_samples_ifft(
  params: &MockTxParams,
) -> Vec<Complex<f32>> {
  let mut generator = MockTxGenerator::new();
  let mut output = Vec::new();
  generator.generate_into(params, &mut output);
  output
}

#[cfg(test)]
mod tests {
  use super::{canonical_mock_tx_signal_key, MockTxGenerator, MockTxParams};

  #[test]
  fn canonical_mock_tx_signal_key_normalizes_supported_keys() {
    assert_eq!(canonical_mock_tx_signal_key("wifi"), "wifi");
    assert_eq!(canonical_mock_tx_signal_key("D Sharp"), "d_sharp");
    assert_eq!(canonical_mock_tx_signal_key("5g"), "5g");
    assert_eq!(canonical_mock_tx_signal_key("  "), "wifi");
  }

  #[test]
  fn generator_reuses_plans_and_output_storage_for_same_ifft_size() {
    let mut generator = MockTxGenerator::new();
    let mut output = Vec::new();
    let mut params = MockTxParams {
      signal_key: "wifi".to_string(),
      sample_rate_hz: 3_200_000.0,
      bandwidth_hz: 100_000.0,
      tx_ifft_size: 1024,
      phase_seed: 1,
    };

    generator.generate_into(&params, &mut output);
    let first_capacity = output.capacity();
    params.phase_seed = 2;
    generator.generate_into(&params, &mut output);

    assert_eq!(output.len(), 1024);
    assert_eq!(output.capacity(), first_capacity);
    assert_eq!(generator.cached_fft_size_count(), 1);
    assert!(generator.scratch_capacity() >= 1024);
  }
}
