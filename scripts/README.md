# I/Q Capture Tools

This guide covers the I/Q capture file format and scripts that inspect,
encrypt, or upgrade I/Q captures.

## Format reference: versions and history

The format version identifies the current file schema. The version dates below
come from the commits that introduced each format generation:

| Version | Introduced | Notes                                                                                                  |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| V1–V2   | Unknown    | Legacy formats; the repository history does not establish reliable dates or complete schemas.          |
| V3      | 2026-07-18 | Introduced the `NAPT-IQ3` container with separate metadata, frame updates, and binary payload.         |
| V4      | 2026-08-05 | Added indexed sections and a trailer.                                                                  |
| V5      | 2026-09-14 | Added the SHA-256 file integrity stamp.                                                                |
| V6      | 2026-09-23 | Work in progress. WebUSB frame updates carry per-frame timestamps, sequence numbers, and byte offsets. |

The playback reader treats a missing `format_version` in a `NAPT-IQ3` file as
V3, matching the format default used by the reader. That fallback is a
compatibility heuristic; it does not prove the source file was originally V3.
V1–V2 captures need format-specific inspection before conversion. Do not infer
their versions from the file extension alone.

## Script: `encrypt_iq_capture.mjs`

[`encrypt_iq_capture.mjs`](encrypt_iq_capture.mjs) encrypts a plaintext
`NAPT-IQ3` capture, retaining its existing format version and frame-update
records. It accepts V3–V6 files. It refuses already encrypted or malformed
inputs. For V5 and V6 it verifies the input integrity stamp before encrypting
and writes a new stamp over the encrypted output.

Set the capture passphrase in the shell environment, then run:

```sh
node scripts/encrypt_iq_capture.mjs path/to/capture.iq
```

An optional second argument selects the output path:

```sh
node scripts/encrypt_iq_capture.mjs path/to/capture.iq path/to/capture-encrypted.iq
```

The default output is `capture.iq.encrypted.iq`. The script reads
`UNSAFE_LOCAL_USER_PASSWORD`, or `N_APT_PASSKEY` if the first variable is not
set. It does not read `.env.local`; provide the value through the process
environment. The passphrase is never accepted as a command-line argument or
written by the script. The default PBKDF2 salt is `n-apt-aes-salt-v1`; set
`NAPT_PBKDF2_SALT` (or `VITE_PBKDF2_SALT`) when the application uses a custom
salt. The script uses the application-compatible PBKDF2-HMAC-SHA256 derivation
with 100,000 iterations and AES-256-GCM.

The output is created with owner-only permissions (`0600`). Existing output
files are never overwritten. Encryption covers the binary I/Q payload; the
header, public metadata, and frame-update timestamps remain readable, as they
do in the application's `NAPT-IQ3` encryption format. This tool does not
encrypt arbitrary raw-I/Q files or legacy V1–V2 containers.

Run its tests with:

```sh
node --test test/scripts/encrypt_iq_capture.test.mjs
```

## Script: `upgrade_iq_capture.mjs`

[`upgrade_iq_capture.mjs`](upgrade_iq_capture.mjs) upgrades compatible
`NAPT-IQ3` captures to V5, the stable format target. It preserves frame-update
records and payload bytes, adds the V5 SHA-256 integrity stamp, and validates
existing V5 integrity before accepting a V5 file. The default output is a new
`<input>.v5.iq` file; it never overwrites the source. It refuses to downgrade
V6, which remains a work in progress.

```sh
node scripts/upgrade_iq_capture.mjs path/to/capture.iq
```

An optional second argument selects the output path. Run the encryption script
on the upgraded file as a separate step:

```sh
node scripts/encrypt_iq_capture.mjs path/to/capture.iq.v5.iq
```

The playback reader treats a missing `format_version` in a `NAPT-IQ3` file as
V3. That is a compatibility fallback, not proof of the original schema. This
single-file command targets `NAPT-IQ3`. V6 per-frame timestamps, sequence
numbers, and byte offsets are never invented; V6 remains unchanged and is never
downgraded.

Run the upgrader tests with:

```sh
node --test test/scripts/upgrade_iq_capture.test.mjs
```

## Script: `migrate_evidentiary_captures.mjs`

This batch migration upgrades and encrypts `.iq` and `.napt` files in one
evidentiary capture directory. It validates every output as encrypted V5
before replacing any source file, uses a temporary staging area, and restores
the original files if the replacement step fails. Legacy `.napt` payload bytes
remain encrypted and unchanged; the migration adds a V5 section index and
integrity trailer without decrypting them. Captures with unknown source
versions retain that uncertainty in metadata, and the migration does not
invent frame timestamps. Existing filenames and extensions are preserved.

```sh
node scripts/migrate_evidentiary_captures.mjs \
  /path/to/training-captures/evidentiary/captures --dry-run
```

After the dry run reports every file valid, apply the migration with:

```sh
node scripts/migrate_evidentiary_captures.mjs \
  /path/to/training-captures/evidentiary/captures --in-place
```

The migration reads `UNSAFE_LOCAL_USER_PASSWORD` or `N_APT_PASSKEY` from the
shell, with `.env.local` as a local fallback. Neither the passphrase nor any
credential is written to the migrated captures' binary payload or the Git
hooks. Outputs are owner-only (`0600`). This command replaces the input files
after validating all outputs, so run it only on the intended capture folder.

Run its tests with:

```sh
node --test test/scripts/migrate_evidentiary_captures.test.mjs
```

## I/Q capture code paths

- Backend writer and format version: [`src/rs/server/iq_format.rs`](../src/rs/server/iq_format.rs)
- WebUSB writer and V6 frame markers: [`src/ts/webusb/iqCaptureFormat.ts`](../src/ts/webusb/iqCaptureFormat.ts)
- Playback reader and legacy-version fallback: [`src/ts/workers/fileWorker.ts`](../src/ts/workers/fileWorker.ts)

## Git hooks: encryption gate

Run `npm run setup:hooks` to configure this repository to use `.githooks`.
The `pre-commit` hook checks the staged Git blobs for `.iq` and `.napt`
captures. The `pre-push` hook checks changed capture blobs in every commit
being pushed, including a capture that was later deleted from the branch.
Both hooks block plaintext, malformed, and unrecognized capture files. They
recognize encrypted `NAPT-IQ3` files, encrypted legacy NAPT files, the
legacy `NAPTENC1` per-capture envelope, and the current salt-free `NAPTENC2`
envelope. `NAPTENC2` needs its per-capture salt from Redis DB 1; preserve the
matching Redis backup with protected copies.

Git has no hook that runs before `git add`, so the pre-commit hook cannot stop
a plaintext file from appearing in the index. It does stop a commit containing
one, and pre-push independently checks outgoing history. To remove a plaintext
capture from the index after a blocked commit, encrypt it first, then stage the
encrypted output.
