use wasm_bindgen::prelude::*;

const C: f64 = 299_792_458.0;

use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::Mutex;

pub static TX_SAFETY_ENABLED: AtomicBool = AtomicBool::new(false);
pub static TX_SAFETY_LIMIT_IS_PERSON: AtomicBool = AtomicBool::new(false);
pub static TX_TRANSMITTING: AtomicBool = AtomicBool::new(false);

pub static TX_HOP_ENABLED: AtomicBool = AtomicBool::new(false);
pub static TX_HOP_TYPE_IS_RANGE: AtomicBool = AtomicBool::new(true);
pub static TX_HOP_START_HZ: Mutex<f64> = Mutex::new(0.0);
pub static TX_HOP_END_HZ: Mutex<f64> = Mutex::new(0.0);
pub static TX_HOP_CHANNELS_MASK: AtomicU32 = AtomicU32::new(0); // Bit 0 = A, Bit 1 = B, Bit 2 = C
pub static TX_HOP_RATE_HZ: Mutex<f64> = Mutex::new(1.0);
pub static TX_POWER_DBM: Mutex<f64> = Mutex::new(0.0);
pub static TX_SIGNAL: Mutex<String> = Mutex::new(String::new());
pub static TX_CENTER_FREQUENCY_HZ: Mutex<f64> = Mutex::new(0.0);
pub static TX_SAMPLE_RATE_HZ: Mutex<f64> = Mutex::new(0.0);
pub static TX_IFFT_SIZE: Mutex<usize> = Mutex::new(2048);

struct MappingPoint {
  vga: f64,
  dbm: f64,
}

const HACKRF_AMP_OFF_MAPPING: &[MappingPoint] = &[
  MappingPoint {
    vga: 0.0,
    dbm: -7.5,
  },
  MappingPoint {
    vga: 5.0,
    dbm: -2.5,
  },
  MappingPoint {
    vga: 10.0,
    dbm: 1.5,
  },
  MappingPoint {
    vga: 15.0,
    dbm: 4.0,
  },
  MappingPoint {
    vga: 20.0,
    dbm: 6.0,
  },
  MappingPoint {
    vga: 25.0,
    dbm: 8.0,
  },
  MappingPoint {
    vga: 30.0,
    dbm: 10.0,
  },
  MappingPoint {
    vga: 35.0,
    dbm: 11.5,
  },
  MappingPoint {
    vga: 40.0,
    dbm: 13.0,
  },
  MappingPoint {
    vga: 47.0,
    dbm: 14.5,
  },
];

const HACKRF_AMP_ON_MAPPING: &[MappingPoint] = &[
  MappingPoint { vga: 0.0, dbm: 1.0 },
  MappingPoint {
    vga: 10.0,
    dbm: 6.0,
  },
  MappingPoint {
    vga: 20.0,
    dbm: 9.0,
  },
  MappingPoint {
    vga: 30.0,
    dbm: 12.0,
  },
  MappingPoint {
    vga: 35.0,
    dbm: 13.5,
  },
  MappingPoint {
    vga: 40.0,
    dbm: 14.5,
  },
  MappingPoint {
    vga: 47.0,
    dbm: 15.0,
  },
];

#[wasm_bindgen]
pub fn dbm_to_watts(dbm: f64) -> f64 {
  10.0f64.powf(dbm / 10.0) / 1000.0
}

#[wasm_bindgen]
pub fn watts_to_dbm(watts: f64) -> f64 {
  if watts <= 0.0 {
    -100.0
  } else {
    10.0 * (watts * 1000.0).log10()
  }
}

fn interpolate_vga_to_dbm(vga: f64, mapping: &[MappingPoint]) -> f64 {
  let vga = vga.clamp(mapping[0].vga, mapping[mapping.len() - 1].vga);
  for i in 0..mapping.len() - 1 {
    let p0 = &mapping[i];
    let p1 = &mapping[i + 1];
    if vga >= p0.vga && vga <= p1.vga {
      let span = p1.vga - p0.vga;
      if span.abs() < 1e-6 {
        return p0.dbm;
      }
      let t = (vga - p0.vga) / span;
      return p0.dbm + t * (p1.dbm - p0.dbm);
    }
  }
  mapping[mapping.len() - 1].dbm
}

fn interpolate_dbm_to_vga(dbm: f64, mapping: &[MappingPoint]) -> f64 {
  let dbm = dbm.clamp(mapping[0].dbm, mapping[mapping.len() - 1].dbm);
  for i in 0..mapping.len() - 1 {
    let p0 = &mapping[i];
    let p1 = &mapping[i + 1];
    if dbm >= p0.dbm && dbm <= p1.dbm {
      let dbm_span = p1.dbm - p0.dbm;
      if dbm_span.abs() < 1e-6 {
        return p0.vga;
      }
      let t = (dbm - p0.dbm) / dbm_span;
      return p0.vga + t * (p1.vga - p0.vga);
    }
  }
  mapping[mapping.len() - 1].vga
}

