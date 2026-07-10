use rustfft::{num_complex::Complex, FftPlanner};
use std::f32::consts::PI;

fn main() {
  let n = 8;
  let mut planner = FftPlanner::new();
  let fft = planner.plan_fft_forward(n);

  // Create a signal with positive frequency: e^{j 2pi * 2 * i / N}
  // This is a +2 Hz signal if Fs = N
  let mut buffer = vec![Complex { re: 0.0, im: 0.0 }; n];
  for i in 0..n {
    let phase = 2.0 * PI * 2.0 * (i as f32) / (n as f32);
    buffer[i] = Complex {
      re: phase.cos(),
      im: phase.sin(),
    };
  }

  fft.process(&mut buffer);

  println!("FFT of e^{{j 2pi * 2 * n / 8}}:");
  for (i, val) in buffer.iter().enumerate() {
    println!("Index {}: re={}, im={}", i, val.re.round(), val.im.round());
  }

  // Now test a negative frequency signal: e^{-j 2pi * 2 * i / N}
  let mut buffer2 = vec![Complex { re: 0.0, im: 0.0 }; n];
  for i in 0..n {
    let phase = -2.0 * PI * 2.0 * (i as f32) / (n as f32);
    buffer2[i] = Complex {
      re: phase.cos(),
      im: phase.sin(),
    };
  }

  fft.process(&mut buffer2);

  println!("\nFFT of e^{{-j 2pi * 2 * n / 8}}:");
  for (i, val) in buffer2.iter().enumerate() {
    println!("Index {}: re={}, im={}", i, val.re.round(), val.im.round());
  }
}
