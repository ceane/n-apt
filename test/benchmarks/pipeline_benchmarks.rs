use criterion::{
  criterion_group, criterion_main, BenchmarkId, Criterion, Throughput,
};
use n_apt_backend::s::ifft::complex_baseband::{
  ComplexBasebandIQGenerator, ComplexBasebandIQParams,
};
use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::tx::repeat_iq_payload_into;
use std::hint::black_box;

fn tx_generators(c: &mut Criterion) {
  let mut group = c.benchmark_group("uncapped_tx_synthesis");
  for signal in ["d", "d_sharp", "wifi", "5g", "tone", "noise", "custom"] {
    for size in [2_048_usize, 32_768] {
      let mut generator = ComplexBasebandIQGenerator::new();
      let mut output = Vec::with_capacity(size);
      let params = ComplexBasebandIQParams {
        signal_key: signal.to_string(),
        sample_rate_hz: 3_200_000.0,
        bandwidth_hz: 1_000_000.0,
        tx_ifft_size: size,
        phase_seed: 1,
      };
      group.throughput(Throughput::Elements(size as u64));
      group.bench_with_input(BenchmarkId::new(signal, size), &size, |b, _| {
        b.iter(|| {
          generator.generate_into(black_box(&params), black_box(&mut output));
          black_box(&output);
        });
      });
    }
  }
  group.finish();
}

fn mock_rx(c: &mut Criterion) {
  let mut group = c.benchmark_group("uncapped_mock_rx");
  for fft_size in [2_048_usize, 32_768, 262_144] {
    let mut processor = SdrProcessor::new_mock_apt().unwrap();
    processor
      .apply_settings(n_apt_backend::server::types::SdrProcessorSettings {
        fft_size: Some(fft_size),
        ..Default::default()
      })
      .unwrap();
    group.throughput(Throughput::Elements(fft_size as u64));
    group.bench_with_input(
      BenchmarkId::from_parameter(fft_size),
      &fft_size,
      |b, _| {
        b.iter(|| black_box(processor.read_and_process_frame().unwrap()));
      },
    );
  }
  group.finish();
}

fn tx_callback_fill(c: &mut Criterion) {
  let payload = vec![0x7f_u8; 262_144 * 2];
  let mut output = vec![0_u8; 262_144];
  c.bench_function("hackrf_tx_callback_modulus_baseline", |b| {
    b.iter(|| {
      for (index, byte) in output.iter_mut().enumerate() {
        *byte = payload[index % payload.len()];
      }
      black_box(&output);
    });
  });
  c.bench_function("hackrf_tx_callback_chunk_fill", |b| {
    b.iter(|| {
      repeat_iq_payload_into(black_box(&payload), black_box(&mut output))
        .unwrap()
    });
  });
}

criterion_group!(pipeline, tx_generators, mock_rx, tx_callback_fill);
criterion_main!(pipeline);
