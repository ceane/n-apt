use criterion::{black_box, criterion_group, criterion_main, Criterion};
use n_apt_backend::s::fft::{FFTProcessor, RawSamples, WindowType};
use std::sync::Arc;

fn fft_benchmark(c: &mut Criterion) {
  let mut group = c.benchmark_group("FFT Processing");

  let sample_rate = 3_200_000u32;
  let min_db = -120;
  let max_db = 0;

  for size in [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144].iter() {
    let size = *size;
    let mut processor =
      FFTProcessor::new_with_defaults(size, sample_rate, min_db, max_db);

    // Prepare dummy data (alternating 127/128 to simulate some noise)
    let mut data = Vec::with_capacity(size * 2);
    for i in 0..size {
      data.push(if i % 2 == 0 { 127 } else { 128 }); // I
      data.push(if i % 3 == 0 { 127 } else { 128 }); // Q
    }

    let samples = RawSamples { data, sample_rate };

    group.bench_with_input(format!("Size {}", size), &samples, |b, s| {
      b.iter(|| processor.process_samples(black_box(s)).unwrap());
    });
  }
  group.finish();
}

fn window_benchmark(c: &mut Criterion) {
  let mut group = c.benchmark_group("FFT Windows");
  let size = 4096;
  let sample_rate = 3_200_000u32;
  let min_db = -120;
  let max_db = 0;

  let mut data = Vec::with_capacity(size * 2);
  for _ in 0..size {
    data.push(128);
    data.push(128);
  }
  let samples = RawSamples { data, sample_rate };

  for window in [
    WindowType::Rectangular,
    WindowType::Hanning,
    WindowType::Hamming,
    WindowType::Blackman,
  ]
  .iter()
  {
    let mut processor =
      FFTProcessor::new_with_defaults(size, sample_rate, min_db, max_db);
    let mut config = processor.config().clone();
    config.window_type = *window;
    processor.update_config(config);

    group.bench_with_input(format!("{:?}", window), &samples, |b, s| {
      b.iter(|| processor.process_samples(black_box(s)).unwrap());
    });
  }
  group.finish();
}

criterion_group!(benches, fft_benchmark, window_benchmark);
criterion_main!(benches);
