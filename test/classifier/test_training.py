import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
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

    def test_only_ready_rows_are_usable_for_supervised_work(self):
        rows = [
            {'split':'train', 'label':'matching', 'status':'ready'},
            {'split':'train', 'label':'nonmatching', 'status':'insufficient_evidence'},
            {'split':'train', 'label':'uncertain', 'status':'ready'},
            {'split':'test', 'label':'matching', 'status':'ready'},
        ]
        self.assertEqual(training.usable(rows, 'train'), [rows[0]])

    def test_weights_balance_classes_sessions_recordings_and_feature_variants(self):
        def row(label, session, recording, frame, fft):
            return {'label':label, 'session':session, 'recordingId':recording,
                    'captureId':recording, 'frameIndex':frame, 'fftSize':fft}
        rows = [
            row('matching', 'p-session-a', 'p-recording-a', 0, 1024),
            row('matching', 'p-session-a', 'p-recording-a', 0, 4096),
            row('matching', 'p-session-a', 'p-recording-b', 0, 1024),
            row('matching', 'p-session-b', 'p-recording-c', 0, 1024),
            row('nonmatching', 'n-session-a', 'n-recording-a', 0, 1024),
            row('nonmatching', 'n-session-b', 'n-recording-b', 0, 1024),
        ]
        weights = training.balanced_weights(rows)
        mass = lambda indices: float(weights[indices].sum())
        positive = [i for i, r in enumerate(rows) if r['label'] == 'matching']
        negative = [i for i, r in enumerate(rows) if r['label'] == 'nonmatching']
        self.assertAlmostEqual(mass(positive), mass(negative))
        self.assertAlmostEqual(mass([0, 1, 2]), mass([3]))
        self.assertAlmostEqual(mass([0, 1]), mass([2]))
        self.assertAlmostEqual(weights[0], weights[1])

    def test_session_balanced_metrics_do_not_let_long_sessions_dominate(self):
        y = [1, 0] + [1] * 9
        pred = [True, False] + [False] * 9
        pooled = training.metrics(y, pred)
        balanced = training.session_balanced_metrics(y, pred, ['short', 'short'] + ['long'] * 9)
        self.assertAlmostEqual(pooled['balancedAccuracy'], 0.55)
        self.assertAlmostEqual(balanced['balancedAccuracy'], 0.75)

    def test_feature_standardization_does_not_clip_native_measurements(self):
        z = training.standardize_features(np.array([[100.0, -100.0]]), np.zeros(2), np.ones(2))
        np.testing.assert_array_equal(z, [[100.0, -100.0]])

    def test_numpy_mlp_updates_and_exports_output_bias(self):
        x = np.array([[-1.0, 0.0], [1.0, 0.0], [2.0, 1.0]])
        y = np.array([1.0, 1.0, 1.0])
        model = training.fit_mlp(x, y, np.ones(3), seed=7, device='numpy', max_epochs=20)
        self.assertNotEqual(model['outputBias'], 0.0)
        self.assertTrue(np.isfinite(training.predict(model, x)).all())

    def test_threshold_uses_session_balanced_validation_metric(self):
        y = [1, 0] + [1] * 9 + [0]
        scores = [0.9, 0.1] + [0.2] * 9 + [0.3]
        threshold = training.choose_threshold(y, scores, ['short', 'short'] + ['long'] * 10)
        self.assertEqual(threshold, 0.5)

    def test_threshold_candidates_include_all_positive_and_all_negative_points(self):
        scores = np.array([0.2, 0.8])
        candidates = training.threshold_candidates(scores)
        self.assertTrue(any(np.all(scores >= threshold) for threshold in candidates))
        self.assertTrue(any(np.all(scores < threshold) for threshold in candidates))

    def test_duplicate_scores_have_stable_ties_and_extreme_logits_stay_finite(self):
        self.assertEqual(training.choose_threshold([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]), 0.5)
        scores = training.stable_sigmoid(np.array([-1000.0, 0.0, 1000.0]))
        self.assertTrue(np.isfinite(scores).all())
        np.testing.assert_array_equal(scores, [0.0, 0.5, 1.0])

    def test_manual_gradients_match_finite_differences_for_each_parameter_group(self):
        x = np.array([[-0.7, 0.2], [0.4, -0.1], [0.8, 0.9]])
        y = np.array([0.0, 1.0, 1.0])
        weight = np.array([0.5, 1.0, 1.5])
        logistic = [np.array([0.2, -0.3]), np.array([0.1])]
        self._assert_gradients_match(
            lambda params: training.logistic_loss_and_grad(x, y, weight, params[0], float(params[1][0]), 0.07),
            logistic)
        mlp = [np.array([[0.2, -0.1], [0.3, 0.4]]), np.array([0.05, -0.02]),
               np.array([0.6, -0.5]), np.array([0.03])]
        self._assert_gradients_match(
            lambda params: training.mlp_loss_and_grad(x, y, weight, params, 0.07), mlp)

    def _assert_gradients_match(self, objective, params):
        loss, gradients = objective(params)
        self.assertTrue(np.isfinite(loss))
        epsilon = 1e-6
        for parameter, gradient in zip(params, gradients):
            numeric = np.zeros_like(parameter)
            for index in np.ndindex(parameter.shape):
                original = parameter[index]
                parameter[index] = original + epsilon
                plus = objective(params)[0]
                parameter[index] = original - epsilon
                minus = objective(params)[0]
                parameter[index] = original
                numeric[index] = (plus - minus) / (2 * epsilon)
            np.testing.assert_allclose(gradient, numeric, rtol=2e-5, atol=2e-7)

    def test_torch_mlp_fit_exports_two_linear_layers_when_available(self):
        try:
            import torch  # noqa: F401
        except ImportError:
            self.skipTest('PyTorch is not installed in this environment')
        x = np.array([[-1.0, 0.0], [1.0, 0.0], [2.0, 1.0]])
        y = np.array([0.0, 1.0, 1.0])
        model = training.fit_mlp(x, y, np.ones(3), seed=7, device='cpu', max_epochs=3)
        self.assertEqual(len(model['weights']), 16)
        self.assertEqual(len(model['outputWeights']), 16)
        self.assertTrue(np.isfinite(training.predict(model, x)).all())

    def test_torch_mlp_monitoring_restores_best_checkpoint_when_available(self):
        try:
            import torch  # noqa: F401
        except ImportError:
            self.skipTest('PyTorch is not installed in this environment')
        x = np.array([[-1.0, 0.0], [1.0, 0.0], [0.0, 1.0]])
        y = np.array([0.0, 1.0, 1.0])
        model = training.fit_mlp(x, y, np.ones(3), seed=11, device='cpu', max_epochs=10,
                                 monitor=(x, y, np.ones(3)), patience=2, min_delta=1000.0)
        diagnostic = model['trainingDiagnostics']
        self.assertTrue(diagnostic['monitoringUsed'])
        self.assertEqual(diagnostic['stopReason'], 'patience')
        self.assertEqual(diagnostic['bestEpoch'], 1)
        self.assertEqual(diagnostic['epochsRun'], 3)

    def test_numpy_mlp_loss_and_gradients_match_torch_autograd_when_available(self):
        try:
            import torch
        except ImportError:
            self.skipTest('PyTorch is not installed in this environment')
        x = np.array([[-0.7, 0.2], [0.4, -0.1], [0.8, 0.9]], dtype=np.float64)
        y = np.array([0.0, 1.0, 1.0], dtype=np.float64)
        weight = np.array([0.5, 1.0, 1.5], dtype=np.float64)
        params = [np.array([[0.2, -0.1], [0.3, 0.4]]), np.array([0.05, -0.02]),
                  np.array([0.6, -0.5]), np.array([0.03])]
        numpy_loss, numpy_gradients = training.mlp_loss_and_grad(x, y, weight, params, 0.07)
        tx = torch.tensor(x, dtype=torch.float64)
        ty = torch.tensor(y, dtype=torch.float64)
        tw = torch.tensor(weight, dtype=torch.float64)
        torch_params = [torch.tensor(value, dtype=torch.float64, requires_grad=True) for value in params]
        w1, b1, w2, b2 = torch_params
        logits = torch.relu(tx @ w1.T + b1) @ w2 + b2[0]
        loss = (torch.nn.functional.binary_cross_entropy_with_logits(logits, ty, reduction='none') * tw).sum() / tw.sum()
        loss = loss + 0.5 * 0.07 * (w1.square().sum() + w2.square().sum())
        loss.backward()
        self.assertAlmostEqual(numpy_loss, float(loss.detach()), places=12)
        for actual, expected in zip(numpy_gradients, torch_params):
            np.testing.assert_allclose(actual, expected.grad.detach().numpy(), rtol=1e-12, atol=1e-12)

    def test_evaluation_reports_abstentions_as_coverage_not_negative_predictions(self):
        with tempfile.TemporaryDirectory() as directory:
            feature_path = Path(directory) / 'features.jsonl'
            report_path = Path(directory) / 'report.json'
            rows = [self._feature_row('positive', 'matching', 'ready', 0.9),
                    self._feature_row('negative', 'nonmatching', 'ready', 0.1),
                    self._feature_row('uncertain', 'matching', 'insufficient_evidence', 0.9)]
            feature_path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            training.evaluate_command(SimpleNamespace(features=feature_path, split='test', model=None,
                                                       threshold=0.5, report=report_path))
            report = json.loads(report_path.read_text())
        self.assertEqual(report['overall']['count'], 2)
        self.assertEqual(report['overall']['balancedAccuracy'], 1.0)
        self.assertEqual(report['coverage']['labeledRows'], 3)
        self.assertEqual(report['coverage']['readyRows'], 2)
        self.assertEqual(report['coverage']['insufficientEvidenceRows'], 1)
        self.assertEqual(report['byResolution']['1024']['insufficientEvidenceRows'], 1)

    def test_training_round_trip_does_not_claim_rates_are_validated(self):
        with tempfile.TemporaryDirectory() as directory:
            feature_path = Path(directory) / 'features.jsonl'
            model_path = Path(directory) / 'model.json'
            report_path = Path(directory) / 'report.json'
            rows = [self._feature_row('train-positive', 'matching', 'ready', 0.0, 'train-positive', 'train'),
                    self._feature_row('train-negative', 'nonmatching', 'ready', 1.0, 'train-negative', 'train'),
                    self._feature_row('valid-positive', 'matching', 'ready', 0.0, 'valid-positive', 'validation'),
                    self._feature_row('valid-negative', 'nonmatching', 'ready', 1.0, 'valid-negative', 'validation')]
            feature_path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            training.train_command(SimpleNamespace(features=feature_path, model=model_path, report=report_path,
                                                   device='numpy'))
            model = json.loads(model_path.read_text())
            report = json.loads(report_path.read_text())
        self.assertEqual(model['validatedSampleRatesHz'], [])
        self.assertNotIn('trainingDiagnostics', model)
        self.assertTrue(model['syntheticOnly'])
        self.assertEqual(report['validatedSampleRatesHz'], [])
        self.assertTrue(report['syntheticOnly'])
        self.assertEqual(report['observedValidationSampleRatesHz'], [3_200_000])
        self.assertIn('sessionBalancedAccuracy', report['validation'])
        self.assertIn('lossCurve', report['selectedTraining'])
        self.assertEqual(report['trainingMonitoring']['available'], False)
        self.assertTrue(report['runManifest']['datasetSha256'])

    def test_monitor_split_keeps_whole_sessions_separate_and_both_classes_in_each_side(self):
        rows = []
        for session, label in [('positive-a','matching'),('positive-b','matching'),
                               ('negative-a','nonmatching'),('negative-b','nonmatching')]:
            rows.extend(self._feature_row(f'{session}-{frame}', label, 'ready', float(frame), session, 'train')
                        for frame in range(3))
        fit_rows, monitor_rows, report = training.split_monitor_sessions(rows, fraction=0.25, seed=13)
        self.assertTrue(report['available'])
        self.assertEqual({row['session'] for row in fit_rows} & {row['session'] for row in monitor_rows}, set())
        self.assertEqual({row['label'] for row in fit_rows}, {'matching', 'nonmatching'})
        self.assertEqual({row['label'] for row in monitor_rows}, {'matching', 'nonmatching'})
        again = training.split_monitor_sessions(rows, fraction=0.25, seed=13)
        self.assertEqual([row['session'] for row in monitor_rows], [row['session'] for row in again[1]])

    def test_monitor_split_reports_session_shortfall_without_splitting_frames(self):
        rows = [self._feature_row('positive','matching','ready',0.2,'positive','train'),
                self._feature_row('negative','nonmatching','ready',0.8,'negative','train')]
        fit_rows, monitor_rows, report = training.split_monitor_sessions(rows)
        self.assertFalse(report['available'])
        self.assertEqual(report['reason'], 'fewer_than_two_sessions_per_class')
        self.assertEqual(fit_rows, rows)
        self.assertEqual(monitor_rows, [])

    def test_mlp_restores_best_group_monitor_checkpoint_after_patience(self):
        x = np.array([[-1.0, 0.0], [1.0, 0.0], [0.0, 1.0]])
        y = np.array([0.0, 1.0, 1.0])
        model = training.fit_mlp(x, y, np.ones(3), seed=11, device='numpy', max_epochs=10,
                                 monitor=(x, y, np.ones(3)), patience=2, min_delta=1000.0)
        diagnostic = model['trainingDiagnostics']
        self.assertEqual(diagnostic['stopReason'], 'patience')
        self.assertEqual(diagnostic['bestEpoch'], 1)
        self.assertEqual(diagnostic['epochsRun'], 3)

    def test_explicit_mps_request_fails_when_backend_is_unavailable(self):
        try:
            import torch
        except ImportError:
            expected_message = 'PyTorch'
        else:
            if torch.backends.mps.is_available():
                self.skipTest('MPS is available in this environment')
            expected_message = 'MPS'
        with self.assertRaisesRegex(RuntimeError, expected_message):
            training.fit_mlp(np.zeros((2, 2)), np.array([0.0, 1.0]), np.ones(2),
                             device='mps', max_epochs=1)

    @unittest.skipUnless(shutil.which('node') and (Path(__file__).parents[2] / 'node_modules/tsx').exists(),
                         'Node.js project runtime is not installed')
    def test_trained_logistic_and_mlp_artifacts_match_typescript_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            feature_path, model_path, report_path, candidate_dir = [root / name for name in
                ('features.jsonl','selected.json','report.json','candidates')]
            rows = []
            for split, prefix in [('train','training'),('validation','validation')]:
                for label, token, score in [('matching','positive',0.8),('nonmatching','negative',0.2)]:
                    sessions = [f'{prefix}-{token}']
                    if split == 'train':
                        sessions.append(f'{prefix}-{token}-second')
                    for session in sessions:
                        for frame in range(2):
                            row = self._feature_row(f'{session}-{frame}', label, 'ready', score,
                                                    session, split)
                            row['frameIndex'] = frame
                            row['timestampMs'] = frame * 100
                            rows.append(row)
            feature_path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            training.train_command(SimpleNamespace(features=feature_path, model=model_path, report=report_path,
                candidates_dir=candidate_dir, device='numpy', mlp_epochs=5, monitor_fraction=0.25, seed=13,
                logistic_max_iter=30, logistic_tolerance=1e-8, logistic_l2=0.001, mlp_l2=0.001,
                learning_rate=0.001, mlp_patience=2, mlp_min_delta=1e-5))
            probe = np.zeros((3, len(training.FEATURE_NAMES)), dtype=float)
            probe[:, 0] = [0.2, 0.8, 120.0]
            ts = """
                import { readFileSync } from 'node:fs';
                import { pathToFileURL } from 'node:url';
                const core = await import(pathToFileURL(process.env.NAPT_CORE_TS).href);
                const model = JSON.parse(readFileSync(process.env.NAPT_MODEL, 'utf8'));
                const features = JSON.parse(process.env.NAPT_PROBES);
                console.log(JSON.stringify(features.map(row => core.inferModel(core.validateModel(model), row))));
            """
            for artifact_path in sorted(candidate_dir.glob('*.json')):
                model = json.loads(artifact_path.read_text())
                expected = training.predict(model, probe)
                environment = {**os.environ, 'NAPT_MODEL':str(artifact_path),
                               'NAPT_CORE_TS':str(Path(__file__).parents[2] / 'src/ts/features/classification/native/core.ts'),
                               'NAPT_PROBES':json.dumps(probe.tolist())}
                result = subprocess.run(['node','--import','tsx','--input-type=module','-e',ts], cwd=Path(__file__).parents[2],
                                        env=environment, check=True, capture_output=True, text=True)
                np.testing.assert_allclose(json.loads(result.stdout), expected, rtol=1e-12, atol=1e-12)
            self.assertEqual({path.stem for path in candidate_dir.glob('*.json')}, {'logistic','mlp'})
            report = json.loads(report_path.read_text())
            self.assertTrue(report['trainingMonitoring']['available'])
            self.assertIn('configuration', report['runManifest'])
            self.assertEqual(report['runManifest']['normalization']['mean'],
                             json.loads(model_path.read_text())['mean'])
            self.assertTrue(all(json.loads(path.read_text()).get('id') for path in candidate_dir.glob('*.json')))

    def _feature_row(self, identifier, label, status, rule_score, session=None, split='test'):
        features = np.zeros(len(training.FEATURE_NAMES), dtype=float)
        features[0] = rule_score
        return {'id':identifier,'captureId':identifier,'recordingId':identifier,'frameIndex':0,
                'session':session or 'test-session','split':split,'label':label,'status':status,
                'ruleScore':rule_score,'fftSize':1024,'visibleFraction':1.0,'timestampMs':0,
                'analysisSampleRateHz':3_200_000,'preprocessing':training.PREPROCESSING,
                'featureNames':training.FEATURE_NAMES,'features':features.tolist(),'syntheticOnly':True}

if __name__ == '__main__': unittest.main()
