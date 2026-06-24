use crate::server::types::TxIqPowerModel;
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::atomic::{AtomicU64, Ordering};

pub const MOCK_TX_DISPLAY_NAME: &str = "Mock Tx SDR";
pub static MOCK_TX_MONITOR_SAMPLE_CURSOR: AtomicU64 = AtomicU64::new(0);

fn clamp_tx_monitor_offset(offset_hz: f64, sample_rate_hz: f64) -> f64 {
  if !offset_hz.is_finite() || !sample_rate_hz.is_finite() {
    return 0.0;
  }
  let nyquist = sample_rate_hz.max(1.0) / 2.0;
  offset_hz.clamp(-nyquist * 0.85, nyquist * 0.85)
}

fn resolve_mock_tx_monitor_params(
  signal_name: &str,
  sample_rate_hz: f64,
) -> (f64, f64, f64) {
  let settings = crate::server::utils::load_mock_tx_settings();
  let key = signal_name.trim().to_ascii_lowercase();
  let preset = settings
    .signals
    .get(&key)
    .or_else(|| settings.signals.get("apt"));

  let offset_hz = preset
    .and_then(|preset| preset.offset_hz)
    .unwrap_or(25_000.0);
  let tone_hz = preset
    .and_then(|preset| preset.tone_hz)
    .unwrap_or(2_400.0)
    .max(1.0);
  let bandwidth_hz = preset
    .and_then(|preset| preset.bandwidth_hz)
    .unwrap_or(sample_rate_hz / 5.0)
    .max(1.0)
    .min(sample_rate_hz.max(1.0));

  (
    clamp_tx_monitor_offset(offset_hz, sample_rate_hz),
    tone_hz,
    bandwidth_hz,
  )
}

fn mock_tx_noise_unit(sample_index: u64, salt: u64) -> f64 {
  let mut x = sample_index
    .wrapping_mul(0x9E37_79B9_7F4A_7C15)
    .wrapping_add(salt);
  x ^= x >> 30;
  x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
  x ^= x >> 27;
  x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
  x ^= x >> 31;
  ((x >> 11) as f64 / ((1u64 << 53) as f64)) * 2.0 - 1.0
}

pub fn mock_tx_monitor_target_rms_from_dbm(
  power_dbm: f64,
  power_model: &TxIqPowerModel,
) -> f64 {
  if !power_dbm.is_finite() {
    return 0.0;
  }
  // Frontend generic dBm mode is dBFS + calibration_db. Generate IQ whose
  // complex RMS therefore measures as the requested dBm after FFT normalization.
  let saturation_rms = if power_model.saturation_rms.is_finite() {
    power_model.saturation_rms
  } else {
    TxIqPowerModel::default().saturation_rms
  }
  .clamp(0.0, 1.0);
  let calibration_db = if power_model.calibration_db.is_finite() {
    power_model.calibration_db
  } else {
    TxIqPowerModel::default().calibration_db
  };
  10.0f64
    .powf((power_dbm - calibration_db) / 20.0)
    .clamp(0.0, saturation_rms)
}

pub fn resolve_effective_tx_power_dbm(
  power_dbm: Option<f64>,
  vga_gain_db: Option<f64>,
  amp_enabled: Option<bool>,
) -> Option<f64> {
  power_dbm.or_else(|| match (vga_gain_db, amp_enabled) {
    (Some(vga_gain_db), Some(amp_enabled)) => Some(
      crate::safety::get_approx_output_power(vga_gain_db, amp_enabled),
    ),
    _ => None,
  })
}

fn quantize_mock_tx_iq(value: f64, sample_index: u64, salt: u64) -> u8 {
  let scaled = value.clamp(-1.0, 1.0) * 128.0;
  let lower = scaled.floor();
  let fraction = scaled - lower;
  let dither = (mock_tx_noise_unit(sample_index, salt) + 1.0) * 0.5;
  let signed = lower + if dither < fraction { 1.0 } else { 0.0 };
  (128.0 + signed).clamp(0.0, 255.0) as u8
}

