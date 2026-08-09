use crate::server::types::TxIqPowerModel;
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::atomic::{AtomicU64, Ordering};

pub const MOCK_TX_DISPLAY_NAME: &str = "Mock Tx SDR";
pub static MOCK_TX_MONITOR_SAMPLE_CURSOR: AtomicU64 = AtomicU64::new(0);

const MOCK_TX_FRAME_NOISE_KEY: u64 = 0x5749_4649_5f46_524d;
const MOCK_TX_SAMPLE_NOISE_KEY: u64 = 0x534d_504c_5458_4741;
const MOCK_TX_I_DITHER_KEY: u64 = 0x544d_4f4e_4951_4949;
const MOCK_TX_Q_DITHER_KEY: u64 = 0x544d_4f4e_4951_5151;
const MOCK_TX_FLAT_I_NOISE_KEY: u64 = 0x464c_4154_5458_4949;
const MOCK_TX_FLAT_Q_NOISE_KEY: u64 = 0x464c_4154_5458_5151;
const MOCK_TX_QUANT_I_NOISE_KEY: u64 = 0x5155_414e_5458_4949;
const MOCK_TX_QUANT_Q_NOISE_KEY: u64 = 0x5155_414e_5458_5151;
const MOCK_TX_OFDM_SYMBOL_PHASE_KEY: u64 = 0x4f46_444d_5359_4d42;
// Keep enough one-code ADC excursions in every monitor frame that the FFT sees
// a noise process rather than one or two isolated impulses. This is output
// quantization support, separate from the configured receiver-noise RMS.
const MOCK_TX_QUANTIZATION_SUPPORT_AMPLITUDE: f64 = 1.0 / (128.0 * 16.0);
// Keep the mock monitor faithful to a hardware receiver's centered DC offset.
// Raw IQ consumers see it; the display's optional compute stage can remove it.
const MOCK_TX_DC_OFFSET: f64 = 0.01;

fn mock_tx_noise_unit(sample_index: u64, noise_key: u64) -> f64 {
  let mut x = sample_index
    .wrapping_mul(0x9E37_79B9_7F4A_7C15)
    .wrapping_add(noise_key);
  x ^= x >> 30;
  x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
  x ^= x >> 27;
  x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
  x ^= x >> 31;
  ((x >> 11) as f64 / ((1u64 << 53) as f64)) * 2.0 - 1.0
}

fn mock_tx_monitor_output_noise(
  sample_index: u64,
  receiver_noise_key: u64,
  quantization_noise_key: u64,
  receiver_noise_rms: f64,
) -> f64 {
  mock_tx_noise_unit(sample_index, receiver_noise_key) * receiver_noise_rms
    + mock_tx_noise_unit(sample_index, quantization_noise_key)
      * MOCK_TX_QUANTIZATION_SUPPORT_AMPLITUDE
}

fn wifi_5g_motion_gain(signal_name: &str, frame_seed: u64) -> f64 {
  if signal_name != "wifi" && signal_name != "5g" {
    return 1.0;
  }

  // Keep the gain constant across one monitor FFT window. Per-sample gain
  // modulation smears the OFDM flat top, especially for large FFT sizes.
  let frame_noise = mock_tx_noise_unit(frame_seed, MOCK_TX_FRAME_NOISE_KEY);
  // Keep the requested signal level as the floor while still making the
  // monitor trace breathe between cycles.
  (1.0 + 0.14 * ((frame_noise + 1.0) * 0.5)).clamp(1.0, 1.14)
}

