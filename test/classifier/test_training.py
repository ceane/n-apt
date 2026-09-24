import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('training', Path(__file__).parents[2] / 'scripts/classifier/train.py')
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)

class TrainingTests(unittest.TestCase):
    def test_balanced_threshold(self):
        self.assertEqual(training.choose_threshold([0, 0, 1, 1], [0.1, 0.3, 0.6, 0.8]), 0.5)
    def test_reject_session_leakage(self):
        rows = [{'session': 'same', 'split': 'train'}, {'session': 'same', 'split': 'test'}]
        with self.assertRaises(ValueError): training.check_splits(rows)
    def test_report_requires_both_classes_for_balanced_accuracy(self):
        result = training.metrics([1, 1], [True, False])
        self.assertIsNone(result['balancedAccuracy'])
        self.assertEqual(result['recall'], 0.5)
    def test_numpy_model_inference(self):
        model = {'kind':'logistic', 'mean':[0,0], 'scale':[1,1], 'weights':[[1,-1]], 'bias':[0]}
        np.testing.assert_allclose(training.predict(model, [[1,1],[2,1]]), [0.5, 1/(1+np.exp(-1))])

if __name__ == '__main__': unittest.main()
