// Device-specific terms enter through FFTParams; keep the conversion equation
// shared so CPU/WASM and GPU profiles use the same units and sign convention.
fn calibrated_dbm(sample: Complex, _idx: u32) -> f32 {
  let power = max(rtl_sdr_complex_power(sample), 1e-20);
  let normalized_power = power / max(params.normalization, 1e-20);
  let dbfs = 10.0 * log10(max(normalized_power, 1e-20));
  let gain_correction_db =
    params.gain_correction_db_per_db * params.tuner_gain_db;

  return dbfs
    + params.base_calibration_db
    + params.chain_loss_db
    + gain_correction_db;
}
