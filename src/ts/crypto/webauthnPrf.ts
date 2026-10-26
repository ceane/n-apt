/**
 * WebAuthn PRF helpers for authenticators that expose the FIDO2 hmac-secret
 * extension (including supported YubiKeys). A normal WebAuthn signature does
 * not provide key material; callers must request PRF and check its output.
 */

export const WEBAUTHN_PRF_VAULT_INPUT = new TextEncoder().encode(
  "n-apt/webauthn-prf/v1/vault-unlock",
);

export type PrfExtensionInput = {
  prf: {
    eval: {
      first: ArrayBuffer;
    };
  };
};

export type WebAuthnPrfCredential = PublicKeyCredential & {
  getClientExtensionResults(): {
    prf?: {
      enabled?: boolean;
      results?: { first?: ArrayBuffer };
    };
  };
};

export interface VaultKeyWrapper {
  format: "n-apt-vault-key-wrapper-v1";
  salt: string;
  nonce: string;
  ciphertext: string;
}

export const VAULT_RECOVERY_KDF_ITERATIONS = 600_000;

/** Add this extension input to WebAuthn creation or request options. */
export function requestVaultPrf(
  input: Uint8Array = WEBAUTHN_PRF_VAULT_INPUT,
): PrfExtensionInput {
  return {
    prf: {
      eval: {
        first: input.slice().buffer,
      },
    },
  };
}

/** Derive a local recovery wrapper key for offline capture tools. */
export async function deriveRecoveryAesKey(
  recoveryCredential: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  if (!recoveryCredential.trim()) {
    throw new Error("Vault recovery credential must not be empty.");
  }
  if (salt.byteLength !== 32) {
    throw new Error("Vault recovery salt must contain 32 random bytes.");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(recoveryCredential.trim()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt.slice().buffer as ArrayBuffer,
      iterations: VAULT_RECOVERY_KDF_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt", "encrypt"],
  );
}

/** Wrap a random 32-byte vault master key for FIDO or offline recovery. */
export async function wrapVaultMasterKey(
  vaultMasterKey: Uint8Array,
  wrappingKey: CryptoKey,
  salt: Uint8Array,
): Promise<VaultKeyWrapper> {
  if (vaultMasterKey.byteLength !== 32) {
    throw new Error("Vault master key must contain 32 bytes.");
  }
  if (salt.byteLength !== 32) {
    throw new Error("Vault wrapper salt must contain 32 random bytes.");
  }
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const format = "n-apt-vault-key-wrapper-v1" as const;
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: new TextEncoder().encode(format),
    },
    wrappingKey,
    vaultMasterKey.slice().buffer as ArrayBuffer,
  );
  return {
    format,
    salt: encodeBase64(salt),
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
  };
}

/** Fail closed if wrapper metadata is malformed or its authenticated data fails. */
export async function unwrapVaultMasterKey(
  wrapper: VaultKeyWrapper,
  wrappingKey: CryptoKey,
): Promise<Uint8Array> {
  if (wrapper.format !== "n-apt-vault-key-wrapper-v1") {
    throw new Error("Unsupported vault key wrapper format.");
  }
  const nonce = decodeBase64(wrapper.nonce);
  const ciphertext = decodeBase64(wrapper.ciphertext);
  if (nonce.byteLength !== 12 || ciphertext.byteLength !== 48) {
    throw new Error("Vault key wrapper has invalid nonce or ciphertext length.");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce.slice().buffer as ArrayBuffer,
      additionalData: new TextEncoder().encode(wrapper.format).buffer as ArrayBuffer,
    },
    wrappingKey,
    ciphertext.slice().buffer as ArrayBuffer,
  );
  if (plaintext.byteLength !== 32) {
    throw new Error("Unwrapped vault master key has an invalid length.");
  }
  return new Uint8Array(plaintext);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Vault key wrapper contains invalid base64 data.");
  }
}

/**
 * Get the PRF result from a completed WebAuthn assertion. Fail closed when
 * the browser/authenticator ignored the extension; never substitute an empty
 * value or a value derived from the credential ID/signature.
 */
export function getVaultPrfResult(credential: PublicKeyCredential): Uint8Array {
  const prf = (credential as WebAuthnPrfCredential).getClientExtensionResults()
    .prf;
  const result = prf?.results?.first;
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) {
    throw new Error(
      "This security key or browser did not return a WebAuthn PRF result.",
    );
  }
  return new Uint8Array(result.slice(0));
}

/**
 * Derive a non-extractable AES-256-GCM key from the authenticator PRF result.
 * `salt` must be random and stored with the wrapped vault key; `purpose` is
 * domain separation, so the same PRF result cannot be reused as another key.
 */
export async function derivePrfAesKey(
  prfResult: Uint8Array,
  salt: Uint8Array,
  purpose: string,
  usages: KeyUsage[] = ["decrypt", "encrypt"],
): Promise<CryptoKey> {
  if (prfResult.byteLength !== 32) {
    throw new Error("WebAuthn PRF output must be exactly 32 bytes.");
  }
  if (salt.byteLength < 16) {
    throw new Error("HKDF salt must contain at least 16 random bytes.");
  }
  if (!purpose || purpose.length > 128) {
    throw new Error("Key derivation purpose must be 1–128 characters.");
  }

  const material = await crypto.subtle.importKey(
    "raw",
    prfResult.slice().buffer as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt.slice().buffer as ArrayBuffer,
      info: new TextEncoder().encode(`n-apt/${purpose}/v1`)
        .buffer as ArrayBuffer,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}
