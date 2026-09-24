#!/usr/bin/env python3
"""Train/evaluate native morphology models from classifier feature JSONL."""
import argparse
import hashlib
import json
import pathlib
import sys

import numpy as np

FEATURE_NAMES = ['bridge','partialBridge','uDip','occupancy','peakDensity','spacingRegularity','width',
                 'prominence','envelopeVariation','quality','narrowAvailable','bridgeAvailable',
                 'envelopeAvailable','visibleFraction','validFraction','persistence','meanBridge','meanUDip']
PREPROCESSING = 'native-morphology-v1'
LABELS = {'matching': 1, 'nonmatching': 0}


def check_splits(rows):
    seen = {}
    for row in rows:
        session, split = row.get('session'), row.get('split')
        if not session or split not in ('train','validation','test','acceptance','unlabeled'):
            raise ValueError('Every feature row requires a session and supported split')
        if session in seen and seen[session] != split:
            raise ValueError(f'Session leakage: {session}')
        seen[session] = split
    return True


def metrics(y_true, y_pred):
    y = np.asarray(y_true, dtype=int)
    pred = np.asarray(y_pred, dtype=bool)
    if y.ndim != 1 or pred.ndim != 1 or y.size != pred.size or not np.isin(y, [0, 1]).all():
        raise ValueError('Metrics require equally sized binary labels and predictions')
    tp = int(np.sum((y == 1) & pred))
    tn = int(np.sum((y == 0) & ~pred))
    fp = int(np.sum((y == 0) & pred))
    fn = int(np.sum((y == 1) & ~pred))
    positives, negatives = tp + fn, tn + fp
    recall = tp / positives if positives else None
    specificity = tn / negatives if negatives else None
    precision = tp / (tp + fp) if tp + fp else 0.0
    return {'count': int(y.size), 'tp': tp, 'tn': tn, 'fp': fp, 'fn': fn, 'precision': precision,
            'recall': recall, 'specificity': specificity,
            'balancedAccuracy': (recall + specificity) / 2 if recall is not None and specificity is not None else None}


def session_balanced_metrics(y_true, y_pred, sessions):
    """Average per-session sensitivity and specificity, so long sessions cannot dominate."""
    y = np.asarray(y_true, dtype=int)
    pred = np.asarray(y_pred, dtype=bool)
    session_ids = np.asarray(sessions, dtype=object)
    if y.ndim != 1 or pred.ndim != 1 or session_ids.ndim != 1 or not (y.size == pred.size == session_ids.size):
        raise ValueError('Session metrics require equally sized labels, predictions, and session IDs')
    if not y.size or not np.isin(y, [0, 1]).all() or any(not value for value in session_ids):
        raise ValueError('Session metrics require binary labels and nonempty session IDs')
    recalls, specificities = [], []
    for session in dict.fromkeys(session_ids.tolist()):
        in_session = session_ids == session
        labels, decisions = y[in_session], pred[in_session]
        positive_count = int(np.sum(labels == 1))
        negative_count = int(np.sum(labels == 0))
        if positive_count:
            recalls.append(float(np.sum((labels == 1) & decisions) / positive_count))
        if negative_count:
            specificities.append(float(np.sum((labels == 0) & ~decisions) / negative_count))
    recall = float(np.mean(recalls)) if recalls else None
    specificity = float(np.mean(specificities)) if specificities else None
    return {'sessionCount': int(len(set(session_ids.tolist()))), 'positiveSessionCount': len(recalls),
            'negativeSessionCount': len(specificities), 'recall': recall, 'specificity': specificity,
            'balancedAccuracy': (recall + specificity) / 2 if recall is not None and specificity is not None else None}


