//! Continuous RTL-SDR-style frequency and sample-clock correction.
//!
//! `set_correction` is the ideal crystal-error model retained for other paths.
//! `set_r82xx_correction` uses the quantized zero-to-PPM PLL/register model in
//! r82xx_ppm. Both drive the same stateful resampler and complex oscillator.
//! Neither predicts analog spurs or proves physical hardware equivalence.

use num_complex::Complex32;

const PPM_SCALE: f64 = 1.0e-6;
const TAU: f64 = std::f64::consts::TAU;

#[derive(Debug, Clone)]
pub struct PpmCorrectionProcessor {
  ppm: i32,
  tuned_frequency_hz: f64,
  sample_rate_hz: f64,
  input_per_output: f64,
  nco_phase_step: f64,
  nco_phase: f64,
  nco: Complex32,
  nco_step: Complex32,
  nco_samples: u64,
  input: Vec<Complex32>,
  input_cursor: f64,
}

impl PpmCorrectionProcessor {
  pub fn new(ppm: i32, tuned_frequency_hz: f64, sample_rate_hz: f64) -> Self {
    let mut processor = Self {
      ppm: 0,
      tuned_frequency_hz: 0.0,
      sample_rate_hz: 0.0,
      input_per_output: 1.0,
      nco_phase_step: 0.0,
      nco_phase: 0.0,
      nco: Complex32::new(1.0, 0.0),
      nco_step: Complex32::new(1.0, 0.0),
      nco_samples: 0,
      input: Vec::new(),
      input_cursor: 0.0,
    };
    processor.set_correction(ppm, tuned_frequency_hz, sample_rate_hz);
    processor
  }

  /// Update correction parameters. A center/rate change is a stream
  /// discontinuity, so it clears both the resampler history and NCO phase.
  pub fn set_correction(
    &mut self,
    ppm: i32,
    tuned_frequency_hz: f64,
    sample_rate_hz: f64,
  ) {
    let rate = sample_rate_hz.max(1.0);
    if self.ppm == ppm
      && (self.tuned_frequency_hz - tuned_frequency_hz).abs() < 0.5
      && (self.sample_rate_hz - rate).abs() < 0.5
    {
      return;
    }

    self.ppm = ppm.clamp(-200, 200);
    self.tuned_frequency_hz = tuned_frequency_hz.max(0.0);
    self.sample_rate_hz = rate;
    let rate_scale = 1.0 + self.ppm as f64 * PPM_SCALE;
    self.input_per_output = rate_scale;
    self.nco_phase_step =
      TAU * self.tuned_frequency_hz * self.ppm as f64 * PPM_SCALE / rate;
    self.nco_step = Complex32::new(
      self.nco_phase_step.cos() as f32,
      self.nco_phase_step.sin() as f32,
    );
    self.reset();
  }

