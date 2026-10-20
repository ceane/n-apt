import {
  derivePrfAesKey,
  getVaultPrfResult,
  requestVaultPrf,
  WEBAUTHN_PRF_VAULT_INPUT,
} from "@n-apt/crypto/webauthnPrf";

describe("WebAuthn PRF key helpers", () => {
  test("requests a stable domain-separated PRF input", () => {
    const input = requestVaultPrf();
    expect(new Uint8Array(input.prf.eval.first)).toEqual(
      WEBAUTHN_PRF_VAULT_INPUT,
    );
    expect(WEBAUTHN_PRF_VAULT_INPUT.byteLength).toBeGreaterThanOrEqual(32);
  });

  test("accepts only a 32-byte authenticator PRF result", () => {
    const credential = {
      getClientExtensionResults: () => ({
        prf: { results: { first: new Uint8Array(32).buffer } },
      }),
    } as unknown as PublicKeyCredential;
    expect(getVaultPrfResult(credential)).toEqual(new Uint8Array(32));

    const unsupported = {
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
    expect(() => getVaultPrfResult(unsupported)).toThrow(/did not return/i);
  });

  test("derives deterministic, non-extractable and purpose-separated keys", async () => {
    const prf = new Uint8Array(32).fill(7);
    const salt = new Uint8Array(32).fill(8);
    const vaultKey = await derivePrfAesKey(prf, salt, "vault-wrap");
    const sameVaultKey = await derivePrfAesKey(prf, salt, "vault-wrap");
    const sessionKey = await derivePrfAesKey(prf, salt, "session");

    expect(vaultKey.type).toBe("secret");
    expect(vaultKey.extractable).toBe(false);
    const nonce = new Uint8Array(12);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      vaultKey,
      new TextEncoder().encode("vault key envelope"),
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      sameVaultKey,
      encrypted,
    );
    expect(new TextDecoder().decode(decrypted)).toBe("vault key envelope");
    await expect(
      crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        sessionKey,
        encrypted,
      ),
    ).rejects.toThrow();
  });

  test("rejects undersized inputs", async () => {
    await expect(
      derivePrfAesKey(new Uint8Array(31), new Uint8Array(32), "vault-wrap"),
    ).rejects.toThrow(/32 bytes/);
    await expect(
      derivePrfAesKey(new Uint8Array(32), new Uint8Array(15), "vault-wrap"),
    ).rejects.toThrow(/16 random bytes/);
  });
});