def combined_metrics(y_true, y_pred, sessions):
    pooled = metrics(y_true, y_pred)
    by_session = session_balanced_metrics(y_true, y_pred, sessions)
    return {**pooled,
            'pooledBalancedAccuracy': pooled['balancedAccuracy'],
            'sessionBalancedRecall': by_session['recall'],
            'sessionBalancedSpecificity': by_session['specificity'],
            'sessionBalancedAccuracy': by_session['balancedAccuracy'],
            'balancedAccuracy': by_session['balancedAccuracy']}


def choose_threshold(y_true, scores, sessions=None):
    y = np.asarray(y_true, dtype=int)
    score = np.asarray(scores, dtype=float)
    if not y.size or y.size != score.size or not np.isfinite(score).all() or set(y.tolist()) != {0, 1}:
        raise ValueError('Threshold selection requires finite scores and both classes')
    if np.any(score < 0) or np.any(score > 1):
        raise ValueError('Threshold selection requires probabilities in [0, 1]')
    if sessions is not None and len(sessions) != y.size:
        raise ValueError('Threshold session IDs must match validation rows')
    candidates = threshold_candidates(score)
    results = []
    for threshold in candidates:
        predicted = score >= threshold
        result = (session_balanced_metrics(y, predicted, sessions)['balancedAccuracy']
                  if sessions is not None else metrics(y, predicted)['balancedAccuracy'])
        results.append((result, -abs(threshold - 0.5), -threshold, threshold))
    return max(results)[-1]


def threshold_candidates(scores):
    score = np.asarray(scores, dtype=float)
    if not score.size or not np.isfinite(score).all() or np.any(score < 0) or np.any(score > 1):
        raise ValueError('Threshold candidates require finite probabilities in [0, 1]')
    ordered = np.unique(score)
    candidates = {0.0, 0.5, 1.0}
    candidates.update(float((a + b) / 2) for a, b in zip(ordered[:-1], ordered[1:]))
    if ordered[0] > 0:
        candidates.add(float(np.nextafter(ordered[0], -np.inf)))
    if ordered[-1] < 1:
        candidates.add(float(np.nextafter(ordered[-1], np.inf)))
    return sorted(t for t in candidates if 0 <= t <= 1)


def standardize_features(x, mean, scale):
    """Apply the exact exported affine transform; deliberately do not clip evidence."""
    values = np.asarray(x, dtype=float)
    center = np.asarray(mean, dtype=float)
    spread = np.asarray(scale, dtype=float)
    if values.ndim != 2 or center.ndim != 1 or spread.shape != center.shape or values.shape[1] != center.size:
        raise ValueError('Feature matrix and normalization dimensions do not match')
    if not np.isfinite(values).all() or not np.isfinite(center).all() or not np.isfinite(spread).all() or np.any(spread <= 0):
        raise ValueError('Feature matrix and normalization must be finite with positive scales')
    return (values - center) / spread


def fit_normalization(x, weight):
    values = np.asarray(x, dtype=float)
    sample_weight = np.asarray(weight, dtype=float)
    if values.ndim != 2 or values.shape[0] != sample_weight.size or not values.shape[0]:
        raise ValueError('Normalization requires a nonempty feature matrix and one weight per row')
    if not np.isfinite(values).all() or not np.isfinite(sample_weight).all() or np.any(sample_weight < 0) or sample_weight.sum() <= 0:
        raise ValueError('Normalization inputs and weights must be finite with positive total weight')
    mean = np.average(values, axis=0, weights=sample_weight)
    variance = np.average((values - mean) ** 2, axis=0, weights=sample_weight)
    scale = np.sqrt(variance)
    scale[scale < 1e-6] = 1.0
    return mean, scale


def stable_sigmoid(logits):
    values = np.asarray(logits, dtype=float)
    result = np.empty_like(values)
    positive = values >= 0
    result[positive] = 1 / (1 + np.exp(-values[positive]))
    exp_values = np.exp(values[~positive])
    result[~positive] = exp_values / (1 + exp_values)
    return result


