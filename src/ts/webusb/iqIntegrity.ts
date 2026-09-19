const PLACEHOLDER = "0".repeat(64);
const encoder = new TextEncoder();

export const NAPT_FORMAT_VERSION = 5;
export const NAPT_TRAILER_VERSION = 2;
export const INTEGRITY_SCOPE = "file-with-integrity-digest-placeholder";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const findToken = (bytes: Uint8Array, token: string): number => {
  const marker = encoder.encode(token);
  outer: for (let offset = 0; offset <= bytes.length - marker.length; offset += 1) {
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[offset + index] !== marker[index]) continue outer;
    }
    return offset;
  }
  return -1;
};

export const stampIntegrity = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const placeholderOffset = findToken(bytes, PLACEHOLDER);
  if (placeholderOffset < 0) throw new Error("Integrity digest placeholder is missing");
  const digestInput = bytes.slice();
  const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput.buffer)));
  const result = bytes.slice();
  result.set(encoder.encode(digest), placeholderOffset);
  return result;
};

export const verifyStampedIntegrity = async (
  bytes: Uint8Array,
  digest: string,
): Promise<boolean> => {
  if (!/^[0-9a-f]{64}$/.test(digest)) return false;
  const placeholderOffset = findToken(bytes, digest);
  if (placeholderOffset < 0) return false;
  const normalized = bytes.slice();
  normalized.set(encoder.encode(PLACEHOLDER), placeholderOffset);
  const calculated = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", normalized.buffer)));
  return calculated === digest;
};

export const integrityPlaceholder = (): string => PLACEHOLDER;
