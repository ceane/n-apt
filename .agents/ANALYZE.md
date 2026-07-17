# Analyze an encrypted `.napt` IQ capture

This repository's `.napt` captures use AES-256-GCM. The password is not stored in
the capture; use the local development value from `.env.local`:

```sh
set -a
source .env.local
set +a
```

Do not print, commit, or paste `UNSAFE_LOCAL_USER_PASSWORD` (or decrypted IQ
data). Keep decrypted output outside the repository, for example under
`/private/tmp`.

## Capture layout

The capture supplied for this task has:

- JSON metadata padded to a 4096-byte header
- `metadata.encrypted: true`
- `metadata.wrapped_dek`: a base64 AES-GCM payload containing the per-capture
  data-encryption key (DEK), wrapped with the password-derived vault key
- encrypted payload beginning at byte 4096
- `metadata.channels[0].offset_iq: 0`
- IQ format `iq_u8`, so payload bytes are interleaved unsigned 8-bit I/Q:
  `I0, Q0, I1, Q1, ...`
- sample rate 3,200,000 samples/second and center frequency 1,618,000 Hz

The password-derived key is PBKDF2-HMAC-SHA256, 100,000 iterations, using
`NAPT_PBKDF2_SALT` (or `VITE_PBKDF2_SALT`) as the salt. If neither is set, the
repository default is `n-apt-aes-salt-v1`. The password is trimmed before key
derivation. AES-GCM uses a 12-byte IV followed by ciphertext and its 16-byte
authentication tag.

## Preferred method: load through n-apt

Run the app locally, authenticate with the same local password, and open the
capture through the IQ/file playback UI. The file worker already handles the
wrapped-DEK flow and extracts the channel bytes using `offset_iq` and
`iq_length`.

Use `localhost` when using browser automation; `127.0.0.1` is intentionally not
supported by this project.

## Offline decryption workflow

For a one-off analysis, use an ephemeral Node process rather than adding a
decryptor or decrypted fixture to the repository. The following example writes
raw IQ bytes to `/private/tmp/capture_iq.u8`:

```sh
CAPTURE="$HOME/Downloads/capture_cap_1778118690298_20260507_015131.napt"
OUT="/private/tmp/capture_iq.u8"

node --input-type=module <<'NODE'
import { readFile, writeFile } from "node:fs/promises";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

const capture = process.env.CAPTURE;
const output = process.env.OUT;
const password = process.env.UNSAFE_LOCAL_USER_PASSWORD;
const salt = process.env.NAPT_PBKDF2_SALT || process.env.VITE_PBKDF2_SALT || "n-apt-aes-salt-v1";
if (!capture || !output || !password) throw new Error("Set CAPTURE, OUT, and source .env.local first");

function decryptGcm(payload, key) {
  const iv = payload.subarray(0, 12);
  const body = payload.subarray(12);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(body.subarray(body.length - 16));
  return Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
}

const bytes = await readFile(capture);
let depth = 0, quoted = false, escaped = false, end = -1;
for (let i = 0; i < 4096; i++) {
  const c = String.fromCharCode(bytes[i]);
  if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
  else if (c === '"') quoted = true;
  else if (c === "{") depth++;
  else if (c === "}" && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error("Could not find JSON header");
const root = JSON.parse(bytes.subarray(0, end).toString("utf8"));
const meta = root.metadata ?? root;
const vaultKey = pbkdf2Sync(password.trim(), salt, 100000, 32, "sha256");
const dek = meta.wrapped_dek ? decryptGcm(Buffer.from(meta.wrapped_dek, "base64"), vaultKey) : vaultKey;
const plaintext = decryptGcm(bytes.subarray(4096), dek);
const channel = (meta.channels ?? root.channels ?? [{ offset_iq: 0 }])[0];
const start = channel.offset_iq ?? 0;
const length = channel.iq_length ?? plaintext.length - start;
await writeFile(output, plaintext.subarray(start, start + length));
console.error(`wrote ${length} IQ bytes to ${output}`);
NODE
```

The command relies on `CAPTURE` and `OUT` being exported. If you save the Node
block temporarily, use a filename beginning with `tmp_`, run it with the two
environment variables set, and remove it afterward. Do not save it under the
repository as a permanent utility unless it is reviewed as production code.

