# N-APT classifier: learning and evaluation plan

Updated 2026-09-24. This plan records the learning method, evaluation contract, and implementation status. The initial trainer correctness repairs are in place and covered with synthetic tests; they do not establish trained-model accuracy. No independently labeled real recordings have been used for fitting or evaluation.

## Recommended first experiment

Use supervised, regularized logistic regression as the first learned baseline. Compare it with a single 16-unit ReLU hidden layer on exactly the same features and session splits. Retain deterministic rules as a comparison and fallback. Prefer logistic regression when the neural model offers no convincing independent improvement.

The model receives features measured from native spectra and timestamped history. The current contract has 18 inputs: logistic regression therefore has 19 learned parameters; the `18 → 16 → 1` network has 321. Neither candidate requires a browser ML runtime. These counts exclude normalization metadata and change if we version the feature vector.

The operating flow is:

`capture I/Q + option/interruption events → attach time-aligned labels → split sessions → native-resolution features → offline fitting → validation threshold → export → browser shadow decisions → independent evaluation`

Capture, feature extraction, and inference do not update model weights. Training is an explicit offline operation with a recorded dataset version.

## What learning means here

Forward propagation computes a prediction with the current weights. A loss measures disagreement with the known training label. Backpropagation uses the chain rule to compute how changing each weight would change that loss. Gradient descent, or an optimizer such as Adam, then updates the weights. Backpropagation computes derivatives; the optimizer performs the update. This repeats over training data. Browser inference performs only the forward pass. See the [PyTorch optimization tutorial](https://docs.pytorch.org/tutorials/beginner/basics/optimization_tutorial.html).

| Candidate | Forward pass | What it can learn | Proposed fitting method |
| --- | --- | --- | --- |
| Existing/improved rules | Explicit measurements and thresholds | No learned weights | Tune only designated thresholds on validation sessions |
| Logistic regression | `p = sigmoid(w · x + b)` | A weighted combination of the supplied measurements | Analytic gradients, full-batch gradient descent with backtracking, L2 regularization |
| Small neural network | `h = ReLU(W1 x + b1)`; `p = sigmoid(w2 · h + b2)` | Nonlinear combinations of those same measurements | Backpropagation and Adam, L2 regularization, early stopping |

Both learned candidates optimize a weighted binary cross-entropy objective. Compute it from logits for numerical stability, plus an explicit L2 penalty on weights, excluding biases. NumPy should use the stable softplus formulation; PyTorch should use unreduced `binary_cross_entropy_with_logits`, followed by the same sample weighting and reduction. The sigmoid is needed for exported scores, not before the logits loss. See [BCEWithLogitsLoss](https://docs.pytorch.org/docs/2.14/generated/torch.nn.BCEWithLogitsLoss.html).

For logistic regression, the unregularized gradient is the weighted average of `(p - y) × x`; gradient descent subtracts a learning-rate-scaled gradient from each weight. A network propagates that error through its output layer, ReLU, and input layer. Use numerical gradient checks to verify the manual NumPy implementation before trusting its training results.

### Learning feature combinations versus discovering features

The current extractor is fixed, not differentiable end-to-end with the trainer. A model can learn that a combination of bridge evidence, spacing, floor-relative prominence, visibility, and persistence is informative. It cannot reconstruct pulse timing, phase coherence, or rise/fall behavior already discarded by the feature vector.

Audit the current measurements before enlarging the model. If pulsing matters, propose a versioned feature extension for modulation depth, pulse rate, duty cycle, and rise/fall time, measured over actual acquisition timestamps with a minimum observation duration and explicit availability. Keep floor-relative power and spacing in physical units/support metadata where appropriate. Do not confuse band visibility/coherence annotations with a measured phase-coherence feature. Any feature-version change must update Python, TypeScript, WGSL, model validation, and parity tests together.

An end-to-end temporal/spectral network is a later experiment if the compact features demonstrably discard necessary information and sufficient independent labels exist. It would need a new resolution-aware input representation and deployment plan. A larger optimizer cannot restore detail lost to coarse FFTs or dropped frames.

## Labels, resolution, and capture boundaries

- `matching` means the independently annotated target morphology is present; `nonmatching` requires an independently identified negative. Uncertain intervals are excluded from supervised fitting. Channel A/B location supplies context, not automatic positive labels or model inputs.
- Insufficient evidence is an abstention based on measurement support, not a third supervised negative class. Exclude unavailable rows from fitting and threshold selection; keep them in coverage reports with reasons.
- Feature-present annotations and free-text tags remain separate from the target label. Do not feed human annotations, filenames, session IDs, absolute channel identity, or existing classifier decisions into model inputs.
- Use coherence/truncation and frequency visibility descriptions rather than a human label called “partial shape.” Keep historical feature keys compatible until a deliberate version migration.
- The supplied acceptance captures remain acceptance-only. Mock signals and sinc probes are synthetic challenge cases, not real RF negatives. Never relabel the current live signal as a mock or sinc negative without independent evidence.
- Initially evaluate 3.2 MS/s at actual 1,024-, 4,096-, and 16,384-sample analysis windows, plus relevant native capture sizes. Bin spacings are 3,125, 781.25, and 195.3125 Hz respectively; window support also limits resolution. Preserve crop origin and native-bin support. No display-image resizing or zero-padding as a substitute for reduced acquired resolution.
- Apply V6 option patches at their exact channel/byte boundaries before extraction; test this reader path rather than assuming a working writer proves it. Do not assemble one analysis window across a settings transition or interruption. Keep original acquisition settings separate from an explicitly chosen offline analysis FFT/window.
- Reset causal temporal histories on source, effective settings, analyzed interval, or continuity changes. Never bridge a gap or use future frames. Do not infer lossless acquisition from timestamps alone. Distinct label intervals must retain their provenance; ambiguous transitions may be excluded by an explicit rule.

## Splits, normalization, and weighting

Freeze independent evaluation sessions before windowing or augmentation. Group by acquisition session and shared continuous recording; adjacent captures from the same setup are not independent just because filenames differ. Every FFT size, crop, gain augmentation, and synthetic derivative stays with its parent split. Keep separate real-negative sessions and diversity of antenna position, interference, tuning, and signal strength. Report session counts, duration, and class coverage before fitting; many frames from one session do not substitute for independent sessions.

Use training sessions for weight fitting. Reserve a group-disjoint monitoring subset inside training for neural early stopping. Validation sessions choose the small, predeclared hyperparameter set, model candidate, and operating threshold. This makes validation a development score; untouched evaluation sessions supply the independent result. If there are too few sessions to populate these roles with both classes, report a data shortfall and use grouped development folds only for exploratory work. Do not fall back to random frame splits.

Fit normalization on training data only, respecting availability masks and training sampling weights. Export the exact transformation used during fitting. Missing measurements must have a documented masked/imputed representation distinct from observed zero; boolean availability indicators retain their defined semantics. Any clipping policy must be identical in fitting, Python prediction, TypeScript, and WGSL. The preferred initial repair is to remove the current training-only clipping, then reject invalid/nonfinite inputs and document handling of out-of-range evidence.

Specify one weighting hierarchy: equal class influence, then equal session influence within each class, then equal recording/annotated-interval influence, then base time windows. Divide each window's weight across its FFT/crop variants. Normalize weights to a mean of one. Use bounded time-window sampling so overlap or delivery cadence cannot inflate a recording's influence. Test that duplicating rows or generating extra variants does not alter the intended group influence.

## Bounded training recipe

These are proposed starting configurations, not measured best settings. Record the search before running it and keep evaluation data out of every choice.

- Logistic: initialize weights/bias to zero; use the analytic gradient with backtracking until the training objective decreases; stop on a documented gradient/improvement tolerance or a maximum of 5,000 updates. Compare L2 strengths `{0, 1e-4, 1e-3, 1e-2}`. Emit convergence reason and loss curve, not just final weights.
- Neural: fixed 16-unit ReLU architecture, suitable variance-scaled initialization, and Adam with learning rate `1e-3`, betas `(0.9, 0.999)`, epsilon `1e-8`. Apply the same explicit L2 objective in both backends rather than relying on differing implicit weight-decay semantics. Compare L2 strengths `{1e-4, 1e-3}`. See [Adam](https://docs.pytorch.org/docs/2.14/generated/torch.optim.Adam.html).
- Start full-batch for the small feature dataset. For larger datasets, accumulate bounded chunks into the same weighted gradient before each optimizer step; do not silently change the objective or effective learning rate with batch size. Stop at 2,000 epochs or after 50 epochs without at least `1e-5` improvement in weighted monitoring loss. Restore the best monitoring checkpoint.
- Use fixed seeds `1729`, `1730`, and `1731` for the neural comparison and report all runs. Predeclare a representative-seed rule based on development results rather than reporting only a lucky run. Do not promise bitwise equality across CPU/MPS; verify forward/gradient agreement within documented tolerances.
- NumPy CPU is the minimal-dependency reference. PyTorch/MPS is optional for offline acceleration; explicit MPS requests should fail clearly if unavailable, while `auto` records the actual backend selected. Benchmark elapsed training time before preferring GPU for a tiny model. [PyTorch MPS](https://docs.pytorch.org/docs/2.14/notes/mps.html) supplies the hardware path; Swift/Core ML remains optional later.

Log each run's dataset hash, split manifest, feature/preprocessing version, code revision, seed, device/software versions, objective, normalization, optimizer settings, loss curves, and stopping reason. Model export must represent the restored checkpoint, with finite values and validated dimensions.

## Selection, calibration, and rollout

For the opt-in grid, use exactly the declared L2 sets above. Select each candidate's threshold by validation session-balanced balanced accuracy. Choose the best logistic L2, preferring stronger L2 on ties. For each MLP L2, average validation session-balanced balanced accuracy across the three declared seeds; choose the best mean, preferring stronger L2 on ties, then represent that L2 with the seed nearest its mean (lowest seed on ties). Compare that MLP mean with the selected logistic score and prefer logistic on ties. Report every candidate threshold, score, configuration, and seed; all must share fitting/monitor/validation sessions. No test split data may participate in any grid choice.

Report both pooled frame balanced accuracy and session-balanced sensitivity/specificity (equal influence per session within each class); use session-balanced balanced accuracy as the declared selection score so long recordings cannot dominate. When a group lacks one class, report the available rate and mark its balanced accuracy unavailable. Test threshold ties, duplicate scores, extreme logits, and the all-positive/all-negative operating points.

Use the same availability policy and captured frames for legacy rules, improved rules, and both models. Show classified-row metrics together with abstention coverage for each class, session, FFT size, and visibility bucket. Report the number of independently labeled positive intervals missed or abstained on; do not hide low-resolution failures by reporting only rows that produced a decision.

Prefer logistic regression on tied development performance. For close results, report variation across sessions and neural seeds; reserve a complexity increase for a consistent benefit. Freeze the selected weights, threshold, temporal policy, and preprocessing before evaluating the untouched split. If evaluation fails, report it and collect a new evaluation set for future development cycles rather than repeatedly tuning against that set.

Initially show an **uncalibrated model score**, not a percentage certainty. Class balancing changes the training distribution, so sigmoid output alone does not establish real-world probability. If calibrated probabilities become necessary, reserve independent, representative calibration sessions (or a documented grouped cross-fitting scheme) and assess reliability/Brier score there; choose the operating threshold on separate validation predictions after calibration. See [probability calibration](https://scikit-learn.org/stable/modules/calibration.html).

Run labeled synthetic sinc, comb, tone, and app-mock challenges separately from real RF evaluation. Include crops and interference overlays without changing the original positive/negative provenance. Compare with/without temporal features and with/without availability indicators to detect shortcuts. Investigate extractor information loss before adding layers. Keep acceptance assertions unchanged and never use their failures to select training weights or thresholds.

Promotion requires passing unchanged acceptance assertions, improvement on independent evaluation without material resolution/visibility regressions, and measured browser latency/render impact. Agree numerical regression and latency budgets before viewing evaluation results. Until then, keep shadow mode and the compatible deterministic fallback. Standalone GPU timing is not proof of live SDR performance.

## Trainer repair status

The source-inspection findings from 2026-09-24 now have focused regressions in `test/classifier/test_training.py`:

| Finding | Current status |
| --- | --- |
| PyTorch export used the Sequential container rather than its two Linear layers | Fixed; CPU fit/export regression passes. |
| NumPy output bias was not read back from the updated parameter array | Fixed; output-bias and finite-difference tests pass. |
| Training clipped standardized inputs while prediction did not | Fixed; training and inference share weighted training normalization and the unclipped affine transform. |
| Sampling weights did not implement the stated hierarchy | Fixed; class/session/recording-interval/base-window/variant weighting is tested. |
| Insufficient evidence entered fitting and scored evaluation as a decision | Fixed; fitting uses ready rows and evaluation reports abstention coverage separately. |
| Validation-row sample rates were called validated | Fixed; artifacts claim no validated rates; observed rates are reported separately. |
| Optimizer settings diverged and training returned no usable convergence details | Partly fixed; NumPy and PyTorch share weighted logits loss, explicit L2, and Adam settings; logistic uses backtracking; and the MLP uses group-disjoint training-monitor sessions, early stopping, and best-checkpoint restore when there are enough sessions. The opt-in `--search-grid` runner compares the predeclared logistic L2 grid and MLP L2-by-seed grid, selects only on shared validation sessions, and reports candidate thresholds/scores/seed variation. The CLI exposes seeds, optimizer/stopping settings, and optional uniquely named candidate exports. Reports include a feature-dataset hash, split-session manifest, source revision/dirty state, runtime versions, configuration, and selected normalization. |

## Implementation handoff: small, testable tasks

1. **Trainer correctness and reproducibility (core slice complete):** tests cover the original defects, finite-difference gradients, stable weighted logits loss, fit/export, abstentions, session-disjoint monitoring, checkpoint restore, report provenance, Python/TypeScript/WGSL inference parity for exported logistic and MLP candidates, explicit unavailable-MPS failure, and predeclared search selection/artifact naming. The opt-in grid uses logistic L2 `{0, 1e-4, 1e-3, 1e-2}` and MLP L2 `{1e-4, 1e-3}` at the base seed and next two integers. Every candidate uses common fitting/monitor/validation sessions; threshold and candidate selection use validation session-balanced balanced accuracy only. Stronger L2 wins same-family ties, the MLP seed nearest its L2 mean is reported (lowest seed on ties), and logistic wins model ties. The trainer can emit every uniquely named candidate artifact. The default Python run passes 25 tests with three optional PyTorch tests skipped. A temporary CPython 3.14/PyTorch 2.14 environment also passes all 25 tests on CPU; MPS is unavailable on this host. The opt-in trained-artifact WebGPU check measured maximum prediction error `2.75e-8` across two model kinds and three probes each. No real-capture training yet.
2. **Capture-to-feature provenance:** verify V6 patches/interruption boundaries through prepare/extract; reconcile actual timestamps, masks, labels, and session splits. Add malformed capture, stale/gap, crop, and variable-FFT cases. Confirm TS/WGSL feature parity before changing features.
3. **Feature sufficiency:** inventory pulse/spacing/power measurements and missing support. Define a separate versioned extension only where needed; compare information content without tuning to acceptance fixtures.
4. **Experiment search and deployed parity:** the bounded, predeclared multi-seed/L2 search and validation-only selection are implemented and tested on synthetic-only rows. Python/TypeScript/WGSL parity for trained artifacts passes, including an out-of-range probe. Synthetic tests prove plumbing only; they do not establish signal accuracy.
5. **Data and comparison:** collect independent labeled sessions, freeze the split/search/metric rules, train both candidates, select on validation, and issue one untouched evaluation report with resolution/visibility/session breakdowns. Report missing real-negative data honestly.
6. **Browser measurement:** load the selected artifact in shadow mode, measure cold/warm extraction and inference, drops, and render impact. Then assess promotion against the predeclared criteria.

Keep I/Q transport metadata agnostic and labels external. Do not change spike detection, demodulation, live SDR settings, or the Swift service as part of these trainer tasks.
