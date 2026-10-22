const PLACEHOLDER = "0".repeat(64);
const encoder = new TextEncoder();

export const NAPT_FORMAT_VERSION = 6;
export const NAPT_TRAILER_VERSION = 2;
export const INTEGRITY_SCOPE = "file-with-integrity-digest-placeholder";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

// Resolve the actual indexed trailer rather than a checksum-like label or sample.
export const integrityDigestOffset = (bytes: Uint8Array): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let start = bytes.length - 24; start >= 0; start--) {
    if (
      bytes[start] !== 78 ||
      new TextDecoder().decode(bytes.subarray(start, start + 8)) !==
        "NAPTTRLR" ||
      bytes[start + 8] !== 2
    )
      continue;
    const length = Number(view.getBigUint64(start + 16, true));
    if (start + 24 + length !== bytes.length) continue;
    const text = new TextDecoder().decode(bytes.subarray(start + 24));
    const matches = [...text.matchAll(/"digest"\s*:\s*"([0-9a-f]{64})"/g)];
    if (matches.length !== 1)
      throw new Error("Missing or ambiguous integrity digest");
    const parsed = JSON.parse(text);
    if (
      parsed.integrity?.algorithm !== "SHA-256" ||
      parsed.integrity?.scope !== INTEGRITY_SCOPE ||
      parsed.integrity?.digest !== matches[0][1]
    )
      throw new Error("Invalid integrity declaration");
    return (
      start +
      24 +
      encoder.encode(
        text.slice(0, matches[0].index! + matches[0][0].indexOf(matches[0][1])),
      ).length
    );
  }
  throw new Error("Invalid integrity trailer");
};

export const captureAdditionalData = async (
  bytes: Uint8Array,
  offset: number,
  length: number,
): Promise<ArrayBuffer> => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 28 ||
    offset + length > bytes.length
  )
    throw new Error("Invalid binary range");
  const digestOffset = integrityDigestOffset(bytes);
  if (digestOffset < offset + length) throw new Error("Invalid trailer range");
  const context = new Uint8Array(bytes.length - length);
  context.set(bytes.subarray(0, offset));
  context.set(bytes.subarray(offset + length), offset);
  context.set(encoder.encode(PLACEHOLDER), digestOffset - length);
  return crypto.subtle.digest("SHA-256", context.buffer);
};

export const stampIntegrity = async (
  bytes: Uint8Array,
): Promise<Uint8Array> => {
  const placeholderOffset = integrityDigestOffset(bytes);
  if (placeholderOffset < 0)
    throw new Error("Integrity digest placeholder is missing");
  const digestInput = Uint8Array.from(bytes);
  const digest = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput.buffer)),
  );
  const result = Uint8Array.from(bytes);
  result.set(encoder.encode(digest), placeholderOffset);
  return result;
};

export const verifyStampedIntegrity = async (
  bytes: Uint8Array,
  digest: string,
): Promise<boolean> => {
  if (!/^[0-9a-f]{64}$/.test(digest)) return false;
  let placeholderOffset: number;
  try { placeholderOffset = integrityDigestOffset(bytes); } catch { return false; }
  if (
    new TextDecoder().decode(
      bytes.subarray(placeholderOffset, placeholderOffset + 64),
    ) !== digest
  )
    return false;
  // Buffer.slice() returns a view, unlike Uint8Array.slice(). Clone through
  // Uint8Array so verification neither mutates Buffer callers nor hashes an
  // oversized backing slab.
  const normalized = Uint8Array.from(bytes);
  normalized.set(encoder.encode(PLACEHOLDER), placeholderOffset);
  const calculated = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", normalized.buffer)),
  );
  return calculated === digest;
};

export const integrityPlaceholder = (): string => PLACEHOLDER;
