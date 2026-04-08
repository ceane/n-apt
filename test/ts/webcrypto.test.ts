import {
  deriveRawKey,
  deriveAesKey,
  computeHmac,
  decryptPayload,
  decryptPayloadBytes,
  decryptBinaryPayload,
  bytesToBase64,
  base64ToBytes,
} from "../../src/ts/crypto/webcrypto";

describe("webcrypto service", () => {
  const testPassword = "test-password-123";
  const testPayload = "Hello, N-APT!";
  
  test("Base64 helpers provide round-trip consistency", () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = bytesToBase64(original);
    expect(b64).toBe("SGVsbG8=");
    const decoded = base64ToBytes(b64);
    expect(decoded).toEqual(original);
  });

  test("deriveRawKey returns a 32-byte ArrayBuffer", async () => {
    const rawKey = await deriveRawKey(testPassword);
    expect(rawKey.byteLength).toBe(32); // 256 bits
  });

  test("deriveAesKey returns an AES-GCM CryptoKey", async () => {
    const aesKey = await deriveAesKey(testPassword);
    expect(aesKey.type).toBe("secret");
    expect((aesKey.algorithm as any).name).toBe("AES-GCM");
  });

  test("computeHmac produces consistent base64 HMAC signatures", async () => {
    const nonce = bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const hmac1 = await computeHmac(testPassword, nonce);
    const hmac2 = await computeHmac(testPassword, nonce);
    
    expect(typeof hmac1).toBe("string");
    expect(hmac1.length).toBeGreaterThan(0);
    expect(hmac1).toBe(hmac2);

    const hmacDifferent = await computeHmac("wrong-password", nonce);
    expect(hmac1).not.toBe(hmacDifferent);
  });

  test("AES-GCM decryption works for valid payloads", async () => {
    const rawKey = await deriveRawKey(testPassword);
    const aesKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const msg = new TextEncoder().encode(testPayload);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      msg
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    const b64Payload = bytesToBase64(combined);
    
    // Test decryptPayload
    const decrypted = await decryptPayload(aesKey, b64Payload);
    expect(decrypted).toBe(testPayload);

    // Test decryptPayloadBytes
    const decryptedBytes = await decryptPayloadBytes(aesKey, b64Payload);
    expect(new TextDecoder().decode(decryptedBytes)).toBe(testPayload);

    // Test decryptBinaryPayload
    const decryptedBinary = await decryptBinaryPayload(aesKey, combined);
    expect(new TextDecoder().decode(decryptedBinary)).toBe(testPayload);
  });

  test("decryption fails with wrong key", async () => {
    const correctRawKey = await deriveRawKey(testPassword);
    const correctEncryptKey = await crypto.subtle.importKey(
      "raw",
      correctRawKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    const wrongKey = await deriveAesKey("wrong-password");
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      correctEncryptKey,
      new TextEncoder().encode(testPayload)
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    await expect(decryptBinaryPayload(wrongKey, combined)).rejects.toThrow();
  });
});
