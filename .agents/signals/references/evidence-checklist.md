# Signal result evidence checklist

Before saying a signal was found, decoded, captured continuously, or validated,
record the evidence that supports that specific claim.

## Identify and inspect

- [ ] Identify source kind and identity: raw file, NAPT-IQ3 file, mock source,
  or named physical receiver.
- [ ] Record center frequency and hardware sample rate separately from selected
  frequency range / demod bandwidth.
- [ ] Record encoding, channel layout, encryption state, and relevant container
  version. Say when metadata is missing or inferred.
- [ ] State whether the data came from live mode or file playback.
- [ ] Treat energy in a spectrum as a candidate only; it does not identify a
  signal or prove successful demodulation.

## Make processing claims

- [ ] For demodulation, record algorithm, effective input rate, selected
  bandwidth, and whether input samples form a contiguous timeline.
- [ ] For a capture, record requested and acknowledged settings, acquisition
  mode/plan, retunes or segment boundaries, and known discarded samples.
- [ ] For integrity, name the actual check performed: completed-job checksum,
  embedded file digest, or authenticated decryption. Do not call an unkeyed
  digest proof of origin.
- [ ] For continuity, use persisted boundary and loss evidence. A successful
  mock test, a moving FFT, or adjacent stitched frequency windows does not
  prove uninterrupted physical acquisition.

## Label the strength of evidence

State which level was actually observed:

1. **Synthetic fixture** — validates code against generated known data.
2. **Deterministic replay** — repeatable result from a saved input; it does not
   prove how that input was acquired.
3. **Mock source** — validates software integration without RF hardware.
4. **Rendered app** — validates the observed UI path and visible output.
5. **Live SDR** — validates one session on a connected receiver; name the
   device and conditions.
6. **Physical/hardware-specific evidence** — required for claims about the
   receiver's real RF behavior, warm-up losses, or continuous acquisition.

Report passes, skipped checks, environment blocks, and failures distinctly.
Use the narrowest claim supported by the evidence, and keep sensitive capture
data private; share synthetic fixtures or redacted metadata where possible.