#[wasm_bindgen]
pub fn get_approx_output_power(vga_gain: f64, amp_enabled: bool) -> f64 {
  if amp_enabled {
    interpolate_vga_to_dbm(vga_gain, HACKRF_AMP_ON_MAPPING)
  } else {
    interpolate_vga_to_dbm(vga_gain, HACKRF_AMP_OFF_MAPPING)
  }
}

#[wasm_bindgen]
pub struct SafeGains {
  pub vga: f64,
  pub amp: bool,
}

#[wasm_bindgen]
pub fn get_max_safe_vga_and_amp(power_limit_dbm: f64) -> SafeGains {
  // If the limit allows at least AMP ON at VGA 0
  if power_limit_dbm >= 1.0 {
    let vga =
      interpolate_dbm_to_vga(power_limit_dbm, HACKRF_AMP_ON_MAPPING).round();
    SafeGains { vga, amp: true }
  } else {
    let vga =
      interpolate_dbm_to_vga(power_limit_dbm, HACKRF_AMP_OFF_MAPPING).round();
    SafeGains { vga, amp: false }
  }
}

#[wasm_bindgen]
pub fn calculate_radiation_lobe_reach(
  frequency_hz: f64,
  power_dbm: f64,
  aperture_width: f64,
  aperture_height: f64,
) -> f64 {
  let freq = frequency_hz.clamp(1000.0, 100_000_000_000.0);
  let power_watts = dbm_to_watts(power_dbm.clamp(-70.0, 64.0));
  let wavelength = C / freq;

  let peak_gain =
    (4.0 * std::f64::consts::PI * aperture_width * aperture_height)
      / (wavelength * wavelength);

  // calculated_reach = sqrt((P * peakGain) / (4 * PI * threshold)) where threshold = 2.0
  let calculated_reach =
    ((power_watts * peak_gain) / (4.0 * std::f64::consts::PI * 2.0)).sqrt();

  let scale = (1.8e9 / freq).powf(1.2);

  (calculated_reach * scale).min(150.0)
}

#[wasm_bindgen]
pub fn calculate_radiation_lobe_power_limit(
  frequency_hz: f64,
  max_distance_m: f64,
  aperture_width: f64,
  aperture_height: f64,
) -> f64 {
  let freq = frequency_hz.clamp(1000.0, 100_000_000_000.0);
  let wavelength = C / freq;
  let scale = (1.8e9 / freq).powf(1.2);

  let target_reach = max_distance_m.clamp(0.01, 150.0);
  let term = target_reach * wavelength / scale;
  let power_watts = (2.0 * term * term) / (aperture_width * aperture_height);

  watts_to_dbm(power_watts)
}

#[wasm_bindgen]
pub fn calculate_room_reach(frequency_hz: f64, power_dbm: f64) -> f64 {
  let freq = frequency_hz.clamp(1000.0, 100_000_000_000.0);
  let wavelength = C / freq;
  let receiver_sensitivity_watts = 4.6e-7;
  let transmitter_gain = 1.64;
  let receiver_gain = 1.0;
  let power_watts = dbm_to_watts(power_dbm);

  let reach = (wavelength / (4.0 * std::f64::consts::PI))
    * ((power_watts * transmitter_gain * receiver_gain)
      / receiver_sensitivity_watts)
      .sqrt();

  reach.max(0.2)
}

#[wasm_bindgen]
pub fn calculate_room_power_limit(
  frequency_hz: f64,
  max_distance_m: f64,
) -> f64 {
  let freq = frequency_hz.clamp(1000.0, 100_000_000_000.0);
  let wavelength = C / freq;
  let receiver_sensitivity_watts = 4.6e-7;
  let transmitter_gain = 1.64;
  let receiver_gain = 1.0;

  let calc_dist = max_distance_m.max(0.01);
  let required_power_watts =
    ((calc_dist * 4.0 * std::f64::consts::PI) / wavelength).powi(2)
      * (receiver_sensitivity_watts / (transmitter_gain * receiver_gain));

  watts_to_dbm(required_power_watts)
}

