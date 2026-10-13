---
name: signals
description: Use for N-APT signal analysis, live or file-backed spectrum work, I/Q capture, demodulation, signal-learning content, or the signals CLI. Explain signal ideas simply first, then use the correct RF/DSP term.
---

# Signals

Use this skill when working on N-APT's signal analysis and capture workflows.
The app and CLI have separate paths and contracts; identify which one owns the
behavior before making a change.

## Communication rule

Explain the idea in ordinary language first. Put the technical name next:

> The radio listens across a slice of frequencies (the capture bandwidth).

Use the terms in [references/terminology.md](references/terminology.md). Do not
replace a clear explanation with unexplained industry language.

For a concise explanation of what a radio signal is and how N-APT represents
one, start with [references/signal-basics.md](references/signal-basics.md).

## Analysis order

1. Identify the source and whether it is live, a file, mock, RTL-SDR, or HackRF RX.
2. Read metadata: center frequency, hardware sample rate, selected frequency range,
   encoding, and continuity.
3. Inspect the rendered spectrum (FFT) to locate energy. Energy is not proof of
   a usable signal.
4. Select the signal region and keep selected bandwidth separate from hardware
   sample rate.
5. Choose the demodulator and preserve a contiguous I/Q timeline.
6. Validate the result as audio, an image, symbols, or data.

Read [references/demod-modes.md](references/demod-modes.md) before changing a
processor. Follow the relevant producer and reader paths when changing a file
format or capture contract.

Use [references/troubleshooting.md](references/troubleshooting.md) to trace
app symptoms to their owning state path,
[references/acquisition-modes.md](references/acquisition-modes.md) before
choosing a multi-frequency capture strategy,
[references/formats.md](references/formats.md) before claiming a file is
supported, and [references/evidence-checklist.md](references/evidence-checklist.md)
when reporting results.

## App surfaces and data paths

- `/visualizer` renders the spectrum and waterfall. It can present live source
  frames or file playback; identify the source mode before tracing a frame.
- `/demodulate` and its `/demod` alias host the demodulation flow. The flow is
  editable and an empty flow can be intentional state.
- `/learn` and `/learn/:id` host signal-learning material; this is a separate
  educational surface, not the live DSP pipeline.
- Live FFT frames, file playback, and demodulation use different data flows.
  An FFT frame is not a substitute for the contiguous I/Q queue needed for
  audio. When output is stale, check source identity, session/stream generation,
  sequence, and tune intent at the owning boundary.

For UI changes, trace the owning route, feature state, and stream lifecycle.
Do not assume the CLI invokes the same processors or state loop as the app.
An empty demod flow is not a reason to recreate nodes.

## CLI

Read `.agents/CLI.md` before changing capture settings, artifact formats,
retuning, or backend protocol behavior. Use built-in help for current options:

```bash
npm run cli -- --help
npm run cli -- signals --help
npm run cli -- signals demod --help
npm run cli -- capture iq --help
```

Local-file commands:

```bash
npm run cli -- signals inspect <input>
npm run cli -- signals spectrum <input>
npm run cli -- signals validate <input>
npm run cli -- signals demod <raw-iq-file> --algorithm fm
npm run cli -- demod <raw-iq-file> --algorithm fm
```

`signals spectrum` currently reports byte-pair magnitude statistics; it does
not compute an FFT despite its name. Use the app's spectrum renderer for an FFT
view. `signals demod` reads raw I/Q bytes and writes a demodulated I/Q artifact.
Supported algorithm names currently include `fm`, `fmDiscriminator`,
`aptAudio`, and `aptImage`. Do not infer that demod accepts every file format
that `inspect` can examine.

Live capture:

```bash
npm run cli -- capture iq --allow-mutations
npm run cli -- signals capture --allow-mutations # alias for capture iq
```

The CLI does not start or own app services. Device listing and I/Q capture
require the Rust backend; snapshot capture uses both backend and frontend. The
development stack is started separately with `npm run dev`. Local-file
inspection, summary, validation, and demodulation do not need running services.

Capture can retune the receiver and change RX settings. Use
`--allow-mutations` only when the requested receive-side change is authorized.
Transmit is outside this workflow; agent clients must not transmit. Keep
captures and private derived recordings out of Git. Follow
[references/capture-workflow.md](references/capture-workflow.md).

## Evidence and safety

State what evidence supports a conclusion: synthetic fixture, deterministic
replay, focused test, rendered app, live SDR, or physical hardware. A mock
signal proves software behavior only; it does not prove real RF behavior.
Use [references/validation.md](references/validation.md) when reporting what a
signal path proves. Do not call a signal identified from FFT energy alone.

## Troubleshooting

- Silent audio: check source mode, contiguous I/Q, tuning, bandwidth, sample
  rate, and audio output before changing the algorithm.
- Stale audio: check source identity, stream/session generation, sequence, and
  pending tune intent.
- A moving FFT with frozen demod: inspect the demod I/Q queue; the newest FFT
  frame alone is not enough for audio.
- Mock works but hardware fails: report the mock result separately and request
  live SDR evidence.
- Empty demod flow: treat it as intentional state unless evidence shows a
  loading or persistence failure.