fn constrain_signal_to_tx_bandwidth(
  signal: &mut [Complex<f32>],
  rel_center_hz: f64,
  tx_sample_rate_hz: f64,
  view_sample_rate_hz: f64,
) {
  let len = signal.len();
  if len == 0
    || !rel_center_hz.is_finite()
    || !tx_sample_rate_hz.is_finite()
    || !view_sample_rate_hz.is_finite()
  {
    return;
  }

  let half_tx_hz = (tx_sample_rate_hz.max(1.0) / 2.0).max(0.5);
  let bin_width_hz = view_sample_rate_hz.max(1.0) / len as f64;
  let guard_hz = bin_width_hz * 1.5;
  let mut planner = FftPlanner::<f32>::new();
  let fft = planner.plan_fft_forward(len);
  fft.process(signal);

  for (index, bin) in signal.iter_mut().enumerate() {
    let bin_hz = if index <= len / 2 {
      index as f64 * bin_width_hz
    } else {
      -((len - index) as f64 * bin_width_hz)
    };
    if (bin_hz - rel_center_hz).abs() > half_tx_hz + guard_hz {
      *bin = Complex::new(0.0, 0.0);
    }
  }

  let ifft = planner.plan_fft_inverse(len);
  ifft.process(signal);
  let scale = 1.0 / len as f32;
  for sample in signal.iter_mut() {
    *sample *= scale;
  }
}

pub fn resolve_mock_tx_iq_power_model() -> TxIqPowerModel {
  crate::server::utils::load_sdr_settings()
    .devices
    .get("hackrf_one")
    .and_then(|device| device.tx_iq_power_model.clone())
    .unwrap_or_default()
}

pub fn resolve_mock_tx_noise_floor_db() -> f64 {
  crate::server::utils::load_mock_tx_settings()
    .noise_floor_db
    .unwrap_or(-100.0)
}

pub fn mock_tx_monitor_noise_floor_rms(power_model: &TxIqPowerModel) -> f64 {
  let configured_rms = mock_tx_monitor_target_rms_from_dbm(
    resolve_mock_tx_noise_floor_db(),
    power_model,
  );
  configured_rms
}