def weighted_logit_loss(logits, y, weight, l2_weights=(), l2=0.0):
    values = np.asarray(logits, dtype=float).reshape(-1)
    labels = np.asarray(y, dtype=float).reshape(-1)
    sample_weight = np.asarray(weight, dtype=float).reshape(-1)
    if not values.size or not (values.size == labels.size == sample_weight.size):
        raise ValueError('Weighted logit loss requires equally sized nonempty vectors')
    if not np.isfinite(values).all() or not np.isfinite(labels).all() or not np.isin(labels, [0, 1]).all() or not np.isfinite(sample_weight).all() or np.any(sample_weight < 0) or sample_weight.sum() <= 0:
        raise ValueError('Weighted logit loss inputs must be finite, binary, and positively weighted')
    loss = float(np.sum(sample_weight * (np.logaddexp(0, values) - labels * values)) / sample_weight.sum())
    matrices = [np.asarray(value, dtype=float) for value in l2_weights]
    if any(not np.isfinite(value).all() for value in matrices) or not np.isfinite(l2) or l2 < 0:
        raise ValueError('L2 weights and strength must be finite and nonnegative')
    loss += 0.5 * l2 * sum(float(np.sum(value * value)) for value in matrices)
    return loss


def logistic_loss_and_grad(x, y, weight, weights, bias, l2=1e-3):
    values = np.asarray(x, dtype=float)
    labels = np.asarray(y, dtype=float)
    sample_weight = np.asarray(weight, dtype=float)
    coefficient = np.asarray(weights, dtype=float)
    logits = values @ coefficient + float(bias)
    loss = weighted_logit_loss(logits, labels, sample_weight, [coefficient], l2)
    residual = (stable_sigmoid(logits) - labels) * sample_weight / sample_weight.sum()
    return loss, [values.T @ residual + l2 * coefficient, np.asarray([residual.sum()])]


def mlp_loss_and_grad(x, y, weight, params, l2=1e-3):
    values = np.asarray(x, dtype=float)
    labels = np.asarray(y, dtype=float)
    sample_weight = np.asarray(weight, dtype=float)
    w1, b1, w2, b2 = (np.asarray(parameter, dtype=float) for parameter in params)
    preactivation = values @ w1.T + b1
    hidden = np.maximum(preactivation, 0)
    logits = hidden @ w2 + float(b2.reshape(-1)[0])
    loss = weighted_logit_loss(logits, labels, sample_weight, [w1, w2], l2)
    delta = (stable_sigmoid(logits) - labels) * sample_weight / sample_weight.sum()
    grad_w2 = hidden.T @ delta + l2 * w2
    grad_b2 = np.asarray([delta.sum()])
    delta_hidden = (delta[:, None] * w2) * (preactivation > 0)
    grad_w1 = delta_hidden.T @ values + l2 * w1
    grad_b1 = delta_hidden.sum(axis=0)
    return loss, [grad_w1, grad_b1, grad_w2, grad_b2]


def predict(model, x):
    standardized = standardize_features(x, model['mean'], model['scale'])
    hidden = standardized @ np.asarray(model['weights'], dtype=float).T + np.asarray(model['bias'], dtype=float)
    if model['kind'] == 'mlp':
        hidden = np.maximum(hidden, 0) @ np.asarray(model['outputWeights'], dtype=float) + float(model['outputBias'])
    return stable_sigmoid(hidden.reshape(-1))


def load_rows(path):
    rows = [json.loads(line) for line in pathlib.Path(path).read_text().splitlines() if line.strip()]
    check_splits(rows)
    for row in rows:
        if row.get('preprocessing') != PREPROCESSING or row.get('featureNames') != FEATURE_NAMES or len(row.get('features', [])) != len(FEATURE_NAMES):
            raise ValueError('Feature version/order does not match trainer')
        if not np.isfinite(np.asarray(row['features'], dtype=float)).all():
            raise ValueError(f"Invalid feature row: {row.get('id')}")
    return rows


