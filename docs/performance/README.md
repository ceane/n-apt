# Rx/Tx performance program

The performance suite reports three different limits:

1. **Theoretical production ceiling** — uncapped `floor(sample_rate / samples_per_frame)` plus byte, device, and compute limits.
2. **Sustainable pipeline ceiling** — the highest measured rate that preserves lossless capture/Tx, bounded queues, and signal correctness.
3. **Presentation ceiling** — browser delivery calibrated to screen refresh. This is commonly 60 Hz and is not the backend, DSP, device, or Tx synthesis ceiling.

Run deterministic CI budgets with:

```sh
cargo --config .cargo/performance.toml test --test performance_tests --release -- --nocapture
cargo test --test performance_program_tests
```

Run uncapped report-only benchmarks with:

```sh
cargo bench --bench pipeline_benchmarks
```

Set `N_APT_PIPELINE_PROFILE=1` before starting the backend to collect detailed stage latency. Cheap counters remain enabled without it. The authenticated read-only snapshot is `GET /api/debug/pipeline-performance`. GPU and USB metrics are reported as unavailable until the running platform supplies real measurements; they are never estimated.

Physical RTL-SDR and HackRF profiles are manual and must record the device, USB topology, host CPU/GPU, OS, build profile, sample rate, transform size, duration, warm-up, and run variance. Hardware absence must not fail CI.
