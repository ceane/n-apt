import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  deriveAesKey,
  decryptBinaryPayload,
} from "../../src/ts/crypto/webcrypto";
import crypto from "node:crypto";

// Ensure WebCrypto is available in Node.js environment
if (typeof window === "undefined") {
  (global as any).crypto = crypto.webcrypto;
}

describe("Encryption Lifecycle Integration (Rust-Generated Test Vectors)", () => {
  const FIXTURE_PATH = path.resolve(__dirname, "fixtures/encrypted_test.napt");
  const FIXTURE_PASSWORD = "napt-test-fixture-password-v1";

  it("should exist the test fixture", () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
  });

  it("should correctly decrypt a backend-generated encrypted file", async () => {
    // 1. Read the fixture
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const fileArray = new Uint8Array(fileBuffer);

    // 2. Extract header and payload
    // The header is the first 4096 bytes (JSON)
    const headerBytes = fileArray.slice(0, 4096);

    const headerStr = new TextDecoder().decode(headerBytes).trim();
    const headerJson = JSON.parse(headerStr);
    const binaryLength = headerJson.metadata.sections.binary.length_bytes;
    const payloadBytes = fileArray.slice(4096, 4096 + binaryLength);

    expect(headerJson.metadata.encrypted).toBe(true);

    // 3. Derive key using the same password used to generate this fixture.
    const aesKey = await deriveAesKey(FIXTURE_PASSWORD);

    // 4. Handle DEK wrapping if present (New Format)
    let finalDecrypted: Uint8Array;
    if (headerJson.metadata.wrapped_dek) {
      // New format: Unwrap DEK using Vault Key
      const wrappedDekBytes = base64ToBytes(headerJson.metadata.wrapped_dek);
      const rawDek = await decryptBinaryPayload(aesKey, wrappedDekBytes);

      // Import the DEK as a new CryptoKey
      const dek = await crypto.webcrypto.subtle.importKey(
        "raw",
        rawDek.slice(0),
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );

      finalDecrypted = await decryptBinaryPayload(dek as any, payloadBytes);
    } else {
      // Legacy format: Decrypt directly with Vault Key
      finalDecrypted = await decryptBinaryPayload(aesKey, payloadBytes);
    }

    // 5. Verify decrypted content matches backend original
    // Original was vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE]
    const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
    expect(finalDecrypted).toEqual(expected);

    console.log("✅ Frontend successfully decrypted backend-generated payload");
  });

  it("should be invariant to trailing whitespace in the password", async () => {
    // This test verifies whitespace trimming matches backend key derivation.
    const PASSWORD_WITH_SPACE = `${FIXTURE_PASSWORD} `;
    const key1 = await deriveAesKey(FIXTURE_PASSWORD);
    const key2 = await deriveAesKey(PASSWORD_WITH_SPACE);

    // Export keys to compare their raw bits
    const raw1 = await crypto.webcrypto.subtle.exportKey("raw", key1);
    const raw2 = await crypto.webcrypto.subtle.exportKey("raw", key2);

    expect(new Uint8Array(raw1)).toEqual(new Uint8Array(raw2));
    console.log("✅ Password whitespace invariance verified on frontend");
  });
});

// Helper for base64 (since we are not in a browser environment with atob)
function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
