use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use std::arch::wasm32::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsValue;

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

fn mean_f32(signal: &[f32]) -> Option<f32> {
  let mut sum = 0.0f32;
  let mut count = 0usize;
  for value in signal {
    if value.is_finite() {
      sum += *value;
      count += 1;
    }
  }
  if count > 0 {
    Some(sum / count as f32)
  } else {
    None
  }
}

/// Normalize dB-domain spectrum floor by applying an additive offset.
///
/// Unlike `match_noise_floor`, spectrum traces are already logarithmic dB values,
/// so matching floors is an offset operation rather than a linear amplitude scale.
pub fn match_noise_floor_db(
  reference: &[f32],
  target: &mut [f32],
  edge_bins: usize,
) {
  match_noise_floor_db_with_limit(reference, target, edge_bins, 0.0);
}

/// Normalize dB-domain spectrum floor with a cap for upward floor shifts.
pub fn match_noise_floor_db_with_limit(
  reference: &[f32],
  target: &mut [f32],
  edge_bins: usize,
  max_positive_shift_db: f32,
) {
  if reference.is_empty() || target.is_empty() {
    return;
  }

  let bins = edge_bins.max(1).min(reference.len()).min(target.len());
  let reference_start = reference.len() - bins;
  let Some(reference_floor) = mean_f32(&reference[reference_start..]) else {
    return;
  };
  let Some(target_floor) = mean_f32(&target[..bins]) else {
    return;
  };
  let delta =
    (reference_floor - target_floor).min(max_positive_shift_db.max(0.0));

  #[cfg(target_arch = "wasm32")]
  {
    let delta_vec = unsafe { f32x4_splat(delta) };
    let (prefix, middle, suffix) = unsafe { target.align_to_mut::<v128>() };

    for x in prefix {
      if x.is_finite() {
        *x += delta;
      }
    }

    for x in middle {
      unsafe {
        let val = *x;
        // Optimization: only add if we have any finite values to avoid unnecessary work
        // though f32x4_add is fast anyway.
        *x = f32x4_add(val, delta_vec);
      }
    }

    for x in suffix {
      if x.is_finite() {
        *x += delta;
      }
    }
  }

  #[cfg(not(target_arch = "wasm32"))]
  {
    for value in target.iter_mut() {
      if value.is_finite() {
        *value += delta;
      }
    }
  }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn match_noise_floor_db_wasm(
  reference: &[f32],
  target: &[f32],
  edge_bins: usize,
  max_positive_shift_db: f32,
) -> Vec<f32> {
  let mut adjusted = target.to_vec();
  match_noise_floor_db_with_limit(
    reference,
    &mut adjusted,
    edge_bins,
    max_positive_shift_db,
  );
  adjusted
}

/// Apply triangular smoothing to a waveform.
#[cfg(target_arch = "wasm32")]
pub fn smooth_waveform(input: &[f32], radius: usize) -> Vec<f32> {
  if radius == 0 || input.len() < 3 {
    return input.to_vec();
  }
  let mut output = vec![0.0f32; input.len()];
  for i in 0..input.len() {
    let start = i.saturating_sub(radius);
    let end = (i + radius + 1).min(input.len());
    let mut sum = 0.0f32;
    let mut weight_sum = 0.0f32;

    for j in start..end {
      let distance = i.abs_diff(j);
      let weight = (radius + 1 - distance) as f32;
      sum += input[j] * weight;
      weight_sum += weight;
    }

    output[i] = if weight_sum > 0.0 {
      sum / weight_sum
    } else {
      input[i]
    };
  }
  output
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn smooth_waveform_wasm(input: &[f32], radius: usize) -> Vec<f32> {
  smooth_waveform(input, radius)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WasmRange {
  pub min: f64,
  pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmWholeChannelWaveformSegment {
  pub waveform: Vec<f32>,
  pub visual_range: WasmRange,
  pub db_min: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmWholeChannelStitchOptions {
  pub minimum_bins: Option<usize>,
  pub seam_bins: Option<usize>,
  pub smoothing_radius: Option<usize>,
  pub max_positive_floor_shift_db: Option<f32>,
}

#[cfg(target_arch = "wasm32")]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
  a + (b - a) * t
}

#[cfg(target_arch = "wasm32")]
fn sample_linear(data: &[f32], x: f32) -> f32 {
  let len = data.len();
  if len == 0 {
    return 0.0;
  }
  if len == 1 {
    return data[0];
  }
  let idx = x.max(0.0).min(len as f32 - 1.0001);
  let i = idx.floor() as usize;
  let t = idx - i as f32;
  lerp(data[i], data[i + 1], t)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn stitch_whole_channel_waveform_wasm(
  segments_val: JsValue,
  options_val: JsValue,
) -> Result<Vec<f32>, JsValue> {
  let segments: Vec<WasmWholeChannelWaveformSegment> =
    serde_wasm_bindgen::from_value(segments_val)
      .map_err(|e| JsValue::from_str(&e.to_string()))?;
  let options: WasmWholeChannelStitchOptions =
    serde_wasm_bindgen::from_value(options_val)
      .map_err(|e| JsValue::from_str(&e.to_string()))?;

  if segments.is_empty() {
    return Ok(Vec::new());
  }

  let min_freq = segments
    .iter()
    .map(|s| s.visual_range.min)
    .fold(f64::INFINITY, f64::min);
  let max_freq = segments
    .iter()
    .map(|s| s.visual_range.max)
    .fold(f64::NEG_INFINITY, f64::max);
  let total_span = max_freq - min_freq;

  if total_span <= 0.0 {
    return Ok(Vec::new());
  }

  let seam_bins = options.seam_bins.unwrap_or(0);
  let max_positive_floor_shift_db =
    options.max_positive_floor_shift_db.unwrap_or(0.0);

  // Normalize segments: match noise floor and apply seam crossfades
  let mut processed_segments = segments;
  for i in 1..processed_segments.len() {
    let (prev_part, next_part) = processed_segments.split_at_mut(i);
    let prev = &prev_part[i - 1];
    let next = &mut next_part[0];

    // Match noise floor
    match_noise_floor_db_with_limit(
      &prev.waveform,
      &mut next.waveform,
      seam_bins,
      max_positive_floor_shift_db,
    );

    // Crossfade overlap region if seam_bins > 0
    if seam_bins > 0
      && prev.waveform.len() >= seam_bins
      && next.waveform.len() >= seam_bins
    {
      let prev_waveform = &prev.waveform;
      let next_waveform = &next.waveform;
      let mut result = Vec::with_capacity(seam_bins);
      let prev_start = prev_waveform.len() - seam_bins;

      for j in 0..seam_bins {
        let t = j as f32 / (seam_bins - 1) as f32;
        let val = lerp(prev_waveform[prev_start + j], next_waveform[j], t);
        result.push(val);
      }

      // Update next waveform's beginning with crossfaded data
      for (j, &val) in result.iter().enumerate() {
        next.waveform[j] = val;
      }
    }
  }

  let bins_per_hz = processed_segments
    .iter()
    .map(|s| {
      let span = s.visual_range.max - s.visual_range.min;
      if span > 0.0 {
        s.waveform.len() as f64 / span
      } else {
        0.0
      }
    })
    .fold(0.0, f64::max);

  let target_bins = if let Some(min_bins) = options.minimum_bins {
    (total_span * bins_per_hz).max(min_bins as f64) as usize
  } else {
    (total_span * bins_per_hz) as usize
  };

  if target_bins == 0 {
    return Ok(Vec::new());
  }

  let mut target = vec![0.0f32; target_bins];
  // Sort segments by frequency for linear scanning optimization
  let mut sorted_segments = processed_segments;
  sorted_segments.sort_by(|a, b| {
    a.visual_range
      .min
      .partial_cmp(&b.visual_range.min)
      .unwrap_or(std::cmp::Ordering::Equal)
  });

  let mut current_segment_idx = 0;
  for i in 0..target_bins {
    let freq = min_freq + (i as f64 / target_bins as f64) * total_span;

    // Fast forward to the first potential segment (O(N+M) total complexity)
    while current_segment_idx < sorted_segments.len()
      && freq > sorted_segments[current_segment_idx].visual_range.max
    {
      current_segment_idx += 1;
    }

    // Check current and subsequent overlapping segments (usually only 1 or 2)
    let mut found = false;
    let mut check_idx = current_segment_idx;
    while check_idx < sorted_segments.len()
      && freq >= sorted_segments[check_idx].visual_range.min
    {
      let segment = &sorted_segments[check_idx];
      if freq <= segment.visual_range.max {
        let span = segment.visual_range.max - segment.visual_range.min;
        if span > 0.0 {
          let t = (freq - segment.visual_range.min) / span;
          let idx = (t * (segment.waveform.len() - 1) as f64).round() as usize;

          if idx < segment.waveform.len() {
            target[i] = segment.waveform[idx];
            found = true;
            break;
          }
        }
      }
      check_idx += 1;
    }

    if !found {
      // Use noise floor from the nearest segment if available
      if let Some(seg) = sorted_segments
        .get(current_segment_idx)
        .or(sorted_segments.last())
      {
        target[i] = seg.db_min.unwrap_or(-120.0);
      } else {
        target[i] = -120.0;
      }
    }
  }

  let mut stitched = target;

  if let Some(radius) = options.smoothing_radius {
    if radius > 0 {
      stitched = smooth_waveform(&stitched, radius);
    }
  }

  Ok(stitched)
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

/// Hann-weighted crossfade between two signals (f32)
pub fn crossfade_f32(a: &[f32], b: &[f32], overlap: usize) -> Vec<f32> {
  let mut result = Vec::with_capacity(a.len() + b.len() - overlap);

  let split = a.len().saturating_sub(overlap);

  result.extend_from_slice(&a[..split]);

  for i in 0..overlap {
    let t = i as f32 / overlap as f32;
    let w = 0.5 - 0.5 * (std::f32::consts::PI * t).cos();

    let val = (1.0 - w) * a[split + i] + w * b[i];
    result.push(val);
  }

  result.extend_from_slice(&b[overlap..]);

  result
}

/// Calculate the RMS error between two dB-domain spectrum segments.
/// Lower is better; indicates how well the overlap matches.
pub fn calculate_rms_error_db(a: &[f32], b: &[f32]) -> f32 {
  if a.len() != b.len() || a.is_empty() {
    return 0.0;
  }
  let mut sum_sq_error = 0.0f32;
  let mut count = 0usize;
  for (va, vb) in a.iter().zip(b.iter()) {
    if va.is_finite() && vb.is_finite() {
      let diff = va - vb;
      sum_sq_error += diff * diff;
      count += 1;
    }
  }
  if count > 0 {
    (sum_sq_error / count as f32).sqrt()
  } else {
    0.0
  }
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
  max_search_hz: f64,
  step_hz: f64,
) -> Option<f64> {
  let max_search = max_search_hz;
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

  #[test]
  fn test_match_noise_floor_db_offset() {
    let reference = vec![-82.0_f32, -81.0, -80.0, -79.0];
    let mut target = vec![-70.0_f32, -69.0, -68.0, -67.0];

    match_noise_floor_db(&reference, &mut target, 4);

    let reference_avg: f32 =
      reference.iter().sum::<f32>() / reference.len() as f32;
    let target_avg: f32 = target.iter().sum::<f32>() / target.len() as f32;
    assert!((reference_avg - target_avg).abs() < 0.001);
  }

  #[test]
  fn test_match_noise_floor_db_does_not_raise_by_default() {
    let reference = vec![-62.0_f32, -50.0];
    let mut target = vec![-84.0_f32, -83.0, -82.0, -81.0];

    match_noise_floor_db(&reference, &mut target, 2);

    assert_eq!(target[0], -84.0);
  }
}