def labeled_rows(rows, split):
    return [row for row in rows if row.get('split') == split and row.get('label') in LABELS]


def usable(rows, split):
    return [row for row in labeled_rows(rows, split) if row.get('status') == 'ready']


def _identity(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)


def balanced_weights(rows):
    """Equal class → session → recording/interval → base-window → variant influence."""
    if not rows:
        raise ValueError('Cannot weight an empty training set')
    labels = [row.get('label') for row in rows]
    if any(label not in LABELS for label in labels):
        raise ValueError('Training weights require explicit matching/nonmatching labels')

    groups = {}
    for index, row in enumerate(rows):
        session = row.get('session')
        if not session:
            raise ValueError('Training rows require a session for balanced weighting')
        recording = row.get('captureId') or row.get('recordingId') or row.get('id')
        if recording is None:
            raise ValueError('Training rows require a capture, recording, or row identifier')
        interval = row.get('annotationIntervalId') or row.get('labelIntervalId') or 'whole-recording'
        if row.get('baseWindowId') is not None:
            window = row['baseWindowId']
        else:
            time_identity = row.get('timestampMs')
            frame_index = row.get('frameIndex')
            if time_identity is None and frame_index is None:
                raise ValueError('Training rows require a baseWindowId, timestampMs, or frameIndex')
            window = [frame_index, time_identity]
        group = groups.setdefault(labels[index], {}).setdefault(str(session), {}).setdefault(
            (str(recording), str(interval)), {}).setdefault(_identity(window), [])
        group.append(index)

    weights = np.zeros(len(rows), dtype=float)
    class_share = 1 / len(groups)
    for sessions in groups.values():
        session_share = class_share / len(sessions)
        for recordings in sessions.values():
            recording_share = session_share / len(recordings)
            # Every recording gets equal mass, then every base time window in it.
            for windows in recordings.values():
                per_window = recording_share / len(windows)
                for variant_rows in windows.values():
                    per_variant = per_window / len(variant_rows)
                    weights[variant_rows] = per_variant
    weights *= len(weights) / weights.sum()
    return weights


def fit_logistic(x, y, weight, max_iter=5000, l2=1e-3, tolerance=1e-8):
    values = np.asarray(x, dtype=float)
    labels = np.asarray(y, dtype=float)
    sample_weight = np.asarray(weight, dtype=float)
    mean, scale = fit_normalization(values, sample_weight)
    standardized = standardize_features(values, mean, scale)
    weights = np.zeros(standardized.shape[1], dtype=float)
    bias = 0.0
    reason = 'maximum_iterations'
    loss_curve = []
    updates = 0
    for _ in range(max_iter):
        loss, gradients = logistic_loss_and_grad(standardized, labels, sample_weight, weights, bias, l2)
        grad_w, grad_b = gradients[0], float(gradients[1][0])
        gradient_norm_sq = float(grad_w @ grad_w + grad_b * grad_b)
        loss_curve.append(loss)
        if gradient_norm_sq ** 0.5 <= tolerance:
            reason = 'gradient_tolerance'
            break
        step = 1.0
        accepted = False
        for _ in range(40):
            candidate_w = weights - step * grad_w
            candidate_b = bias - step * grad_b
            candidate_loss = weighted_logit_loss(standardized @ candidate_w + candidate_b, labels,
                                                 sample_weight, [candidate_w], l2)
            if candidate_loss <= loss - 1e-4 * step * gradient_norm_sq:
                weights, bias = candidate_w, candidate_b
                accepted = True
                updates += 1
                if loss - candidate_loss <= tolerance:
                    reason = 'objective_tolerance'
                break
            step *= 0.5
        if not accepted:
            reason = 'line_search_tolerance'
            break
        if reason == 'objective_tolerance':
            break
    return {'kind':'logistic','mean':mean.tolist(),'scale':scale.tolist(),'weights':[weights.tolist()],
            'bias':[float(bias)],'trainingDiagnostics':{'updates':updates,'convergence':reason,'lossCurve':loss_curve}}