pub fn synthesize_mock_tx_monitor_iq(
  fft_size: usize,
  view_center_hz: f64,
  view_sample_rate: u32,
  tx_center_hz: f64,
  tx_sample_rate_hz: f64,
  signal_name: &str,
  tx_ifft_size: usize,
  power_dbm: f64,
  power_model: &TxIqPowerModel,
  phase_accumulator: &mut f64,
) -> Vec<u8> {
  if fft_size == 0 {
    return Vec::new();
  }

  let sample_rate_hz = view_sample_rate.max(1) as f64;
  let tx_sample_rate_hz = tx_sample_rate_hz.max(1.0);
  let half_view = sample_rate_hz / 2.0;
  let half_tx = tx_sample_rate_hz / 2.0;
  let view_min_hz = view_center_hz - half_view;
  let view_max_hz = view_center_hz + half_view;
  let tx_min_hz = tx_center_hz - half_tx;
  let tx_max_hz = tx_center_hz + half_tx;
  let overlaps_tx_window = view_max_hz >= tx_min_hz && view_min_hz <= tx_max_hz;
  let signal_key = if signal_name.trim().is_empty() {
    "apt".to_string()
  } else {
    signal_name.trim().to_ascii_lowercase()
  };
  let (_offset_hz, tone_hz, bandwidth_hz) =
    resolve_mock_tx_monitor_params(&signal_key, tx_sample_rate_hz);
  let tx_occupied_bandwidth_hz = tx_sample_rate_hz.min(sample_rate_hz).max(1.0);
  let tx_half_bandwidth_hz = tx_occupied_bandwidth_hz / 2.0;
  let effective_tone_hz = tone_hz.min((tx_half_bandwidth_hz * 0.25).max(1.0));
  let effective_bandwidth_hz =
    bandwidth_hz.min(tx_occupied_bandwidth_hz * 0.85).max(1.0);
  let start_sample =
    MOCK_TX_MONITOR_SAMPLE_CURSOR.fetch_add(fft_size as u64, Ordering::Relaxed);
  let quantized_power_floor_dbm =
    crate::safety::get_quantized_iq_power_floor_dbm(
      8,
      tx_ifft_size.max(1) as u32,
      power_model.calibration_db,
    )
    .ceil();
  let target_rms = mock_tx_monitor_target_rms_from_dbm(
    power_dbm.max(quantized_power_floor_dbm),
    power_model,
  );
  let noise_floor_rms = mock_tx_monitor_noise_floor_rms(power_model);
  let signal_abs_hz = tx_center_hz;
  let rel_hz = signal_abs_hz - view_center_hz;
  let signal_in_view = overlaps_tx_window && rel_hz.abs() <= half_view * 0.98;
  let phase_step = 2.0 * std::f64::consts::PI * rel_hz / sample_rate_hz;
  let mut signal_samples = vec![Complex::new(0.0_f32, 0.0_f32); fft_size];
  let mut noise_samples = vec![Complex::new(0.0_f32, 0.0_f32); fft_size];

  // Pre-calculate FM modulation constants to avoid recomputing in loop
  let w_sweep = 2.0 * std::f64::consts::PI * 0.25 / sample_rate_hz;
  let sweep_deviation_hz = 15_000.0_f64.min(tx_half_bandwidth_hz * 0.2);
  let mod_index_sweep = sweep_deviation_hz / 0.25;

  let w_drift = 2.0 * std::f64::consts::PI * 0.1 / sample_rate_hz;
  let drift_deviation_hz = 2_000.0_f64.min(tx_half_bandwidth_hz * 0.15);
  let mod_index_drift = drift_deviation_hz / 0.1;

  for j in 0..fft_size {
    let t = start_sample + j as u64;
    let t_f = t as f64;

    // Accumulate carrier phase for every sample to avoid jumps when phase_step changes (panning)
    *phase_accumulator += phase_step;
    // Prevent unbounded growth of phase_accumulator
    if *phase_accumulator > 2.0 * std::f64::consts::PI {
      *phase_accumulator -= 2.0 * std::f64::consts::PI;
    } else if *phase_accumulator < -2.0 * std::f64::consts::PI {
      *phase_accumulator += 2.0 * std::f64::consts::PI;
    }
    let carrier_phase = *phase_accumulator;

    let noise_i =
      mock_tx_noise_unit(t, 0x464c_4154_5458_4949) * noise_floor_rms;
    let noise_q =
      mock_tx_noise_unit(t, 0x464c_4154_5458_5151) * noise_floor_rms;
    noise_samples[j] = Complex::new(noise_i as f32, noise_q as f32);

    if !signal_in_view {
      continue;
    }

    // Dynamic phase calculation with continuous FM integration (no jumps)
    let phase = if signal_key == "tone" {
      carrier_phase + (t_f * w_sweep).sin() * mod_index_sweep
    } else if signal_key == "apt" {
      carrier_phase + (t_f * w_drift).cos() * mod_index_drift
    } else {
      carrier_phase
    };

    let (carrier_q, carrier_i) = phase.sin_cos();

    let (i, q) = match signal_key.as_str() {
      "carrier" => (carrier_i * target_rms, carrier_q * target_rms),
      "tone" => (carrier_i * target_rms, carrier_q * target_rms),
      "noise" => {
        // Multi-carrier noise hump simulation of bandwidth_hz (600 kHz)
        let mut i_sum = 0.0;
        let mut q_sum = 0.0;
        let num_carriers = 16;
        for k in 0..num_carriers {
          let fraction = (k as f64 / (num_carriers - 1) as f64) - 0.5;
          let freq_offset = fraction * effective_bandwidth_hz;
          let phase_noise =
            mock_tx_noise_unit(t / 256, k as u64) * std::f64::consts::PI;
          let phase_k = carrier_phase
            + (2.0 * std::f64::consts::PI * freq_offset * t_f / sample_rate_hz)
            + phase_noise;
          let (sin_k, cos_k) = phase_k.sin_cos();
          i_sum += cos_k;
          q_sum += sin_k;
        }
        let norm = (num_carriers as f64).sqrt();
        (i_sum * target_rms / norm, q_sum * target_rms / norm)
      }
      "custom" => {
        // Dynamic BPSK digital signal with 120 kHz symbol rate
        let symbol_rate = 120_000.0_f64.min(tx_occupied_bandwidth_hz / 8.0);
        let symbol_period =
          (sample_rate_hz / symbol_rate).round().max(1.0) as u64;
        let symbol_index = t / symbol_period;
        let mut hash = symbol_index.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        hash ^= hash >> 30;
        let bit = hash & 1;
        let symbol = if bit == 0 { -1.0 } else { 1.0 };
        (
          carrier_i * symbol * target_rms,
          carrier_q * symbol * target_rms,
        )
      }
      _ => {
        // AM subcarrier for the visual Mock Tx monitor without periodic blanking.
        let subcarrier = (2.0 * std::f64::consts::PI * effective_tone_hz * t_f
          / sample_rate_hz)
          .sin();
        let modulation = 0.78 + 0.22 * subcarrier;
        let apt_rms_correction = 1.0 / 0.795_f64;
        (
          carrier_i * modulation * target_rms * apt_rms_correction,
          carrier_q * modulation * target_rms * apt_rms_correction,
        )
      }
    };

    signal_samples[j] = Complex::new(i as f32, q as f32);
  }

  if signal_in_view {
    constrain_signal_to_tx_bandwidth(
      &mut signal_samples,
      rel_hz,
      tx_sample_rate_hz,
      sample_rate_hz,
    );
  }

  let mut out = Vec::with_capacity(fft_size * 2);
  for j in 0..fft_size {
    let t = start_sample + j as u64;
    let sample = signal_samples[j] + noise_samples[j];
    out.push(quantize_mock_tx_iq(
      sample.re as f64,
      t,
      0x544d_4f4e_4951_4949,
    ));
    out.push(quantize_mock_tx_iq(
      sample.im as f64,
      t,
      0x544d_4f4e_4951_5151,
    ));
  }

  out
}

