# Offline audio demodulation training

This local Python workflow trains from the same paired reference data already
used by the browser prototype: narrowband I/Q recorded while known audio plays,
aligned reference PCM, and the AM/FM/APT baseline outputs. The target is the
reference waveform. `coherent` and `static` remain review metadata; they are not
waveform classes or model inputs.

The browser exports binary sample arrays in a bounded `.tar` archive. Its small
`manifest.json` records the capture/session identities, sample rates, channel
profile, alignment, and checksums. Waveform samples are never serialized as
JSON numbers. Each survey job is one session; combine separate survey exports
to get independent train, validation, and test sessions.

## Export paired captures

On `/demodulate`, use **Export Python corpus** in the local ML audio demodulation
node. This downloads up to 256 MB from the selected survey job. The archive
contains `manifest.json`, binary I/Q and PCM arrays, any available DSP baseline
arrays, and `session-splits.template.json`.

Inspect several exports and create one small split file. Assign each survey job
to exactly one partition; keep captures from the same survey job together:

```json
{
  "format": "napt-audio-demod-session-splits",
  "version": 1,
  "sessionSplits": {
    "survey-job-id-1": "train",
    "survey-job-id-2": "validation",
    "survey-job-id-3": "test"
  }
}
```

The split map contains identifiers and assignments only. Do not assign nearby
clips from the same survey session to different partitions. A single survey
session cannot support a held-out evaluation.

## Train on the M4 locally

```sh
python3 -m venv /private/tmp/napt-audio-demod-env
/private/tmp/napt-audio-demod-env/bin/pip install -r scripts/audio_demod/requirements.txt

/private/tmp/napt-audio-demod-env/bin/python scripts/audio_demod/train.py inspect \
  --dataset /path/to/survey-train.tar \
  --dataset /path/to/survey-validation.tar \
  --dataset /path/to/survey-test.tar
```

Use the `sessionIds` from `inspect` to fill `session-splits.template.json` (or
combine the templates into `/path/to/session-splits.json`) before training.

```sh
/private/tmp/napt-audio-demod-env/bin/python scripts/audio_demod/train.py train \
  --dataset /path/to/survey-train.tar \
  --dataset /path/to/survey-validation.tar \
  --dataset /path/to/survey-test.tar \
  --splits /path/to/session-splits.json \
  --output-dir "$HOME/Library/Application Support/N-APT/audio-demod/runs/run-001" \
  --device auto --epochs 100
```

Keep the output directory on persistent local storage; it holds the run settings
and resumable checkpoint. The capture archives can stay wherever you have room.

`auto` uses Apple MPS when PyTorch exposes it and otherwise uses CPU. Training
uses a small time-domain regressor and bounded sample windows. It checkpoints
every 16 batches and after each completed epoch. Closing the Mac for sleep
suspends the process with the OS; it continues after wake. There is no
calendar-day runtime cap. To pause training manually, press Ctrl-C or run this
from another terminal:

```sh
/private/tmp/napt-audio-demod-env/bin/python scripts/audio_demod/train.py pause \
  --output-dir "$HOME/Library/Application Support/N-APT/audio-demod/runs/run-001"
```

To resume after a manual pause or process restart, rerun the training command
with the same output directory. The run file holds the dataset/split paths and
training settings, so the short resume command is:

```sh
/private/tmp/napt-audio-demod-env/bin/python scripts/audio_demod/train.py resume \
  --output-dir "$HOME/Library/Application Support/N-APT/audio-demod/runs/run-001"
```

If the process is terminated before its next checkpoint, resume starts from the
latest saved batch or epoch. The trainer refuses changed captures or split assignments when resuming. It
selects the best epoch using validation sessions, evaluates the untouched test
sessions once, and compares test output against available AM/FM/APT baselines.
Outputs include `audio_demod_run.json`, `audio_demod_checkpoint.pt`, `audio_demod_progress.json`,
`audio_demod_report.json`, `audio_demod.onnx`, `audio_demod.weights.f32le`, and
`audio_demod.manifest.json`. ONNX uses `iq_fourier_windows` `[batch, 192]` and
`pcm` `[batch, 1]`, matching the current browser runtime. The manifest binds the
model and weights checksums to their training profile and report. To load the
export into the app, open `/demodulate`, select **Load Python ONNX model**, and
choose the `.onnx`, `.manifest.json`, and `.weights.f32le` files together. The
app stores the bundle locally and enables Neural output only when the held-out
DSP comparison passes and the live sample-rate/channel-width profile matches.
The artifact is explicitly experimental; a lower test RMSE alone does not
establish that the decoder generalizes to other sessions or channel widths.

## Current boundary

This first Python slice exports the current browser model v4 contract: a
64-complex-sample raw-I/Q context concatenated with 64 Hann-windowed,
FFT-shifted log-power features, mapped to one PCM sample. The Fourier values
supplement raw I/Q. Training and ONNX export run offline in Python; live capture
and ONNX inference stay in the TypeScript app. Keep capture archives, split
maps, checkpoints, reports, and models in local-only folders; do not add
recorded signal data to Git.