def fit_mlp(x, y, weight, seed=1729, device='auto', max_epochs=2000, l2=1e-3, learning_rate=1e-3):
    values = np.asarray(x, dtype=float)
    labels = np.asarray(y, dtype=float)
    sample_weight = np.asarray(weight, dtype=float)
    mean, scale = fit_normalization(values, sample_weight)
    standardized = standardize_features(values, mean, scale)
    if max_epochs < 1 or not np.isfinite(learning_rate) or learning_rate <= 0 or not np.isfinite(l2) or l2 < 0:
        raise ValueError('MLP training requires positive epochs/rate and nonnegative L2')
    try:
        import torch
    except ImportError:
        torch = None
    if torch is not None and device != 'numpy':
        torch.manual_seed(seed)
        backend = 'mps' if torch.backends.mps.is_available() else 'cpu'
        if device == 'mps' and backend != 'mps':
            raise RuntimeError('PyTorch MPS was explicitly requested but is unavailable')
        backend = device if device in ('cpu','mps') else backend
        tx = torch.tensor(standardized, dtype=torch.float32, device=backend)
        ty = torch.tensor(labels[:, None], dtype=torch.float32, device=backend)
        tw = torch.tensor(sample_weight[:, None], dtype=torch.float32, device=backend)
        first = torch.nn.Linear(values.shape[1], 16)
        last = torch.nn.Linear(16, 1)
        model = torch.nn.Sequential(first, torch.nn.ReLU(), last).to(backend)
        optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate, betas=(0.9, 0.999), eps=1e-8)
        loss_curve = []
        for _ in range(max_epochs):
            optimizer.zero_grad()
            logits = model(tx)
            data_loss = (torch.nn.functional.binary_cross_entropy_with_logits(logits, ty, reduction='none') * tw).sum() / tw.sum()
            loss = data_loss + 0.5 * l2 * (first.weight.square().sum() + last.weight.square().sum())
            loss.backward()
            optimizer.step()
            loss_curve.append(float(loss.detach().cpu()))
        first_layer, last_layer = [layer for layer in model.modules() if isinstance(layer, torch.nn.Linear)]
        return {'kind':'mlp','mean':mean.tolist(),'scale':scale.tolist(),
                'weights':first_layer.weight.detach().cpu().numpy().tolist(),
                'bias':first_layer.bias.detach().cpu().numpy().tolist(),
                'outputWeights':last_layer.weight.detach().cpu().numpy()[0].tolist(),
                'outputBias':float(last_layer.bias.detach().cpu().numpy()[0]),
                'trainingDevice':backend,'trainingDiagnostics':{'epochs':max_epochs,'lossCurve':loss_curve}}

    rng = np.random.default_rng(seed)
    w1 = rng.normal(0, np.sqrt(2 / standardized.shape[1]), (16, standardized.shape[1]))
    b1 = np.zeros(16)
    w2 = rng.normal(0, np.sqrt(2 / 16), 16)
    b2 = np.zeros(1)
    params = [w1, b1, w2, b2]
    first_moment = [np.zeros_like(parameter) for parameter in params]
    second_moment = [np.zeros_like(parameter) for parameter in params]
    loss_curve = []
    for step in range(1, max_epochs + 1):
        loss, gradients = mlp_loss_and_grad(standardized, labels, sample_weight, params, l2)
        loss_curve.append(loss)
        for index, (parameter, gradient) in enumerate(zip(params, gradients)):
            first_moment[index] = 0.9 * first_moment[index] + 0.1 * gradient
            second_moment[index] = 0.999 * second_moment[index] + 0.001 * gradient * gradient
            corrected_first = first_moment[index] / (1 - 0.9 ** step)
            corrected_second = second_moment[index] / (1 - 0.999 ** step)
            parameter -= learning_rate * corrected_first / (np.sqrt(corrected_second) + 1e-8)
    return {'kind':'mlp','mean':mean.tolist(),'scale':scale.tolist(),'weights':w1.tolist(),'bias':b1.tolist(),
            'outputWeights':w2.tolist(),'outputBias':float(b2[0]),'trainingDevice':'numpy',
            'trainingDiagnostics':{'epochs':max_epochs,'lossCurve':loss_curve}}