#[cfg(test)]
mod tests {
  use super::*;

  const TEST_FFT_SIZE: usize = 65_536;
  const TEST_VIEW_SAMPLE_RATE_HZ: f64 = 3_200_000.0;
  const TEST_TX_SAMPLE_RATE_HZ: f64 = 100_000.0;
  const TEST_TX_POWER_DBM: f64 = -18.0;

  #[derive(Debug, Clone)]
  struct SpectrumBin {
    rel_hz: f64,
    dbm: f64,
  }

  fn iq_bin_dbm_at(frame: &[u8], rel_hz: f64, sample_rate_hz: f64) -> f64 {
    let sample_count = frame.len() / 2;
    if sample_count == 0 {
      return -150.0;
    }
    let mut acc_i = 0.0;
    let mut acc_q = 0.0;
    for (index, sample) in frame.chunks_exact(2).enumerate() {
      let i = (sample[0] as f64 - 128.0) / 128.0;
      let q = (sample[1] as f64 - 128.0) / 128.0;
      let phase =
        -2.0 * std::f64::consts::PI * rel_hz * index as f64 / sample_rate_hz;
      let (sin_phase, cos_phase) = phase.sin_cos();
      acc_i += i * cos_phase - q * sin_phase;
      acc_q += i * sin_phase + q * cos_phase;
    }
    let normalized_power =
      (acc_i * acc_i + acc_q * acc_q) / (sample_count * sample_count) as f64;
    10.0 * normalized_power.max(1e-15).log10()
      + TxIqPowerModel::default().calibration_db
  }