#[wasm_bindgen]
pub fn get_quantized_iq_power_floor_dbm(
  bits: u32,
  fft_size: u32,
  dbm_offset: f64,
) -> f64 {
  let usable_bits = bits.clamp(2, 32);
  let sample_count = fft_size.max(1) as f64;
  let signed_steps = 2.0f64.powi((usable_bits - 1) as i32);
  10.0 * (1.0 / (signed_steps * signed_steps * sample_count)).log10()
    + dbm_offset
}

#[wasm_bindgen]
pub fn get_recommended_fft_size_for_iq_power_dbm(
  requested_dbm: f64,
  bits: u32,
  dbm_offset: f64,
) -> u32 {
  if !requested_dbm.is_finite() {
    return 1;
  }
  let usable_bits = bits.clamp(2, 32);
  let signed_steps = 2.0f64.powi((usable_bits - 1) as i32);
  let required = 10.0f64.powf((dbm_offset - requested_dbm) / 10.0)
    / (signed_steps * signed_steps);
  let required = required.ceil().max(1.0).min(u32::MAX as f64);
  let mut size = 1u32;
  while (size as f64) < required && size < (1 << 30) {
    size <<= 1;
  }
  size
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_power_conversion_roundtrip() {
    let dbm = 10.0;
    let watts = dbm_to_watts(dbm);
    assert!((watts - 0.01).abs() < 1e-6); // 10 dBm = 10 mW = 0.01 W
    let roundtrip = watts_to_dbm(watts);
    assert!((roundtrip - dbm).abs() < 1e-6);
  }

  #[test]
  fn test_get_approx_output_power() {
    // Exact mapping points
    assert!((get_approx_output_power(0.0, false) - (-7.5)).abs() < 1e-6);
    assert!((get_approx_output_power(47.0, false) - 14.5).abs() < 1e-6);
    assert!((get_approx_output_power(0.0, true) - 1.0).abs() < 1e-6);
    assert!((get_approx_output_power(47.0, true) - 15.0).abs() < 1e-6);

    // Interpolation tests
    // AMP OFF: VGA 2.5 is halfway between 0 (-7.5) and 5 (-2.5) -> -5.0 dBm
    assert!((get_approx_output_power(2.5, false) - (-5.0)).abs() < 1e-6);
    // AMP ON: VGA 25 is halfway between 20 (9.0) and 30 (12.0) -> 10.5 dBm
    assert!((get_approx_output_power(25.0, true) - 10.5).abs() < 1e-6);
  }

  #[test]
  fn test_quantized_iq_power_floor_dbm() {
    assert!(
      (get_quantized_iq_power_floor_dbm(8, 2048, 30.0) - -45.257).abs()
        < 0.001
    );
    assert!(
      (get_quantized_iq_power_floor_dbm(8, 65_536, 30.0) - -60.309).abs()
        < 0.001
    );
    assert_eq!(
      get_recommended_fft_size_for_iq_power_dbm(-70.0, 8, 30.0),
      1_048_576
    );
  }

  #[test]
  fn test_get_max_safe_vga_and_amp() {
    // If limit is high, should use AMP ON
    let safe_high = get_max_safe_vga_and_amp(10.5);
    assert!(safe_high.amp);
    assert_eq!(safe_high.vga, 25.0);

    // If limit is low, should use AMP OFF
    let safe_low = get_max_safe_vga_and_amp(-5.0);
    assert!(!safe_low.amp);
    assert_eq!(safe_low.vga, 3.0); // -5.0 dBm falls at VGA 2.5, rounded to 3.0

    // Extreme bounds
    let max_safe = get_max_safe_vga_and_amp(30.0);
    assert!(max_safe.amp);
    assert_eq!(max_safe.vga, 47.0);

    let min_safe = get_max_safe_vga_and_amp(-30.0);
    assert!(!min_safe.amp);
    assert_eq!(min_safe.vga, 0.0);
  }

  #[test]
  fn test_room_reach_and_power_limit_inversion() {
    let freq = 1.5e9; // 1.5 GHz
    let target_dist = 3.0; // 3 meters limit

    // Find the power limit for 3m
    let power_limit = calculate_room_power_limit(freq, target_dist);

    // Verify that this power limit results in a reach of 3m
    let reach = calculate_room_reach(freq, power_limit);
    assert!((reach - target_dist).abs() < 1e-3);
  }

  #[test]
  fn test_radiation_lobe_reach_and_power_limit_inversion() {
    let freq = 1.8e9; // 1.8 GHz
    let width = 0.65;
    let height = 1.56;
    let target_dist = 5.0; // 5 meters

    let power_limit =
      calculate_radiation_lobe_power_limit(freq, target_dist, width, height);
    let reach =
      calculate_radiation_lobe_reach(freq, power_limit, width, height);
    assert!((reach - target_dist).abs() < 1e-3);
  }
}
