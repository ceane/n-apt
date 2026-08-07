# Receive capture workflow

1. Confirm the source is authorized and is operating in RX.
2. Record center frequency, hardware sample rate, selected range, gain, PPM, device identity, and timestamp.
3. Capture locally and keep the file out of Git.
4. Prefer encrypted `.napt` output for sensitive captures.
5. Analyze locally with `signals inspect`, `signals spectrum`, `signals demod`, and `signals validate`.
6. Share synthetic fixtures or redacted metadata when reporting a problem.

`signals capture` requires `--allow-mutations`. This permits receive capture and receive-side settings only. It must never start transmit.
