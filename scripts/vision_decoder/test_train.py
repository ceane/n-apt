import copy
import unittest

import numpy as np

from train import (
    FEATURE_COUNT,
    TARGET_COUNT,
    fit_normalization,
    session_balanced_mse,
    validate_dataset,
)


def example(session, split, index):
    return {
        "type": "example",
        "sessionId": session,
        "trialId": f"trial-{index}",
        "artifactChecksum": f"{index:064x}",
        "split": split,
        "timestampBackendMs": 1000 + index * 100,
        "frameIndex": index,
        "frequencyGrid": {"centerFrequencyHz": 100000000, "sampleRateHz": 3200000},
        "calibrationSeed": None,
        "features": [0.0] * FEATURE_COUNT,
        "opponent": [0.0] * TARGET_COUNT,
        "rgb": [0] * TARGET_COUNT,
        "colorClassIndex": None,
    }


def dataset_manifest(rows):
    return {
        "type": "manifest",
        "format": "napt-vision-training-jsonl",
        "version": 1,
        "preprocessing": {
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
        },
        "target": {
            "width": 16,
            "height": 16,
            "fps": 10,
            "coordinates": "opponent",
            "colorTransform": "linear-srgb-lms-opponent-v1",
        },
        "frequencyGrid": {"centerFrequencyHz": 100000000, "sampleRateHz": 3200000},
        "sessionSplits": {
            "train-session": "train",
            "validation-session": "validation",
            "test-session": "test",
        },
        "exampleCount": len(rows),
        "excludedTransitionCount": 0,
    }


class VisionDatasetContractTest(unittest.TestCase):
    def setUp(self):
        self.rows = [
            example("train-session", "train", 1),
            example("validation-session", "validation", 2),
            example("test-session", "test", 3),
        ]
        self.manifest = dataset_manifest(self.rows)

    def test_accepts_versioned_session_disjoint_dataset(self):
        result = validate_dataset(self.manifest, self.rows)
        self.assertEqual(result["session_count"], 3)
        self.assertEqual(result["example_count"], 3)

    def test_rejects_session_leakage_and_unknown_session_assignments(self):
        leaked = copy.deepcopy(self.rows)
        leaked[1]["sessionId"] = "train-session"
        leaked[1]["split"] = "validation"
        with self.assertRaisesRegex(ValueError, "(?i)session split"):
            validate_dataset(self.manifest, leaked)

        unknown = copy.deepcopy(self.rows)
        unknown[0]["sessionId"] = "unassigned-session"
        with self.assertRaisesRegex(ValueError, "session assignment"):
            validate_dataset(self.manifest, unknown)

    def test_rejects_wrong_tensor_contract_and_duplicate_capture(self):
        malformed = copy.deepcopy(self.rows)
        malformed[0]["features"] = [0.0]
        with self.assertRaisesRegex(ValueError, "feature shape"):
            validate_dataset(self.manifest, malformed)

        duplicate = copy.deepcopy(self.rows)
        duplicate[1]["artifactChecksum"] = duplicate[0]["artifactChecksum"]
        with self.assertRaisesRegex(ValueError, "(?i)capture artifact"):
            validate_dataset(self.manifest, duplicate)

    def test_normalization_uses_training_rows_only(self):
        features = np.asarray([[1, 4], [1000, 1000], [3, 8]], dtype=np.float32)
        mean, scale = fit_normalization(features, np.asarray([True, False, True]))
        np.testing.assert_allclose(mean, [2, 6])
        np.testing.assert_allclose(scale, [1, 2])

    def test_session_balanced_metrics_do_not_weight_longer_sessions_more(self):
        expected = np.zeros((3, 2), dtype=np.float32)
        predicted = np.asarray([[0, 0], [1, 1], [1, 1]], dtype=np.float32)
        score = session_balanced_mse(
            expected, predicted, ["short", "long", "long"]
        )
        self.assertAlmostEqual(score, 0.5)
        pooled = float(np.mean((predicted - expected) ** 2))
        self.assertAlmostEqual(pooled, 2 / 3)


if __name__ == "__main__":
    unittest.main()
