# Synthetic shape probes

The focused test at `test/ts/nativeClassifierAdversarial.test.ts` constructs several spectra to inspect feature-extractor behavior. These are mechanics probes only, **not an adversarial evaluation, signal classification result, or evidence about the currently received live N-APT signal**. The live signal has not been captured or analyzed by this test. In particular, the current real signal must not be described as a sinc formation based on these synthetic examples.

The constructed examples include a sinc-squared BPSK-like pedestal, a cropped sinc lobe, and a hand-built bridge with shoulders. Any scores they produce depend on arbitrary synthetic parameters and must not be compared as accuracy, used to tune thresholds, or used to characterize the live signal. The BPSK construction approximates only the app mock's pedestal formula; it does not reproduce the full stochastic mock or a captured mock FFT.

The checked-in regression manifest includes mock negatives and sinc-artifact recordings, but the native offline feature CLI does not yet ingest that legacy manifest as native-resolution arrays. Proper evaluation needs labeled real captures and representative negative captures in separate acquisition sessions. Synthetic scores should be excluded from those performance claims.

Feature audit: `spacingRegularity` is computed from within-spectrum detected local maxima and rough adjacent peak gaps; it is not timestamped spike-event interval analysis. `prominence` is the maximum narrow local peak above a 20th-percentile spectral floor, not a robust calibrated signal-to-floor measurement. `envelopeVariation` measures within-frame spectral variation. Temporal `persistence` is duration-weighted presence/mean bridge and U-dip over one second; there is no pulse rate, duty cycle, amplitude-modulation depth, rise/fall, or pulse-spacing feature.

Run only the mechanics probe with:

```sh
./node_modules/.bin/jest --runInBand --runTestsByPath test/ts/nativeClassifierAdversarial.test.ts
```
