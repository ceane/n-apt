# Manual FIDO capture and playback checks

Automated format tests do not exercise browser WebAuthn prompts, YubiKey PIN/touch
behavior, or the Hugging Face batch workflow. Run these checks with a test
account and disposable captures on a trusted local origin. Do not commit capture
files, decrypted output, PINs, passwords, recovery credentials, or screenshots
containing secrets.

## Prerequisites

- Use a browser and OS that support WebAuthn PRF (`hmac-secret`) for the
  enrolled security-key credential.
- Plug in the enrolled FIDO key before starting an enrollment, login, or vault
  unlock ceremony. Follow the browser prompt; it may request the key PIN and a
  touch.
- Have the account password available for enrollment and the configured local
  capture recovery passphrase available to the `n-apt-ml` batch tooling. Never
  pass either secret as a command-line argument.
- Use a known, non-sensitive I/Q test signal and keep generated files in a
  local temporary directory.

The interactive, physical-key browser check is opt-in so normal CI does not
hang waiting for a person or authenticator:

```sh
NAPT_RUN_FIDO_HARDWARE=1 npx playwright test test/ts/FidoHardwareE2E.spec.ts --headed
```

It opens the real app, waits for the enrolled key's sign-in prompt, then opens
the capture panel and enables FIDO encryption using the vault unlocked during
sign-in. Tap the key when the browser asks. Do not run it in parallel with
another auth flow using the same test account. Vitest/Jest unit tests remain
mocked and deterministic; the hardware-gated Playwright test verifies the
browser WebAuthn boundary.

## 1. FIDO authentication and enrollment

1. Sign out, open the Auth route, and choose **Use FIDO security key**. Confirm
   the browser requests the enrolled security-key credential, then complete its
   PIN/touch prompt. Verify the app signs in and reports the FIDO credential as
   enrolled.
2. Sign out and choose **Sign in with Passkey**. Verify the ordinary passkey
   path remains distinct and still works.
3. If using a fresh test account, sign in with its password, open the FIDO
   enrollment dialog, confirm the dialog tells you to plug in the key, enter the
   account password, and complete the browser's enrollment prompts. Confirm a
   success notification appears. Refresh the app and verify enrollment is
   remembered; do not enroll repeatedly just because the key asks for its PIN.
4. Remove the key and confirm FIDO vault encryption cannot be enabled. Reinsert
   it, unlock the vault, and confirm the capture setup stays open throughout the
   prompt.

## 2. Encrypted I/Q capture and in-app decryption

Repeat for `.iq` and `.napt`:

1. Select the format, unlock the FIDO vault, and enable **FIDO vault
   encryption**. Confirm **Increased protection** is disabled/off for a FIDO
   capture and that no Redis per-capture salt is requested.
2. Capture a short known signal. Confirm the saved file is identified as
   FIDO-vault encrypted and its size is nonzero.
3. Use **Playback after capture**. Confirm metadata loads, playback starts, and
   the displayed I/Q frame data and frame timing match the known capture. There
   should be no `Invalid N-APT header` message.
4. Reopen the saved file from **File Selection** while the vault is unlocked.
   Confirm the same metadata, I/Q bytes, and playback are available.
5. Lock/sign out and try opening the same file. It must fail closed with a clear
   vault-unlock message, not show fabricated/zeroed playback or corrupt the
   file. Unlock again and verify the file works.
6. For `.napt`, include enough frame updates to make the JSON header exceed
   8 KiB. Confirm both metadata inspection and playback still work.

Capture metadata is currently plaintext. The binary I/Q payload is encrypted;
format, acquisition parameters, timestamps, frame updates, and the encrypted
recovery wrapper remain visible to anyone who has the file. This is expected in
the current format and is separate from payload confidentiality.

## 3. Batch decryption in `n-apt-ml`

1. Copy only the encrypted test artifact into a local acceptance directory in
   the `n-apt-ml` checkout. Keep the recovery passphrase in its existing
   owner-only `.env.local` configuration; do not configure a Redis salt for
   FIDO-vault files.
2. Run the repository's documented package/archive and `prepare --package`
   workflow on the FIDO `.iq` and `.napt` artifacts. Verify both decrypt in one
   batch process with the recovery wrapper, without a browser or WebAuthn
   prompt.
3. Compare the decrypted I/Q bytes, frame offsets, and timestamps with the
   known test signal and the app playback result.
4. Repeat with a wrong recovery passphrase and with a damaged encrypted payload.
   Both must fail authentication and produce no accepted plaintext dataset.
5. Confirm temporary decrypted buffers/output stay in the local-only temporary
   directory and are removed or retained only as explicitly configured local
   acceptance output.

## 4. WAV behavior

1. Select `.wav`. Confirm the FIDO encryption toggle is disabled/off and
   **Increased protection** does not imply encryption for this format.
2. Capture and reopen the WAV. Confirm RIFF/WAVE metadata parses, the stored I/Q
   bytes and frame timing match the known capture, and playback succeeds.
3. Confirm the file is explicitly marked unencrypted. Encrypted WAV is not
   supported by the current backend and must not be presented as protected.

## Record results

Record browser/OS versions, authenticator model/firmware, selected file format,
which prompts appeared, and pass/fail for each step. Record only safe error
messages and file hashes; never include secrets or decrypted signal data.