  /// Reproduce the nominal zero-to-PPM R82xx register transition. Hardware
  /// remains at zero; all consumers receive the same continuous correction.
  pub fn set_r82xx_correction(
    &mut self,
    ppm: i32,
    center_hz: u32,
    if_hz: u32,
    blog_v4: bool,
    sample_rate_hz: f64,
  ) -> Result<(), &'static str> {
    if !sample_rate_hz.is_finite() || sample_rate_hz <= 0.0 {
      return Err("Invalid sample rate");
    }
    let model = super::r82xx_ppm::correction(ppm, center_hz, if_hz, blog_v4)?;
    let step = TAU * model.shift_hz / sample_rate_hz;
    if self.ppm == ppm
      && self.tuned_frequency_hz == center_hz as f64
      && self.sample_rate_hz == sample_rate_hz
      && self.input_per_output == model.input_per_output
      && self.nco_phase_step == step
    {
      return Ok(());
    }
    self.ppm = ppm;
    self.tuned_frequency_hz = center_hz as f64;
    self.sample_rate_hz = sample_rate_hz;
    self.input_per_output = model.input_per_output;
    self.nco_phase_step = step;
    self.nco_step = Complex32::new(step.cos() as f32, step.sin() as f32);
    self.reset();
    Ok(())
  }

  /// Reset phase and fractional-delay history after dropped samples, retunes,
  /// rate changes, or source replacement.
  pub fn reset(&mut self) {
    self.nco_phase = 0.0;
    self.nco = Complex32::new(1.0, 0.0);
    self.nco_samples = 0;
    self.input.clear();
    self.input_cursor = 0.0;
  }

  pub fn ppm(&self) -> i32 {
    self.ppm
  }

  /// Process one arbitrary-sized complex sample chunk. The output sample
  /// count can differ slightly from the input because sample-clock correction
  /// changes the output/input ratio.
  pub fn process_complex(&mut self, chunk: &[Complex32]) -> Vec<Complex32> {
    if self.ppm == 0 || chunk.is_empty() {
      if self.ppm == 0 {
        self.reset();
        return chunk.to_vec();
      }
      return Vec::new();
    }

    self.input.extend_from_slice(chunk);
    let estimated =
      ((chunk.len() as f64 / self.input_per_output).ceil() as usize) + 2;
    let mut output = Vec::with_capacity(estimated);

    while self.input_cursor + 1.0 < self.input.len() as f64 {
      let base = self.input_cursor.floor() as usize;
      let fraction = (self.input_cursor - base as f64) as f32;
      let sample =
        self.input[base] * (1.0 - fraction) + self.input[base + 1] * fraction;
      output.push(sample * self.nco);

      self.input_cursor += self.input_per_output;
      self.nco_phase = (self.nco_phase + self.nco_phase_step).rem_euclid(TAU);
      self.nco *= self.nco_step;
      self.nco_samples += 1;

      // Keep oscillator magnitude bounded without making the result depend on
      // chunk boundaries.
      if self.nco_samples.is_multiple_of(4096) {
        self.nco = Complex32::new(
          self.nco_phase.cos() as f32,
          self.nco_phase.sin() as f32,
        );
      }
    }

    let consumed = self.input_cursor.floor() as usize;
    if consumed > 0 {
      self.input.drain(..consumed);
      self.input_cursor -= consumed as f64;
    }
    output
  }

  /// Process RTL-SDR unsigned 8-bit interleaved I/Q. Quantization is restored
  /// to the original representation after the same floating-point transform
  /// used by native and WASM consumers.
  pub fn process_u8_iq(&mut self, bytes: &[u8]) -> Vec<u8> {
    let sample_count = bytes.len() / 2;
    if sample_count == 0 {
      return Vec::new();
    }
    if self.ppm == 0 {
      self.reset();
      return bytes[..sample_count * 2].to_vec();
    }

    let complex = bytes[..sample_count * 2]
      .chunks_exact(2)
      .map(|sample| {
        Complex32::new(
          (sample[0] as f32 - 127.5) / 127.5,
          (sample[1] as f32 - 127.5) / 127.5,
        )
      })
      .collect::<Vec<_>>();
    let corrected = self.process_complex(&complex);
    let mut output = Vec::with_capacity(corrected.len() * 2);
    for sample in corrected {
      output
        .push(((sample.re * 127.5 + 127.5).round()).clamp(0.0, 255.0) as u8);
      output
        .push(((sample.im * 127.5 + 127.5).round()).clamp(0.0, 255.0) as u8);
    }
    output
  }
}

#[cfg(target_arch = "wasm32")]
mod wasm_api {
  use super::PpmCorrectionProcessor;
  use wasm_bindgen::prelude::*;

  #[wasm_bindgen]
  pub struct WasmPpmCorrectionProcessor(PpmCorrectionProcessor);

  #[wasm_bindgen]
  impl WasmPpmCorrectionProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(ppm: i32, tuned_frequency_hz: f64, sample_rate_hz: f64) -> Self {
      Self(PpmCorrectionProcessor::new(
        ppm,
        tuned_frequency_hz,
        sample_rate_hz,
      ))
    }

    pub fn set_correction(
      &mut self,
      ppm: i32,
      tuned_frequency_hz: f64,
      sample_rate_hz: f64,
    ) {
      self
        .0
        .set_correction(ppm, tuned_frequency_hz, sample_rate_hz);
    }

    pub fn set_r82xx_correction(
      &mut self,
      ppm: i32,
      center_hz: u32,
      if_hz: u32,
      blog_v4: bool,
      sample_rate_hz: f64,
    ) -> Result<(), JsValue> {
      self
        .0
        .set_r82xx_correction(ppm, center_hz, if_hz, blog_v4, sample_rate_hz)
        .map_err(JsValue::from_str)
    }

    pub fn reset(&mut self) {
      self.0.reset();
    }

    pub fn process_u8_iq(&mut self, bytes: &[u8]) -> Vec<u8> {
      self.0.process_u8_iq(bytes)
    }
  }
}

#[cfg(target_arch = "wasm32")]
pub use wasm_api::WasmPpmCorrectionProcessor;

#[cfg(test)]
mod tests {
  use super::*;

  fn tone(
    frequency_hz: f64,
    sample_rate_hz: f64,
    count: usize,
  ) -> Vec<Complex32> {
    (0..count)
      .map(|index| {
        let phase = TAU * frequency_hz * index as f64 / sample_rate_hz;
        Complex32::new(phase.cos() as f32, phase.sin() as f32)
      })
      .collect()
  }

  fn estimate_frequency(samples: &[Complex32], sample_rate_hz: f64) -> f64 {
    let (real, imag) =
      samples
        .windows(2)
        .fold((0.0f64, 0.0f64), |(real, imag), pair| {
          let correlation = pair[0].conj() * pair[1];
          (real + correlation.re as f64, imag + correlation.im as f64)
        });
    imag.atan2(real) * sample_rate_hz / TAU
  }

