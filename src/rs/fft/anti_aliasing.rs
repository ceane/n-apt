/// Estimate quantization uncertainty from sample rate and FFT size
fn estimate_quantization_error(fs_hz: f64, fft_size: usize) -> f64 {
  fs_hz / (2.0 * fft_size as f64)
}

/// Calculate RMS of signal
pub fn rms(signal: &[f64]) -> f64 {
  let sum: f64 = signal.iter().map(|x| x * x).sum();
  (sum / signal.len() as f64).sqrt()
}

/// Normalize noise floor between segments
pub fn match_noise_floor(reference: &[f64], target: &mut [f64]) {
  let rms_ref = rms(reference);
  let rms_target = rms(target);

  if rms_target > 0.0 {
    let scale = rms_ref / rms_target;
    for x in target.iter_mut() {
      *x *= scale;
    }
  }
}

/// Hann-weighted crossfade between two signals
pub fn crossfade(a: &[f64], b: &[f64], overlap: usize) -> Vec<f64> {
  let mut result = Vec::new();

  let split = a.len().saturating_sub(overlap);

  result.extend_from_slice(&a[..split]);

  for i in 0..overlap {
    let t = i as f64 / overlap as f64;
    let w = 0.5 - 0.5 * (std::f64::consts::PI * t).cos();

    let val = (1.0 - w) * a[split + i] + w * b[i];
    result.push(val);
  }

  result.extend_from_slice(&b[overlap..]);

  result
}

/// Remove DC offset from signal
pub fn remove_dc(signal: &mut [f64]) {
  let mean: f64 = signal.iter().sum::<f64>() / signal.len() as f64;
  for x in signal.iter_mut() {
    *x -= mean;
  }
}

/// Parabolic interpolation for sub-bin accuracy
/// This is the key to reducing aliasing - find the true peak between bins
fn parabolic_interpolate(waveform: &[f32], peak_bin: usize) -> f64 {
  if peak_bin == 0 || peak_bin >= waveform.len() - 1 {
    return peak_bin as f64;
  }

  let alpha = waveform[peak_bin - 1] as f64;
  let beta = waveform[peak_bin] as f64;
  let gamma = waveform[peak_bin + 1] as f64;

  let denom = alpha - 2.0 * beta + gamma;
  if denom.abs() < 1e-12 {
    return peak_bin as f64;
  }

  let delta = 0.5 * (alpha - gamma) / denom;
  peak_bin as f64 + delta
}

/// Fold aliased frequency back into fundamental range
fn fold_to_nyquist(f: f64, fs: f64) -> f64 {
  let mut r = f % fs;
  if r > fs / 2.0 {
    r = fs - r;
  }
  r.abs()
}

/// Find the peak bin in magnitude spectrum
pub fn find_peak_bin(mag: &[f32]) -> usize {
  let mut max = f32::NEG_INFINITY;
  let mut idx = 0;

  // Skip DC and last bin
  for i in 1..mag.len() - 1 {
    if mag[i] > max {
      max = mag[i];
      idx = i;
    }
  }

  idx
}

/// Apply sub-bin refinement to waveform for anti-aliased rendering
/// This improves the apparent resolution by finding the true peak position
pub fn refine_waveform_peak(
  waveform: &[f32],
  fft_size: usize,
  sample_rate_hz: f64,
) -> Vec<f32> {
  let peak_bin = find_peak_bin(waveform);
  let refined_bin = parabolic_interpolate(waveform, peak_bin);

  // Calculate frequency of refined peak
  let peak_freq = (refined_bin / fft_size as f64) * sample_rate_hz;
  let folded_freq = fold_to_nyquist(peak_freq, sample_rate_hz);

  // Return the frequency error for display
  vec![folded_freq as f32]
}

/// Measurement struct for CRT reconstruction
#[derive(Debug, Clone)]
pub struct Measurement {
  pub f: f64,
  pub fs: f64,
  pub eps: f64,
}

impl Measurement {
  pub fn new(
    waveform: &[f32],
    fft_size: usize,
    sample_rate_hz: f64,
  ) -> Option<Self> {
    if waveform.is_empty() || fft_size == 0 || sample_rate_hz == 0.0 {
      return None;
    }

    let peak_bin = find_peak_bin(waveform);
    let refined_bin = parabolic_interpolate(waveform, peak_bin);
    let f_measured = (refined_bin / fft_size as f64) * sample_rate_hz;
    let f_aliased = fold_to_nyquist(f_measured, sample_rate_hz);
    let eps = estimate_quantization_error(sample_rate_hz, fft_size);

    Some(Self {
      f: f_aliased,
      fs: sample_rate_hz,
      eps,
    })
  }
}

/// Chinese Remainder Theorem reconstruction from multiple measurements
/// Returns the true frequency that could produce all measurements
pub fn reconstruct_frequency_crt(
  measurements: &[Measurement],
  max_search_mhz: f64,
  step_hz: f64,
) -> Option<f64> {
  let max_search = max_search_mhz * 1_000_000.0;
  let mut f = 0.0;

  while f < max_search {
    let mut valid = true;

    for m in measurements {
      let mut r = f % m.fs;
      if r > m.fs / 2.0 {
        r = m.fs - r;
      }

      if (r - m.f).abs() > m.eps {
        valid = false;
        break;
      }
    }

    if valid {
      return Some(f);
    }

    f += step_hz;
  }

  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_parabolic_interpolate() {
    // Create a synthetic peak: 0.5, 1.0, 0.5 at bins 1,2,3
    let waveform = vec![0.0, 0.5, 1.0, 0.5, 0.0];
    let refined = parabolic_interpolate(&waveform, 2);
    // Should give bin 2.0 exactly (symmetric)
    assert!((refined - 2.0).abs() < 0.001);
  }

  #[test]
  fn test_fold_to_nyquist() {
    // Fold 3/4 of sample rate back
    assert!((fold_to_nyquist(0.75, 1.0) - 0.25).abs() < 0.001);
  }
}
