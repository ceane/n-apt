# YubiKey vault unlock with WebAuthn PRF

## What FIDO can provide

WebAuthn passkey login proves possession of a credential by signing a fresh
server challenge. The signature is not an encryption key and cannot be turned
into one. A FIDO2 authenticator that supports `hmac-secret` can additionally
return a 32-byte per-credential PRF result through the WebAuthn `prf` extension.
The browser mediates this result; the application must request it and fail
closed if it is missing. YubiKey 5 and Bio models with FIDO2 support are a
target, but browser, OS, firmware, and credential configuration all affect
availability.

The branch adds `src/ts/crypto/webauthnPrf.ts` as a small primitive layer. It
provides a stable vault-purpose PRF input, validates returned output, and
derives non-extractable AES-GCM keys through HKDF-SHA-256. It is not wired into
the login or file pipeline yet.

## Capture control behavior

The intended UI is a second encryption toggle in
`IQCaptureControlsSection`, available only when the authenticated session has
an unlocked, PRF-capable FIDO credential. It selects the encryption scheme for
that capture; it must not silently change the existing password/server-key
mode. The normal mode stays available and unchanged.

The capture-specific key should be derived before capture starts, while the
user can interact with WebAuthn. If a device/plugin handshake is delayed, use
a bounded wait state with a visible deadline. Any capture data produced during
that wait must remain in a bounded in-memory chunk queue with backpressure; on
timeout, cancel the capture, clear the queue and report failure. Never write
plaintext to a temporary file or fall back to the ordinary encryption key.
Once the key is ready, encrypt each chunk before it crosses the persistence
boundary. For downloads to external destinations, upload only the encrypted
artifact.

The current acquisition path is Rust-backend-driven and persists capture
artifacts there. To keep the PRF key out of the backend, the selected mode
needs a streamed capture path that sends chunks to the browser for encryption
before the backend or another destination persists them. Sending the raw
PRF-derived key to Rust would make it a server-held key and would not provide
client-side-only encryption. If the product instead chooses server-side
encryption with an ephemeral key handed to Rust, state that trust boundary
clearly and keep the key memory-only for the session/capture.

## Current application boundary

- Password login uses a password-derived HMAC challenge response.
- Passkey login verifies WebAuthn assertions and issues a normal random session
  token.
- `/auth/vault-key` returns the configured password-derived encryption key to
  an authenticated client.
- Rust capture handlers and streaming paths use the server's configured
  encryption key. The Redis session's random key is currently separate from
  that vault key.

Therefore, adding a YubiKey button by itself would authenticate a user but
would not unlock a distinct YubiKey-protected vault. Sending the PRF output or
derived vault key to the existing server would let that server decrypt files;
the current arrangement is server-side encryption at rest, not end-to-end
encryption.

## Recommended key hierarchy

1. Generate a random 256-bit vault master key (VMK) once, using the browser
   cryptographic RNG.
2. For each enrolled FIDO credential, request PRF output using the fixed,
   application-specific input in the helper. Derive a wrapping key using
   HKDF-SHA-256 with a fresh random 32-byte salt and a purpose label.
3. AES-GCM-wrap the VMK with that wrapping key. Store only the ciphertext,
   salt, nonce, credential identifier, and format version on the server.
4. At sign-in, verify the ordinary WebAuthn assertion, request the same PRF
   output, derive the wrapping key, and unwrap the VMK locally. Never send the
   PRF result or VMK to the server.
5. Derive per-file data-encryption keys from the VMK and random per-file salts,
   or generate random per-file keys and wrap them with a VMK-derived key.
   Preserve a versioned envelope so old files can be migrated only after a
   successful old-key unlock.
6. Let multiple enrolled keys wrap the same VMK. Require an explicit recovery
   method before enabling this mode; losing the only security key otherwise
   makes the vault unrecoverable. Password fallback must not silently return
   the old server key.

This changes key custody and requires moving encryption/decryption of protected
files into the client. Keeping the server able to use a master key for capture
streams would not provide the intended client-side protection.

## Streaming and session keys

Large files can be encrypted as independently authenticated chunks with
AES-256-GCM. Use a random file identifier and a unique nonce per chunk (for
example, a random per-file nonce prefix plus a monotonically increasing 64-bit
chunk counter). Authenticate the file identifier, format version, chunk
counter, and final-chunk marker as additional authenticated data. Include an
authenticated final marker so truncation and reordering are detected. Keep
chunks bounded (for example, 1 MiB) and stream them through
`ReadableStream`/`TransformStream`; do not concatenate the entire file in
memory. The file key must be unique per file, or nonce uniqueness must be
guaranteed across every encryption with that key.

A per-login client session key can be derived from the unlocked VMK with HKDF
using fresh server-provided session salt and a session-specific info label, or
generated randomly and kept only in browser memory. It should be distinct from
the long-lived vault key and from the bearer session token. WebAuthn PRF must
not be invoked for every file chunk: it is a credential ceremony requiring
authenticator/browser participation, not a high-throughput streaming primitive.
The server's current random session key remains an independent session value;
it does not make the current server-side file encryption YubiKey-bound.

## Integration steps

1. Extend passkey enrollment to request PRF support and persist whether that
   credential returned the expected capability. Keep ordinary passkeys
   working when PRF is absent.
2. Add an explicit YubiKey/vault-unlock ceremony that requests PRF on an
   assertion and verifies the assertion server-side as it does today.
3. Introduce versioned VMK wrapper records and recovery/multiple-key flows.
4. Move the protected file read/write path to client-side chunked encryption;
   migrate legacy files after successful unlock.
5. Keep the authentication bearer token and vault-unlock key separate, add
   logout/lock memory clearing, and test failure, missing-extension, loss, and
   migration cases before exposing the button.

## Verification boundary

Unit tests cover PRF output validation and HKDF key derivation. They cannot
verify YubiKey/browser support or the full vault lifecycle; that needs a real
FIDO2 device and integration tests in a secure browser origin.