  #[test]
  fn r82xx_model_retains_pll_and_clock_quantization() {
    let model =
      super::super::r82xx_ppm::correction(1, 1_618_000, 3_570_000, true)
        .unwrap();
    // Independent register fixture: 33.988 MHz LO, divide by 64,
    // reference truncated to 28,800,028 Hz at +1 ppm.
    assert_eq!(model.mix_divider, 64);
    assert_eq!(model.sample_offset, -16);
    assert_eq!(model.zero_divider - model.corrected_divider, 3);
    assert!(
      (model.shift_hz - 41.19873046875 * model.input_per_output).abs() < 1e-8
    );
    let negative =
      super::super::r82xx_ppm::correction(-1, 1_618_000, 3_570_000, true)
        .unwrap();
    assert!(negative.shift_hz < 0.0);
    assert_eq!(negative.sample_offset, 16);
    assert!(super::super::r82xx_ppm::correction(
      201, 1_618_000, 3_570_000, true
    )
    .is_err());
  }

  #[test]
  fn modeled_pll_shift_is_continuous_across_usb_chunks() {
    let input = tone(-10_000.0, 3_200_000.0, 320_000);
    let mut whole = PpmCorrectionProcessor::new(0, 0.0, 3_200_000.0);
    whole
      .set_r82xx_correction(1, 1_618_000, 3_570_000, true, 3_200_000.0)
      .unwrap();
    let mut split = whole.clone();
    let expected = whole.process_complex(&input);
    let actual: Vec<_> = input
      .chunks(997)
      .flat_map(|chunk| split.process_complex(chunk))
      .collect();
    assert_eq!(expected.len(), actual.len());
    for (a, b) in actual.iter().zip(&expected) {
      assert!((*a - *b).norm() < 1e-4);
    }
    let ratio = 1.0 + 16.0 / 16_777_216.0;
    let target = (-10_000.0 + 41.19873046875 * 1.000001) * ratio;
    assert!((estimate_frequency(&actual, 3_200_000.0) - target).abs() < 0.1);
    split
      .set_r82xx_correction(0, 1_618_000, 3_570_000, true, 3_200_000.0)
      .unwrap();
    assert_eq!(split.process_complex(&input), input);
  }

  #[test]
  fn positive_and_negative_ppm_remove_tuner_and_sample_clock_error() {
    let sample_rate_hz = 3_200_000.0;
    let tuned_frequency_hz = 1_000_000.0;
    let sample_count = 320_000;
    for signal_offset_hz in [-2_000.0, 0.0, 2_000.0] {
      for ppm in [-100, 100] {
        let actual_clock_hz = sample_rate_hz * (1.0 + ppm as f64 * PPM_SCALE);
        let raw_tone_hz =
          signal_offset_hz - tuned_frequency_hz * ppm as f64 * PPM_SCALE;
        let input = tone(raw_tone_hz, actual_clock_hz, sample_count);
        let mut processor =
          PpmCorrectionProcessor::new(ppm, tuned_frequency_hz, sample_rate_hz);
        let output = processor.process_complex(&input);
        let frequency = estimate_frequency(&output, sample_rate_hz);

        assert!(
          (frequency - signal_offset_hz).abs() < 0.2,
          "PPM {ppm} corrected {raw_tone_hz} Hz to {frequency} Hz instead of {signal_offset_hz} Hz",
        );
        if ppm > 0 {
          assert!(output.len() < input.len());
        } else {
          assert!(output.len() > input.len());
        }
      }
    }
  }

  #[test]
  fn arbitrary_chunk_boundaries_preserve_resampler_and_nco_state() {
    let sample_rate_hz = 1_000_000.0;
    let input = tone(31_000.0, sample_rate_hz, 80_000);
    let mut whole =
      PpmCorrectionProcessor::new(37, 1_618_000.0, sample_rate_hz);
    let expected = whole.process_complex(&input);

    let mut split =
      PpmCorrectionProcessor::new(37, 1_618_000.0, sample_rate_hz);
    let mut actual = Vec::new();
    for chunk in input.chunks(997) {
      actual.extend(split.process_complex(chunk));
    }

    assert_eq!(actual.len(), expected.len());
    let max_error = actual
      .iter()
      .zip(&expected)
      .map(|(actual, expected)| (*actual - *expected).norm())
      .fold(0.0f32, f32::max);
    assert!(max_error < 0.0001, "chunk boundary error {max_error}");
  }

  #[test]
  fn zero_ppm_is_an_exact_passthrough() {
    let input = tone(12_500.0, 1_000_000.0, 4_097);
    let mut processor =
      PpmCorrectionProcessor::new(0, 1_618_000.0, 1_000_000.0);
    assert_eq!(processor.process_complex(&input), input);
  }

  #[test]
  fn reset_clears_buffered_interpolation_and_phase() {
    let input = tone(31_000.0, 1_000_000.0, 4_096);
    let mut processor =
      PpmCorrectionProcessor::new(37, 1_618_000.0, 1_000_000.0);
    let _ = processor.process_complex(&input[..1_000]);
    processor.reset();
    let after_reset = processor.process_complex(&input);
    let mut fresh = PpmCorrectionProcessor::new(37, 1_618_000.0, 1_000_000.0);
    assert_eq!(after_reset, fresh.process_complex(&input));
  }
}
