# N-APT demodulation scratchpad

This directory contains small, reusable analysis steps for decrypted IQ data.
It deliberately does not decrypt `.napt` files or read passwords. Decrypt a
capture to a temporary raw interleaved `uint8` IQ file using
`.agents/ANALYZE.md`, then run:

```sh
PYTHONPATH=. python3 -m src.demod.analyze_iq /private/tmp/capture_iq.u8 \
  --sample-rate 3200000 \
  --search-band 10000 \
  --minimum-separation 500
```

NumPy and SciPy are required. The current analysis reports the two strongest
local spectral peaks after enforcing a minimum separation, their midpoint, and
their frequency separation. It is intentionally a measurement primitive, not
yet a complete N-APT demodulator.

The next planned steps are narrow complex mixing, matched filters for the two
carriers, sum/difference/phase-difference traces, and repetition analysis of
the residual valleys.

The Python API exposes these steps through `extract_pair_traces`. Pass the
carrier separation and optional midpoint offset in hertz; its outputs include
`sum`, `difference`, and `phase_difference`. Use `repetition_score` to compare
any output at a candidate lag, such as the approximately 28 ms observation.

`detect_spike_events` provides the next exploratory layer. It reports local
spectral events with time, frequency, bandwidth, power, and a simple symmetry
score. A high symmetry score suggests energy on both sides of a peak; a low
score suggests an isolated or asymmetric event. Treat these as candidate
features for clustering, not as decoded symbols.
