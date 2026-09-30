# I/Q capture file formats

The app writes three proprietary project formats. They all store unsigned 8-bit interleaved I/Q samples and capture metadata. The extensions describe intended use and packaging; they are not general interchange standards.

| Extension | Intended use | Encryption | Recommendation |
| --- | --- | --- | --- |
| `.napt` | Sensitive N-APT captures | Required | Use for sensitive captures |
| `.iq` | Canonical project I/Q container | Optional | Preferred general-purpose format |
| `.wav` | Project I/Q carried in RIFF/WAVE | Unsupported | Compatibility option; not recommended |

> [!NOTE]
> `.wav` is not ordinary audio. The app stores I and Q as two 8-bit PCM channels and adds project metadata in a custom `nAPT` chunk. Generic audio tools may misread the samples or remove project metadata.

## At a glance

- **`.napt`:** The backend gets its encryption password from `UNSAFE_LOCAL_USER_PASSWORD` in `.env.local`. WebUSB asks for a passphrase. The binary I/Q payload is encrypted; the JSON metadata remains readable.
- **`.iq`:** Uses the app's canonical binary container. The payload can be encrypted or plaintext.
- **`.wav`:** Uses RIFF/WAVE with custom N-APT metadata and channel chunks. Encryption is not supported.

## What the files contain

All formats store the raw samples as:

```text
I0, Q0, I1, Q1, I2, Q2, ...
```

- Each value is an unsigned 8-bit integer.
- Each complex I/Q sample uses two bytes.
- The usual normalization is `(value - 128) / 127`.
- Metadata describes sample encoding, sample rates, frequency, FFT settings, device, duration, gain, PPM, and available channel information.

### Offset units

V6 has two offset units. Keep them distinct:

- **Chunk `sample_offset`:** complex samples, within a channel. One step is one I/Q pair, or two bytes.
- **Frame-update `sample_offset`:** bytes, within that channel's raw I/Q stream. It points to the first byte of the frame associated with the update.

For example, two complex samples occupy four bytes. A single-channel chunk usually starts at sample offset `0`. Multichannel files store one chunk per channel. Frame updates carry a channel index; readers route them to the relevant channel for playback.

## V6 `.iq` container

![Diagram of the V6 IQ container sections and offset units](images/iq-container-v6.png)

The file is laid out in this order:

1. **40-byte fixed header**
2. **UTF-8 JSON metadata**
3. **UTF-8 JSON frame-update array**
4. **Binary payload**, optionally encrypted
5. **Integrity trailer**

The header starts with the eight-byte magic `NAPT-IQ3`. It then stores four little-endian 64-bit lengths: metadata, frame updates, and payload, followed by an encrypted flag and seven reserved bytes. Use these lengths to locate each section.

### Metadata and frame updates

Metadata includes:

- `format: "iq"`, `format_version: 6`, and `interleaving: "IQ"`
- `sample_encoding`
- center, capture, and hardware sample rates
- FFT size and window, duration, frame rate, gain, and PPM
- channels, device profile, and optional location or frequency range
- `originalVersion` when a WebUSB upgrade preserves the source schema version

Each frame update has a byte `sample_offset` and `timestamp_us`. Optional fields include `kind`, `frame_sequence`, `channel`, `source_id`, `job_id`, and `patch`.

- A `Frame` entry gives the timestamp and zero-based sequence for a captured frame.
- A `PatchOptionsApplied` entry records settings effective at that boundary, such as FFT size or center frequency.
- Multiple entries can share an offset because they describe the same frame boundary.
- V6 timestamps are elapsed processing-time microseconds from capture start. They are not hardware-clock timestamps.

### Payload and encryption

The binary payload contains channel chunks. Each chunk is:

```text
u64 little-endian  complex-sample offset
u32 little-endian  channel index
u64 little-endian  data length in bytes
bytes   interleaved I/Q data
```

Optional private device metadata uses this prefix before the chunks:

```text
PMD3 || u64 little-endian JSON length || JSON bytes
```

When encryption is enabled, the complete payload, including private metadata, is encrypted together:

```text
12-byte random AES-GCM nonce || ciphertext || 16-byte authentication tag
```

The metadata and frame updates remain readable. Encrypted `.iq` uses the app's password-derived vault key. Private device metadata is only written in encrypted `.iq` files.

`metadata.sections.binary` and `metadata.sections.trailer` give absolute file offsets and lengths for their respective sections.

## V6 `.napt` container

![Diagram of the V6 NAPT header, encrypted payload, and integrity trailer](images/napt-container-v6.png)

The file contains:

1. **Plaintext UTF-8 JSON header** wrapped as `{"metadata": ...}`
2. **Padding** up to the indexed binary offset
3. **Encrypted binary section** containing the concatenated channel data
4. **Integrity trailer**

The header size is dynamic: at least 4096 bytes, rounded to a 1024-byte boundary. Readers must use `sections.binary.offset_bytes`; they should not assume every header is exactly 4096 bytes.

Channel entries describe the concatenated payload:

- `offset_iq` is a byte offset, despite the historical field name.
- `iq_length` is a byte length.
- Entries also carry sample rate, center frequency, `bins_per_frame`, and optional range and label.
- Channel lengths together must cover the complete plaintext payload.

`.napt` requires encryption. A fresh data-encryption key (DEK) encrypts the binary section with AES-GCM. The app wraps the DEK with the password-derived vault key and stores it as Base64 in `wrapped_dek`.

