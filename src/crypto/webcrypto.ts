/**
 * WebCrypto utilities for AES-256-GCM payload decryption and
 * HMAC-based challenge–response authentication.
 *
 * All parameters (salt, iterations, algorithm) MUST match the Rust backend
 * in src/crypto/mod.rs.
 */

const PBKDF2_ITERATIONS = 100_000
const PBKDF2_SALT = new TextEncoder().encode("n-apt-aes-salt-v1")
const IV_LENGTH = 12 // AES-GCM standard nonce size

/**
 * Derive a 256-bit AES key from a passkey using PBKDF2-HMAC-SHA256.
 * Returns a CryptoKey usable for both HMAC signing and AES-GCM decryption.
 */
export async function deriveRawKey(passkey: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passkey),
    "PBKDF2",
    false,
    ["deriveBits"],
  )

  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  )
}

/**
 * Derive a CryptoKey for AES-GCM decryption from a passkey.
 */
export async function deriveAesKey(passkey: string): Promise<CryptoKey> {
  const rawKey = await deriveRawKey(passkey)
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "decrypt",
  ])
}

/**
 * Compute HMAC-SHA256 over `data` using a key derived from the passkey.
 * Returns the HMAC as a base64 string.
 */
export async function computeHmac(
  passkey: string,
  nonceBase64: string,
): Promise<string> {
  const rawKey = await deriveRawKey(passkey)
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  const nonceBytes = base64ToBytes(nonceBase64)
  const signature = await crypto.subtle.sign("HMAC", hmacKey, nonceBytes.buffer as ArrayBuffer)
  return bytesToBase64(new Uint8Array(signature))
}

/**
 * Decrypt an AES-256-GCM encrypted payload.
 * Input: base64-encoded `IV (12 bytes) || ciphertext || tag (16 bytes)`
 * Returns the decrypted plaintext as a string.
 */
export async function decryptPayload(
  aesKey: CryptoKey,
  encryptedBase64: string,
): Promise<string> {
  const data = base64ToBytes(encryptedBase64)

  const iv = data.slice(0, IV_LENGTH)
  const ciphertext = data.slice(IV_LENGTH)

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext,
  )

  return new TextDecoder().decode(decrypted)
}

// ── Base64 helpers ──────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
