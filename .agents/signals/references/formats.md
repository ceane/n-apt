# Signal file format support

Use this matrix to keep inspection, validation, demodulation, playback, and
capture claims separate. An extension alone does not prove the file's schema,
encryption state, or successful integrity verification.

| Input/output | CLI inspect | CLI validate | CLI spectrum | CLI demod | App playback / capture notes |
|---|---|---|---|---|---|
| Raw `.iq` bytes | Yes; treats non-`NAPT-IQ3` bytes as raw I/Q and reports byte count/sample estimate. No frequency metadata is available. | Metadata validation fails because raw input has no metadata. | Current implementation computes magnitude statistics directly over the input byte pairs; it is not an FFT. | Yes; demod path consumes raw input bytes. | File playback depends on the app loader's supported raw-file workflow and user-provided settings/metadata. |
| NAPT-IQ3 `.iq` | Yes; parses the header and metadata and reports payload length. This is not full artifact verification or decryption. | Checks required center frequency and sample rate; warns about absent/invalid frequency range and encrypted payload. | Do not use as an FFT or payload-only analysis: the current summary reads input bytes as pairs, including container/header bytes. | Do not assume support: the CLI demod harness currently treats input bytes as raw I/Q. | App file worker parses indexed/legacy layouts and may decrypt supported payloads. V6 playback must respect frame updates and byte offsets. |
| `.napt` capture | Not supported by the signals CLI inspector, which recognizes NAPT-IQ3 `.iq` containers only. | Not supported by CLI signal metadata validation. | Not a supported container-aware summary input. | Not supported as a container-aware demod input. | Backend capture format is encrypted; app playback requires the authorized decryption path. V6 backend captures include integrity and frame-update metadata. |
| `.wav` capture | Not supported by signals inspector as a project container. | Not supported by CLI signal metadata validator. | Do not treat as ordinary audio or an FFT input. | Not supported as a container-aware demod input. | Project RIFF/WAVE with two unsigned 8-bit channels for I/Q and custom `nAPT` metadata; encryption is unsupported. Generic audio software may alter or misread it. |
| CLI demodulated output (`.iq`) | Written as a NAPT-IQ3 container, currently format version 4. | Required metadata may be present in its generated metadata; inspect actual output. | Summary caveat for NAPT-IQ3 applies. | The CLI writes demodulated PCM data in a project container; it is not a generic RF I/Q capture. | Do not assume interchangeability with capture-produced V6 `.iq`. |

## Verification boundaries

- `signals inspect` parses enough NAPT-IQ3 header data to report metadata and
  payload size. It does not authenticate, decrypt, or fully verify the file.
- `signals validate` checks a small required-metadata set. A valid result does
  not establish payload integrity, continuity, or signal presence.
- The `capture iq` downloader separately checks the job checksum and, for
  downloaded V6 `.iq` and `.napt`, embedded integrity and required frame-update
  history. Its WAV path verifies RIFF/WAVE structure and the job checksum.
- V6's SHA-256 integrity digest detects file changes but is unkeyed and is not
  a producer signature. AES-GCM authentication applies to supported encrypted
  payloads when decrypted with the authorized key.
- Browser playback compatibility is broader than CLI processing. Consult
  `docs/IQ-CAPTURE-FORMATS.md` and the file worker before changing format
  behavior; map both writers and readers.

For format generations, offset units, integrity semantics, and encryption
details, see [`docs/IQ-CAPTURE-FORMATS.md`](../../../docs/IQ-CAPTURE-FORMATS.md).