  fn max_dbm_between(
    frame: &[u8],
    min_rel_hz: f64,
    max_rel_hz: f64,
    step_hz: f64,
    sample_rate_hz: f64,
  ) -> f64 {
    let mut rel_hz = min_rel_hz;
    let mut max_dbm: f64 = -150.0;
    while rel_hz <= max_rel_hz {
      max_dbm = max_dbm.max(iq_bin_dbm_at(frame, rel_hz, sample_rate_hz));
      rel_hz += step_hz.max(1.0);
    }
    max_dbm
  }

  fn spectrum_dbm(frame: &[u8], sample_rate_hz: f64) -> Vec<SpectrumBin> {
    let sample_count = frame.len() / 2;
    let mut samples: Vec<Complex<f32>> = frame
      .chunks_exact(2)
      .map(|sample| {
        Complex::new(
          (sample[0] as f32 - 128.0) / 128.0,
          (sample[1] as f32 - 128.0) / 128.0,
        )
      })
      .collect();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(sample_count);
    fft.process(&mut samples);

    samples
      .iter()
      .enumerate()
      .map(|(index, bin)| {
        let rel_hz = if index <= sample_count / 2 {
          index as f64 * sample_rate_hz / sample_count as f64
        } else {
          -((sample_count - index) as f64 * sample_rate_hz
            / sample_count as f64)
        };
        let normalized_re = bin.re as f64 / sample_count as f64;
        let normalized_im = bin.im as f64 / sample_count as f64;
        let power =
          normalized_re * normalized_re + normalized_im * normalized_im;
        SpectrumBin {
          rel_hz,
          dbm: 10.0 * power.max(1e-15).log10()
            + TxIqPowerModel::default().calibration_db,
        }
      })
      .collect()
  }

  fn sorted_dbm(values: impl Iterator<Item = f64>) -> Vec<f64> {
    let mut values: Vec<f64> =
      values.filter(|value| value.is_finite()).collect();
    values.sort_by(|left, right| left.total_cmp(right));
    values
  }

