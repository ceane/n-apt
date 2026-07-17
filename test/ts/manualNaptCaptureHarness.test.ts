import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const SCRIPT = join(process.cwd(), "scripts/test/manual_napt_capture_harness.mjs");

function encryptGcm(plaintext: Buffer, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

describe("manual NAPT capture harness", () => {
  test("CLI help is manual and does not require a capture or password", () => {
    const output = execFileSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
    expect(output).toMatch(/--input/);
    expect(output).toMatch(/--out-dir/);
    expect(output).toMatch(/raw interleaved I\/Q/i);
  });

  test("decrypts a capture, writes raw IQ, and extracts selected frames", () => {
    const directory = mkdtempSync(join(tmpdir(), "napt-harness-test-"));
    try {
      const password = "harness-test-password";
      const salt = "harness-test-salt";
      const vaultKey = crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256");
      const dataKey = crypto.randomBytes(32);
      const iq = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
      const metadata = {
        encrypted: true,
        fft_size: 4,
        sample_rate_hz: 3_200_000,
        channels: [{ offset_iq: 0, iq_length: iq.length }],
        wrapped_dek: encryptGcm(dataKey, vaultKey).toString("base64"),
      };
      const header = Buffer.alloc(4096, 32);
      const headerJson = Buffer.from(JSON.stringify(metadata));
      headerJson.copy(header);
      const input = join(directory, "labeled.napt");
      writeFileSync(input, Buffer.concat([header, encryptGcm(iq, dataKey)]));
      const outputDir = join(directory, "output");
      const output = execFileSync(process.execPath, [SCRIPT, "--input", input, "--out-dir", outputDir, "--frames", "3,1,3"], {
        encoding: "utf8",
        env: { ...process.env, UNSAFE_LOCAL_USER_PASSWORD: password, NAPT_PBKDF2_SALT: salt },
      });
      const summary = JSON.parse(output);
      expect(summary.frame_count).toBe(2);
      expect(readFileSync(join(outputDir, "raw.iq.u8"))).toEqual(iq);
      expect(readFileSync(join(outputDir, "frames/frame_000003.iq.u8"))).toEqual(iq.subarray(24, 32));
      expect(readFileSync(join(outputDir, "frames/frame_000001.iq.u8"))).toEqual(iq.subarray(8, 16));
      const manifest = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"));
      expect(manifest.frames.map((frame: { index: number }) => frame.index)).toEqual([3, 1]);
      expect(JSON.stringify(manifest)).not.toMatch(/password|wrapped_dek|key/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
