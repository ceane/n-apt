use criterion::{criterion_group, criterion_main, Criterion};
use n_apt_backend::sdr::mock_apt::MockAptDevice;
use std::sync::Mutex;
use std::hint::black_box;

static MOCK_APT_BENCH_LOCK: Mutex<()> = Mutex::new(());

fn mock_apt_generation_benchmark(c: &mut Criterion) {
  let _guard = MOCK_APT_BENCH_LOCK.lock().expect("mock APT bench lock");

  let mut group = c.benchmark_group("Mock APT Generation");

  for fft_size in [32_768usize, 262_144usize] {
    group.bench_function(format!("read_samples_sync/{fft_size}"), |b| {
      let mut device = MockAptDevice::new_with_seed(20240513);
      eprintln!(
        "Mock APT benchmark backend ({}): {}",
        fft_size,
        device.generation_backend_label()
      );
      device.read_samples_sync(1024).unwrap();
      b.iter(|| {
        black_box(device.read_samples_sync(fft_size).unwrap());
      });
    });

    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    {
      group.bench_function(format!("read_samples_sync_metal/{fft_size}"), |b| {
        let mut device = MockAptDevice::new_with_seed_and_gpu_backend(20240513);
        if !device.gpu_backend_enabled() {
          return;
        }
        eprintln!(
          "Mock APT benchmark backend (metal/{fft_size}): {}",
          device.generation_backend_label()
        );
        device.read_samples_sync(1024).unwrap();
        b.iter(|| {
          black_box(device.read_samples_sync(fft_size).unwrap());
        });
      });
    }
  }

  group.finish();
}

criterion_group!(benches, mock_apt_generation_benchmark);
criterion_main!(benches);
