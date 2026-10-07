# Offline visual demodulation training

The visual path is a demodulation pipeline. It consumes versioned Channel C
frequency-bin features paired with the timed RGB reference, learns a spatial
decoder offline in Python, and writes ONNX for local browser inference. The
S/M/L/Red output is a secondary calibration head; it does not replace the RGB
reconstruction target.

`visionDataset.ts` exports a prepared `VisionTrainingDataset` with
`serializeVisionTrainingDataset(dataset, sessionSplits)`. The JSONL contains
derived feature tensors and paired targets, not raw I/Q or capture decryption
material. Keep it and the resulting model/report in a local working directory.

```sh
python3 -m venv /private/tmp/napt-vision-env
/private/tmp/napt-vision-env/bin/pip install -r scripts/vision_decoder/requirements.txt
/private/tmp/napt-vision-env/bin/python scripts/vision_decoder/train.py \
  --dataset /private/tmp/napt-vision/train.jsonl \
  --output-dir /private/tmp/napt-vision/model \
  --device auto
```

The trainer rejects unknown formats, wrong feature/target dimensions, capture
reuse, mixed RF grids, invalid labels, and session or calibration-seed leakage.
Normalization is fit only on training sessions. Validation selects the best
epoch and early-stopping point; the test partition is evaluated after
selection. Outputs are `vision_decoder.onnx`, a checksum-bound
`vision_decoder.manifest.json`, and a `vision_decoder.report.json` containing
the held-out metrics and run provenance. The manifest remains explicitly
experimental and disables promotion.

The ONNX contract is the current browser contract: `vision_features` has shape
`[batch, 10 * 1024 * 2]`; outputs are `opponent` `[batch, 16 * 16 * 3]` and
`color_logits` `[batch, 4]`. Load a model and its parsed sidecar with
`createVisionOnnxRuntimeFromPythonArtifact`; the browser checks the model SHA-256
and RF frequency grid before inference.

## Current boundary

The Python trainer and browser loader are implemented, but the verified path
from encrypted SDR captures through producer-indexed I/Q preprocessing into
the prepared JSONL is not wired into the app yet. Do not hand-author labels or
promote a model from synthetic examples. First complete capture/reference
alignment and feature export, then validate with independent sessions and
partial-band spatial references. This first trainer binds to one exact RF grid;
it does not merge different Channel C tuning windows or learn a regional
coverage mask yet. A lower image MSE by itself is not evidence that the RF
signal contains a recoverable image.

Focused contract tests:

```sh
python3 -m unittest discover -s scripts/vision_decoder -p 'test_*.py'
npx jest test/ts/visionOfflineTraining.test.ts test/ts/visionOnnxRuntime.test.ts test/ts/DemodReadinessNode.test.tsx --runInBand --silent
```