fn mock_tx_ofdm_symbol_rotation(symbol_index: u64) -> (f64, f64) {
  let phase = (mock_tx_noise_unit(symbol_index, MOCK_TX_OFDM_SYMBOL_PHASE_KEY)
    + 1.0)
    * std::f64::consts::PI;
  phase.sin_cos()
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

fn quantize_mock_tx_iq(value: f64, sample_index: u64, noise_key: u64) -> u8 {
  let scaled = value.clamp(-1.0, 1.0) * 128.0;
  let lower = scaled.floor();
  let fraction = scaled - lower;
  let dither = (mock_tx_noise_unit(sample_index, noise_key) + 1.0) * 0.5;
  let signed = lower + if dither < fraction { 1.0 } else { 0.0 };
  (128.0 + signed).clamp(0.0, 255.0) as u8
}

use std::cell::RefCell;

thread_local! {
  static PLANNER: RefCell<FftPlanner<f32>> = RefCell::new(FftPlanner::new());
}

fn clamp_raw_iq_to_bandwidth(
  iq: &mut [Complex<f64>],
  rel_center_hz: f64,
  width_bandwidth_hz: f64,
  view_sample_rate_hz: f64,
) {
  let sample_count = iq.len();
  if sample_count == 0
    || !rel_center_hz.is_finite()
    || !width_bandwidth_hz.is_finite()
    || !view_sample_rate_hz.is_finite()
  {
    return;
  }

  let half_width_hz = width_bandwidth_hz.max(1.0) / 2.0;
  let bin_width_hz = view_sample_rate_hz.max(1.0) / sample_count as f64;
  let guard_hz = bin_width_hz * 2.0;

  let mut iq_f32: Vec<Complex<f32>> = iq
    .iter()
    .map(|c| Complex::new(c.re as f32, c.im as f32))
    .collect();

  let (fft, ifft) = PLANNER.with(|p| {
    let mut planner = p.borrow_mut();
    (
      planner.plan_fft_forward(sample_count),
      planner.plan_fft_inverse(sample_count),
    )
  });

  fft.process(&mut iq_f32);

  for (index, bin) in iq_f32.iter_mut().enumerate() {
    let bin_hz = if index <= sample_count / 2 {
      index as f64 * bin_width_hz
    } else {
      -((sample_count - index) as f64 * bin_width_hz)
    };
    if (bin_hz - rel_center_hz).abs() > half_width_hz + guard_hz {
      *bin = Complex::new(0.0, 0.0);
    }
  }

  ifft.process(&mut iq_f32);
  let scale = 1.0 / sample_count as f64;
  for (index, sample) in iq_f32.iter().enumerate() {
    iq[index] =
      Complex::new(sample.re as f64 * scale, sample.im as f64 * scale);
  }
}

fn complex_spectral_peak_raw(iq: &[Complex<f64>]) -> f64 {
  if iq.is_empty() {
    return 0.0;
  }

  let mut spectrum: Vec<Complex<f32>> = iq
    .iter()
    .map(|sample| Complex::new(sample.re as f32, sample.im as f32))
    .collect();
  let mut planner = FftPlanner::<f32>::new();
  let fft = planner.plan_fft_forward(spectrum.len());
  fft.process(&mut spectrum);
  spectrum
    .iter()
    .map(|bin| bin.norm() as f64 / iq.len() as f64)
    .fold(0.0_f64, f64::max)
}

fn complex_rms_raw(iq: &[Complex<f64>]) -> f64 {
  if iq.is_empty() {
    return 0.0;
  }
  (iq.iter().map(|sample| sample.norm_sqr()).sum::<f64>() / iq.len() as f64)
    .sqrt()
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
  mock_tx_monitor_target_rms_from_dbm(
    resolve_mock_tx_noise_floor_db(),
    power_model,
  )
}

use std::sync::{Arc, LazyLock, Mutex};

use crate::s::ifft::complex_baseband::{
  canonical_complex_baseband_signal_key, ComplexBasebandIQGenerator,
  ComplexBasebandIQParams,
};

struct ComplexBasebandIQBuffer {
  params: Option<ComplexBasebandIQParams>,
  samples: Arc<Vec<Complex<f32>>>,
  generator: ComplexBasebandIQGenerator,
}

impl ComplexBasebandIQBuffer {
  fn new() -> Self {
    Self {
      params: None,
      samples: Arc::new(Vec::new()),
      generator: ComplexBasebandIQGenerator::new(),
    }
  }

  fn prepare(&mut self, params: &ComplexBasebandIQParams) {
    if self.params.as_ref() == Some(params)
      && !self.samples.is_empty()
      && self.samples.len() == params.tx_ifft_size
    {
      return;
    }

    self
      .generator
      .generate_into(params, Arc::make_mut(&mut self.samples));
    self.params = Some(params.clone());
  }

  fn snapshot_samples(&self) -> Arc<Vec<Complex<f32>>> {
    Arc::clone(&self.samples)
  }
}

static COMPLEX_BASEBAND_IQ_CACHE: LazyLock<Mutex<ComplexBasebandIQBuffer>> =
  LazyLock::new(|| Mutex::new(ComplexBasebandIQBuffer::new()));

/// Test-only lock that serializes cursor-reset + synthesize pairs so parallel
/// tests cannot race on MOCK_TX_MONITOR_SAMPLE_CURSOR or COMPLEX_BASEBAND_IQ_CACHE.
#[cfg(test)]
pub(crate) static MOCK_TX_TEST_LOCK: Mutex<()> = Mutex::new(());

pub fn synthesize_mock_tx_monitor_iq(
  fft_size: usize,
  view_center_hz: f64,
  view_sample_rate: u32,
  tx_center_hz: f64,
  tx_bandwidth_hz: f64,
  signal_name: &str,
  tx_ifft_size: usize,
  power_dbm: f64,
  power_model: &TxIqPowerModel,
  phase_accumulator: &mut f64,
) -> Vec<u8> {
  #[cfg(test)]
  let _cwd_guard = crate::server::utils::cwd_lock().lock().unwrap();

  if fft_size == 0 {
    return Vec::new();
  }

  let sample_rate_hz = view_sample_rate.max(1) as f64;
  let signal_key = canonical_complex_baseband_signal_key(signal_name);
  let is_ofdm = signal_key == "wifi" || signal_key == "5g";
  let motion_signal_key = signal_key.clone();

  let settings = crate::server::utils::load_mock_tx_settings();
  let preset = settings
    .signals
    .get(&signal_key)
    .or_else(|| settings.signals.get("wifi"));

  let target_bandwidth_hz = if tx_bandwidth_hz > 0.0 {
    tx_bandwidth_hz
  } else {
    preset
      .and_then(|p| p.bandwidth_hz)
      .unwrap_or(sample_rate_hz)
  };

  let tx_occupied_bandwidth_hz =
    target_bandwidth_hz.min(sample_rate_hz).max(1.0);
  let effective_bandwidth_hz = tx_occupied_bandwidth_hz;

  let offset_hz = preset.and_then(|p| p.offset_hz).unwrap_or(0.0);
  let offset_hz = offset_hz.clamp(
    -tx_occupied_bandwidth_hz * 0.85 / 2.0,
    tx_occupied_bandwidth_hz * 0.85 / 2.0,
  );

  // Emit the offset to place the signal at the requested display frequency.
  let rel_hz = tx_center_hz - view_center_hz + offset_hz;

  let half_bw = effective_bandwidth_hz / 2.0;
  let max_offset = sample_rate_hz / 2.0;
  let is_offscreen = rel_hz.abs() - half_bw >= max_offset;

  let quantized_power_floor_dbm =
    crate::safety::get_quantized_iq_power_floor_dbm(
      8,
      tx_ifft_size.max(1) as u32,
      power_model.calibration_db,
    )
    .ceil();
  let target_rms = if is_offscreen {
    0.0
  } else {
    mock_tx_monitor_target_rms_from_dbm(
      power_dbm.max(quantized_power_floor_dbm),
      power_model,
    )
  };
  let noise_floor_rms = mock_tx_monitor_noise_floor_rms(power_model);
  // A monitor frame is measured by the browser at `fft_size`. Bound the
  // generated IFFT block to that frame so a longer configured Tx IFFT cannot
  // put the visible power into samples the browser will discard.
  let render_ifft_size = tx_ifft_size.min(fft_size).clamp(256, 262_144);
  let start_sample =
    MOCK_TX_MONITOR_SAMPLE_CURSOR.fetch_add(fft_size as u64, Ordering::Relaxed);

  let frame_seed = start_sample / fft_size.max(1) as u64;
  let frame_motion_gain = wifi_5g_motion_gain(&motion_signal_key, frame_seed);

  // Regenerate the OFDM subcarrier amplitudes and phases for every monitor
  // frame. A fixed seed makes the cached IFFT block identical forever, so
  // the display can only jiggle from gain/noise even though the signal shape
  // should be changing.
  let phase_seed = if is_ofdm || signal_key == "d" || signal_key == "d_sharp" {
    frame_seed.wrapping_add(1)
  } else {
    0
  };

  let current_params = ComplexBasebandIQParams {
    signal_key,
    sample_rate_hz,
    bandwidth_hz: effective_bandwidth_hz,
    tx_ifft_size: render_ifft_size,
    phase_seed,
  };

  // Read or compute cached IFFT block
  let block = {
    let mut cache = COMPLEX_BASEBAND_IQ_CACHE.lock().unwrap();
    cache.prepare(&current_params);
    cache.snapshot_samples()
  };
  let block_peak = if is_ofdm {
    let block_iq: Vec<Complex<f64>> = block
      .iter()
      .map(|sample| Complex::new(sample.re as f64, sample.im as f64))
      .collect();
    complex_spectral_peak_raw(&block_iq)
  } else {
    1.0
  };
  let signal_amplitude = if block_peak > 0.0 {
    target_rms / block_peak
  } else {
    0.0
  };
  let phase_step = 2.0 * std::f64::consts::PI * rel_hz / sample_rate_hz;
  let mut signal_iq = Vec::with_capacity(fft_size);

  for j in 0..fft_size {
    let t = start_sample + j as u64;

    // Accumulate carrier phase continuously to avoid tuning/panning clicks
    *phase_accumulator += phase_step;
    if *phase_accumulator > 2.0 * std::f64::consts::PI {
      *phase_accumulator -= 2.0 * std::f64::consts::PI;
    } else if *phase_accumulator < -2.0 * std::f64::consts::PI {
      *phase_accumulator += 2.0 * std::f64::consts::PI;
    }

    let (sin_p, cos_p) = phase_accumulator.sin_cos();
    let sample_motion_gain = if is_ofdm && render_ifft_size <= 2_048 {
      1.0 + 0.06 * mock_tx_noise_unit(t ^ frame_seed, MOCK_TX_SAMPLE_NOISE_KEY)
    } else {
      1.0
    };

    // Loop baseband block sample and mix to carrier frequency offset
    let block_sample = block[(t as usize) % render_ifft_size];
    let (symbol_sin, symbol_cos) = if is_ofdm {
      mock_tx_ofdm_symbol_rotation(t / render_ifft_size.max(1) as u64)
    } else {
      (0.0, 1.0)
    };
    let symbol_re =
      block_sample.re as f64 * symbol_cos - block_sample.im as f64 * symbol_sin;
    let symbol_im =
      block_sample.re as f64 * symbol_sin + block_sample.im as f64 * symbol_cos;
    let i_sig = (symbol_re * cos_p - symbol_im * sin_p)
      * signal_amplitude
      * sample_motion_gain;
    let q_sig = (symbol_re * sin_p + symbol_im * cos_p)
      * signal_amplitude
      * sample_motion_gain;

    signal_iq.push(Complex::new(i_sig, q_sig));
  }
  // Apply receiver anti-aliasing filter logic
  if is_offscreen {
    for sample in signal_iq.iter_mut() {
      *sample = Complex::new(0.0, 0.0);
    }
  } else {
    clamp_raw_iq_to_bandwidth(
      &mut signal_iq,
      rel_hz,
      effective_bandwidth_hz,
      sample_rate_hz,
    );

    // Small render blocks are displayed by their strongest spectral line.
    // Large blocks represent the shader's integrated complex-RMS power; using
    // a per-bin peak there would require clipping a wide OFDM waveform.
    let filtered_level = if is_ofdm && render_ifft_size > 2_048 {
      complex_rms_raw(&signal_iq)
    } else {
      complex_spectral_peak_raw(&signal_iq)
    };
    if filtered_level > 0.0 {
      let factor = target_rms / filtered_level;
      for sample in signal_iq.iter_mut() {
        *sample = *sample * factor;
      }
      let max_sample = signal_iq
        .iter()
        .fold(0.0_f64, |m, s| m.max(s.re.abs().max(s.im.abs())));
      if max_sample > 0.99 {
        let scale = 0.99 / max_sample;
        for sample in signal_iq.iter_mut() {
          *sample = *sample * scale;
        }
      }
    }
  }

  // Animate the displayed signal once per monitor frame, after normalization,
  // so the level changes without changing the spectral envelope.
  if frame_motion_gain != 1.0 {
    for sample in signal_iq.iter_mut() {
      *sample = *sample * frame_motion_gain;
    }

    let max_sample = signal_iq
      .iter()
      .fold(0.0_f64, |m, s| m.max(s.re.abs().max(s.im.abs())));
    if max_sample > 0.99 {
      let scale = 0.99 / max_sample;
      for sample in signal_iq.iter_mut() {
        *sample = *sample * scale;
      }
    }
  }

  // The monitor is an IQ stream, so preserve the receiver DC offset in the
  // generated samples. This is intentionally added after signal filtering so
  // an off-screen Tx still produces the centered spike.
  for sample in signal_iq.iter_mut() {
    sample.re += MOCK_TX_DC_OFFSET;
  }

  // Generate output frame with noise added AFTER signal filtering/scaling
  let mut out = Vec::with_capacity(fft_size * 2);
  for j in 0..fft_size {
    let t = start_sample + j as u64;
    let sig = signal_iq[j];

    let noise_i = mock_tx_monitor_output_noise(
      t,
      MOCK_TX_FLAT_I_NOISE_KEY,
      MOCK_TX_QUANT_I_NOISE_KEY,
      noise_floor_rms,
    );
    let noise_q = mock_tx_monitor_output_noise(
      t,
      MOCK_TX_FLAT_Q_NOISE_KEY,
      MOCK_TX_QUANT_Q_NOISE_KEY,
      noise_floor_rms,
    );

    let i_val = sig.re + noise_i;
    let q_val = sig.im + noise_q;

    out.push(quantize_mock_tx_iq(i_val, t, MOCK_TX_I_DITHER_KEY));
    out.push(quantize_mock_tx_iq(q_val, t, MOCK_TX_Q_DITHER_KEY));
  }

  out
}

#[cfg(test)]
mod tests {
  use super::*;

  const TEST_FFT_SIZE: usize = 65_536;
  const TEST_VIEW_SAMPLE_RATE_HZ: f64 = 3_200_000.0;
  const TEST_TX_BANDWIDTH_HZ: f64 = 100_000.0;
  const TEST_TX_POWER_DBM: f64 = -18.0;

  #[derive(Debug, Clone)]
  struct SpectrumBin {
    rel_hz: f64,
    dbm: f64,
  }

  fn max_dbm_between(
    spectrum: &[SpectrumBin],
    min_rel_hz: f64,
    max_rel_hz: f64,
  ) -> f64 {
    spectrum
      .iter()
      .filter(|b| b.rel_hz >= min_rel_hz && b.rel_hz <= max_rel_hz)
      .fold(-150.0_f64, |max, b| max.max(b.dbm))
  }

  fn spectrum_dbm_including_dc(
    frame: &[u8],
    sample_rate_hz: f64,
  ) -> Vec<SpectrumBin> {
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

  // Existing Mock Tx shape/power assertions are about the requested carrier,
  // not the intentionally modeled receiver DC offset. Keep those checks
  // focused on non-DC bins while the dedicated DC test uses the full helper.
  fn spectrum_dbm(frame: &[u8], sample_rate_hz: f64) -> Vec<SpectrumBin> {
    let mut spectrum = spectrum_dbm_including_dc(frame, sample_rate_hz);
    if let Some(dc) = spectrum.first_mut() {
      dc.dbm = -150.0;
    }
    spectrum
  }

  fn spectrum_dbm_from_iq(
    samples: &[Complex<f64>],
    sample_rate_hz: f64,
  ) -> Vec<SpectrumBin> {
    let sample_count = samples.len();
    let mut samples: Vec<Complex<f32>> = samples
      .iter()
      .map(|sample| Complex::new(sample.re as f32, sample.im as f32))
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

  fn integrated_dbm(spectrum: &[SpectrumBin]) -> f64 {
    let calibration_db = TxIqPowerModel::default().calibration_db;
    let normalized_power = spectrum
      .iter()
      .map(|bin| 10.0f64.powf((bin.dbm - calibration_db) / 10.0))
      .sum::<f64>();
    10.0 * normalized_power.max(1e-15).log10() + calibration_db
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

  fn synthesize_test_frame(
    signal_name: &str,
    tx_bandwidth_hz: f64,
    power_dbm: f64,
  ) -> Vec<u8> {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    synthesize_mock_tx_monitor_iq(
      TEST_FFT_SIZE,
      137_100_000.0,
      TEST_VIEW_SAMPLE_RATE_HZ as u32,
      137_100_000.0,
      tx_bandwidth_hz,
      signal_name,
      2048,
      power_dbm,
      &model,
      &mut 0.0,
    )
  }

  #[test]
  fn mock_tx_monitor_emits_a_centered_dc_spike_when_signal_is_offscreen() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let frame = synthesize_mock_tx_monitor_iq(
      TEST_FFT_SIZE,
      137_100_000.0,
      TEST_VIEW_SAMPLE_RATE_HZ as u32,
      150_000_000.0,
      TEST_TX_BANDWIDTH_HZ,
      "wifi",
      2_048,
      TEST_TX_POWER_DBM,
      &model,
      &mut 0.0,
    );
    let spectrum = spectrum_dbm_including_dc(&frame, TEST_VIEW_SAMPLE_RATE_HZ);
    // The backend emits ordinary (unshifted) FFT order. The UI centers this
    // bin when it prepares the display spectrum.
    let dc = 0;
    let adjacent = (spectrum[1].dbm + spectrum[spectrum.len() - 1].dbm) * 0.5;

    assert!(
      spectrum[dc].dbm > adjacent + 12.0,
      "Mock Tx DC bin should be visibly above its neighbors: center={:.2} dBm adjacent={adjacent:.2} dBm",
      spectrum[dc].dbm,
    );
  }

  fn synthesize_test_frame_with_view_and_ifft(
    signal_name: &str,
    view_sample_rate_hz: f64,
    tx_bandwidth_hz: f64,
    tx_ifft_size: usize,
    power_dbm: f64,
  ) -> Vec<u8> {
    synthesize_test_frame_with_fft_and_view_and_ifft(
      TEST_FFT_SIZE,
      signal_name,
      view_sample_rate_hz,
      tx_bandwidth_hz,
      tx_ifft_size,
      power_dbm,
    )
  }

  fn synthesize_test_frame_with_fft_and_view_and_ifft(
    fft_size: usize,
    signal_name: &str,
    view_sample_rate_hz: f64,
    tx_bandwidth_hz: f64,
    tx_ifft_size: usize,
    power_dbm: f64,
  ) -> Vec<u8> {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    synthesize_mock_tx_monitor_iq(
      fft_size,
      137_100_000.0,
      view_sample_rate_hz as u32,
      137_100_000.0,
      tx_bandwidth_hz,
      signal_name,
      tx_ifft_size,
      power_dbm,
      &model,
      &mut 0.0,
    )
  }

  fn synthesize_test_frame_with_custom_centers(
    signal_name: &str,
    view_center_hz: f64,
    tx_center_hz: f64,
    tx_bandwidth_hz: f64,
    power_dbm: f64,
  ) -> Vec<u8> {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    synthesize_mock_tx_monitor_iq(
      TEST_FFT_SIZE,
      view_center_hz,
      TEST_VIEW_SAMPLE_RATE_HZ as u32,
      tx_center_hz,
      tx_bandwidth_hz,
      signal_name,
      2048,
      power_dbm,
      &model,
      &mut 0.0,
    )
  }

  fn expected_flat_noise_frame(
    sample_count: usize,
    power_model: &TxIqPowerModel,
  ) -> Vec<u8> {
    let noise_floor_rms = mock_tx_monitor_noise_floor_rms(power_model);
    (0..sample_count)
      .flat_map(|j| {
        let t = j as u64;
        let noise_i = mock_tx_monitor_output_noise(
          t,
          MOCK_TX_FLAT_I_NOISE_KEY,
          MOCK_TX_QUANT_I_NOISE_KEY,
          noise_floor_rms,
        );
        let noise_q = mock_tx_monitor_output_noise(
          t,
          MOCK_TX_FLAT_Q_NOISE_KEY,
          MOCK_TX_QUANT_Q_NOISE_KEY,
          noise_floor_rms,
        );
        [
          quantize_mock_tx_iq(
            noise_i + MOCK_TX_DC_OFFSET,
            t,
            MOCK_TX_I_DITHER_KEY,
          ),
          quantize_mock_tx_iq(noise_q, t, MOCK_TX_Q_DITHER_KEY),
        ]
      })
      .collect()
  }

  fn subtract_frames_as_iq(left: &[u8], right: &[u8]) -> Vec<Complex<f64>> {
    left
      .chunks_exact(2)
      .zip(right.chunks_exact(2))
      .map(|(left, right)| {
        Complex::new(
          (left[0] as f64 - right[0] as f64) / 128.0,
          (left[1] as f64 - right[1] as f64) / 128.0,
        )
      })
      .collect()
  }

  #[test]
  fn mock_tx_centers_align_correctly() {
    let view_center_hz = 137_100_000.0;
    let tx_center_hz = 138_100_000.0; // 1 MHz offset

    let frame = synthesize_test_frame_with_custom_centers(
      "am", // Simple AM carrier with no preset offset
      view_center_hz,
      tx_center_hz,
      10_000.0,
      TEST_TX_POWER_DBM,
    );
    let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);

    let peak_bin = spectrum
      .iter()
      .max_by(|a, b| a.dbm.total_cmp(&b.dbm))
      .unwrap();

    // The generator uses a 2048-point IFFT at 3.2 MHz, so its bins are 1562.5 Hz wide.
    // This means any signal frequency will be quantized to a multiple of 1562.5 Hz.
    // 1,000,000 Hz maps to bin 640 or 641 (641 * 1562.5 = 1,001,562.5 Hz).
    // So the peak in the output spectrum should be within ~1600 Hz of 1,000,000 Hz.
    assert!(
      (peak_bin.rel_hz - 1_000_000.0).abs() <= 1600.0,
      "Expected peak near 1,000,000 Hz, found at {} Hz",
      peak_bin.rel_hz
    );
  }

  fn assert_tx_spectrum_contract(signal_name: &str) {
    let frame = synthesize_test_frame(
      signal_name,
      TEST_TX_BANDWIDTH_HZ,
      TEST_TX_POWER_DBM,
    );
    let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);
    let bin_width_hz = TEST_VIEW_SAMPLE_RATE_HZ / TEST_FFT_SIZE as f64;
    // Small guard for FFT bin quantization at band edges
    let guard_hz = bin_width_hz * 3.0;
    let tx_half_width_hz = TEST_TX_BANDWIDTH_HZ / 2.0;

    let in_band: Vec<_> = spectrum
      .iter()
      .filter(|bin| bin.rel_hz.abs() <= tx_half_width_hz + guard_hz)
      .collect();
    let far_left = sorted_dbm(
      spectrum
        .iter()
        .filter(|bin| {
          bin.rel_hz >= -1_400_000.0
            && bin.rel_hz <= -(tx_half_width_hz + 100_000.0)
        })
        .map(|bin| bin.dbm),
    );
    let far_right = sorted_dbm(
      spectrum
        .iter()
        .filter(|bin| {
          bin.rel_hz <= 1_400_000.0
            && bin.rel_hz >= tx_half_width_hz + 100_000.0
        })
        .map(|bin| bin.dbm),
    );
    let in_band_peak =
      in_band.iter().fold(-150.0_f64, |max, bin| max.max(bin.dbm));
    let outside = sorted_dbm(
      spectrum
        .iter()
        .filter(|bin| bin.rel_hz.abs() > tx_half_width_hz + guard_hz)
        .map(|bin| bin.dbm),
    );
    let outside_peak = percentile_dbm(&outside, 0.99);
    let left_floor = percentile_dbm(&far_left, 0.50);
    let right_floor = percentile_dbm(&far_right, 0.50);
    assert!(
      (left_floor - right_floor).abs() <= 3.0,
      "{signal_name} Tx noise floor should remain flat outside the \
       Tx channel: left={left_floor:.2} dBm, right={right_floor:.2} dBm"
    );
    // Tightened: out-of-band peak must be >= 40 dB below in-band peak
    assert!(
      outside_peak <= in_band_peak - 40.0,
      "{signal_name} Tx signal should stay constrained to configured \
       bandwidth: in-band peak={in_band_peak:.2} dBm, \
       outside peak={outside_peak:.2} dBm, \
       delta={:.2} dB (need >= 40 dB)",
      in_band_peak - outside_peak,
    );
    // Tightened: peak must be within ±3 dB of requested power
    assert!(
      in_band_peak <= TEST_TX_POWER_DBM + 3.0,
      "{signal_name} Tx peak should stay near requested power: \
       requested={TEST_TX_POWER_DBM:.2} dBm, peak={in_band_peak:.2} dBm"
    );
    assert!(
      in_band_peak >= TEST_TX_POWER_DBM - 3.0,
      "{signal_name} Tx peak too far below requested power: \
       requested={TEST_TX_POWER_DBM:.2} dBm, peak={in_band_peak:.2} dBm"
    );
  }

  #[test]
  fn tx_monitor_narrow_bandwidth_suppresses_far_outside_shoulders() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let frame = synthesize_mock_tx_monitor_iq(
      TEST_FFT_SIZE,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      100_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut 0.0,
    );

    let spectrum = spectrum_dbm(&frame, 3_200_000.0);
    let center_dbm = max_dbm_between(&spectrum, -50000.0, 50000.0);
    let outside_dbm = max_dbm_between(&spectrum, 250_000.0, 1_400_000.0)
      .max(max_dbm_between(&spectrum, -1_400_000.0, -250_000.0));

    assert!(
      outside_dbm < center_dbm - 40.0,
      "narrow Tx bandwidth should not create broad shoulders outside \
       the Tx window: center={center_dbm:.2} dBm, \
       outside={outside_dbm:.2} dBm, \
       delta={:.2} dB (need >= 40 dB)",
      center_dbm - outside_dbm,
    );
  }

  #[test]
  fn tx_monitor_bandwidth_drop_keeps_first_frame_within_new_bandwidth() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);

    let _wide_frame = synthesize_mock_tx_monitor_iq(
      TEST_FFT_SIZE,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut 0.0,
    );

    let narrow_frame = synthesize_mock_tx_monitor_iq(
      TEST_FFT_SIZE,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      1_200_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut 0.0,
    );

    let spectrum = spectrum_dbm(&narrow_frame, 3_200_000.0);
    let narrow_half_bw = 1_200_000.0 / 2.0;
    let outside_dbm =
      max_dbm_between(&spectrum, narrow_half_bw + 200_000.0, 1_400_000.0).max(
        max_dbm_between(&spectrum, -1_400_000.0, -(narrow_half_bw + 200_000.0)),
      );
    let center_dbm = max_dbm_between(&spectrum, -50_000.0, 50_000.0);

    assert!(
      outside_dbm <= center_dbm - 18.0,
      "first frame after bandwidth decrease should stay inside the new \
       bandwidth: center={center_dbm:.2} dBm, outside={outside_dbm:.2} dBm"
    );
  }

  #[test]
  fn tx_monitor_generated_signals_have_flat_noise_floor_and_constrained_shape()
  {
    for signal_name in ["d", "d_sharp", "wifi", "5g"] {
      assert_tx_spectrum_contract(signal_name);
    }
  }

  /// Spectral mask test: verify that signal energy at specific offsets
  /// from the band edge drops below threshold.
  #[test]
  fn tx_monitor_spectral_mask_at_band_edges() {
    for signal_name in ["d", "d_sharp", "wifi", "5g"] {
      let frame = synthesize_test_frame(signal_name, TEST_TX_BANDWIDTH_HZ, 0.0);
      let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);
      let tx_half_width_hz = TEST_TX_BANDWIDTH_HZ / 2.0;
      let in_band_peak = spectrum
        .iter()
        .filter(|b| b.rel_hz.abs() <= tx_half_width_hz)
        .fold(-150.0_f64, |max, b| max.max(b.dbm));

      // Check at 2x the Tx bandwidth offset: must be >= 50 dB below peak
      let far_offset_hz = tx_half_width_hz * 2.0;
      let far_peak = spectrum
        .iter()
        .filter(|b| {
          b.rel_hz.abs() >= far_offset_hz
            && b.rel_hz.abs() <= far_offset_hz + 50_000.0
        })
        .fold(-150.0_f64, |max, b| max.max(b.dbm));

      assert!(
        far_peak <= in_band_peak - 28.0,
        "{signal_name} spectral mask violated at 2x bandwidth offset: \
         in-band peak={in_band_peak:.2} dBm, far peak={far_peak:.2} dBm, \
         delta={:.2} dB (need >= 28 dB)",
        in_band_peak - far_peak,
      );
    }
  }

  #[test]
  fn tx_monitor_explicit_power_and_bandwidth() {
    let signals = vec![
      ("d", 100_000.0, 100_000.0),
      ("d_sharp", 100_000.0, 100_000.0),
      ("wifi", 100_000.0, 100_000.0),
      ("5g", 100_000.0, 100_000.0),
    ];
    for (signal_name, tx_rate, expected_bw) in signals {
      let power_dbm = -20.0;
      let frame = synthesize_test_frame(signal_name, tx_rate, power_dbm);
      let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);

      let peak_power = max_dbm_between(
        &spectrum,
        -TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
        TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
      );

      // Explicit power check: Height matches requested precisely
      let power_error = (peak_power - power_dbm).abs();
      assert!(
        power_error <= 3.0,
        "[{signal_name}] Explicit power test: peak power {peak_power:.1} dBm deviates from target {power_dbm} by {power_error:.1} dB",
      );

      // Explicit bandwidth check: Width matches requested boundaries precisely
      // We check that energy strictly drops off beyond the dotted lines boundary.
      let half_bw = expected_bw / 2.0;
      let margin_hz = expected_bw * 0.15; // 15% margin for modulation FM sidelobes
      let outside_peak = spectrum
        .iter()
        .filter(|b| b.rel_hz.abs() > half_bw + margin_hz)
        .fold(-150.0_f64, |max, b| max.max(b.dbm));

      assert!(
        outside_peak <= peak_power - 30.0,
        "[{signal_name}] Explicit bandwidth test: energy outside ±{:.1}kHz exceeds limit. Peak: {:.1}dBm, Outside peak: {:.1}dBm",
        (half_bw + margin_hz) / 1000.0,
        peak_power,
        outside_peak
      );
    }
  }

  #[test]
  fn tx_monitor_power_matches_when_synthesized_at_large_frontend_ifft_size() {
    let power_dbm = -18.0;
    let frontend_ifft_size = 65_536;
    let backend_fft_size = frontend_ifft_size;
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let frame = synthesize_mock_tx_monitor_iq(
      backend_fft_size,
      137_100_000.0,
      TEST_VIEW_SAMPLE_RATE_HZ as u32,
      137_100_000.0,
      1_500_000.0,
      "d",
      frontend_ifft_size,
      power_dbm,
      &model,
      &mut 0.0,
    );

    let mut padded_iq: Vec<Complex<f32>> =
      Vec::with_capacity(frontend_ifft_size);
    for chunk in frame.chunks_exact(2) {
      padded_iq.push(Complex::new(
        (chunk[0] as f32 - 128.0) / 128.0,
        (chunk[1] as f32 - 128.0) / 128.0,
      ));
    }
    padded_iq.resize(frontend_ifft_size, Complex::new(0.0, 0.0));
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(frontend_ifft_size);
    fft.process(&mut padded_iq);

    let peak_power = padded_iq
      .iter()
      .map(|bin| {
        let norm_re = bin.re as f64 / frontend_ifft_size as f64;
        let norm_im = bin.im as f64 / frontend_ifft_size as f64;
        10.0 * (norm_re * norm_re + norm_im * norm_im).max(1e-15).log10()
          + model.calibration_db
      })
      .fold(-150.0_f64, f64::max);

    let power_error = (peak_power - power_dbm).abs();
    assert!(
      power_error <= 3.0,
      "Zero-padded frontend FFT size ({frontend_ifft_size}) peak power ({peak_power:.1} dBm) deviates from target ({power_dbm} dBm) by {power_error:.1} dB",
    );
  }

  #[test]
  fn tx_monitor_power_matches_across_frontend_fft_and_tx_ifft_sizes() {
    let cases = [
      (2_048, 2_048, 3_200_000.0),
      (8_192, 2_048, 3_200_000.0),
      (65_536, 2_048, 6_270_000.0),
      (65_536, 262_144, 6_270_000.0),
      (262_144, 65_536, 6_270_000.0),
    ];

    for (frontend_fft_size, tx_ifft_size, view_sample_rate_hz) in cases {
      let frame = synthesize_test_frame_with_fft_and_view_and_ifft(
        frontend_fft_size,
        "d",
        view_sample_rate_hz,
        1_500_000.0,
        tx_ifft_size,
        -18.0,
      );
      assert_eq!(
        frame.len(),
        frontend_fft_size * 2,
        "Tx monitor payload must contain exactly the frontend FFT's I/Q samples"
      );
      let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
      let peak_dbm = max_dbm_between(&spectrum, -750_000.0, 750_000.0);

      assert!(
        (peak_dbm + 18.0).abs() <= 3.0,
        "Tx power changed for frontend FFT={frontend_fft_size} and Tx IFFT={tx_ifft_size}: peak={peak_dbm:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_wifi_integrated_power_matches_shader_power_model() {
    let frame = synthesize_test_frame_with_fft_and_view_and_ifft(
      65_536,
      "wifi",
      6_270_000.0,
      3_200_000.0,
      262_144,
      -18.0,
    );
    let spectrum = spectrum_dbm(&frame, 6_270_000.0);
    let integrated_power_dbm = integrated_dbm(&spectrum);

    assert!(
      (integrated_power_dbm + 18.0).abs() <= 3.0,
      "WiFi Tx integrated power does not match the shader power model: power={integrated_power_dbm:.2} dBm"
    );
  }

  #[test]
  fn tx_monitor_d_family_uses_sparse_scaling_spikes_not_filled_blocks() {
    let narrow = spectrum_dbm(
      &synthesize_test_frame("d_sharp", 100_000.0, TEST_TX_POWER_DBM),
      TEST_VIEW_SAMPLE_RATE_HZ,
    );
    let wide = spectrum_dbm(
      &synthesize_test_frame("d", 1_000_000.0, TEST_TX_POWER_DBM),
      TEST_VIEW_SAMPLE_RATE_HZ,
    );

    let narrow_peak = max_dbm_between(
      &narrow,
      -TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
      TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
    );
    let wide_peak = max_dbm_between(
      &wide,
      -TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
      TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
    );
    let narrow_active_bins = narrow
      .iter()
      .filter(|bin| {
        bin.rel_hz.abs() <= 50_000.0 && bin.dbm >= narrow_peak - 24.0
      })
      .count();
    let wide_active_bins = wide
      .iter()
      .filter(|bin| {
        bin.rel_hz.abs() <= 500_000.0 && bin.dbm >= wide_peak - 24.0
      })
      .count();
    let narrow_total_bins = narrow
      .iter()
      .filter(|bin| bin.rel_hz.abs() <= 50_000.0)
      .count();

    assert!(
      narrow_active_bins <= 12,
      "D# should render as one or a few narrow spectral spikes, not a filled rectangle: active_bins={narrow_active_bins}"
    );
    assert!(
      (narrow_active_bins as f64 / narrow_total_bins.max(1) as f64) <= 0.08,
      "D# active bins should be sparse within the allocated bandwidth: active={narrow_active_bins}, total={narrow_total_bins}"
    );
    assert!(
      wide_active_bins >= narrow_active_bins * 2,
      "D should gain more sawtooth harmonics/spikes as bandwidth grows: narrow={narrow_active_bins}, wide={wide_active_bins}"
    );
  }

  #[test]
  fn tx_monitor_wifi_and_5g_have_ofdm_shaped_skirts_not_square_edges() {
    for signal_name in ["wifi", "5g"] {
      let frame =
        synthesize_test_frame(signal_name, 1_000_000.0, TEST_TX_POWER_DBM);
      let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);
      let center = sorted_dbm(
        spectrum
          .iter()
          .enumerate()
          .filter(|(idx, bin)| idx % 32 == 0 && bin.rel_hz.abs() <= 250_000.0)
          .map(|(_, bin)| bin.dbm),
      );
      let shoulder = sorted_dbm(
        spectrum
          .iter()
          .enumerate()
          .filter(|(idx, bin)| {
            idx % 32 == 0 && (360_000.0..=470_000.0).contains(&bin.rel_hz.abs())
          })
          .map(|(_, bin)| bin.dbm),
      );
      let outside = sorted_dbm(
        spectrum
          .iter()
          .enumerate()
          .filter(|(idx, bin)| {
            idx % 32 == 0 && (560_000.0..=800_000.0).contains(&bin.rel_hz.abs())
          })
          .map(|(_, bin)| bin.dbm),
      );

      let center_level = percentile_dbm(&center, 0.75);
      let shoulder_level = percentile_dbm(&shoulder, 0.75);
      let outside_level = percentile_dbm(&outside, 0.95);

      assert!(
        shoulder_level <= center_level - 4.0,
        "{signal_name} should have a sloped OFDM shoulder, not a square top at the band edge: center={center_level:.2} dBm, shoulder={shoulder_level:.2} dBm"
      );
      assert!(
        outside_level <= shoulder_level - 12.0,
        "{signal_name} should drop below its shaped shoulder outside the allocated bandwidth: shoulder={shoulder_level:.2} dBm, outside={outside_level:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_signals_strictly_occupy_requested_bandwidth() {
    for signal_name in ["d", "d_sharp", "wifi", "5g"] {
      let tx_rate_hz = 1_000_000.0;
      let half_width_hz = tx_rate_hz / 2.0;
      let frame =
        synthesize_test_frame(signal_name, tx_rate_hz, TEST_TX_POWER_DBM);
      let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);
      let peak = max_dbm_between(
        &spectrum,
        -TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
        TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
      );
      let near_left_edge = max_dbm_between(
        &spectrum,
        -half_width_hz * 0.98,
        -half_width_hz * 0.72,
      );
      let near_right_edge =
        max_dbm_between(&spectrum, half_width_hz * 0.72, half_width_hz * 0.98);
      let outside = max_dbm_between(
        &spectrum,
        half_width_hz + 25_000.0,
        half_width_hz + 400_000.0,
      )
      .max(max_dbm_between(
        &spectrum,
        -half_width_hz - 400_000.0,
        -half_width_hz - 25_000.0,
      ));

      assert!(
        near_left_edge >= peak - 28.0 && near_right_edge >= peak - 28.0,
        "{signal_name} should use the requested Tx bandwidth up to both dotted edges: peak={peak:.2} dBm, left_edge={near_left_edge:.2} dBm, right_edge={near_right_edge:.2} dBm"
      );
      assert!(
        outside <= TEST_TX_POWER_DBM - 38.0,
        "{signal_name} should not extend past the requested Tx bandwidth: peak={peak:.2} dBm, outside={outside:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_wifi_and_5g_have_flat_top_then_internal_rolloff() {
    for signal_name in ["wifi", "5g"] {
      let tx_rate_hz = 1_000_000.0;
      let half_width_hz = tx_rate_hz / 2.0;
      let frame =
        synthesize_test_frame(signal_name, tx_rate_hz, TEST_TX_POWER_DBM);
      let spectrum = spectrum_dbm(&frame, TEST_VIEW_SAMPLE_RATE_HZ);
      let center = sorted_dbm(
        spectrum
          .iter()
          .enumerate()
          .filter(|(idx, bin)| {
            idx % 32 == 0 && bin.rel_hz.abs() <= half_width_hz * 0.30
          })
          .map(|(_, bin)| bin.dbm),
      );
      let flat_top = sorted_dbm(
        spectrum
          .iter()
          .enumerate()
          .filter(|(idx, bin)| {
            idx % 32 == 0
              && (half_width_hz * 0.35..=half_width_hz * 0.68)
                .contains(&bin.rel_hz.abs())
          })
          .map(|(_, bin)| bin.dbm),
      );
      let rolloff = sorted_dbm(
        spectrum
          .iter()
          .enumerate()
          .filter(|(idx, bin)| {
            idx % 32 == 0
              && (half_width_hz * 0.92..=half_width_hz * 0.99)
                .contains(&bin.rel_hz.abs())
          })
          .map(|(_, bin)| bin.dbm),
      );
      let outside = sorted_dbm(
        spectrum
          .iter()
          .enumerate()
          .filter(|(idx, bin)| {
            idx % 32 == 0
              && (half_width_hz + 40_000.0..=half_width_hz + 300_000.0)
                .contains(&bin.rel_hz.abs())
          })
          .map(|(_, bin)| bin.dbm),
      );

      let center_level = percentile_dbm(&center, 0.60);
      let flat_level = percentile_dbm(&flat_top, 0.60);
      let rolloff_level = percentile_dbm(&rolloff, 0.75);
      let outside_level = percentile_dbm(&outside, 0.95);

      assert!(
        (flat_level - center_level).abs() <= 14.0,
        "{signal_name} should have a flat OFDM top before rolloff: center={center_level:.2} dBm, flat={flat_level:.2} dBm"
      );
      assert!(
        rolloff_level <= flat_level - 5.0 && rolloff_level >= flat_level - 50.0,
        "{signal_name} should roll off inside the allocated bandwidth instead of rising vertically: flat={flat_level:.2} dBm, rolloff={rolloff_level:.2} dBm"
      );
      assert!(
        outside_level <= rolloff_level - 10.0,
        "{signal_name} should drop after the internal rolloff before leaving the requested bandwidth: rolloff={rolloff_level:.2} dBm, outside={outside_level:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_wifi_and_5g_change_after_about_one_second_of_frames() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    let animation_fft_size = 8192;

    for signal_name in ["wifi", "5g"] {
      MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
      let mut phase_accumulator = 0.0;
      let first = synthesize_mock_tx_monitor_iq(
        animation_fft_size,
        137_100_000.0,
        TEST_VIEW_SAMPLE_RATE_HZ as u32,
        137_100_000.0,
        2_400_000.0,
        signal_name,
        2048,
        TEST_TX_POWER_DBM,
        &model,
        &mut phase_accumulator,
      );

      let mut later = first.clone();
      for _ in 0..30 {
        later = synthesize_mock_tx_monitor_iq(
          animation_fft_size,
          137_100_000.0,
          TEST_VIEW_SAMPLE_RATE_HZ as u32,
          137_100_000.0,
          2_400_000.0,
          signal_name,
          2048,
          TEST_TX_POWER_DBM,
          &model,
          &mut phase_accumulator,
        );
      }

      let first_spectrum = spectrum_dbm(&first, TEST_VIEW_SAMPLE_RATE_HZ);
      let later_spectrum = spectrum_dbm(&later, TEST_VIEW_SAMPLE_RATE_HZ);
      let first_peak = first_spectrum
        .iter()
        .filter(|bin| bin.rel_hz.abs() <= 1_200_000.0)
        .fold(-150.0_f64, |max, bin| max.max(bin.dbm));
      let later_peak = later_spectrum
        .iter()
        .filter(|bin| bin.rel_hz.abs() <= 1_200_000.0)
        .fold(-150.0_f64, |max, bin| max.max(bin.dbm));
      let max_shape_delta = first_spectrum
        .iter()
        .zip(later_spectrum.iter())
        .filter(|(left, _)| left.rel_hz.abs() <= 1_200_000.0)
        .map(|(left, right)| {
          ((left.dbm - first_peak) - (right.dbm - later_peak)).abs()
        })
        .fold(0.0_f64, f64::max);

      assert!(
        max_shape_delta >= 0.5,
        "{signal_name} monitor should change visible FFT shape after about one second of frames, max normalized delta was {max_shape_delta:.3} dB"
      );
      assert_ne!(
        first, later,
        "{signal_name} monitor should not replay a static frame after about one second of frames"
      );
    }
  }

  #[test]
  fn tx_monitor_wifi_and_5g_show_curtains_at_7_361mhz_width() {
    let view_sample_rate_hz = 18_250_000.0;
    let width_bandwidth_hz = 7_361_000.0;
    let height_power_dbm = TEST_TX_POWER_DBM;
    let half_width_hz = width_bandwidth_hz / 2.0;

    for signal_name in ["wifi", "5g"] {
      let frame = synthesize_test_frame_with_view_and_ifft(
        signal_name,
        view_sample_rate_hz,
        width_bandwidth_hz,
        2048,
        height_power_dbm,
      );
      let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
      let peak = max_dbm_between(
        &spectrum,
        -view_sample_rate_hz / 2.0,
        view_sample_rate_hz / 2.0,
      );
      let center = sorted_dbm(
        spectrum
          .iter()
          .filter(|bin| bin.rel_hz.abs() <= half_width_hz * 0.18)
          .map(|bin| bin.dbm),
      );
      let outside = sorted_dbm(
        spectrum
          .iter()
          .filter(|bin| bin.rel_hz.abs() >= half_width_hz + 160_000.0)
          .map(|bin| bin.dbm),
      );

      let center_level = percentile_dbm(&center, 0.65);
      let outside_level = percentile_dbm(&outside, 0.95);

      assert!(
        peak <= height_power_dbm + 3.0 && peak >= height_power_dbm - 6.0,
        "{signal_name} 7.361MHz should still peak near the configured power: peak={peak:.2} dBm, height_power={height_power_dbm:.2} dBm"
      );
      assert!(
        outside_level <= center_level - 3.0,
        "{signal_name} 7.361MHz should stay band-limited with a quiet outside region: center={center_level:.2} dBm, outside={outside_level:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_small_ifft_blocks_still_stay_inside_requested_bandwidth() {
    let view_sample_rate_hz = 18_250_000.0;
    let tx_rate_hz = 1_000_000.0;
    let tx_half_width_hz = tx_rate_hz / 2.0;

    for signal_name in ["d", "d_sharp", "wifi", "5g"] {
      let frame = synthesize_test_frame_with_view_and_ifft(
        signal_name,
        view_sample_rate_hz,
        tx_rate_hz,
        2048,
        TEST_TX_POWER_DBM,
      );
      let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
      let peak = max_dbm_between(
        &spectrum,
        -TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
        TEST_VIEW_SAMPLE_RATE_HZ / 2.0,
      );
      let outside = max_dbm_between(
        &spectrum,
        tx_half_width_hz + 50_000.0,
        view_sample_rate_hz / 2.0,
      )
      .max(max_dbm_between(
        &spectrum,
        -view_sample_rate_hz / 2.0,
        -tx_half_width_hz - 50_000.0,
      ));

      assert!(
        outside <= peak - 38.0,
        "{signal_name} with a small Tx IFFT block should not create periodic comb energy outside the requested bandwidth: peak={peak:.2} dBm, outside={outside:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_small_ifft_blocks_keep_peak_at_requested_power() {
    let view_sample_rate_hz = 18_250_000.0;
    let tx_rate_hz = 1_000_000.0;

    for signal_name in ["d", "d_sharp", "wifi", "5g"] {
      let frame = synthesize_test_frame_with_view_and_ifft(
        signal_name,
        view_sample_rate_hz,
        tx_rate_hz,
        2048,
        TEST_TX_POWER_DBM,
      );
      let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
      let peak = max_dbm_between(
        &spectrum,
        -view_sample_rate_hz / 2.0,
        view_sample_rate_hz / 2.0,
      );

      assert!(
        peak <= TEST_TX_POWER_DBM + 3.0,
        "{signal_name} with a small Tx IFFT block should not exceed requested power: requested={TEST_TX_POWER_DBM:.2} dBm, peak={peak:.2} dBm"
      );
      assert!(
        peak >= TEST_TX_POWER_DBM - 3.0,
        "{signal_name} with a small Tx IFFT block should remain visible at requested power: requested={TEST_TX_POWER_DBM:.2} dBm, peak={peak:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_width_bandwidth_and_height_power_are_strict_in_wide_views() {
    let view_sample_rate_hz = 18_250_000.0;
    let width_bandwidth_hz = 1_000_000.0;
    let height_power_dbm = TEST_TX_POWER_DBM;
    let half_width_hz = width_bandwidth_hz / 2.0;

    for signal_name in ["d", "d_sharp", "wifi", "5g"] {
      let frame = synthesize_test_frame_with_view_and_ifft(
        signal_name,
        view_sample_rate_hz,
        width_bandwidth_hz,
        2048,
        height_power_dbm,
      );
      let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
      let peak = max_dbm_between(
        &spectrum,
        -view_sample_rate_hz / 2.0,
        view_sample_rate_hz / 2.0,
      );
      let inside_width =
        max_dbm_between(&spectrum, -half_width_hz, half_width_hz);
      let outside = sorted_dbm(
        spectrum
          .iter()
          .filter(|bin| {
            (half_width_hz + 50_000.0..=view_sample_rate_hz / 2.0)
              .contains(&bin.rel_hz.abs())
          })
          .map(|bin| bin.dbm),
      );
      let outside_width = percentile_dbm(&outside, 0.99);

      assert!(
        (inside_width - peak).abs() <= 0.1,
        "{signal_name} peak must be inside width_bandwidth: inside={inside_width:.2} dBm, peak={peak:.2} dBm"
      );
      assert!(
        peak <= height_power_dbm + 3.0,
        "{signal_name} must not exceed height_power: height_power={height_power_dbm:.2} dBm, peak={peak:.2} dBm"
      );
      assert!(
        peak >= height_power_dbm - 3.0,
        "{signal_name} must reach height_power: height_power={height_power_dbm:.2} dBm, peak={peak:.2} dBm"
      );
      assert!(
        outside_width <= height_power_dbm - 38.0,
        "{signal_name} must stay inside width_bandwidth: width_bandwidth={width_bandwidth_hz:.0} Hz, outside={outside_width:.2} dBm, height_power={height_power_dbm:.2} dBm"
      );
    }
  }

  #[test]
  fn tx_monitor_width_bandwidth_and_height_power_hold_across_signal_widths() {
    let height_power_dbm = TEST_TX_POWER_DBM;

    for width_bandwidth_hz in
      [33_000.0, 100_000.0, 1_000_000.0, 3_200_000.0, 5_000_000.0] as [f64; 5]
    {
      let view_sample_rate_hz = (width_bandwidth_hz * 8.0).max(8_000_000.0);
      let half_width_hz = width_bandwidth_hz / 2.0;
      let edge_margin_hz = (width_bandwidth_hz * 0.04)
        .max(view_sample_rate_hz / TEST_FFT_SIZE as f64 * 4.0);

      for signal_name in ["d", "d_sharp", "wifi", "5g"] {
        let frame = synthesize_test_frame_with_view_and_ifft(
          signal_name,
          view_sample_rate_hz,
          width_bandwidth_hz,
          2048,
          height_power_dbm,
        );
        let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
        let peak = max_dbm_between(
          &spectrum,
          -view_sample_rate_hz / 2.0,
          view_sample_rate_hz / 2.0,
        );
        let inside_width =
          max_dbm_between(&spectrum, -half_width_hz, half_width_hz);
        let edge_left = max_dbm_between(
          &spectrum,
          -half_width_hz + edge_margin_hz,
          -half_width_hz * 0.55,
        );
        let edge_right = max_dbm_between(
          &spectrum,
          half_width_hz * 0.55,
          half_width_hz - edge_margin_hz,
        );
        let outside = sorted_dbm(
          spectrum
            .iter()
            .filter(|bin| {
              (half_width_hz + edge_margin_hz..=view_sample_rate_hz / 2.0)
                .contains(&bin.rel_hz.abs())
            })
            .map(|bin| bin.dbm),
        );
        let outside_width = percentile_dbm(&outside, 0.99);

        assert!(
          (inside_width - peak).abs() <= 0.1,
          "{signal_name} {width_bandwidth_hz:.0}Hz peak must be inside width_bandwidth: inside={inside_width:.2} dBm, peak={peak:.2} dBm"
        );
        assert!(
          peak <= height_power_dbm + 3.0,
          "{signal_name} {width_bandwidth_hz:.0}Hz must not exceed height_power: height_power={height_power_dbm:.2} dBm, peak={peak:.2} dBm"
        );
        assert!(
          peak >= height_power_dbm - 3.0,
          "{signal_name} {width_bandwidth_hz:.0}Hz must reach height_power: height_power={height_power_dbm:.2} dBm, peak={peak:.2} dBm"
        );
        assert!(
          outside_width <= height_power_dbm - 38.0,
          "{signal_name} {width_bandwidth_hz:.0}Hz must stay inside width_bandwidth: outside={outside_width:.2} dBm, height_power={height_power_dbm:.2} dBm"
        );
        assert!(
          edge_left >= height_power_dbm - 34.0
            && edge_right >= height_power_dbm - 34.0,
          "{signal_name} {width_bandwidth_hz:.0}Hz should visibly occupy both sides of width_bandwidth: left={edge_left:.2} dBm, right={edge_right:.2} dBm, height_power={height_power_dbm:.2} dBm"
        );
      }
    }
  }

  #[test]
  fn tx_monitor_wifi_and_5g_do_not_render_wide_plateaus_at_2_4mhz_width() {
    let view_sample_rate_hz = 18_250_000.0;
    let width_bandwidth_hz = 2_400_000.0;
    let height_power_dbm = TEST_TX_POWER_DBM;
    let half_width_hz = width_bandwidth_hz / 2.0;
    let edge_margin_hz = 75_000.0;

    for signal_name in ["wifi", "5g"] {
      let frame = synthesize_test_frame_with_view_and_ifft(
        signal_name,
        view_sample_rate_hz,
        width_bandwidth_hz,
        2048,
        height_power_dbm,
      );
      let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
      let peak = max_dbm_between(
        &spectrum,
        -view_sample_rate_hz / 2.0,
        view_sample_rate_hz / 2.0,
      );
      let outside = sorted_dbm(
        spectrum
          .iter()
          .filter(|bin| {
            (half_width_hz + edge_margin_hz..=view_sample_rate_hz / 2.0)
              .contains(&bin.rel_hz.abs())
          })
          .map(|bin| bin.dbm),
      );
      let outside_99 = percentile_dbm(&outside, 0.99);
      let outside_999 = percentile_dbm(&outside, 0.999);
      let visible_outside_bins = spectrum
        .iter()
        .filter(|bin| {
          bin.rel_hz.abs() > half_width_hz + edge_margin_hz
            && bin.dbm >= height_power_dbm - 30.0
        })
        .count();

      assert!(
        peak <= height_power_dbm + 3.0 && peak >= height_power_dbm - 3.0,
        "{signal_name} 2.4MHz should render at height_power: peak={peak:.2} dBm, height_power={height_power_dbm:.2} dBm"
      );
      assert!(
        outside_99 <= height_power_dbm - 38.0
          && outside_999 <= height_power_dbm - 32.0,
        "{signal_name} 2.4MHz should not render a wide plateau outside width_bandwidth: outside99={outside_99:.2} dBm, outside999={outside_999:.2} dBm, height_power={height_power_dbm:.2} dBm"
      );
      assert_eq!(
        visible_outside_bins, 0,
        "{signal_name} 2.4MHz should have no visible bins outside width_bandwidth above height_power-30dB"
      );
    }
  }

  #[test]
  fn tx_monitor_recalibrates_power_after_bandwidth_filtering() {
    let frame = synthesize_test_frame_with_view_and_ifft(
      "wifi",
      5_000_000.0,
      2_592_000.0,
      2048,
      -18.0,
    );
    let spectrum = spectrum_dbm(&frame, 5_000_000.0);
    let peak = max_dbm_between(&spectrum, -500_000.0, 500_000.0);
    assert!(
      peak >= -27.0,
      "filtered mock Tx peak lost power: {peak:.2} dBm"
    );
  }

  #[test]
  fn tx_monitor_wifi_and_5g_do_not_repeat_a_short_ifft_period() {
    let view_sample_rate_hz = 18_250_000.0;
    let width_bandwidth_hz = 2_400_000.0;
    let half_width_hz = width_bandwidth_hz / 2.0;

    for (fft_size, tx_ifft_size) in [(65_536, 2_048), (2_048, 8_192)] {
      for signal_name in ["wifi", "5g"] {
        let frame = synthesize_test_frame_with_fft_and_view_and_ifft(
          fft_size,
          signal_name,
          view_sample_rate_hz,
          width_bandwidth_hz,
          tx_ifft_size,
          TEST_TX_POWER_DBM,
        );
        let spectrum = spectrum_dbm(&frame, view_sample_rate_hz);
        let in_band = spectrum
          .iter()
          .filter(|bin| bin.rel_hz.abs() <= half_width_hz * 0.8)
          .collect::<Vec<_>>();
        let peak = in_band.iter().fold(-150.0_f64, |max, bin| max.max(bin.dbm));
        let strong_bins =
          in_band.iter().filter(|bin| bin.dbm >= peak - 22.0).count();
        let strong_ratio = strong_bins as f64 / in_band.len().max(1) as f64;

        assert!(
          strong_ratio >= 0.20,
          "{signal_name} with FFT={fft_size} and IFFT={tx_ifft_size} should spread energy across the occupied band instead of repeating a short IFFT period: strong_ratio={strong_ratio:.3}, strong_bins={strong_bins}, total_bins={}",
          in_band.len()
        );
      }
    }
  }

  #[test]
  fn tx_monitor_advances_when_fft_size_divides_block_length() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let mut phase_accumulator = 0.0;
    let first = synthesize_mock_tx_monitor_iq(
      2048,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase_accumulator,
    );
    let second = synthesize_mock_tx_monitor_iq(
      2048,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase_accumulator,
    );

    assert_eq!(
      first.len(),
      second.len(),
      "mock tx monitor should keep a stable frame size even when frame length matches block length"
    );
  }

  #[test]
  fn tx_monitor_spectrum_animates_when_fft_size_divides_block_length() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let mut phase_accumulator = 0.0;
    let first = synthesize_mock_tx_monitor_iq(
      2048,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase_accumulator,
    );
    let second = synthesize_mock_tx_monitor_iq(
      2048,
      137_100_000.0,
      3_200_000,
      137_100_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase_accumulator,
    );

    let first_spectrum = spectrum_dbm(&first, TEST_VIEW_SAMPLE_RATE_HZ);
    let second_spectrum = spectrum_dbm(&second, TEST_VIEW_SAMPLE_RATE_HZ);
    let max_in_band_delta = first_spectrum
      .iter()
      .zip(second_spectrum.iter())
      .filter(|(left, _)| left.rel_hz.abs() <= 1_200_000.0)
      .map(|(left, right)| (left.dbm - right.dbm).abs())
      .fold(0.0_f64, f64::max);

    assert!(
      max_in_band_delta >= 1.0,
      "mock tx monitor should change visible in-band FFT magnitudes, max delta was {max_in_band_delta:.3} dB"
    );
  }

  #[test]
  fn tx_monitor_large_ifft_changes_frame_level_without_deforming_flat_top() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let mut phase_accumulator = 0.0;

    let first = synthesize_mock_tx_monitor_iq(
      65_536,
      137_100_000.0,
      6_270_000,
      137_100_000.0,
      3_200_000.0,
      "wifi",
      262_144,
      -18.0,
      &model,
      &mut phase_accumulator,
    );
    let second = synthesize_mock_tx_monitor_iq(
      65_536,
      137_100_000.0,
      6_270_000,
      137_100_000.0,
      3_200_000.0,
      "wifi",
      262_144,
      -18.0,
      &model,
      &mut phase_accumulator,
    );

    let first_spectrum = spectrum_dbm(&first, 6_270_000.0);
    let second_spectrum = spectrum_dbm(&second, 6_270_000.0);
    let inner_bins = |spectrum: &[SpectrumBin]| {
      spectrum
        .iter()
        .filter(|bin| bin.rel_hz.abs() <= 1_000_000.0)
        .map(|bin| bin.dbm)
        .collect::<Vec<_>>()
    };
    let first_inner = inner_bins(&first_spectrum);
    let second_inner = inner_bins(&second_spectrum);
    let first_level = percentile_dbm(&first_inner, 0.5);
    let second_level = percentile_dbm(&second_inner, 0.5);
    let first_shape = first_inner
      .iter()
      .zip(second_inner.iter())
      .map(|(first, second)| (first - first_level) - (second - second_level))
      .fold(0.0_f64, |max, delta| max.max(delta.abs()));

    assert_ne!(
      first_level, second_level,
      "large-IFFT Tx amplitude should move between monitor cycles"
    );
    assert!(
      (first_level - second_level).abs() >= 0.25,
      "large-IFFT Tx amplitude change was too small: first={first_level:.2} dBm, second={second_level:.2} dBm"
    );
    assert!(
      first_shape <= 18.0,
      "large-IFFT Tx envelope changed shape by {first_shape:.2} dB instead of staying within the OFDM variation bound"
    );
  }

  /// Verifies that every Tx signal type produces visible energy (not frozen
  /// nothingness) and visibly animates across frames.
  #[test]
  fn tx_monitor_all_signals_are_present_and_animate() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    let tx_bandwidth_hz = 1_000_000.0;

    for signal_name in ["d", "d_sharp", "wifi", "5g"] {
      MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
      let mut phase_acc = 0.0;

      // Generate first frame
      let first = synthesize_mock_tx_monitor_iq(
        TEST_FFT_SIZE,
        137_100_000.0,
        TEST_VIEW_SAMPLE_RATE_HZ as u32,
        137_100_000.0,
        tx_bandwidth_hz,
        signal_name,
        2048,
        TEST_TX_POWER_DBM,
        &model,
        &mut phase_acc,
      );

      let first_spectrum = spectrum_dbm(&first, TEST_VIEW_SAMPLE_RATE_HZ);
      let half_bw = tx_bandwidth_hz / 2.0;
      let in_band_peak = max_dbm_between(&first_spectrum, -half_bw, half_bw);
      let far_noise =
        max_dbm_between(&first_spectrum, 1_200_000.0, 1_500_000.0);
      assert!(
        (in_band_peak - TEST_TX_POWER_DBM).abs() <= 6.0,
        "{signal_name} should have requested Tx power: \
         peak={in_band_peak:.2} dBm"
      );
      assert!(
        in_band_peak - far_noise >= 20.0,
        "{signal_name} in-band signal should be clearly above noise: \
         peak={in_band_peak:.2} dBm, noise={far_noise:.2} dBm"
      );

      let mut later = first.clone();
      for _ in 0..10 {
        later = synthesize_mock_tx_monitor_iq(
          TEST_FFT_SIZE,
          137_100_000.0,
          TEST_VIEW_SAMPLE_RATE_HZ as u32,
          137_100_000.0,
          tx_bandwidth_hz,
          signal_name,
          2048,
          TEST_TX_POWER_DBM,
          &model,
          &mut phase_acc,
        );
      }

      // Raw I/Q bytes must differ
      assert_ne!(
        first, later,
        "{signal_name} raw IQ frames should not be frozen"
      );

      // Spectral content must visibly change
      let later_spectrum = spectrum_dbm(&later, TEST_VIEW_SAMPLE_RATE_HZ);
      let max_in_band_delta = first_spectrum
        .iter()
        .zip(later_spectrum.iter())
        .filter(|(l, _)| l.rel_hz.abs() <= half_bw)
        .map(|(l, r)| (l.dbm - r.dbm).abs())
        .fold(0.0_f64, f64::max);

      assert!(
        max_in_band_delta >= 0.3,
        "{signal_name} FFT spectrum should visibly animate: \
         max in-band delta was {max_in_band_delta:.3} dB (need >= 0.3 dB)"
      );

      // Signal must still be present after animation (didn't collapse).
      let later_peak = max_dbm_between(&later_spectrum, -half_bw, half_bw);
      assert!(
        (later_peak - TEST_TX_POWER_DBM).abs() <= 6.0,
        "{signal_name} signal should retain requested power after animation: \
         peak={later_peak:.2} dBm"
      );
    }
  }

  #[test]
  fn test_mock_tx_monitor_initial_state_alignment() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);

    // View center = 137.1 MHz, Tx center = 137.1 MHz, sample rate = 18.25 MHz, bandwidth = 2.4 MHz
    let frame = synthesize_mock_tx_monitor_iq(
      2048,
      137_100_000.0,
      18_250_000,
      137_100_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut 0.0,
    );

    let spectrum = spectrum_dbm_including_dc(&frame, 18_250_000.0);

    let center_bin = spectrum
      .iter()
      .find(|bin| bin.rel_hz.abs() < 100_000.0)
      .unwrap();
    let offset_bin = spectrum
      .iter()
      .find(|bin| (bin.rel_hz + 5_100_000.0).abs() < 100_000.0)
      .unwrap();

    assert!(
      center_bin.dbm > offset_bin.dbm + 20.0,
      "Signal should be centered at 0Hz: center={:.1} dBm, -5.1MHz={:.1} dBm",
      center_bin.dbm,
      offset_bin.dbm
    );
  }

  #[test]
  fn mock_tx_monitor_cache_exposes_shared_samples_after_prepare() {
    let mut cache = ComplexBasebandIQBuffer::new();
    let params = ComplexBasebandIQParams {
      signal_key: "wifi".to_string(),
      sample_rate_hz: 3_200_000.0,
      bandwidth_hz: 100_000.0,
      tx_ifft_size: 1024,
      phase_seed: 1,
    };

    cache.prepare(&params);
    let snapshot = cache.snapshot_samples();

    assert_eq!(snapshot.len(), 1024);
    assert_eq!(std::sync::Arc::strong_count(&snapshot), 2);
  }

  #[test]
  fn mock_tx_monitor_reuses_generator_plan_across_frames() {
    let _guard = MOCK_TX_TEST_LOCK.lock().unwrap();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    {
      let mut cache = COMPLEX_BASEBAND_IQ_CACHE.lock().unwrap();
      cache.params = None;
      cache.samples = Arc::new(Vec::new());
      cache.generator = ComplexBasebandIQGenerator::new();
    }

    let mut phase = 0.0;
    let power_model = resolve_mock_tx_iq_power_model();
    for _ in 0..2 {
      let frame = synthesize_mock_tx_monitor_iq(
        1024,
        137_100_000.0,
        3_200_000,
        137_100_000.0,
        100_000.0,
        "wifi",
        1024,
        -18.0,
        &power_model,
        &mut phase,
      );
      assert_eq!(frame.len(), 2048);
    }

    let cache = COMPLEX_BASEBAND_IQ_CACHE.lock().unwrap();
    assert_eq!(cache.generator.cached_fft_size_count(), 1);
  }

  #[test]
  fn test_mock_tx_offscreen_noise_flatness() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);

    // View center = 137.1 MHz, Tx center = 110.0 MHz (completely off-screen), sample rate = 10 MHz
    let frame = synthesize_mock_tx_monitor_iq(
      2048,
      137_100_000.0,
      10_000_000,
      110_000_000.0,
      2_000_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut 0.0,
    );

    let spectrum = spectrum_dbm(&frame, 10_000_000.0);

    // Get the peak of the spectrum
    let peak_bin = spectrum
      .iter()
      .max_by(|a, b| a.dbm.total_cmp(&b.dbm))
      .unwrap();
    let median_dbm =
      percentile_dbm(&sorted_dbm(spectrum.iter().map(|bin| bin.dbm)), 0.50);

    // The noise floor should remain low and there should be no carrier spike.
    // Dense quantized white noise has statistical FFT peaks, so constrain the
    // median floor here; coherent Tx leakage is checked separately by the
    // residual-after-noise-removal regression below.
    assert!(
      median_dbm < -65.0 && peak_bin.dbm < -50.0,
      "Expected a low off-screen noise floor without signal-level peaks, but found median={median_dbm:.1} dBm and peak={:.1} dBm at {:.3} MHz",
      peak_bin.dbm,
      peak_bin.rel_hz / 1_000_000.0,
    );
    assert!(
      peak_bin.dbm - median_dbm <= 18.0,
      "Expected off-screen output to stay noise-like, but found a narrow peak {peak_to_median:.1} dB above the median noise floor (peak={:.1} dBm, median={median_dbm:.1} dBm)",
      peak_bin.dbm,
      peak_to_median = peak_bin.dbm - median_dbm,
    );
  }

  #[test]
  fn test_mock_tx_noise_floor_rms_preserves_configured_power() {
    let model = TxIqPowerModel::default();
    let configured = mock_tx_monitor_target_rms_from_dbm(
      resolve_mock_tx_noise_floor_db(),
      &model,
    );

    assert_eq!(
      mock_tx_monitor_noise_floor_rms(&model),
      configured,
      "receiver noise RMS must preserve the configured dBm value; ADC quantization support belongs in the output stage"
    );
  }

  #[test]
  fn test_mock_tx_offscreen_noise_is_continuous_across_frame_boundaries() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    let mut phase = 0.0;

    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let whole = synthesize_mock_tx_monitor_iq(
      4096,
      143_117_000.0,
      18_250_000,
      132_197_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase,
    );

    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    phase = 0.0;
    let first = synthesize_mock_tx_monitor_iq(
      2048,
      143_117_000.0,
      18_250_000,
      132_197_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase,
    );
    let second = synthesize_mock_tx_monitor_iq(
      2048,
      143_117_000.0,
      18_250_000,
      132_197_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase,
    );
    let split: Vec<u8> = first.into_iter().chain(second).collect();

    assert_eq!(
      split, whole,
      "offscreen receiver noise must depend only on absolute sample index, not frame boundaries"
    );
  }

  #[test]
  fn test_mock_tx_offscreen_has_no_coherent_tx_residual_after_noise_removal() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    const FRAME_LEN: usize = 16_384;
    const VIEW_CENTER_HZ: f64 = 137_100_000.0;
    const VIEW_SAMPLE_RATE_HZ: u32 = 10_000_000;
    const TX_BANDWIDTH_HZ: f64 = 2_400_000.0;
    const TX_POWER_DBM: f64 = -18.0;

    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let onscreen = synthesize_mock_tx_monitor_iq(
      FRAME_LEN,
      VIEW_CENTER_HZ,
      VIEW_SAMPLE_RATE_HZ,
      VIEW_CENTER_HZ,
      TX_BANDWIDTH_HZ,
      "wifi",
      2048,
      TX_POWER_DBM,
      &model,
      &mut 0.0,
    );
    let onscreen_spectrum = spectrum_dbm(&onscreen, VIEW_SAMPLE_RATE_HZ as f64);
    let onscreen_peak = onscreen_spectrum
      .iter()
      .max_by(|a, b| a.dbm.total_cmp(&b.dbm))
      .unwrap();
    let onscreen_median = percentile_dbm(
      &sorted_dbm(onscreen_spectrum.iter().map(|bin| bin.dbm)),
      0.50,
    );
    assert!(
      onscreen_peak.dbm - onscreen_median >= 20.0,
      "onscreen control should contain coherent Tx energy before checking the offscreen residual (peak={:.1} dBm at {:.3} MHz, median={onscreen_median:.1} dBm)",
      onscreen_peak.dbm,
      onscreen_peak.rel_hz / 1_000_000.0,
    );

    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let offscreen = synthesize_mock_tx_monitor_iq(
      FRAME_LEN,
      VIEW_CENTER_HZ,
      VIEW_SAMPLE_RATE_HZ,
      VIEW_CENTER_HZ + 20_000_000.0,
      TX_BANDWIDTH_HZ,
      "wifi",
      2048,
      TX_POWER_DBM,
      &model,
      &mut 0.0,
    );
    let expected_noise = expected_flat_noise_frame(FRAME_LEN, &model);
    let residual = subtract_frames_as_iq(&offscreen, &expected_noise);
    let residual_spectrum =
      spectrum_dbm_from_iq(&residual, VIEW_SAMPLE_RATE_HZ as f64);
    let residual_peak = residual_spectrum
      .iter()
      // The centered receiver DC offset is intentional; this assertion is
      // checking for an off-screen Tx carrier outside that expected bin.
      .skip(1)
      .max_by(|a, b| a.dbm.total_cmp(&b.dbm))
      .unwrap();
    let residual_median = percentile_dbm(
      &sorted_dbm(residual_spectrum.iter().map(|bin| bin.dbm)),
      0.50,
    );

    assert!(
      residual_peak.dbm <= onscreen_peak.dbm - 45.0,
      "fully offscreen Tx should not leave coherent carrier residual after modeled receiver noise is removed (onscreen peak={:.1} dBm at {:.3} MHz, residual peak={:.1} dBm at {:.3} MHz, residual median={residual_median:.1} dBm)",
      onscreen_peak.dbm,
      onscreen_peak.rel_hz / 1_000_000.0,
      residual_peak.dbm,
      residual_peak.rel_hz / 1_000_000.0,
    );
    assert!(
      residual_peak.dbm - residual_median <= 12.0,
      "fully offscreen residual should not contain a narrow carrier-like peak after noise removal (peak={:.1} dBm at {:.3} MHz, median={residual_median:.1} dBm)",
      residual_peak.dbm,
      residual_peak.rel_hz / 1_000_000.0,
    );
  }

  #[test]
  fn test_mock_tx_offscreen_transition_has_no_frame_dependent_tone_comb() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let mut phase = 0.0;

    let _onscreen = synthesize_mock_tx_monitor_iq(
      2048,
      143_117_000.0,
      18_250_000,
      143_117_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase,
    );

    let mut worst_periodic_corr = 0.0_f64;
    let mut worst_periodic_lag = 0usize;
    for _ in 0..32 {
      let frame = synthesize_mock_tx_monitor_iq(
        2048,
        143_117_000.0,
        18_250_000,
        132_197_000.0,
        2_400_000.0,
        "wifi",
        2048,
        -18.0,
        &model,
        &mut phase,
      );
      let samples: Vec<f64> = frame
        .chunks_exact(2)
        .map(|sample| (sample[0] as f64 - 128.0) / 128.0)
        .collect();
      let mean = samples.iter().sum::<f64>() / samples.len() as f64;
      let centered: Vec<f64> =
        samples.iter().map(|sample| sample - mean).collect();
      let energy = centered.iter().map(|sample| sample * sample).sum::<f64>();
      let (frame_corr, frame_lag) = (2..=256)
        .map(|lag| {
          let corr = centered
            .iter()
            .zip(centered.iter().skip(lag))
            .map(|(a, b)| a * b)
            .sum::<f64>();
          ((corr / energy.max(f64::EPSILON)).abs(), lag)
        })
        .max_by(|left, right| left.0.total_cmp(&right.0))
        .unwrap();
      if frame_corr > worst_periodic_corr {
        worst_periodic_corr = frame_corr;
        worst_periodic_lag = frame_lag;
      }
    }

    assert!(
      worst_periodic_corr < 0.12,
      "offscreen transition must not produce a frame-dependent carrier comb; worst normalized autocorrelation={worst_periodic_corr:.3} at lag {worst_periodic_lag}"
    );
  }

  #[test]
  fn test_mock_tx_offscreen_runtime_noise_does_not_quantize_to_sparse_arches() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
    let mut phase = 0.0;

    // Reproduce the recorded transition with the runtime +15 dB calibration:
    // one visible WiFi frame, followed by the Tx moving fully outside the
    // 18.25 MHz monitor span.
    let _onscreen = synthesize_mock_tx_monitor_iq(
      2048,
      143_117_000.0,
      18_250_000,
      143_117_000.0,
      2_400_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut phase,
    );

    let mut sparsest_ratio = 1.0_f64;
    for _ in 0..32 {
      let frame = synthesize_mock_tx_monitor_iq(
        2048,
        143_117_000.0,
        18_250_000,
        132_197_000.0,
        2_400_000.0,
        "wifi",
        2048,
        -18.0,
        &model,
        &mut phase,
      );
      let non_neutral_codes =
        frame.iter().filter(|&&sample| sample != 128).count();
      let active_ratio = non_neutral_codes as f64 / frame.len() as f64;
      sparsest_ratio = sparsest_ratio.min(active_ratio);
    }

    // Sub-LSB stochastic rounding creates frames with only one or two impulses.
    // Their FFT is A + B*cos(2*pi*k*delta/N), which is the moving arch/comb
    // pattern from the recording. A usable quantized white-noise floor must be
    // dense enough that no individual impulse pair controls the FFT envelope.
    assert!(
      sparsest_ratio >= 0.02,
      "offscreen monitor noise became a sparse quantized impulse frame whose FFT renders moving arches; sparsest non-neutral code ratio={sparsest_ratio:.4}, expected at least 0.02"
    );
  }

  #[test]
  fn test_mock_tx_offscreen_noise_has_no_periodic_tone_train() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);

    let frame = synthesize_mock_tx_monitor_iq(
      4096,
      137_100_000.0,
      10_000_000,
      110_000_000.0,
      2_000_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut 0.0,
    );

    let i_samples: Vec<f64> = frame
      .chunks_exact(2)
      .map(|sample| (sample[0] as f64 - 128.0) / 128.0)
      .collect();
    let mean = i_samples.iter().sum::<f64>() / i_samples.len() as f64;
    let centered: Vec<f64> =
      i_samples.iter().map(|sample| sample - mean).collect();
    let energy = centered.iter().map(|sample| sample * sample).sum::<f64>();

    let max_periodic_corr = if energy > f64::EPSILON {
      (2..=256)
        .map(|lag| {
          let corr = centered
            .iter()
            .zip(centered.iter().skip(lag))
            .map(|(a, b)| a * b)
            .sum::<f64>();
          (corr / energy).abs()
        })
        .fold(0.0_f64, f64::max)
    } else {
      0.0
    };

    assert!(
      max_periodic_corr < 0.08,
      "offscreen noise should not preserve a visible periodic tone train; max normalized autocorrelation={max_periodic_corr:.3}"
    );
  }

  #[test]
  fn test_mock_tx_offscreen_uses_flat_monitor_noise_mixer() {
    let _lock = MOCK_TX_TEST_LOCK.lock().unwrap();
    let model = TxIqPowerModel::default();
    MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);

    let frame = synthesize_mock_tx_monitor_iq(
      1024,
      137_100_000.0,
      10_000_000,
      110_000_000.0,
      2_000_000.0,
      "wifi",
      2048,
      -18.0,
      &model,
      &mut 0.0,
    );

    let noise_floor_rms = mock_tx_monitor_noise_floor_rms(&model);
    let expected: Vec<u8> = (0..1024)
      .flat_map(|j| {
        let t = j as u64;
        let noise_i = mock_tx_monitor_output_noise(
          t,
          MOCK_TX_FLAT_I_NOISE_KEY,
          MOCK_TX_QUANT_I_NOISE_KEY,
          noise_floor_rms,
        );
        let noise_q = mock_tx_monitor_output_noise(
          t,
          MOCK_TX_FLAT_Q_NOISE_KEY,
          MOCK_TX_QUANT_Q_NOISE_KEY,
          noise_floor_rms,
        );
        [
          quantize_mock_tx_iq(
            noise_i + MOCK_TX_DC_OFFSET,
            t,
            MOCK_TX_I_DITHER_KEY,
          ),
          quantize_mock_tx_iq(noise_q, t, MOCK_TX_Q_DITHER_KEY),
        ]
      })
      .collect();

    assert_eq!(
      frame, expected,
      "fully offscreen Mock Tx should fall through the same final flat-noise mixer used when signal energy is zero"
    );
  }

  #[test]
  fn test_clamp_raw_iq_to_bandwidth() {
    let mut iq = vec![Complex::new(1.0, 1.0); 1024];
    clamp_raw_iq_to_bandwidth(&mut iq, 0.0, 100_000.0, 1_000_000.0);

    let mut iq_f32: Vec<Complex<f32>> = iq
      .iter()
      .map(|c| Complex::new(c.re as f32, c.im as f32))
      .collect();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(1024);
    fft.process(&mut iq_f32);

    for index in 55..=512 {
      assert!(
        iq_f32[index].norm() < 1e-5,
        "Bin {} should be zero, found {}",
        index,
        iq_f32[index].norm()
      );
    }
  }
}
