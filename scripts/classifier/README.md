# Offline native-spectrum classifier

The browser path uses the application's WebGPU device and adds no model-runtime dependency. Model training and capture processing are separate operator-run tools. Keep decrypted sample buffers and derived feature files under `/private/tmp` or another local-only folder. Store encrypted, labeled source Data Packages in the local Hugging Face dataset checkout at `../n-apt-ml/training-captures/classification`; never add plaintext captures or keys to Git.

For the end-to-end operator steps, start with [TRAINING_CHECKLIST.md](TRAINING_CHECKLIST.md). The learning method, gradient updates, candidate search, and threshold-selection contract are in [TRAINING_PLAN.md](TRAINING_PLAN.md); current verified progress and blockers are tracked in [HANDOFF.md](HANDOFF.md).

Install the small baseline dependency with `python3 -m venv .venv-classifier && .venv-classifier/bin/pip install -r scripts/classifier/requirements.txt`. The NumPy logistic and 16-unit MLP trainers need only NumPy. To enable accelerated MPS training on Apple Silicon, install optional PyTorch with `.venv-classifier/bin/pip install -r scripts/classifier/requirements-pytorch.txt`. `--device auto` uses MPS if available, then CPU; NumPy is the fallback when PyTorch is absent. `--device mps` requires an available MPS backend.

Create a JSON manifest with explicit recording ids, session ids, split, label (`matching`, `nonmatching`, or `uncertain`), path, sample format (`napt`, `u8`, `s16le`, `f32le`, or `browser-capture`), sample rate in Hz, and center frequency in Hz. For `.napt`, provide `fftSize`; password loading reuses the existing local `.env.local` / environment contract and does not print credentials. Splits are assigned by whole session and validated before processing. Keep attached acceptance captures in the `acceptance` split; the trainer excludes them. Uncertain rows are never used for fitting or threshold selection.

## Archive capture packages in the local Hugging Face checkout

The browser's one-click ZIP is still one download containing the V6 `.iq`, detached labels, and `datapackage.json`. To store a training-ready package in the local Hugging Face checkout, run:

```sh
node --import tsx scripts/classifier/archive-package.mjs \
  --package "$HOME/Downloads/n-apt-classifier-capture.zip" \
  --split train \
  --env-file .env.local
```

The command encrypts V6 `.iq` payloads with a per-capture AES-256-GCM key derived from the vault key and a random Redis salt. It rebinds the detached labels to the encrypted trailer checksum, preserves the source checksum in the Data Package descriptor, and updates the legacy-compatible seven-column `labels.csv`. It also accepts already-encrypted V6 `.napt` packages without changing their bytes; plaintext `.napt` must go through the capture migration/encryption workflow first. The output is split by label under `train`, `validation`, or `test`; uncertain captures go only under `unlabeled`, while mock and sinc challenge data use `challenge-mock` and `challenge-sinc`. The script never commits or pushes. Git LFS tracks the stored capture files.

Assign every acquisition session to exactly one split before deriving FFT windows, crops, or augmentations. The package scan rejects re-archiving the same source checksum into a different split, and a repeated archive operation is idempotent. Keep real RF nonmatching sessions separate from app mock and sinc challenges. The browser's backend **Save classification capture to Hugging Face** action stores a protected `.enc` artifact; use the downloaded Data Package plus this command when offline classifier `prepare` needs the original capture structure.

Classifier archive requires `REDIS_URL` in the shell or `.env.local` and the capture passkey in `.env.local`. For V6 `.iq`, it creates or reuses a random salt in Redis DB 1 at `capture-protection:<source-capture-checksum>`, then encrypts with the derived per-capture key. The package descriptor contains the Redis key name, never the salt. `prepare --package` looks up the salt and fails closed if it is missing. Back up Redis DB 1 using the deployment's supported backup procedure and test restoration before publishing protected classifier packages. Existing globally keyed V6 `.iq` packages are rewrapped with this per-capture key when archived.

On local development machines, restrict `.env.local` and Redis persistence files such as `.redis_data/dump.rdb` and `.redis_data/appendonlydir/*` to owner-only access. Use mode `600` for files and `700` for directories. Keep separate backup copies owner-only too; Redis backups contain the per-capture salts needed to decrypt the captures.

The browser classifier's **Start training capture → Stop/export** flow exposes one **Download capture package** link. It downloads one ZIP containing `datapackage.json`, the label-agnostic V6 `.iq` capture, and its detached annotation sidecar; no second download is needed. `prepare --package` accepts this ZIP directly and verifies the descriptor, resource sizes, SHA-256 hashes, V6 trailer, and label identity. Capture metadata stores the initial applied RX options once, then compact `PatchOptionsApplied` and `StreamInterrupted` events aligned to exact byte/frame/timestamp boundaries. Each frame contains only its epoch/revision, sequence, timestamp, valid sample count, and raw I/Q bytes; frames remain independent and are never joined across a gap. Labels, observed N-APT channel, morphology toggles, condition tags, and `InterferenceMarked` events stay in the sidecar; changing labels never changes the capture file. The identity contract prefers the verified V6 trailer SHA-256 digest, with its digest scope recorded. Browser-generated frame JSON has no V6 trailer, so its current v2 sidecar uses the exact capture filename plus the first acquired frame's UTC timestamp as `captureId`; its workflow `sessionId` remains a separate compatibility link. Keep each capture as its own source recording and assign its full acquisition session to exactly one split. Example:

For browser captures that declare lossless temporal resolution, the V6 header must contain one timestamped `Frame` update for every captured frame. `prepare` checks that count and rejects older or malformed files that claim lossless timing without frame markers; it does not infer time from concatenated bytes. The resulting dataset stores each acquired frame separately with its original sequence, timestamp, and sample count. These browser captures are frame-indexed observations, not a continuous raw-I/Q stream between frames: only the samples inside each frame are present. Temporal features must use the recorded frame times and must not treat the gaps between acquired frames as signal samples. Interference/view-condition tags are kept separate from the morphology label, so a user-confirmed matching signal remains positive when interference is visible.

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

## Detached labels and capture packages

Use `package` to keep annotation data separate from the original capture while describing both as resources in a standard Data Package. The command writes a directory whose root `datapackage.json` describes the byte-for-byte signal capture under `captures/` and `labels.json`. The browser's one-click ZIP uses equivalent `iq-capture` and `annotations` resource names. Both descriptors and per-resource `sha256:` hashes follow the [Data Package Standard](https://datapackage.org/standard/data-package/); labels remain a separate resource and are never inserted into the capture. The capture resource hash covers the exact stored bytes.

V6 `.iq` and `.napt` captures must pass the existing V6 trailer integrity verifier. For their label identity, `captureId` uses the trailer's SHA-256 digest and records its scope (`file-with-integrity-digest-placeholder`). This scoped trailer digest is distinct from the Data Package resource hash, which hashes the exact final file bytes. Encrypted `.napt` data is copied unchanged; packaging does not decrypt it. WAV has no V6 trailer, so it uses the exact filename and UTC capture timestamp. Browser frame JSON also has no V6 trailer and uses its filename plus first-frame timestamp; its bound v2 annotation sidecar can be passed directly.

A hand-authored draft can be used for a native capture:

```json
{
  "format": "n-apt-native-label-draft-v1",
  "sessionId": "channel-a-session-01",
  "annotations": {
    "label": "matching",
    "channel": "A",
    "features": ["bridge", "coherent-continuation"],
    "tags": ["stable", "low-interference"]
  },
  "annotationEvents": [],
  "interferenceMarkedEvents": []
}
```

Create a package with:

```sh
node --import tsx scripts/classifier/cli.mjs package \
  --capture /path/to/capture.iq \
  --labels /path/to/label-draft.json \
  --out /private/tmp/channel-a-session-01
```

For WAV files without a `YYYYMMDD_HHMMSS` filename suffix, pass `--captured-at 2026-09-27T10:20:30Z`. Existing bound browser annotation sidecars are checked against the named capture before packaging; an identity mismatch is rejected. The output directory must be new so this command cannot silently replace an earlier labeled package. The package records the selected label and `sessionId` but not a train/validation/test split; assign that later by whole acquisition session with `prepare --split`.

`prepare` now validates the Data Package descriptor and both resource hashes before reading either resource. It accepts browser frame JSON, unencrypted V6 `.iq`, and encrypted single-channel V6 `.napt`; `.napt` uses the existing password-file/environment decryption path. It splits native captures at each `PatchOptionsApplied` byte boundary and at missing chunk ranges, preserving the original frame-update offsets and timestamp metadata in the prepared dataset. Typed V6 `StreamInterrupted` frame updates with code `1` also split the analysis segment and remain a separate event in prepared features; a co-located option patch stays a distinct event at the same byte and timestamp boundary. A chunk offset is in complex samples; a frame-update offset is in I/Q bytes. The synthetic V6 reader/extractor test verifies this metadata path, but does not prove a capture writer emits interruption events during a real restart. WAV remains an attachable, hash-checked archive resource but cannot be used as classifier input because it is demodulated audio, not raw I/Q. Multi-channel `.napt` preparation is explicitly rejected until channel-wise decoding is implemented.

The single browser download can be prepared without extracting it first. Use a separate output path for each source capture/session:

```sh
node --import tsx scripts/classifier/cli.mjs prepare \
  --package /path/to/n-apt-classifier-capture.zip \
  --split acceptance \
  --out /private/tmp/napt-classifier/prepared-session-a
node scripts/classifier/cli.mjs extract \
  --dataset /private/tmp/napt-classifier/prepared-session-a/dataset.json \
  --fft-sizes 1024,4096,16384 --crops 0:1 --window hann --max-frames 64 \
  --out /private/tmp/napt-classifier/session-a-features.jsonl
```

For native `.iq`, set `--capture` to the V6 `.iq` file. For encrypted `.napt`, use the same command with the `.napt` file and add `--env-file .env.local` to `prepare`; the password is never passed as a command argument. A single labeled real-signal capture is suitable for an early shadow/diagnostic trial, but it is not enough to train, calibrate a threshold, or claim accuracy. Keep each capture session separate. Build training and validation from multiple independently labeled real N-APT and real-negative sessions; keep mock and sinc captures in challenge data, and reserve untouched sessions for evaluation. Until that data exists, inspect feature availability, resolution, crop visibility, rule scores, and timestamps without promoting or tuning to acceptance fixtures.

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
