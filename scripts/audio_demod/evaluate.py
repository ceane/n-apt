"""Held-out waveform metrics for audio-demod model and DSP comparisons."""

from __future__ import annotations

import numpy as np

from features import build_model_inputs


EVALUATION_BUDGET = 6_000
SEGMENT_SIZE = 2_000


def evaluation_ranges(sample_count: int) -> list[tuple[int, int]]:
    if sample_count < 1:
        return []
    if sample_count <= EVALUATION_BUDGET:
        return [(0, sample_count)]
    last_start = sample_count - SEGMENT_SIZE
    starts = sorted(set((0, last_start // 2, last_start)))
    return [(start, start + SEGMENT_SIZE) for start in starts]


def best_aligned_waveform_rmse(prediction: np.ndarray, target: np.ndarray, max_lag: int = 2_400) -> float:
    predicted = np.asarray(prediction, dtype=np.float64).reshape(-1)
    expected = np.asarray(target, dtype=np.float64).reshape(-1)
    length = min(predicted.size, expected.size)
    if length < 8:
        return float("inf")
    stride = max(1, int(np.ceil(length / 6_000)))
    max_shift = min(max_lag, length // 4)
    best_mse = float("inf")
    for lag in range(-max_shift, max_shift + 1, stride):
        first = max(0, -lag)
        last = min(length, length - lag)
        x = predicted[first + lag : last + lag : stride]
        y = expected[first:last:stride]
        if x.size < 8:
            continue
        sum_x = float(x.sum())
        sum_y = float(y.sum())
        sum_xx = float(np.dot(x, x))
        sum_yy = float(np.dot(y, y))
        sum_xy = float(np.dot(x, y))
        count = x.size
        variance = sum_xx - (sum_x * sum_x) / count
        covariance = sum_xy - (sum_x * sum_y) / count
        gain = covariance / variance if variance > 1e-12 else 0.0
        bias = (sum_y - gain * sum_x) / count
        mse = (
            sum_yy
            + gain * gain * sum_xx
            + count * bias * bias
            - 2 * gain * sum_xy
            - 2 * bias * sum_y
            + 2 * gain * bias * sum_x
        ) / count
        best_mse = min(best_mse, max(0.0, mse))
    return float(np.sqrt(best_mse))


def _predict(model, torch, device, inputs: np.ndarray, batch_size: int = 512) -> np.ndarray:
    outputs = []
    model.eval()
    with torch.no_grad():
        for start in range(0, len(inputs), batch_size):
            batch = torch.from_numpy(inputs[start : start + batch_size]).to(device)
            outputs.append(model(batch).detach().cpu().numpy().reshape(-1))
    return np.concatenate(outputs) if outputs else np.empty((0,), dtype=np.float32)


def _example_windows(row: dict) -> list[tuple[int, int, np.ndarray, np.ndarray]]:
    reference = row["reference"]
    ranges = evaluation_ranges(reference.size)
    prepared = []
    for start, end in ranges:
        indices = np.arange(start, end, dtype=np.int64)
        features = build_model_inputs(row["iq"], reference.size, indices)
        prepared.append((start, end, features, reference[start:end]))
    return prepared


def evaluate_model(model, torch, device, rows: list[dict], *, with_baselines: bool = False) -> dict:
    per_example = []
    for row in rows:
        model_sum = 0.0
        model_count = 0
        baseline_sums: dict[str, float] = {}
        baseline_counts: dict[str, int] = {}
        for start, end, features, target in _example_windows(row):
            prediction = _predict(model, torch, device, features)
            rmse = best_aligned_waveform_rmse(prediction, target)
            if np.isfinite(rmse):
                count = len(target)
                model_sum += rmse * rmse * count
                model_count += count
            if with_baselines:
                for name, baseline in row["baselines"].items():
                    reference = baseline[start:end]
                    baseline_rmse = best_aligned_waveform_rmse(reference, target)
                    if np.isfinite(baseline_rmse):
                        count = min(len(reference), len(target))
                        baseline_sums[name] = baseline_sums.get(name, 0.0) + baseline_rmse**2 * count
                        baseline_counts[name] = baseline_counts.get(name, 0) + count

        if model_count == 0:
            continue
        model_rmse = float(np.sqrt(model_sum / model_count))
        baseline_rmse = {
            name: float(np.sqrt(total / baseline_counts[name]))
            for name, total in baseline_sums.items()
            if baseline_counts.get(name, 0) > 0
        }
        per_example.append(
            {
                "artifactId": row["metadata"]["artifactId"],
                "sessionId": row["sessionId"],
                "modelRmse": model_rmse,
                "baselineRmse": baseline_rmse,
                "sampleCount": model_count,
            }
        )

    if not per_example:
        return {"rmse": None, "sessionBalancedRmse": None, "perExample": []}
    pooled_mse = sum(item["modelRmse"] ** 2 * item["sampleCount"] for item in per_example)
    pooled_count = sum(item["sampleCount"] for item in per_example)
    session_mse: dict[str, list[float]] = {}
    for item in per_example:
        session_mse.setdefault(item["sessionId"], []).append(item["modelRmse"] ** 2)
    session_balanced_rmse = float(
        np.sqrt(np.mean([np.mean(values) for values in session_mse.values()]))
    )
    result = {
        "rmse": float(np.sqrt(pooled_mse / pooled_count)),
        "sessionBalancedRmse": session_balanced_rmse,
        "sessionCount": len(session_mse),
        "perExample": per_example,
    }
    if with_baselines:
        baseline_names = sorted({name for item in per_example for name in item["baselineRmse"]})
        by_name = {}
        for name in baseline_names:
            values_by_session: dict[str, list[float]] = {}
            for item in per_example:
                if name in item["baselineRmse"]:
                    values_by_session.setdefault(item["sessionId"], []).append(item["baselineRmse"][name] ** 2)
            by_name[name] = float(np.sqrt(np.mean([np.mean(values) for values in values_by_session.values()])))
        best = min(by_name.values()) if by_name else None
        result["baselineSessionBalancedRmse"] = by_name
        result["bestBaselineSessionBalancedRmse"] = best
        result["modelPreferred"] = best is not None and session_balanced_rmse <= best
    return result