  fn percentile_dbm(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
      return -150.0;
    }
    let index =
      ((values.len() - 1) as f64 * percentile.clamp(0.0, 1.0)).round() as usize;
    values[index]
  }

  fn occupied_bandwidth_hz(
    spectrum: &[SpectrumBin],
    threshold_dbm: f64,
  ) -> f64 {
    let active_bins: Vec<_> = spectrum
      .iter()
      .filter(|bin| bin.dbm >= threshold_dbm)
      .collect();
    if active_bins.is_empty() {
      return 0.0;
    }

    let min_hz = active_bins
      .iter()
      .fold(f64::INFINITY, |min, bin| min.min(bin.rel_hz));
    let max_hz = active_bins
      .iter()
      .fold(f64::NEG_INFINITY, |max, bin| max.max(bin.rel_hz));

    (max_hz - min_hz).max(0.0)
  }

  fn synthesize_test_frame(
    signal_name: &str,
    tx_sample_rate_hz: f64,
    power_dbm: f64,
  ) -> Vec<u8> {
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    synthesize_mock_tx_monitor_iq(
      TEST_FFT_SIZE,
      137_100_000.0,
      TEST_VIEW_SAMPLE_RATE_HZ as u32,
      137_100_000.0,
      tx_sample_rate_hz,
      signal_name,
      TEST_FFT_SIZE,
      power_dbm,
      &model,
      &mut 0.0,
    )
  }

  fn assert_tx_spectrum_contract(signal_name: &str) {
    let frame = synthesize_test_frame(
      signal_name,
      TEST_TX_SAMPLE_RATE_HZ,
      TEST_TX_POWER_DBM,
    );
    let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);
    let guard_hz = TEST_VIEW_SAMPLE_RATE_HZ / TEST_FFT_SIZE as f64 * 3.0;
    let tx_half_width_hz = TEST_TX_SAMPLE_RATE_HZ / 2.0;

    let in_band: Vec<_> = spectrum
      .iter()
      .filter(|bin| bin.rel_hz.abs() <= tx_half_width_hz + guard_hz)
      .collect();
    let far_left = sorted_dbm(
      spectrum
        .iter()
        .filter(|bin| {
          bin.rel_hz >= -1_400_000.0
            && bin.rel_hz <= -(tx_half_width_hz + 200_000.0)
        })
        .map(|bin| bin.dbm),
    );
    let far_right = sorted_dbm(
      spectrum
        .iter()
        .filter(|bin| {
          bin.rel_hz <= 1_400_000.0
            && bin.rel_hz >= tx_half_width_hz + 200_000.0
        })
        .map(|bin| bin.dbm),
    );
    let in_band_peak =
      in_band.iter().fold(-150.0_f64, |max, bin| max.max(bin.dbm));
    let outside_peak = spectrum
      .iter()
      .filter(|bin| bin.rel_hz.abs() > tx_half_width_hz + guard_hz)
      .fold(-150.0_f64, |max, bin| max.max(bin.dbm));
    let left_floor = percentile_dbm(&far_left, 0.50);
    let right_floor = percentile_dbm(&far_right, 0.50);
    let noise_floor_dbm = (left_floor + right_floor) / 2.0;
    let occupied_width_hz =
      occupied_bandwidth_hz(&spectrum, noise_floor_dbm + 18.0);
    let max_allowed_width_hz = TEST_TX_SAMPLE_RATE_HZ + guard_hz * 2.0;

    assert!(
      (left_floor - right_floor).abs() <= 3.0,
      "{signal_name} Tx noise floor should remain flat outside the Tx channel: left={left_floor:.2} dBm, right={right_floor:.2} dBm"
    );
    assert!(
      occupied_width_hz <= max_allowed_width_hz,
      "{signal_name} Tx occupied bandwidth exceeds configured Tx width: occupied={occupied_width_hz:.1} Hz, allowed={max_allowed_width_hz:.1} Hz, threshold={:.2} dBm",
      noise_floor_dbm + 18.0
    );
    assert!(
      outside_peak <= in_band_peak - 25.0,
      "{signal_name} Tx signal should stay constrained to configured bandwidth: in-band peak={in_band_peak:.2} dBm, outside peak={outside_peak:.2} dBm"
    );
    assert!(
      in_band_peak <= TEST_TX_POWER_DBM + 6.0,
      "{signal_name} Tx peak should stay near requested power: requested={TEST_TX_POWER_DBM:.2} dBm, peak={in_band_peak:.2} dBm"
    );
  }

  #[test]
  fn tx_monitor_narrow_bandwidth_suppresses_far_outside_shoulders() {
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let frame = synthesize_mock_tx_monitor_iq(
      65_536,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      100_000.0,
      "apt",
      65_536,
      -18.0,
      &model,
      &mut 0.0,
    );

    let center_dbm = iq_bin_dbm_at(&frame, 0.0, 3_200_000.0);
    let outside_dbm =
      max_dbm_between(&frame, 250_000.0, 1_400_000.0, 25_000.0, 3_200_000.0)
        .max(max_dbm_between(
          &frame,
          -1_400_000.0,
          -250_000.0,
          25_000.0,
          3_200_000.0,
        ));

    assert!(
      outside_dbm < center_dbm - 35.0,
      "narrow Tx bandwidth should not create broad shoulders outside the Tx window: center={center_dbm:.2} dBm, outside={outside_dbm:.2} dBm"
    );
  }

  #[test]
  fn tx_monitor_generated_signals_have_flat_noise_floor_and_constrained_shape()
  {
    for signal_name in ["apt", "tone", "carrier", "custom", "noise"] {
      assert_tx_spectrum_contract(signal_name);
    }
  }
}