## Manual shader-test harness

For repeatable, file-based shader experiments, use the reviewed manual harness
instead of copying a one-off decrypt block. It reads the password only from
`UNSAFE_LOCAL_USER_PASSWORD` in `.env.local` or the process environment, and it
writes decrypted output outside the repository by default:

```sh
node scripts/test/manual_napt_capture_harness.mjs \
  --input "$HOME/Desktop/samples-for-shaders/large_suspension_bridge_capture_cap_1784255167483_20260717_022608.napt" \
  --out-dir "/private/tmp/napt-harness/large-suspension-bridge" \
  --fft-size 65536 \
  --frames 0,8,16,24,32
```

The output directory contains:

- `raw.iq.u8`: the complete unsigned 8-bit interleaved stream
  (`I0,Q0,I1,Q1,...`);
- `frames/frame_XXXXXX.iq.u8`: selected complete FFT-sized frame slices; and
- `manifest.json`: safe provenance and frame metadata, without the password or
  wrapped DEK.

Use `--frames all` to extract every complete frame, or provide a comma-separated
list to keep a manual test run small. This harness is intentionally not part of
CI: a human must explicitly choose the capture, output directory, and frames.

To run the GPU classifier against those raw frames, use the separate manual
classifier harness. It performs the full FFT in Node, sends the complete FFT
frame to WebGPU, and then follows the production order: resample, floor
reduction, primary/recovery spike detection, classifier finalization, and N-APT
decision readback.

```sh
node scripts/test/manual_napt_classifier_harness.mjs \
  --manifest-dir "/private/tmp/napt-harness/large-suspension-bridge" \
  --frames 0,8,16,24,32
```

Repeat `--manifest-dir` for additional labeled captures. The JSON result marks
each capture `valid: false` when WebGPU reports a validation error, no spikes,
or an unpopulated floor/readback value; those results must not be interpreted as
classifier `No` decisions. This scoring command is manual-only and expects the
local app to already be running at `http://localhost:5173/`.

## Interpreting the output

The extracted file is unsigned 8-bit interleaved IQ. Convert each byte to a
centered sample before DSP:

```text
I = (byte_I - 127.5) / 127.5
Q = (byte_Q - 127.5) / 127.5
```

## N-APT analysis target

Do not demodulate, infer protocol behavior from, or treat Mock APT SDR output as
the real signal. Mock APT is only a synthetic development/test source. In
particular, do not use its waveform, seeded checksum, spike pattern, or frame
timing as the expected N-APT baseline.

The intended target is a true N-APT signal. The working hypothesis is:

- it is APT-based, so line timing and image-line structure are more useful
  starting points than generic audio demodulation;
- it may be heterodyned, but the heterodyne can initially be left as an unknown
  frequency translation and removed later;
- it contains spikes and valleys, with valleys potentially carrying content
  and spikes potentially indicating function, framing, transitions, or control.

For a real N-APT capture, preserve the raw decrypted IQ and create analysis
derivatives outside the repository. Start with:

1. Plot PSD and a spectrogram without assuming the signal is centered at DC.
2. Estimate the occupied bandwidth and try several candidate frequency shifts;
   do not hard-code a heterodyne correction until it is supported by repeated
   observations.
3. Compare amplitude, phase, instantaneous frequency, and short-time energy
   representations. A valley that persists in amplitude but not phase may be a
   content symbol rather than a carrier event.
4. Search for stable line periods or repeated frame intervals. Use
   autocorrelation and matched averaging to separate recurring APT structure
   from isolated spikes.
5. Detect spike widths, spacing, polarity, and context. Test whether spikes
   mark boundaries or mode changes, rather than immediately treating them as
   picture pixels.
6. Only after timing is stable, try envelope, FM/phase-discriminator, coherent
   I/Q, and valley-oriented slicers as competing demodulation paths.

Record each candidate demodulator with its frequency shift, filter bandwidth,
line rate, polarity, and any timing assumptions. The goal is to falsify the
wrong interpretation using the real capture—not to make it resemble Mock APT.
