# Audio demodulation Python training slice

The browser's audio survey stores timestamp-aligned narrowband I/Q and known
reference PCM in IndexedDB. `Export Python corpus` downloads one survey job as a
bounded, uncompressed tar containing binary arrays and a small manifest. That
keeps signal samples out of JSON and preserves capture/session identity.

`scripts/audio_demod/` consumes one or more such archives and an explicit
session split map. It reproduces the v4 browser feature shape (128 raw I/Q
floats plus 64 Fourier features), trains a local 192→12→1 tanh regressor, saves
atomic batch and epoch checkpoints, supports safe manual pause/resume, evaluates
against held-out sessions and available DSP baselines, and exports an ONNX graph
with the app's input/output names. Sleep/wake leaves the local process suspended
for the OS to resume; a terminated process can be restored with the `resume`
subcommand and its persistent run directory.
The ONNX graph, small binary weight vector, and checksum manifest can be loaded
from the demodulation node and are kept in local IndexedDB for the selected
survey job.

This is a prototype bridge, not a validated general neural decoder. The corpus
must contain independent survey jobs in train, validation, and test. Models
remain profile-specific to one I/Q sample rate, channel width, and PCM rate.
Live acquisition and ONNX inference remain app-side; Python only handles
offline training and evaluation.

Operational instructions and commands: [scripts/audio_demod/README.md](../scripts/audio_demod/README.md).
