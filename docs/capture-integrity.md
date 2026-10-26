# Capture integrity and public metadata

Metadata remains readable. New encrypted IQ and NAPT captures declare
`payload_authentication: "public-sections-v1"`. Their AES-256-GCM tag binds all
public file bytes using the following associated data:

1. Locate the binary section using the container header / section index.
2. Concatenate all bytes before the binary section with all bytes after it.
3. Replace only the indexed trailer's `integrity.digest` value with 64 ASCII
   zeroes. Reject missing, malformed, or ambiguous digest fields.
4. SHA-256 this byte sequence; use the 32 raw digest bytes as GCM associated data.

The public SHA-256 file checksum is stamped after encryption, with its own
field normalized to the same placeholder. Verify it before consuming V5+
files. A checksum detects corruption; recomputing it cannot repair an invalid
GCM tag. Changing or removing the authentication declaration also invalidates
the tag. DEK wrapping and the streaming wire format are unchanged.

Existing captures remain readable with their original encryption rules. Their
metadata cannot gain cryptographic authentication without re-encryption.
Readers enforce the checksum for existing V5+ captures as well.

Exports inspect the actual container encryption declaration and encrypted
section, rather than searching labels or samples for an encryption marker.
FIDO exports also require a recovery wrapper, a wrapped DEK for NAPT, and a
valid file checksum before bypassing the ordinary export envelope.
