# Manual N-APT classifier regression fixtures

The manifest, harness, and synthetic tests are versioned, but raw-IQ captures
are intentionally local-only. They do not run in CI because WebGPU and capture
data are expensive, and raw `.napt`, `.wav`, and `.iq` files must never be
checked into Git. The ignored `captures/` directory is only a convenient local
working location for classifier calibration.

Run the local app first, then execute:

```sh
node scripts/test/manual_napt_classifier_harness.mjs \
  --regression-manifest test/fixtures/napt-classifier/regression.json \
  --assert
```

The manifest is the source of truth for labels and thresholds. Do not infer a
label from a filename in the harness. When adding a capture, decrypt it with
the manual capture harness and place the resulting raw samples and metadata in
the ignored local `captures/` directory (or keep them outside the repository),
then add only the explicit metadata case here. Never add the raw capture to
Git.

Positive feature thresholds intentionally start high. A failing real-capture
case is a classifier or labeling issue to investigate, not a reason to hide a
regression by silently lowering its assertion.
