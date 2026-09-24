# Offline native-spectrum classifier

The browser path uses the application's WebGPU device and adds no model-runtime dependency. Model training and capture processing are separate operator-run tools. Keep decrypted captures and derived feature files under `/private/tmp` or another local-only folder; never add raw captures, keys, or generated datasets to Git.

Install the small baseline dependency with `python3 -m venv .venv-classifier && .venv-classifier/bin/pip install -r scripts/classifier/requirements.txt`. The NumPy logistic and 16-unit MLP trainers need only NumPy. To enable accelerated MPS training on Apple Silicon, install optional PyTorch with `.venv-classifier/bin/pip install -r scripts/classifier/requirements-pytorch.txt`. `--device auto` uses MPS if available, then CPU; NumPy is the fallback when PyTorch is absent. `--device mps` requires an available MPS backend.

Create a JSON manifest with explicit recording ids, session ids, split, label (`matching`, `nonmatching`, or `uncertain`), path, sample format (`napt`, `u8`, `s16le`, `f32le`, or `browser-capture`), sample rate in Hz, and center frequency in Hz. For `.napt`, provide `fftSize`; password loading reuses the existing local `.env.local` / environment contract and does not print credentials. Splits are assigned by whole session and validated before processing. Keep attached acceptance captures in the `acceptance` split; the trainer excludes them. Uncertain rows are never used for fitting or threshold selection.

The browser classifier's **Start training capture → Stop/export** button downloads two linked files: a label-agnostic I/Q capture and an annotation sidecar. Capture metadata stores the initial applied RX options once, then compact `PatchOptionsApplied` and `StreamInterrupted` events aligned to exact byte/frame/timestamp boundaries. Each frame contains only its epoch/revision, sequence, timestamp, valid sample count, and raw I/Q bytes; frames remain independent and are never joined across a gap. Labels, observed N-APT channel, morphology toggles, condition tags, and `InterferenceMarked` events live only in the sidecar keyed by `captureId`/`sessionId`. You can revise labels after capture without changing the raw recording. `prepare` joins a sidecar only when the manifest explicitly names it and the IDs match; unlabeled captures remain valid input for inspection or classification. Keep each capture as its own source recording and assign its full acquisition session to exactly one split. Example:

```json
{
  "recordings": [{
    "id": "channel-a-session-01",
    "session": "channel-a-session-01",
    "split": "train",
    "label": "matching",
    "input": "captures/channel-a.json",
    "annotations": "captures/channel-a.annotations.json",
    "format": "browser-capture",
    "sampleRateHz": 3200000,
    "centerFrequencyHz": 137500000
  }]
}
```

For a real classifier, use separate manually reviewed captures for training, validation, and untouched test sessions, including real negative signals. The supplied mock negatives remain useful regression fixtures but are not a substitute for real negatives.

```sh
node scripts/classifier/cli.mjs prepare --manifest manifest.json --out /private/tmp/napt-classifier/prepared --env-file .env.local
node scripts/classifier/cli.mjs extract --dataset /private/tmp/napt-classifier/prepared/dataset.json --fft-sizes 1024,4096,16384 --crops 0:1,0.25:0.75 --window hann --max-frames 64 --out /private/tmp/napt-classifier/features.jsonl
python3 scripts/classifier/train.py train --features /private/tmp/napt-classifier/features.jsonl --model /private/tmp/napt-classifier/model.json --report /private/tmp/napt-classifier/validation.json
python3 scripts/classifier/train.py evaluate --features /private/tmp/napt-classifier/features.jsonl --split test --model /private/tmp/napt-classifier/model.json --report /private/tmp/napt-classifier/test.json
node scripts/classifier/cli.mjs classify --input /private/tmp/napt-classifier/prepared/dataset.json --model /private/tmp/napt-classifier/model.json --out /private/tmp/napt-classifier/classifications.jsonl
```

The trainer holds out whole training sessions for MLP early stopping when it can keep both labels in both subsets. If the training data has too few distinct sessions, it reports why monitoring is unavailable and fits with all ready training rows. Logistic regression and the MLP use the same fitting rows. The report contains `runManifest.datasetSha256` for the exact feature JSONL, split/session inventory, source revision and dirty-state marker, runtime versions, run settings, and selected normalization. It also records the selected candidate and validation balanced accuracy; the untouched test split is not used for candidate or threshold selection. To save both candidates alongside the selected model, pass `--candidates-dir /private/tmp/napt-classifier/candidates`.

The optional `--search-grid` flag runs the predeclared comparison: logistic L2 `{0, 1e-4, 1e-3, 1e-2}` and 16-unit MLP L2 `{1e-4, 1e-3}` at three seeds (the base `--seed` and the next two integers). For example, `python3 scripts/classifier/train.py train --features /private/tmp/features.jsonl --model /private/tmp/selected.json --report /private/tmp/report.json --device auto --search-grid --seed 1729 --candidates-dir /private/tmp/candidates`. Every candidate shares the same fitting, monitoring, and validation sessions; the test split is never opened for selection. Each threshold is selected against validation session-balanced balanced accuracy. The best logistic L2 uses stronger regularization on ties; each MLP L2 is ranked by its mean across seeds, again preferring stronger regularization on ties, and its representative seed is closest to that mean (lowest seed on ties). Logistic wins a tie against the best MLP mean. The report records all candidate configurations, thresholds, validation scores, seed variation, selected rule, and session IDs. Grid artifacts use unique filenames. `--device` keeps its existing meaning (`auto`, `numpy`, `cpu`, or `mps`); explicit unavailable backends still fail rather than silently falling back.

Reproducibility controls include `--seed`, `--monitor-fraction`, `--logistic-max-iter`, `--logistic-tolerance`, `--logistic-l2`, `--mlp-epochs`, `--mlp-patience`, `--mlp-min-delta`, `--mlp-l2`, and `--learning-rate`. These tune a single run; with `--search-grid`, the declared L2 grids and three seeds take precedence over the single-run `--logistic-l2`, `--mlp-l2`, and `--seed` values (the supplied seed is the first of the three). The exported model/report are synthetic-only when every labeled train and validation row is explicitly marked `syntheticOnly`; synthetic runs prove the pipeline works, not signal accuracy.

`extract` runs the shared WGSL features in a temporary local headless Chromium instance, without the app server. It uses overlapping 50% windows and samples up to 64 representative frames evenly across each capture per FFT/crop (configurable from 1 to 256). FFT size denotes actual analysis samples; a short final window has its actual FFT size and valid sample count recorded. `--crops` are fractions of each resulting FFT-shifted spectrum, so native bin spacing and original crop offsets are preserved. This is a manual analysis tool, not part of CI.

The current feature scales, threshold, and `native-morphology-v1` extractor need calibration against independent, explicitly labeled sessions. Synthetic data only tests data flow. Reports break out resolution/session/visibility and must include insufficient-evidence coverage; they are not grounds to promote an unvalidated model. Only 3.2 MS/s is currently targeted. No validation claim should be made for another rate without captured, labeled evaluation data.

Sidebar morphology/condition toggles are annotations in the sidecar, never model inputs. The current trainer learns only the binary `matching`/`nonmatching` target; the toggles are preserved for review but do not yet train separate feature predictions. Native v1 includes rough within-frame peak spacing and peak prominence above a 20th-percentile spectral-floor estimate, plus duration-weighted bridge/U-dip persistence. It does not yet measure pulse rate, duty cycle, amplitude-modulation depth, or rise/fall timing.
