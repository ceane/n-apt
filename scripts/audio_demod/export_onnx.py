"""Export and validate the audio v4 model for the local browser ONNX runtime."""

from __future__ import annotations

import hashlib
import json
import os
import pathlib

import numpy as np


INPUT_NAME = "iq_fourier_windows"
OUTPUT_NAME = "pcm"
INPUT_SIZE = 192


def _sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_onnx(torch, model, output_dir: pathlib.Path, corpus: dict, report: dict) -> dict:
    try:
        import onnx
    except ImportError as error:
        raise RuntimeError("Install scripts/audio_demod/requirements.txt to export ONNX") from error

    model.eval().cpu()
    model_path = output_dir / "audio_demod.onnx"
    temporary_path = output_dir / "audio_demod.onnx.tmp"
    sample = torch.zeros((2, INPUT_SIZE), dtype=torch.float32)
    torch.onnx.export(
        model,
        sample,
        temporary_path,
        input_names=[INPUT_NAME],
        output_names=[OUTPUT_NAME],
        dynamic_axes={INPUT_NAME: {0: "batch"}, OUTPUT_NAME: {0: "batch"}},
        opset_version=13,
        do_constant_folding=True,
        dynamo=False,
    )
    graph = onnx.load(str(temporary_path))
    onnx.checker.check_model(graph)
    inputs = {value.name: value for value in graph.graph.input}
    outputs = {value.name: value for value in graph.graph.output}
    if set(inputs) != {INPUT_NAME} or set(outputs) != {OUTPUT_NAME}:
        temporary_path.unlink(missing_ok=True)
        raise ValueError("Exported ONNX names do not match the browser runtime contract")
    input_dimensions = inputs[INPUT_NAME].type.tensor_type.shape.dim
    output_dimensions = outputs[OUTPUT_NAME].type.tensor_type.shape.dim
    if (
        len(input_dimensions) != 2
        or input_dimensions[0].dim_param != "batch"
        or input_dimensions[1].dim_value != INPUT_SIZE
        or len(output_dimensions) != 2
        or output_dimensions[0].dim_param != "batch"
        or output_dimensions[1].dim_value != 1
    ):
        temporary_path.unlink(missing_ok=True)
        raise ValueError("Exported ONNX shapes do not match [batch, 192] to [batch, 1]")
    os.replace(temporary_path, model_path)

    weights_path = output_dir / "audio_demod.weights.f32le"
    weights_temp = output_dir / "audio_demod.weights.f32le.tmp"
    state = model.state_dict()
    weights = np.concatenate(
        (
            state["input.weight"].detach().cpu().numpy().astype("<f4", copy=False).reshape(-1),
            state["input.bias"].detach().cpu().numpy().astype("<f4", copy=False).reshape(-1),
            state["output.weight"].detach().cpu().numpy().astype("<f4", copy=False).reshape(-1),
            state["output.bias"].detach().cpu().numpy().astype("<f4", copy=False).reshape(-1),
        )
    )
    weights_temp.write_bytes(weights.tobytes())
    os.replace(weights_temp, weights_path)

    counts = report["corpus"]["exampleCounts"]
    test = report["test"]
    training_state = {
        "status": "completed",
        "epoch": report["settings"]["epochsCompleted"],
        "totalEpochs": report["settings"]["epochsRequested"],
        "trainingPairCount": counts["train"],
        "holdoutPairCount": counts["validation"] + counts["test"],
        "validationPairCount": counts["validation"],
        "testPairCount": counts["test"],
        "validationRmse": report["bestValidationRmse"],
        "modelRmse": test.get("rmse"),
        "dspRmse": test.get("bestBaselineSessionBalancedRmse"),
        "modelPreferred": bool(test.get("modelPreferred", False)),
    }

    metadata = {
        "format": "napt-audio-demod-onnx",
        "version": 1,
        "modelVersion": 4,
        "architecture": "tanh-mlp-192x12x1-v4",
        "createdAt": report["createdAt"],
        "modelFile": model_path.name,
        "modelSha256": _sha256(model_path),
        "weightsFile": weights_path.name,
        "weightsSha256": _sha256(weights_path),
        "weightsFloatCount": int(weights.size),
        "weightsLayout": ["inputWeights[12,192]", "hiddenBias[12]", "outputWeights[12]", "outputBias[1]"],
        "trainingSamples": report["trainingSampleCount"],
        "datasetSha256": corpus["dataset_sha256"],
        "input": {
            "name": INPUT_NAME,
            "shape": ["batch", INPUT_SIZE],
            "preprocessing": "audio-survey-v4-iq-plus-hann-fourier",
        },
        "output": {"name": OUTPUT_NAME, "shape": ["batch", 1], "sampleRateHz": corpus["profile"]["pcmSampleRateHz"]},
        "profile": corpus["profile"],
        "sessionSplits": corpus["session_splits"],
        "sourcePairIds": sorted(row["metadata"]["artifactId"] for row in corpus["rows"]),
        "training": training_state,
        "reportFile": "audio_demod_report.json",
        "modelPreferredOnTest": training_state["modelPreferred"],
        "experimental": True,
    }
    metadata_path = output_dir / "audio_demod.manifest.json"
    metadata_temp = output_dir / "audio_demod.manifest.json.tmp"
    metadata_temp.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    os.replace(metadata_temp, metadata_path)
    return metadata
