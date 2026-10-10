#!/usr/bin/env python3
"""Train, evaluate, and export the experimental audio demodulator locally."""

from __future__ import annotations

import argparse
import copy
import datetime
import json
import os
import pathlib
import platform
import signal
import sys

import numpy as np

from dataset import _load_archive, load_training_corpus
from evaluate import evaluate_model
from features import build_model_inputs
from model import create_model
from export_onnx import export_onnx


DEFAULT_EPOCHS = 100
DEFAULT_PATIENCE = 14
DEFAULT_SAMPLES_PER_PAIR = 4096
DEFAULT_CHECKPOINT_EVERY_BATCHES = 16
EVALUATION_BUDGET = 6_000
EVALUATION_SEGMENT = 2_000


def atomic_json(path: pathlib.Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def save_checkpoint(torch, path: pathlib.Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save(value, temporary)
    os.replace(temporary, path)


def load_checkpoint(torch, path: pathlib.Path) -> dict:
    try:
        value = torch.load(path, map_location="cpu", weights_only=True)
    except TypeError:
        value = torch.load(path, map_location="cpu")
    if not isinstance(value, dict) or value.get("format") != "napt-audio-demod-checkpoint-v1":
        raise ValueError("Unsupported audio-demod checkpoint")
    return value


def choose_device(torch, requested: str):
    available = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
    if requested == "mps" and not available:
        raise ValueError("MPS was requested but is unavailable in this Python environment")
    if requested == "cpu":
        return torch.device("cpu")
    return torch.device("mps" if available else "cpu")


def _training_arrays(rows: list[dict], samples_per_pair: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    feature_blocks = []
    target_blocks = []
    for row in rows:
        reference = row["reference"]
        first_sample = 63
        available = np.arange(first_sample, reference.size, dtype=np.int64)
        if available.size == 0:
            continue
        count = min(samples_per_pair, available.size)
        indices = np.sort(rng.choice(available, size=count, replace=False))
        feature_blocks.append(build_model_inputs(row["iq"], reference.size, indices))
        target_blocks.append(reference[indices].astype(np.float32, copy=False))
    if not feature_blocks:
        raise ValueError("Training sessions have no complete I/Q contexts")
    return np.concatenate(feature_blocks), np.concatenate(target_blocks)


def _evaluation_rows(rows: list[dict]) -> list[dict]:
    prepared = []
    for row in rows:
        reference = row["reference"]
        if reference.size <= EVALUATION_BUDGET:
            indices = np.arange(reference.size, dtype=np.int64)
        else:
            last_start = reference.size - EVALUATION_SEGMENT
            starts = sorted(set((0, last_start // 2, last_start)))
            indices = np.concatenate(
                [np.arange(start, start + EVALUATION_SEGMENT, dtype=np.int64) for start in starts]
            )
        prepared.append(
            {
                **row,
                "eval_features": build_model_inputs(row["iq"], reference.size, indices),
                "eval_targets": reference[indices],
            }
        )
    return prepared


def _direct_session_rmse(model, torch, device, rows: list[dict], batch_size: int) -> float:
    session_errors: dict[str, list[float]] = {}
    model.eval()
    with torch.no_grad():
        for row in rows:
            features = row["eval_features"]
            targets = row["eval_targets"]
            predictions = []
            for start in range(0, len(features), batch_size):
                batch = torch.from_numpy(features[start : start + batch_size]).to(device)
                predictions.append(model(batch).detach().cpu().numpy().reshape(-1))
            output = np.concatenate(predictions)
            mse = float(np.mean((output - targets) ** 2))
            session_errors.setdefault(row["sessionId"], []).append(mse)
    if not session_errors:
        return float("inf")
    return float(np.sqrt(np.mean([np.mean(values) for values in session_errors.values()])))


def _optimizer_to(optimizer, device, torch) -> None:
    for state in optimizer.state.values():
        for key, value in state.items():
            if isinstance(value, torch.Tensor):
                state[key] = value.to(device)


def _corpus_summary(corpus: dict) -> dict:
    counts = {split: 0 for split in ("train", "validation", "test")}
    sessions = {split: set() for split in counts}
    for row in corpus["rows"]:
        counts[row["split"]] += 1
        sessions[row["split"]].add(row["sessionId"])
    return {
        "exampleCount": len(corpus["rows"]),
        "sessionCounts": {split: len(values) for split, values in sessions.items()},
        "exampleCounts": counts,
        "sessionSplits": corpus["session_splits"],
        "profile": corpus["profile"],
        "datasetSha256": corpus["dataset_sha256"],
    }


def inspect_command(args) -> int:
    archives = []
    for raw_path in args.dataset:
        path = pathlib.Path(raw_path)
        manifest, rows = _load_archive(path)
        archives.append(
            {
                "path": str(path),
                "sizeBytes": path.stat().st_size,
                "exampleCount": len(rows),
                "sessionIds": manifest["sessionIds"],
                "profiles": sorted(
                    {
                        (
                            example["iq"]["sampleRateHz"],
                            example["bandwidthHz"],
                            example["reference"]["sampleRateHz"],
                        )
                        for example, _, _, _ in rows
                    }
                ),
            }
        )
    print(json.dumps({"archives": archives}, indent=2))
    return 0


def train_command(args) -> int:
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("Install scripts/audio_demod/requirements.txt before training") from error

    if (
        not np.isfinite(args.learning_rate)
        or not np.isfinite(args.min_delta)
        or args.epochs < 1
        or args.patience < 1
        or args.batch_size < 1
        or args.samples_per_pair < 1
        or args.learning_rate <= 0
        or args.min_delta < 0
        or args.checkpoint_every_batches < 1
        or args.seed < 0
    ):
        raise ValueError("Training settings must be positive and seed must be nonnegative")

    corpus = load_training_corpus(args.dataset, args.splits)
    rows = corpus["rows"]
    train_rows = [row for row in rows if row["split"] == "train"]
    validation_source_rows = [row for row in rows if row["split"] == "validation"]
    test_rows = [row for row in rows if row["split"] == "test"]
    if not validation_source_rows or not test_rows:
        raise ValueError("Training requires independent validation and test sessions")

    output_dir = pathlib.Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output_dir / "audio_demod_checkpoint.pt"
    progress_path = output_dir / "audio_demod_progress.json"
    report_path = output_dir / "audio_demod_report.json"
    run_config_path = output_dir / "audio_demod_run.json"
    if checkpoint_path.exists() and not args.resume:
        raise FileExistsError(f"Checkpoint already exists; pass --resume to continue: {checkpoint_path}")
    if args.resume and not checkpoint_path.exists():
        raise FileNotFoundError(f"No checkpoint is available to resume: {checkpoint_path}")
    if not args.resume:
        atomic_json(
            run_config_path,
            {
                "format": "napt-audio-demod-run-config-v1",
                "datasetPaths": [str(pathlib.Path(path).resolve()) for path in args.dataset],
                "splitPath": str(pathlib.Path(args.splits).resolve()),
                "outputDir": str(output_dir.resolve()),
                "device": args.device,
                "epochs": args.epochs,
                "patience": args.patience,
                "batchSize": args.batch_size,
                "samplesPerPair": args.samples_per_pair,
                "learningRate": args.learning_rate,
                "minDelta": args.min_delta,
                "seed": args.seed,
                "checkpointEveryBatches": args.checkpoint_every_batches,
            },
        )

    device = choose_device(torch, args.device)
    torch.manual_seed(args.seed)
    model = create_model(torch).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    training_config = {
        "seed": args.seed,
        "learningRate": args.learning_rate,
        "batchSize": args.batch_size,
        "samplesPerPair": args.samples_per_pair,
        "patience": args.patience,
        "minDelta": args.min_delta,
    }
    start_epoch = 0
    resume_batch_cursor = 0
    resume_batch_order = None
    resume_epoch_squared_error = 0.0
    resume_epoch_sample_count = 0
    best_state = copy.deepcopy(model.state_dict())
    best_validation_rmse = float("inf")
    stale_epochs = 0
    history = []

    if args.resume:
        checkpoint = load_checkpoint(torch, checkpoint_path)
        if checkpoint.get("datasetSha256") != corpus["dataset_sha256"]:
            raise ValueError("Checkpoint corpus digest differs from the supplied captures or split map")
        if checkpoint.get("trainingConfig") != training_config:
            raise ValueError("Training configuration differs from the resumable checkpoint")
        model.load_state_dict(checkpoint["modelState"])
        optimizer.load_state_dict(checkpoint["optimizerState"])
        _optimizer_to(optimizer, device, torch)
        start_epoch = int(checkpoint["nextEpoch"])
        if start_epoch > args.epochs:
            raise ValueError("--epochs must be at least the checkpoint's next epoch")
        resume_batch_cursor = int(checkpoint.get("batchCursor", 0))
        resume_batch_order = checkpoint.get("batchOrder")
        resume_epoch_squared_error = float(checkpoint.get("epochSquaredError", 0.0))
        resume_epoch_sample_count = int(checkpoint.get("epochSampleCount", 0))
        best_state = checkpoint["bestModelState"]
        best_validation_rmse = float(checkpoint["bestValidationRmse"])
        stale_epochs = int(checkpoint["staleEpochs"])
        history = list(checkpoint.get("history", []))
        rng_state = checkpoint.get("torchRngState")
        if isinstance(rng_state, torch.Tensor):
            torch.set_rng_state(rng_state)

    pause_path = output_dir / "audio_demod_pause.requested"
    pause_path.unlink(missing_ok=True)
    pause_requested = False

    def handle_pause_signal(_signum, _frame):
        nonlocal pause_requested
        pause_requested = True

    summary = _corpus_summary(corpus)
    progress = {
        "format": "napt-audio-demod-training-progress-v1",
        "status": "running",
        "epoch": start_epoch,
        "totalEpochs": args.epochs,
        "bestValidationRmse": best_validation_rmse if np.isfinite(best_validation_rmse) else None,
        "device": str(device),
        "datasetSha256": corpus["dataset_sha256"],
        "checkpointEveryBatches": args.checkpoint_every_batches,
    }
    pause_signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGHUP"):
        pause_signals.append(signal.SIGHUP)
    previous_signal_handlers = {
        signum: signal.signal(signum, handle_pause_signal)
        for signum in pause_signals
    }

    try:
        initial_state = {
            "format": "napt-audio-demod-checkpoint-v1",
            "datasetSha256": corpus["dataset_sha256"],
            "nextEpoch": start_epoch,
            "batchCursor": resume_batch_cursor,
            "batchOrder": resume_batch_order,
            "epochSquaredError": resume_epoch_squared_error,
            "epochSampleCount": resume_epoch_sample_count,
            "modelState": model.state_dict(),
            "bestModelState": best_state,
            "optimizerState": optimizer.state_dict(),
            "bestValidationRmse": best_validation_rmse,
            "staleEpochs": stale_epochs,
            "history": history,
            "torchRngState": torch.get_rng_state(),
            "seed": args.seed,
            "trainingConfig": training_config,
        }
        if not args.resume:
            save_checkpoint(torch, checkpoint_path, initial_state)

        train_x, train_y = _training_arrays(train_rows, args.samples_per_pair, args.seed)
        train_x_tensor = torch.from_numpy(train_x)
        train_y_tensor = torch.from_numpy(train_y.reshape(-1, 1))
        if resume_batch_cursor > 0 and (
            not isinstance(resume_batch_order, torch.Tensor)
            or resume_batch_order.numel() != len(train_x_tensor)
            or resume_batch_cursor > len(train_x_tensor)
            or (
                resume_batch_cursor < len(train_x_tensor)
                and resume_batch_cursor % args.batch_size != 0
            )
        ):
            raise ValueError("Checkpoint in-epoch cursor does not match the training sample set")
        validation_rows = _evaluation_rows(validation_source_rows)

        for epoch in range(start_epoch, args.epochs):
            if pause_requested or pause_path.exists():
                progress["status"] = "paused"
                atomic_json(progress_path, progress)
                print("Paused before the next epoch; resume with --resume")
                return 0
            model.train()
            is_resuming_epoch = epoch == start_epoch and resume_batch_cursor > 0
            order = (
                resume_batch_order.to(device="cpu", dtype=torch.long)
                if is_resuming_epoch and isinstance(resume_batch_order, torch.Tensor)
                else torch.randperm(len(train_x_tensor))
            )
            batch_cursor = resume_batch_cursor if is_resuming_epoch else 0
            epoch_squared_error = resume_epoch_squared_error if is_resuming_epoch else 0.0
            epoch_sample_count = resume_epoch_sample_count if is_resuming_epoch else 0
            for batch_start in range(batch_cursor, len(order), args.batch_size):
                batch_indices = order[batch_start : batch_start + args.batch_size]
                features = train_x_tensor[batch_indices].to(device)
                targets = train_y_tensor[batch_indices].to(device)
                optimizer.zero_grad(set_to_none=True)
                predictions = model(features)
                loss = torch.mean((predictions - targets) ** 2)
                loss.backward()
                optimizer.step()
                epoch_squared_error += float(loss.detach().cpu()) * len(batch_indices)
                epoch_sample_count += len(batch_indices)
                batch_end = batch_start + len(batch_indices)
                pause_requested = pause_requested or pause_path.exists()
                completed_batches = (batch_start // args.batch_size) + 1
                should_checkpoint = (
                    completed_batches % args.checkpoint_every_batches == 0
                    and batch_end < len(order)
                )
                if pause_requested or should_checkpoint:
                    checkpoint = {
                        "format": "napt-audio-demod-checkpoint-v1",
                        "datasetSha256": corpus["dataset_sha256"],
                        "nextEpoch": epoch,
                        "batchCursor": batch_end,
                        "batchOrder": order.detach().cpu(),
                        "epochSquaredError": epoch_squared_error,
                        "epochSampleCount": epoch_sample_count,
                        "modelState": model.state_dict(),
                        "bestModelState": best_state,
                        "optimizerState": optimizer.state_dict(),
                        "bestValidationRmse": best_validation_rmse,
                        "staleEpochs": stale_epochs,
                        "history": history,
                        "torchRngState": torch.get_rng_state(),
                        "seed": args.seed,
                        "trainingConfig": training_config,
                    }
                    save_checkpoint(torch, checkpoint_path, checkpoint)
                    progress = {
                        **progress,
                        "status": "paused" if pause_requested else "running",
                        "epoch": epoch + 1,
                        "batchCursor": batch_end,
                        "batchCount": len(order),
                    }
                    atomic_json(progress_path, progress)
                    if pause_requested:
                        print(f"Paused during epoch {epoch + 1}, after batch sample {batch_end}; resume with --resume")
                        return 0

            validation_rmse = _direct_session_rmse(
                model, torch, device, validation_rows, args.batch_size
            )
            improved = validation_rmse < best_validation_rmse - args.min_delta
            if improved:
                best_validation_rmse = validation_rmse
                best_state = {
                    key: value.detach().cpu().clone()
                    for key, value in model.state_dict().items()
                }
                stale_epochs = 0
            else:
                stale_epochs += 1
            history.append(
                {
                    "epoch": epoch + 1,
                    "trainingRmse": float(np.sqrt(epoch_squared_error / max(1, epoch_sample_count))),
                    "validationRmse": validation_rmse,
                    "bestValidationRmse": best_validation_rmse,
                }
            )
            checkpoint = {
                "format": "napt-audio-demod-checkpoint-v1",
                "datasetSha256": corpus["dataset_sha256"],
                "nextEpoch": epoch + 1,
                "batchCursor": 0,
                "batchOrder": None,
                "epochSquaredError": 0.0,
                "epochSampleCount": 0,
                "modelState": model.state_dict(),
                "bestModelState": best_state,
                "optimizerState": optimizer.state_dict(),
                "bestValidationRmse": best_validation_rmse,
                "staleEpochs": stale_epochs,
                "history": history,
                "torchRngState": torch.get_rng_state(),
                "seed": args.seed,
                "trainingConfig": training_config,
            }
            resume_batch_cursor = 0
            resume_batch_order = None
            resume_epoch_squared_error = 0.0
            resume_epoch_sample_count = 0
            save_checkpoint(torch, checkpoint_path, checkpoint)
            progress = {
                **progress,
                "status": "running",
                "epoch": epoch + 1,
                "bestValidationRmse": best_validation_rmse,
                "lastTrainingRmse": history[-1]["trainingRmse"],
                "lastValidationRmse": validation_rmse,
            }
            atomic_json(progress_path, progress)

            if pause_requested or pause_path.exists():
                progress["status"] = "paused"
                atomic_json(progress_path, progress)
                print(f"Paused after epoch {epoch + 1}; resume with --resume")
                return 0

            training_complete = stale_epochs >= args.patience or epoch + 1 >= args.epochs
            if training_complete:
                break

        model.load_state_dict(best_state)
        test = evaluate_model(model, torch, device, test_rows, with_baselines=True)
        report = {
            "format": "napt-audio-demod-training-report-v1",
            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "modelVersion": 4,
            "architecture": "tanh-mlp-192x12x1-v4",
            "datasetSha256": corpus["dataset_sha256"],
            "sourceDatasetFormats": [manifest["format"] for manifest in corpus["manifests"]],
            "sessionSplits": corpus["session_splits"],
            "profile": corpus["profile"],
            "settings": {
                "epochsRequested": args.epochs,
                "epochsCompleted": len(history),
                "patience": args.patience,
                "learningRate": args.learning_rate,
                "samplesPerPairPerEpoch": args.samples_per_pair,
                "batchSize": args.batch_size,
                "seed": args.seed,
                "device": str(device),
            },
            "runtime": {"python": platform.python_version(), "numpy": np.__version__, "torch": torch.__version__},
            "corpus": summary,
            "trainingSampleCount": int(train_y.size),
            "bestValidationRmse": best_validation_rmse,
            "history": history,
            "test": test,
            "limitations": [
                "The model is experimental and is gated by independent held-out sessions.",
                "Fourier features supplement raw time-domain I/Q; they do not replace the waveform input.",
                "The runtime contract is one fixed I/Q rate, channel width, and PCM rate per model.",
            ],
        }
        atomic_json(report_path, report)
        export_onnx(torch, model, output_dir, corpus, report)
        progress = {
            **progress,
            "status": "completed",
            "epoch": len(history),
            "bestValidationRmse": best_validation_rmse,
            "testSessionBalancedRmse": test.get("sessionBalancedRmse"),
            "modelPreferred": test.get("modelPreferred", False),
        }
        atomic_json(progress_path, progress)
        print(json.dumps(progress, indent=2))
        return 0
    except KeyboardInterrupt:
        print(f"Interrupted; the latest training checkpoint is saved in {checkpoint_path}", file=sys.stderr)
        return 130
    finally:
        for signum, previous_handler in previous_signal_handlers.items():
            signal.signal(signum, previous_handler)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    inspect_parser = subparsers.add_parser("inspect", help="summarize datasets and their sessions")
    inspect_parser.add_argument("--dataset", action="append", required=True, help="browser-exported .tar; repeat to combine sessions")
    inspect_parser.set_defaults(handler=inspect_command)

    train_parser = subparsers.add_parser("train", help="train, evaluate, and export a local ONNX model")
    train_parser.add_argument("--dataset", action="append", required=True, help="browser-exported .tar; repeat to combine sessions")
    train_parser.add_argument("--splits", required=True, help="session-level split map JSON")
    train_parser.add_argument("--output-dir", required=True)
    train_parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    train_parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    train_parser.add_argument("--patience", type=int, default=DEFAULT_PATIENCE)
    train_parser.add_argument("--batch-size", type=int, default=512)
    train_parser.add_argument("--samples-per-pair", type=int, default=DEFAULT_SAMPLES_PER_PAIR)
    train_parser.add_argument("--learning-rate", type=float, default=1e-3)
    train_parser.add_argument("--min-delta", type=float, default=1e-5)
    train_parser.add_argument("--seed", type=int, default=1729)
    train_parser.add_argument(
        "--checkpoint-every-batches",
        type=int,
        default=DEFAULT_CHECKPOINT_EVERY_BATCHES,
        help="save resumable progress after this many completed batches",
    )
    train_parser.add_argument("--resume", action="store_true", help="continue from the matching output-dir checkpoint")
    train_parser.set_defaults(handler=train_command)

    pause_parser = subparsers.add_parser("pause", help="request a safe pause of a running trainer")
    pause_parser.add_argument("--output-dir", required=True)
    pause_parser.set_defaults(handler=pause_command)

    resume_parser = subparsers.add_parser("resume", help="resume a saved run from its output directory")
    resume_parser.add_argument("--output-dir", required=True)
    resume_parser.set_defaults(handler=resume_command)
    return parser


def pause_command(args) -> int:
    output_dir = pathlib.Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pause_path = output_dir / "audio_demod_pause.requested"
    pause_path.write_text(
        datetime.datetime.now(datetime.timezone.utc).isoformat() + "\n",
        encoding="utf-8",
    )
    print(f"Pause requested in {pause_path}; the running trainer will stop at a batch boundary")
    return 0


def resume_command(args) -> int:
    output_dir = pathlib.Path(args.output_dir)
    config_path = output_dir / "audio_demod_run.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read saved run settings: {config_path}") from error
    if not isinstance(config, dict) or config.get("format") != "napt-audio-demod-run-config-v1":
        raise ValueError("Unsupported or incomplete saved audio-demod run settings")
    dataset_paths = config.get("datasetPaths")
    if not isinstance(dataset_paths, list) or not dataset_paths or any(not isinstance(path, str) for path in dataset_paths):
        raise ValueError("Saved run settings have no dataset paths")
    split_path = config.get("splitPath")
    if not isinstance(split_path, str):
        raise ValueError("Saved run settings have no session split file")
    resumed_args = argparse.Namespace(
        dataset=dataset_paths,
        splits=split_path,
        output_dir=str(output_dir),
        device=config.get("device", "auto"),
        epochs=config.get("epochs", DEFAULT_EPOCHS),
        patience=config.get("patience", DEFAULT_PATIENCE),
        batch_size=config.get("batchSize", 512),
        samples_per_pair=config.get("samplesPerPair", DEFAULT_SAMPLES_PER_PAIR),
        learning_rate=config.get("learningRate", 1e-3),
        min_delta=config.get("minDelta", 1e-5),
        seed=config.get("seed", 1729),
        checkpoint_every_batches=config.get(
            "checkpointEveryBatches", DEFAULT_CHECKPOINT_EVERY_BATCHES
        ),
        resume=True,
    )
    return train_command(resumed_args)


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.handler(args)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"audio-demod: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
