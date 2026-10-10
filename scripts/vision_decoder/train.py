#!/usr/bin/env python3
"""Train the experimental Channel C visual decoder from paired JSONL features."""

import argparse
import copy
import datetime
import hashlib
import json
import pathlib
import platform

import numpy as np


PREPROCESSING_VERSION = 2
FEATURE_SHAPE = (10, 1024, 2)
FEATURE_COUNT = int(np.prod(FEATURE_SHAPE))
TARGET_COUNT = 16 * 16 * 3
PREPROCESSING_CONTRACT = {
    "version": 2,
    "fftSize": 1024,
    "hopSamples": 512,
    "window": "hann-periodic",
    "temporalSlices": 10,
    "contextMs": 30,
    "featureOrder": ["logPower", "phaseDelta"],
    "iqEncoding": "u8-interleaved",
    "normalization": "(value-128)/127",
    "binOrder": "fftshift",
    "phaseUnit": "radians",
    "tensorShape": [10, 1024, 2],
    "power": "log1p(magnitudeSquared/windowEnergy)",
    "phaseDelta": "arg(current*conjugate(previous)); zero for first or zero-power bin",
    "aggregation": "mean logPower and circular-mean phaseDelta per 3ms slice",
    "context": "preceding 30ms; reject missing slices and discontinuities",
}
DATASET_FORMAT = "napt-vision-training-jsonl"
DECODER_FORMAT = "napt-vision-decoder"
DECODER_ARCHITECTURE = "freq-conv-temporal-v2"
COLOR_TRANSFORM = "linear-srgb-lms-opponent-v1"
SPLITS = ("train", "validation", "test")
COLOR_LOSS_WEIGHT = 0.2