> [!IMPORTANT]
> The `.napt` header is plaintext. This includes capture metadata, frame timing, channel layout, and the wrapped DEK. Do not put secrets in metadata fields.

### Password source

- **Backend captures:** derive the vault key from `UNSAFE_LOCAL_USER_PASSWORD`, loaded from `.env.local`.
- **WebUSB captures:** derive the key from the passphrase entered for that capture.
- Both use the configured PBKDF2 parameters below. To share a decryption credential, the entered passphrase must match the backend password.

## WAV container

The project `.wav` writer emits RIFF/WAVE with:

- A PCM format chunk.
- A custom `nAPT` JSON metadata chunk containing channels and frame updates.
- A `data` chunk for the first channel and project-specific `nIQ1`, `nIQ2`, and later chunks for additional channels.

The WAV metadata version is currently 3. WAV captures are plaintext. Standard WAV tools may ignore extra channel chunks or remove the custom metadata. Use `.iq` for canonical project I/Q files.

## Integrity trailer

V4 introduced indexed sections and the `NAPTTRLR` trailer. Its 24-byte binary header is followed by JSON:

```text
8 bytes   NAPTTRLR magic
1 byte    trailer version (V6 writers use version 2)
7 bytes   reserved
u64 little-endian    trailer JSON length
JSON      trailer metadata
```

V6 trailer JSON includes a SHA-256 integrity record:

- Algorithm: `SHA-256`
- Scope: `file-with-integrity-digest-placeholder`
- Digest: 64 hexadecimal characters

The digest covers the complete serialized file, treating the digest field as 64 zeroes while hashing. It detects changes, but is not a signature and does not prove who created the file. Encrypted payloads also have AES-GCM authentication. Plaintext `.iq` and `.wav` files have no keyed origin authentication.

The trailer stays readable when the payload is encrypted. V6 writers also include processing provenance, such as operation and tool version.

## Compatibility

- V1–V3 layouts have no indexed sections or trailer.
- V4 introduced the indexed binary and trailer sections.
- Trailer version 2 carries V5 and later SHA-256 integrity metadata.
- V6 adds per-frame `Frame` timestamps and sequences.
- Readers retain compatibility paths for older layouts and trailer versions.
- Legacy files without integrity can remain playable; their integrity status is unavailable.
- Invalid integrity is rejected unless the caller selects the recovery path where supported.
- The WebUSB encoder can preserve an older source version in `originalVersion` when upgrading `.iq` files. The backend capture writer writes new captures; it does not upgrade old files.
- `.wav` keeps its separate version-3 metadata layout.
- Do not trust the extension alone. Supported writers require `.napt` encryption, but external or malformed files still need section and metadata validation.

## Password key and online-copy salt

There are two separate salts in the app.

### Password-derived vault key

Rust and browser code use:

- PBKDF2-HMAC-SHA-256
- 100,000 iterations
- A 256-bit AES key
- Default UTF-8 salt: `n-apt-aes-salt-v1`

The backend can override the salt with `NAPT_PBKDF2_SALT`; the browser can use `VITE_PBKDF2_SALT` (or its supported fallback). Frontend and backend settings must match. This is shared configuration, not a per-file secret or a substitute for a strong password.

### Protected online copies

When the backend writes an extra protected copy for destinations such as Aspect or training-capture exports:

1. It creates a random 32-byte salt per capture job.
2. It derives a per-capture key from the vault key using HMAC-SHA-256 extract/expand and context `n-apt/capture-protection/v1`.
3. It encrypts the original file into this outer envelope:

   ```text
   NAPTENC1 || 32-byte salt || 12-byte AES-GCM nonce || ciphertext || 16-byte tag
   ```

4. It stores the salt in Redis under `capture-protection:<jobId>` for later requests.

The envelope includes the salt, so a compatible tool can decrypt it using the vault key. This outer wrapper does not change the inner `.napt`, `.iq`, or `.wav` file.

> [!NOTE]
> `NAPTENC1` is a backend storage/export wrapper, not a playback format. The browser file reader does not open it directly; unwrap it before normal file playback.

## Current limitations

- Frame timestamps report processing observation times, not hardware acquisition-clock ticks.
- Hardware-clock synchronization and absolute per-sample time are not encoded.
- The formats do not define compression or sparse/zero-run encoding.
- `.wav` is project-specific and is not a validated SDR interchange format.
- The SHA-256 trailer is unkeyed. It does not establish file origin.
- The online-copy wrapper needs a backend or compatible decryption step before browser playback.

## Related implementation

- Backend writer and V6 IQ codec: `src/rs/server/utils.rs`, `src/rs/server/iq_format.rs`
- WebUSB writers and encoders: `src/ts/webusb/iqCapture.worker.ts`, `src/ts/webusb/iqCaptureFormat.ts`
- Frontend file reader: `src/ts/workers/fileWorker.ts`
- Backend cryptography and online-copy envelope: `src/rs/crypto/mod.rs`, `src/rs/server/http_endpoints.rs`
- Cross-language acceptance test: `npm run test:iq-capture:cross-language`

## File playback

The app reads capture files through the frontend worker and replays the decoded I/Q frames in the signal display. This screenshot shows file selection, metadata, and playback controls in use.

![File playback view showing selected capture, metadata, FFT display, and waterfall](images/iq-file-playback.png)