def write_json(path, value):
    output = pathlib.Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def coverage(rows):
    ready = sum(row.get('status') == 'ready' for row in rows)
    return {'labeledRows':len(rows),'readyRows':ready,'insufficientEvidenceRows':len(rows) - ready,
            'coverage':ready / len(rows) if rows else 0.0}


def training_report_metrics(y, predicted, sessions):
    return combined_metrics(y, predicted, sessions)


def train_command(args):
    rows = load_rows(args.features)
    tr_all, va_all = labeled_rows(rows, 'train'), labeled_rows(rows, 'validation')
    tr, va = usable(rows, 'train'), usable(rows, 'validation')
    if not tr or not va or {row['label'] for row in tr} != set(LABELS) or {row['label'] for row in va} != set(LABELS):
        raise ValueError('Train and validation splits each require both explicit ready labels')
    x = np.asarray([row['features'] for row in tr], dtype=float)
    y = np.asarray([LABELS[row['label']] for row in tr], dtype=float)
    weight = balanced_weights(tr)
    vx = np.asarray([row['features'] for row in va], dtype=float)
    vy = np.asarray([LABELS[row['label']] for row in va], dtype=int)
    validation_sessions = [row['session'] for row in va]
    synthetic_only = bool(tr_all + va_all) and all(row.get('syntheticOnly') is True for row in tr_all + va_all)
    candidates = []
    for kind, fit in [('logistic', fit_logistic), ('mlp', lambda a,b,c: fit_mlp(a,b,c,device=args.device))]:
        params = fit(x, y, weight)
        training_diagnostics = params.pop('trainingDiagnostics', {})
        training_device = params.pop('trainingDevice', 'numpy')
        scores = predict(params, vx)
        threshold = choose_threshold(vy, scores, validation_sessions)
        validation_report = training_report_metrics(vy, scores >= threshold, validation_sessions)
        observed_rates = sorted(set(row['analysisSampleRateHz'] for row in va if row.get('analysisSampleRateHz') is not None))
        artifact = {**params,'version':1,'preprocessing':PREPROCESSING,'featureNames':FEATURE_NAMES,'threshold':threshold,
                    'validatedSampleRatesHz':[],'syntheticOnly':synthetic_only,
                    'trainingSessions':sorted(set(row['session'] for row in tr)),
                    'validationSessions':sorted(set(validation_sessions))}
        candidates.append((artifact, validation_report, {'device':training_device, **training_diagnostics,
                                                         'observedValidationSampleRatesHz':observed_rates}))
    candidates.sort(key=lambda item: ((item[1]['sessionBalancedAccuracy'] if item[1]['sessionBalancedAccuracy'] is not None else -1),
                                      item[0]['kind'] == 'logistic'), reverse=True)
    model = candidates[0][0]
    canonical = json.dumps(model, sort_keys=True, separators=(',',':'))
    model['id'] = hashlib.sha256(canonical.encode()).hexdigest()[:16]
    write_json(args.model, model)
    write_json(args.report, {'selectedModel':model['kind'],'selectedTraining':candidates[0][2],
        'validation':candidates[0][1],
        'candidates':[{'kind':artifact['kind'],'validation':report,'training':diagnostics}
                      for artifact,report,diagnostics in candidates],
        'trainingRows':len(tr),'trainingCoverage':coverage(tr_all),
        'validationRows':len(va),'validationCoverage':coverage(va_all),
        'observedValidationSampleRatesHz':candidates[0][2]['observedValidationSampleRatesHz'],
        'validatedSampleRatesHz':[], 'testRows':len(usable(rows,'test')),
        'syntheticOnly':synthetic_only})