def validate_dataset(manifest, rows):
    """Validate the versioned interchange and return safe split metadata."""
    if not isinstance(manifest, dict) or manifest.get("type") != "manifest":
        raise ValueError("Dataset must start with a manifest row")
    if manifest.get("format") != DATASET_FORMAT or manifest.get("version") != 1:
        raise ValueError("Unsupported vision training dataset format or version")
    if manifest.get("preprocessing") != PREPROCESSING_CONTRACT:
        raise ValueError("Vision preprocessing version, order, or settings mismatch")
    target = manifest.get("target", {})
    if target != {
        "width": 16,
        "height": 16,
        "fps": 10,
        "coordinates": "opponent",
        "colorTransform": COLOR_TRANSFORM,
    }:
        raise ValueError("Vision target contract mismatch")

    session_splits = manifest.get("sessionSplits")
    if not isinstance(session_splits, dict) or not session_splits:
        raise ValueError("Explicit session assignment is required")
    if any(not session or split not in SPLITS for session, split in session_splits.items()):
        raise ValueError("Invalid session assignment")
    grid = manifest.get("frequencyGrid")
    if not isinstance(grid, dict):
        raise ValueError("Vision frequency grid is required")
    try:
        center_hz = float(grid["centerFrequencyHz"])
        sample_rate_hz = int(grid["sampleRateHz"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Invalid vision frequency grid") from error
    if not np.isfinite(center_hz) or center_hz < 0 or sample_rate_hz < 3_200_000 or sample_rate_hz % 100:
        raise ValueError("Unsupported vision frequency grid")
    if grid.get("centerFrequencyHz") != center_hz or grid.get("sampleRateHz") != sample_rate_hz:
        raise ValueError("Frequency grid values must be finite numeric Hz")

    if not isinstance(rows, list) or not rows:
        raise ValueError("Vision examples are required")
    if manifest.get("exampleCount") != len(rows):
        raise ValueError("Vision example count does not match the manifest")
    excluded = manifest.get("excludedTransitionCount")
    if not isinstance(excluded, int) or excluded < 0:
        raise ValueError("Invalid transition exclusion count")

    seen_splits = set()
    capture_identity = {}
    trial_identity = {}
    contexts = set()
    calibration_splits = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("type") != "example":
            raise ValueError("Every dataset line after the manifest must be an example")
        session, split = row.get("sessionId"), row.get("split")
        if not session or session not in session_splits:
            raise ValueError("Every example requires an explicit session assignment")
        if split not in SPLITS or session_splits[session] != split:
            raise ValueError("Session split mismatch or leakage")
        seen_splits.add(split)
        checksum = row.get("artifactChecksum")
        if (
            not row.get("trialId")
            or not isinstance(checksum, str)
            or len(checksum) != 64
            or any(ch not in "0123456789abcdef" for ch in checksum)
        ):
            raise ValueError("Invalid vision trial or capture artifact identity")
        if row.get("frequencyGrid") != grid:
            raise ValueError("Vision examples must use the manifest frequency grid")
        timestamp = row.get("timestampBackendMs")
        frame_index = row.get("frameIndex")
        if (
            not isinstance(timestamp, (float, int))
            or not np.isfinite(timestamp)
            or not isinstance(frame_index, int)
            or frame_index < 0
        ):
            raise ValueError("Invalid vision feature context timestamp or frame")

        features = np.asarray(row.get("features"), dtype=np.float32)
        opponent = np.asarray(row.get("opponent"), dtype=np.float32)
        rgb_input = np.asarray(row.get("rgb"))
        if features.shape != (FEATURE_COUNT,) or not np.isfinite(features).all():
            raise ValueError("Vision feature shape or values are invalid")
        if opponent.shape != (TARGET_COUNT,) or not np.isfinite(opponent).all():
            raise ValueError("Vision opponent target shape or values are invalid")
        if (
            rgb_input.shape != (TARGET_COUNT,)
            or not np.issubdtype(rgb_input.dtype, np.integer)
            or np.any(rgb_input < 0)
            or np.any(rgb_input > 255)
        ):
            raise ValueError("Vision RGB target must contain 768 byte values")
        color_class = row.get("colorClassIndex")
        if color_class is not None and (not isinstance(color_class, int) or color_class < 0 or color_class > 3):
            raise ValueError("Invalid solid-color class label")

        seed = row.get("calibrationSeed")
        if seed is not None:
            if not isinstance(seed, int) or seed < 0 or seed > 0xFFFFFFFF:
                raise ValueError("Invalid calibration seed")
            if seed in calibration_splits and calibration_splits[seed] != split:
                raise ValueError("Calibration seed leaked across session splits")
            calibration_splits[seed] = split

        trial_key = row["trialId"]
        identity = (session, row["artifactChecksum"], split)
        if trial_key in trial_identity and trial_identity[trial_key] != identity:
            raise ValueError("A trial cannot identify multiple captures or splits")
        trial_identity[trial_key] = identity
        checksum = row["artifactChecksum"]
        capture_owner = (session, trial_key, split)
        if checksum in capture_identity and capture_identity[checksum] != capture_owner:
            raise ValueError("Capture artifact is reused across trials or splits")
        capture_identity[checksum] = capture_owner
        context_key = (trial_key, frame_index, float(timestamp))
        if context_key in contexts:
            raise ValueError("Duplicate vision feature context")
        contexts.add(context_key)

    if seen_splits != set(SPLITS):
        raise ValueError("Training requires train, validation, and test examples")
    return {
        "session_count": len({row["sessionId"] for row in rows}),
        "example_count": len(rows),
        "excluded_transition_count": excluded,
        "frequency_grid": {"centerFrequencyHz": center_hz, "sampleRateHz": sample_rate_hz},
        "session_splits": dict(sorted(session_splits.items())),
        "rows": rows,
    }


def load_dataset(path):
    source = pathlib.Path(path).read_bytes()
    try:
        parsed = [json.loads(line) for line in source.decode("utf-8").splitlines() if line.strip()]
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Vision dataset must be valid UTF-8 JSONL") from error
    if not parsed:
        raise ValueError("Vision dataset is empty")
    validated = validate_dataset(parsed[0], parsed[1:])
    validated["sha256"] = hashlib.sha256(source).hexdigest()
    return validated


def fit_normalization(features, train_mask):
    values = np.asarray(features, dtype=np.float32)
    mask = np.asarray(train_mask, dtype=bool)
    if values.ndim != 2 or values.shape[0] != mask.size or not mask.any() or not np.isfinite(values).all():
        raise ValueError("Normalization requires finite rows and a nonempty training mask")
    training = values[mask].astype(np.float64)
    mean = training.mean(axis=0)
    scale = np.maximum(training.std(axis=0), 1e-6)
    return mean.astype(np.float32), scale.astype(np.float32)


def session_balanced_mse(expected, predicted, session_ids):
    actual = np.asarray(expected, dtype=np.float64)
    estimate = np.asarray(predicted, dtype=np.float64)
    sessions = np.asarray(session_ids, dtype=object)
    if (
        actual.ndim != 2
        or estimate.shape != actual.shape
        or sessions.ndim != 1
        or len(sessions) != actual.shape[0]
        or not len(sessions)
        or not np.isfinite(actual).all()
        or not np.isfinite(estimate).all()
    ):
        raise ValueError("Session-balanced MSE requires finite aligned examples")
    per_session = [
        float(np.mean((estimate[sessions == session] - actual[sessions == session]) ** 2))
        for session in dict.fromkeys(sessions.tolist())
    ]
    return float(np.mean(per_session))


def rgb_from_opponent(values):
    value = np.asarray(values, dtype=np.float64).reshape(-1, 16, 16, 3)
    y, rg, by = value[..., 0], value[..., 1], value[..., 2]
    l, m, s = (y + rg) / 2, (y - rg) / 2, by + y
    inverse = np.asarray([
        [5.47221206, -4.6419601, 0.16963708],
        [-1.1252419, 2.29317094, -0.1678952],
        [0.02980165, -0.19318073, 1.16364789],
    ])
    linear = np.einsum("ij,bhwj->bhwi", inverse, np.stack([l, m, s], axis=-1))
    encoded = np.where(linear <= 0.0031308, 12.92 * linear, 1.055 * np.power(np.maximum(linear, 0), 1 / 2.4) - 0.055)
    return np.clip(encoded, 0, 1).reshape(-1, TARGET_COUNT).astype(np.float32)


def make_decoder(torch, input_mean, input_scale):
    class FrequencyTemporalDecoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.register_buffer("input_mean", torch.from_numpy(input_mean.copy()).view(1, FEATURE_COUNT))
            self.register_buffer("input_scale", torch.from_numpy(input_scale.copy()).view(1, FEATURE_COUNT))
            self.frequency_conv = torch.nn.Conv1d(2, 4, kernel_size=5, padding=2)
            self.temporal = torch.nn.Linear(4 * 10 * 8, 24)
            self.opponent = torch.nn.Linear(24, TARGET_COUNT)
            self.color = torch.nn.Linear(24, 4)

        def forward(self, vision_features):
            batch = vision_features.shape[0]
            normalized = (vision_features - self.input_mean) / self.input_scale
            slices = normalized.reshape(batch, 10, 1024, 2)
            bands = slices.reshape(batch, 10, 64, 16, 2).mean(dim=3)
            by_frequency = bands.permute(0, 1, 3, 2).reshape(batch * 10, 2, 64)
            convolved = torch.relu(self.frequency_conv(by_frequency))
            pooled = torch.nn.functional.avg_pool1d(convolved, kernel_size=8, stride=8)
            pooled = pooled.reshape(batch, 10, 4, 8).permute(0, 2, 1, 3).reshape(batch, 4 * 10 * 8)
            hidden = torch.tanh(self.temporal(pooled))
            return self.opponent(hidden), self.color(hidden)

    return FrequencyTemporalDecoder()


def choose_device(torch, requested):
    if requested == "cpu":
        return torch.device("cpu")
    available = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
    if requested == "mps" and not available:
        raise ValueError("MPS was requested but is unavailable in this Python environment")
    return torch.device("mps" if available else "cpu")


def train_and_export(
    dataset,
    output_dir,
    *,
    epochs=100,
    patience=12,
    learning_rate=1e-3,
    seed=1729,
    device="auto",
    batch_size=16,
):
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("Install scripts/vision_decoder/requirements.txt to train and export ONNX") from error
    try:
        import onnx  # noqa: F401
    except ImportError as error:
        raise RuntimeError("Install scripts/vision_decoder/requirements.txt to validate ONNX export") from error
    if epochs < 1 or patience < 1 or batch_size < 1 or learning_rate <= 0 or seed < 0:
        raise ValueError("Invalid vision trainer settings")

    rows = dataset["rows"]
    feature_values = np.stack([np.asarray(row["features"], dtype=np.float32) for row in rows])
    opponent_values = np.stack([np.asarray(row["opponent"], dtype=np.float32) for row in rows])
    rgb_values = np.stack([np.asarray(row["rgb"], dtype=np.float32) / 255 for row in rows])
    class_values = np.asarray(
        [
            -1 if row["colorClassIndex"] is None else row["colorClassIndex"]
            for row in rows
        ],
        dtype=np.int64,
    )
    split_values = np.asarray([row["split"] for row in rows])
    train_mask = split_values == "train"
    validation_mask = split_values == "validation"
    test_mask = split_values == "test"
    input_mean, input_scale = fit_normalization(feature_values, train_mask)

    torch.manual_seed(seed)
    device_value = choose_device(torch, device)
    model = make_decoder(torch, input_mean, input_scale).to(device_value)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    x_cpu = torch.from_numpy(feature_values)
    y_cpu = torch.from_numpy(opponent_values)
    labels_cpu = torch.from_numpy(class_values)
    rng = torch.Generator(device="cpu").manual_seed(seed)
    train_indices = torch.from_numpy(np.flatnonzero(train_mask))
    validation_indices = np.flatnonzero(validation_mask)
    best_validation_mse = float("inf")
    best_state = None
    best_epoch = 0
    stale_epochs = 0
    history = []

    def predict(indices, output_index=0):
        model.eval()
        outputs = []
        with torch.no_grad():
            for offset in range(0, len(indices), batch_size):
                selected = indices[offset : offset + batch_size]
                x = x_cpu[selected].to(device_value)
                outputs.append(model(x)[output_index].detach().cpu().numpy())
        return np.concatenate(outputs, axis=0)

    for epoch in range(1, epochs + 1):
        model.train()
        order = train_indices[torch.randperm(len(train_indices), generator=rng)]
        for offset in range(0, len(order), batch_size):
            selected = order[offset : offset + batch_size]
            x = x_cpu[selected].to(device_value)
            opponent_target = y_cpu[selected].to(device_value)
            color_target = labels_cpu[selected].to(device_value)
            predicted_opponent, color_logits = model(x)
            loss = torch.nn.functional.mse_loss(predicted_opponent, opponent_target)
            color_mask = color_target >= 0
            if color_mask.any():
                loss = loss + COLOR_LOSS_WEIGHT * torch.nn.functional.cross_entropy(
                    color_logits[color_mask], color_target[color_mask]
                )
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

        validation_prediction = predict(validation_indices)
        validation_mse = session_balanced_mse(
            opponent_values[validation_mask],
            validation_prediction,
            [rows[index]["sessionId"] for index in validation_indices],
        )
        history.append(
            {"epoch": epoch, "validationSessionBalancedOpponentMse": validation_mse}
        )
        if validation_mse < best_validation_mse:
            best_validation_mse = validation_mse
            best_state = copy.deepcopy(model.state_dict())
            best_epoch = epoch
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break
    if best_state is None:
        raise RuntimeError("Vision training produced no finite validation checkpoint")
    model.load_state_dict(best_state)

    # The test partition is read only after validation selected the checkpoint.
    test_indices = np.flatnonzero(test_mask)
    test_opponent = predict(test_indices)
    expected_opponent = opponent_values[test_mask]
    expected_rgb = rgb_values[test_mask]
    predicted_rgb = rgb_from_opponent(test_opponent)
    test_session_ids = [rows[index]["sessionId"] for index in test_indices]
    training_rgb = rgb_values[train_mask]
    mean_image = training_rgb.mean(axis=0)
    mean_color = training_rgb.reshape(-1, 16, 16, 3).mean(axis=(0, 1, 2))
    test_metrics = {
        "frameCount": int(len(test_indices)),
        "sessionCount": int(len({rows[index]["sessionId"] for index in test_indices})),
        "opponentMse": float(np.mean((test_opponent - expected_opponent) ** 2)),
        "sessionBalancedOpponentMse": session_balanced_mse(
            expected_opponent, test_opponent, test_session_ids
        ),
        "rgbMse": float(np.mean((predicted_rgb - expected_rgb) ** 2)),
        "sessionBalancedRgbMse": session_balanced_mse(
            expected_rgb, predicted_rgb, test_session_ids
        ),
        "meanImageRgbMse": float(np.mean((mean_image - expected_rgb) ** 2)),
        "constantColorRgbMse": float(
            np.mean(
                (
                    mean_color.reshape(1, 1, 1, 3)
                    - expected_rgb.reshape(-1, 16, 16, 3)
                )
                ** 2
            )
        ),
    }
    labeled_test = (class_values[test_mask] >= 0)
    test_color_count = int(labeled_test.sum())
    if test_color_count:
        color_logits = predict(test_indices, output_index=1)
        test_metrics["colorAccuracy"] = float(
            np.mean(
                color_logits[labeled_test].argmax(axis=1)
                == class_values[test_mask][labeled_test]
            )
        )
    else:
        test_metrics["colorAccuracy"] = None
    test_metrics["colorExampleCount"] = test_color_count

    target_dir = pathlib.Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    model_path = target_dir / "vision_decoder.onnx"
    temporary_model_path = target_dir / "vision_decoder.onnx.tmp"
    model.eval()
    model.to(torch.device("cpu"))
    dummy = torch.zeros((1, FEATURE_COUNT), dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        str(temporary_model_path),
        input_names=["vision_features"],
        output_names=["opponent", "color_logits"],
        dynamic_axes={
            "vision_features": {0: "batch"},
            "opponent": {0: "batch"},
            "color_logits": {0: "batch"},
        },
        opset_version=13,
        dynamo=False,
    )
    onnx_model = onnx.load(str(temporary_model_path))
    onnx.checker.check_model(onnx_model)
    temporary_model_path.replace(model_path)
    model_sha = hashlib.sha256(model_path.read_bytes()).hexdigest()
    model_id = f"vision-decoder-{seed}-{dataset['sha256'][:12]}"
    manifest = {
        "format": DECODER_FORMAT,
        "artifactVersion": 1,
        "modelVersion": 2,
        "modelId": model_id,
        "architecture": DECODER_ARCHITECTURE,
        "modelFile": model_path.name,
        "modelSha256": model_sha,
        "datasetSha256": dataset["sha256"],
        "preprocessingVersion": PREPROCESSING_VERSION,
        "featureShape": list(FEATURE_SHAPE),
        "referenceVersion": 1,
        "colorTransform": COLOR_TRANSFORM,
        "frequencyGrid": dataset["frequency_grid"],
        "output": {"width": 16, "height": 16, "fps": 10, "coordinates": "opponent"},
        "sessionSplits": dataset["session_splits"],
        "trainingTrialIds": sorted({row["trialId"] for row in rows if row["split"] == "train"}),
        "status": "experimental",
        "promotionAllowed": False,
    }
    report = {
        "format": DECODER_FORMAT,
        "artifactVersion": 1,
        "createdAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "datasetSha256": dataset["sha256"],
        "dataset": {
            "exampleCount": dataset["example_count"],
            "sessionCount": dataset["session_count"],
            "excludedTransitionCount": dataset["excluded_transition_count"],
            "sessionSplits": dataset["session_splits"],
        },
        "training": {
            "seed": seed,
            "device": str(device_value),
            "epochsRequested": epochs,
            "epochsRun": len(history),
            "bestEpoch": best_epoch,
            "bestValidationOpponentMse": best_validation_mse,
            "batchSize": batch_size,
            "learningRate": learning_rate,
            "normalizationFit": "train sessions only",
            "runtime": {"python": platform.python_version(), "numpy": np.__version__, "torch": torch.__version__},
        },
        "heldOutTest": test_metrics,
        "validationHistory": history,
        "modelSha256": model_sha,
        "status": "experimental",
        "promotionAllowed": False,
    }
    write_json_atomic(target_dir / "vision_decoder.manifest.json", manifest)
    write_json_atomic(target_dir / "vision_decoder.report.json", report)
    return manifest, report


def write_json_atomic(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, help="Prepared, paired vision dataset JSONL")
    parser.add_argument("--output-dir", required=True, help="Local directory for ONNX, manifest, and report")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=1729)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    args = parser.parse_args(argv)
    try:
        dataset = load_dataset(args.dataset)
        manifest, report = train_and_export(
            dataset,
            args.output_dir,
            epochs=args.epochs,
            patience=args.patience,
            learning_rate=args.learning_rate,
            seed=args.seed,
            device=args.device,
            batch_size=args.batch_size,
        )
    except (ValueError, RuntimeError) as error:
        parser.error(str(error))
    print(
        json.dumps(
            {
                "model": manifest["modelFile"],
                "modelSha256": manifest["modelSha256"],
                "bestEpoch": report["training"]["bestEpoch"],
                "test": report["heldOutTest"],
                "status": manifest["status"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
