use rustfft::{num_complex::Complex, FftPlanner};

#[derive(Clone, PartialEq, Debug)]
pub struct MockTxParams {
  pub signal_key: String,
  pub sample_rate_hz: f64,
  pub bandwidth_hz: f64,
  pub tx_ifft_size: usize,
}

pub fn generate_mock_tx_samples_ifft(
  params: &MockTxParams,
) -> Vec<Complex<f32>> {
  let mut planner = FftPlanner::<f32>::new();
  let fft = planner.plan_fft_inverse(params.tx_ifft_size);
  let forward_fft = planner.plan_fft_forward(params.tx_ifft_size);
  let mut spectrum = vec![Complex::new(0.0_f32, 0.0_f32); params.tx_ifft_size];

  let key = params.signal_key.as_str();
  let bin_spacing = params.sample_rate_hz / params.tx_ifft_size as f64;
  let num_bins = (params.bandwidth_hz / bin_spacing).round().max(1.0) as usize;

  let half_bins = num_bins / 2;

  if key == "d" || key == "d_sharp" {
    let max_harmonics = if key == "d_sharp" {
      (params.bandwidth_hz / 40_000.0).ceil() as usize
    } else {
      (params.bandwidth_hz / 90_000.0).ceil() as usize + 2
    }
    .clamp(2, 18);
    let spike_count = max_harmonics.min(half_bins.max(1));

    for n in 0..spike_count {
      let harmonic = n + 1;
      let edge_fraction = harmonic as f64 / (spike_count + 1) as f64;
      let bin_offset =
        (edge_fraction * half_bins.max(1) as f64).round().max(1.0) as usize;
      let amp =
        (1.0 / harmonic as f32) * (1.0 - 0.35 * n as f32 / spike_count as f32);
      let phase = if key == "d_sharp" {
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
      if mirrored > params.tx_ifft_size / 2 && mirrored < params.tx_ifft_size {
        spectrum[mirrored] =
          Complex::new((cos_p as f32) * amp, -(sin_p as f32) * amp);
      }
    }
  } else {
    let half_width = half_bins.max(1) as f64;
    let shoulder_start = if key == "5g" { 0.72 } else { 0.68 };
    for k in 0..num_bins {
      let centered = k as isize - half_bins as isize;
      let bin_idx = if centered >= 0 {
        centered
      } else {
        params.tx_ifft_size as isize + centered
      };
      let wrapped_bin = bin_idx as usize;

      if wrapped_bin < params.tx_ifft_size {
        let x = (centered as f64).abs() / half_width;
        let amp = if x <= shoulder_start {
          1.0
        } else {
          let t =
            ((x - shoulder_start) / (1.0 - shoulder_start)).clamp(0.0, 1.0);
          let smooth = t * t * (3.0 - 2.0 * t);
          1.0 - 0.985 * smooth
        };

        let phase =
          std::f64::consts::PI * (centered as f64).powi(2) / num_bins as f64;
        let (sin_p, cos_p) = phase.sin_cos();
        spectrum[wrapped_bin] = Complex::new(
          (cos_p as f32) * amp as f32,
          (sin_p as f32) * amp as f32,
        );
      }
    }

    let desired_magnitudes: Vec<f32> = spectrum
      .iter()
      .map(|bin| (bin.re * bin.re + bin.im * bin.im).sqrt())
      .collect();
    for _ in 0..6 {
      let mut projected = spectrum.clone();
      fft.process(&mut projected);
      for sample in &mut projected {
        let mag = (sample.re * sample.re + sample.im * sample.im).sqrt();
        if mag > 18.0 {
          let scale = 18.0 / mag;
          sample.re *= scale;
          sample.im *= scale;
        }
      }
      forward_fft.process(&mut projected);
      for (bin, desired_mag) in
        projected.iter_mut().zip(desired_magnitudes.iter())
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
      spectrum = projected;
    }
  }

  // Transform to time domain
  fft.process(&mut spectrum);

  // Normalize block so its FFT peak bin is exactly 1.0 (after receiver size normalization)
  let mut test_block = spectrum.clone();
  forward_fft.process(&mut test_block);

  let mut max_fft_mag = 0.0_f32;
  for s in &test_block {
    let mag = (s.re * s.re + s.im * s.im).sqrt();
    if mag > max_fft_mag {
      max_fft_mag = mag;
    }
  }
  if max_fft_mag > 0.0 {
    let scale = (params.tx_ifft_size as f32) / max_fft_mag;
    for s in &mut spectrum {
      s.re *= scale;
      s.im *= scale;
    }
  }

  spectrum
}