def visibility_bucket(value):
    if value is None:
        return 'unknown'
    fraction = float(value)
    if fraction >= 0.999:
        return 'full'
    if fraction >= 0.75:
        return 'mostly-visible'
    if fraction >= 0.5:
        return 'partly-visible'
    return 'low-visibility'


def grouped_evaluation(rows, predictions, key_fn):
    groups = {}
    for row, prediction in zip(rows, predictions):
        groups.setdefault(str(key_fn(row)), []).append((row, prediction))
    result = {}
    for key, group in groups.items():
        ready = [(row, prediction) for row, prediction in group if row.get('status') == 'ready']
        metrics_result = None
        if ready:
            y = [LABELS[row['label']] for row, _ in ready]
            pred = [prediction for _, prediction in ready]
            metrics_result = combined_metrics(y, pred, [row['session'] for row, _ in ready])
        total = len(group)
        result[key] = {'labeledRows':total,'readyRows':len(ready),'insufficientEvidenceRows':total - len(ready),
                       'coverage':len(ready) / total if total else 0.0,'metrics':metrics_result}
    return result


def evaluate_command(args):
    rows = load_rows(args.features)
    split = args.split
    selected = labeled_rows(rows, split)
    if not selected:
        raise ValueError(f'No labeled {split} rows')
    ready = usable(rows, split)
    report = {'split':split,'byRecording':{},'bySession':{},'byResolution':{},'byVisibility':{},
              'overall':None,'coverage':coverage(selected)}
    model = json.loads(pathlib.Path(args.model).read_text()) if args.model else None
    predictions = []
    for row in ready:
        score = float(predict(model, [row['features']])[0]) if model else float(row.get('ruleScore', 0))
        predictions.append(score >= (model['threshold'] if model else args.threshold))
    if ready:
        y = [LABELS[row['label']] for row in ready]
        report['overall'] = combined_metrics(y, predictions, [row['session'] for row in ready])
    report['byRecording'] = grouped_evaluation(selected, predictions_for_rows(selected, ready, predictions),
                                                lambda row: row.get('captureId') or row.get('recordingId') or row.get('id', 'unknown'))
    report['bySession'] = grouped_evaluation(selected, predictions_for_rows(selected, ready, predictions),
                                              lambda row: row.get('session', 'unknown'))
    report['byResolution'] = grouped_evaluation(selected, predictions_for_rows(selected, ready, predictions),
                                                 lambda row: row.get('fftSize', 'unknown'))
    report['byVisibility'] = grouped_evaluation(selected, predictions_for_rows(selected, ready, predictions),
                                                 lambda row: visibility_bucket(row.get('visibleFraction')))
    write_json(args.report, report)


def predictions_for_rows(all_rows, ready_rows, ready_predictions):
    by_identity = {id(row): prediction for row, prediction in zip(ready_rows, ready_predictions)}
    return [by_identity.get(id(row)) for row in all_rows]


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    train = sub.add_parser('train')
    train.add_argument('--features', required=True)
    train.add_argument('--model', required=True)
    train.add_argument('--report', required=True)
    train.add_argument('--device', choices=['auto','numpy','cpu','mps'], default='auto')
    train.set_defaults(run=train_command)
    evaluate = sub.add_parser('evaluate')
    evaluate.add_argument('--features', required=True)
    evaluate.add_argument('--split', choices=['validation','test','acceptance'], default='test')
    evaluate.add_argument('--model')
    evaluate.add_argument('--threshold', type=float, default=0.5)
    evaluate.add_argument('--report', required=True)
    evaluate.set_defaults(run=evaluate_command)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'classifier: {error}', file=sys.stderr)
        sys.exit(2)
