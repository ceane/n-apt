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

/** Add this extension input to WebAuthn creation or request options. */
export function requestVaultPrf(): PrfExtensionInput {
  return {
    prf: {
      eval: {
        first: WEBAUTHN_PRF_VAULT_INPUT.slice().buffer,
      },
    },
  };
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
