//! Numerical model of an R82xx zero-to-PPM register transition.
//!
//! Sources: osmocom/rtl-sdr src/tuner_r82xx.c (r82xx_set_pll) and
//! src/librtlsdr.c (rtlsdr_set_freq_correction/set_sample_freq_correction).
//! Models nominal divider synthesis, not VCO calibration, PLL lock, phase
//! noise, analog filtering, or spurs. The IF register is held fixed: the PPM
//! setter retunes the PLL but does not call rtlsdr_set_if_freq. Reprogramming
//! bandwidth/rate afterwards is a different hardware transition.

#[derive(Debug, Clone, Copy)]
pub struct Correction {
  pub zero_divider: u64,
  pub corrected_divider: u64,
  pub mix_divider: u64,
  pub sample_offset: i16,
  pub shift_hz: f64,
  pub input_per_output: f64,
}

pub fn correction(
  ppm: i32,
  center_hz: u32,
  if_hz: u32,
  blog_v4: bool,
) -> Result<Correction, &'static str> {
  if !(-200..=200).contains(&ppm) {
    return Err("PPM must be within -200..=200");
  }
  let rf = center_hz as u64
    + if blog_v4 && center_hz < 28_800_000 {
      28_800_000
    } else {
      0
    };
  let lo = rf + if_hz as u64;
  let khz = (lo + 500) / 1000;
  let mix_divider = [2u64, 4, 8, 16, 32, 64]
    .into_iter()
    .find(|div| (1_770_000..3_540_000).contains(&(khz * div)))
    .ok_or("LO is outside R82xx synthesis range")?;
  let reference = 28_800_000u64;
  // librtlsdr truncates its corrected reference to uint32_t before PLL math.
  let corrected_reference =
    (reference as f64 * (1.0 + ppm as f64 / 1e6)) as u64;
  let divider = |clock: u64| (clock + 65_536 * lo * mix_divider) / (2 * clock);
  let zero_divider = divider(reference);
  let corrected_divider = divider(corrected_reference);
  // C signed division truncates toward zero. Registers contain 14 signed bits.
  let sample_offset = (-(ppm as i64) * 16_777_216 / 1_000_000) as i16;
  // Fractional sample-clock model using the quantized register offset. This
  // interpretation still requires measured timing validation on RTL2832U.
  let input_per_output = 1.0 - sample_offset as f64 / 16_777_216.0;
  // The calibration value describes the crystal error being simulated.
  // Hardware computes the corrected divider from the scaled reference, while
  // both divider configurations run from the same physically fast crystal.
  let actual_reference = reference as f64 * (1.0 + ppm as f64 / 1e6);
  let lo_delta = (zero_divider as f64 - corrected_divider as f64)
    * (2.0 * actual_reference)
    / (65_536 * mix_divider) as f64;
  Ok(Correction {
    zero_divider,
    corrected_divider,
    mix_divider,
    sample_offset,
    shift_hz: lo_delta * input_per_output,
    input_per_output,
  })
}

/// IF selected by the upstream R82xx bandwidth configuration. Zero bandwidth
/// means automatic (sample rate). This is not a hardware register readback.
pub fn intermediate_frequency(bandwidth: u32, rate: u32) -> u32 {
  let mut bw = if bandwidth == 0 { rate } else { bandwidth };
  if bw > 6_000_000 {
    return 4_570_000;
  }
  if bw > 2_430_000 {
    return 3_570_000;
  }
  let mut frequency = 2_300_000;
  let mut width = 0;
  if bw > 2_050_000 {
    bw -= 380_000;
    frequency += 380_000;
    width += 380_000;
  }
  if bw > 1_700_000 {
    bw -= 350_000;
    frequency += 350_000;
    width += 350_000;
  }
  let widths = [
    1_700_000, 1_600_000, 1_550_000, 1_450_000, 1_200_000, 900_000, 700_000,
    550_000, 450_000, 350_000,
  ];
  let index = widths
    .iter()
    .position(|value| bw > *value)
    .unwrap_or(widths.len())
    .saturating_sub(1);
  frequency - (width + widths[index]) / 2
}

#[cfg(test)]
mod tests {
  use super::intermediate_frequency;

  #[test]
  fn intermediate_frequency_matches_r82xx_bandwidth_boundaries() {
    assert_eq!(intermediate_frequency(7_000_001, 3_200_000), 4_570_000);
    assert_eq!(intermediate_frequency(6_000_000, 3_200_000), 3_570_000);
    assert_eq!(intermediate_frequency(2_430_001, 3_200_000), 3_570_000);
    assert_eq!(intermediate_frequency(2_430_000, 3_200_000), 1_815_000);
    assert_eq!(intermediate_frequency(2_050_000, 3_200_000), 1_625_000);
    assert_eq!(intermediate_frequency(1_700_000, 3_200_000), 1_450_000);
    assert_eq!(intermediate_frequency(1_000_000, 3_200_000), 1_700_000);
  }

  #[test]
  fn zero_bandwidth_uses_the_configured_sample_rate() {
    assert_eq!(intermediate_frequency(0, 3_200_000), 3_570_000);
  }
}
