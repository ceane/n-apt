use std::sync::atomic::{AtomicU64, Ordering};
use crate::server::types::TxIqPowerModel;

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
  let _ = (sample_index, salt);
  let signed = (value.clamp(-1.0, 1.0) * 128.0).round();
  (128.0 + signed).clamp(0.0, 255.0) as u8
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
  let mut out = Vec::with_capacity(fft_size * 2);

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

    if !signal_in_view {
      out.push(quantize_mock_tx_iq(noise_i, t, 0x464c_4154_5458_4949));
      out.push(quantize_mock_tx_iq(noise_q, t, 0x464c_4154_5458_5151));
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

    out.push(quantize_mock_tx_iq(i + noise_i, t, 0x544d_4f4e_4951_4949));
    out.push(quantize_mock_tx_iq(q + noise_q, t, 0x544d_4f4e_4951_5151));
  }

  out
}
