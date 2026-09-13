---
name: signals
description: Use when working with N-APT signal analysis, IQ captures, FFTs, demodulation, the /learn route, or the signals CLI. Explain signal ideas simply first, then use the correct RF/DSP term.
---

# Signals

Use this skill when an agent needs to understand, inspect, capture, demodulate, or validate a signal in N-APT.

## Communication rule

Explain the idea in ordinary language first. Put the technical name next:

> The radio listens across a slice of frequencies (the capture bandwidth).

Use the terms in [references/terminology.md](references/terminology.md). Do not replace a clear explanation with unexplained industry language.

## Working order

Follow this order:

1. Identify the source and whether it is live, a file, mock, RTL-SDR, or HackRF RX.
2. Read the metadata: center frequency, sample rate, frequency range, encoding, and continuity.
3. Inspect the spectrum (FFT) to locate energy. Energy is not proof of a usable signal.
4. Select the signal region and keep the selected bandwidth separate from the hardware sample rate.
5. Choose the demodulator and preserve a contiguous IQ timeline.
6. Validate the result as audio, an image, symbols, or data.

Read the mode-specific guidance in [references/demod-modes.md](references/demod-modes.md) before changing a processor.

## CLI

Use the existing entrypoint:

```text
npm run cli -- signals inspect <input>
npm run cli -- signals spectrum <input>
npm run cli -- signals demod <input> --input <raw-iq-file> --algorithm fm
npm run cli -- signals validate <input>
npm run cli -- signals capture --allow-mutations
```

Local inspection, spectrum summaries, replay, and validation are read-only. Live capture and receive-side settings require explicit mutation opt-in. Transmit is always blocked for agent clients.

## Evidence and safety

Say what evidence supports a conclusion: synthetic fixture, deterministic replay, focused test, rendered app, live SDR, or physical hardware. A mock signal proves software behavior only; it does not prove real RF behavior.

Do not commit, upload, or expose IQ captures or derived private recordings. Use synthetic fixtures and redacted metadata. Follow [references/capture-workflow.md](references/capture-workflow.md).

## Troubleshooting

- Silent audio: check source mode, contiguous IQ, tuning, bandwidth, sample rate, and audio output before changing the algorithm.
- Stale audio: check source identity, stream/session epoch, sequence, and pending tune intent.
- A moving FFT with frozen demod: inspect the demod IQ queue; the newest FFT frame alone is not enough for audio.
- Mock works but hardware fails: report the mock result separately and request live SDR evidence.
- Empty demod flow: treat it as intentional state; do not recreate nodes merely because the node list is empty.

Use [references/validation.md](references/validation.md) when reporting whether a signal path is actually proven.
